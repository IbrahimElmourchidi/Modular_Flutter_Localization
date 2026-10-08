/**
 * A real ICU MessageFormat parser for ARB messages.
 *
 * The generator used to find ICU constructs with regular expressions and
 * `indexOf`. Both are unsound for this grammar:
 *
 *   - `indexOf('one{')` matches inside a *word* ("Some**one{**") and inside a
 *     nested block, so plural cases were attributed to the wrong owner.
 *   - A regex cannot see block structure, so a `select` nested in a plural body
 *     was emitted as literal text.
 *
 * So the grammar is parsed properly here, once, into a tree. Everything
 * downstream (rendering, argument collection, validation, diagnostics) reads
 * that tree instead of re-scanning the string.
 *
 * Design notes:
 *
 * - **Never throws.** Malformed input yields an {@link IcuInvalid} node plus an
 *   error, and parsing continues with the rest of the message. A broken ARB file
 *   must still produce a usable generator run with a diagnostic, not a stack
 *   trace in the extension host.
 *
 * - **Every node carries `start`/`end` offsets** into the source string, so a
 *   diagnostic can point at the exact construct instead of the whole message.
 *
 * - **Apostrophes follow ICU, not Dart.** In an ICU message `''` is a literal
 *   apostrophe and a lone `'` quotes the next special character. These strings
 *   end up inside Dart string literals, so getting this wrong is visible to
 *   end users ("It''s"). See {@link readText}.
 */

/** What a name is *for*, which decides the generated Dart parameter type. */
export type ArgRole =
    /** `{count, plural, …}` — the value a CLDR plural category is chosen from. */
    | 'pluralOperand'
    /** `{n, selectordinal, …}` — as above, but ordinal rules. */
    | 'ordinalOperand'
    /** `{gender, select, …}` — a keyword, so a `String`. */
    | 'selectOperand'
    /** `{name}` — interpolated as-is. */
    | 'plain';

export interface IcuArg {
    name: string;
    /** The strictest role the name was reached through; decides the Dart type. */
    role: ArgRole;
    /**
     * The other *operand* roles the name was also reached through, set only
     * when there is more than one.
     *
     * `plain` is deliberately excluded from this: `{count}` next to
     * `{count, plural, …}` is ordinary and workable — the plural role simply
     * decides the type — so it is not a disagreement. Two operand roles for one
     * name genuinely are, because they want different values.
     */
    conflict?: ArgRole[];
}

export type IcuNode = IcuText | IcuHash | IcuArgRef | IcuSelect | IcuPlural | IcuInvalid;

export interface IcuBase {
    /** Offset of the construct's first character in the source string. */
    start: number;
    /** Offset one past the construct's last character. */
    end: number;
}

export interface IcuText extends IcuBase {
    kind: 'text';
    /** Already unescaped: `''` collapsed, quoted runs unwrapped. */
    value: string;
    /**
     * Set when this node holds a syntax character the author fenced off on
     * purpose — inside a quoted run (`'{name}'`, `'{c, plural, other{'#'}}'`),
     * or directly between apostrophes where no run is opened
     * (`Press '#' to go`).
     *
     * The parser unwraps those, so `value` alone cannot show that a `#` was
     * deliberately quoted rather than one that failed to become a plural
     * reference. A diagnostic that advises about literal `#` needs the
     * distinction, and it cannot recover it from the value.
     */
    quotedSyntax?: boolean;
    /**
     * Source offset of each literal `#` in `value`, in order. Absent when the
     * node holds none.
     *
     * `value` is the *decoded* text, so its indices cannot address the source:
     * the two apostrophes of `''` collapse to one character, and a quoted run
     * loses both. Anything reporting a range into the message — a diagnostic, a
     * quick fix — must use these rather than `start + value.indexOf('#')`.
     */
    sourceHashOffsets?: number[];
}

/**
 * `#` inside a plural or selectordinal body, standing for the (offset-shifted)
 * plural value. Outside such a block `#` is ordinary text and never produces
 * this node.
 */
export interface IcuHash extends IcuBase {
    kind: 'hash';
}

export interface IcuArgRef extends IcuBase {
    kind: 'arg';
    name: string;
}

export interface IcuSelect extends IcuBase {
    kind: 'select';
    name: string;
    cases: Map<string, IcuNode[]>;
}

export interface IcuPlural extends IcuBase {
    kind: 'plural';
    name: string;
    ordinal: boolean;
    /**
     * `offset:n` — ICU subtracts this before category selection and before `#`
     * substitution. Exact `=N` selectors still match the *raw* value.
     */
    offset: number;
    /** Case key to body. Keys are `zero`…`other` or exact `=N`. */
    cases: Map<string, IcuNode[]>;
    /**
     * Exact selectors (`=0`, `=5`, …) in source order, kept apart from
     * categories so the renderer can emit them as equality tests rather than
     * folding them into `Intl.plural`'s named parameters.
     */
    exactSelectors: string[];
}

export interface IcuInvalid extends IcuBase {
    kind: 'invalid';
    raw: string;
    error: string;
}

export interface IcuParseError {
    message: string;
    start: number;
    end: number;
}

export interface IcuParseResult {
    nodes: IcuNode[];
    errors: IcuParseError[];
}

/** Block types this parser understands. Anything else is reported, not guessed. */
const ICU_TYPES = new Set(['select', 'plural', 'selectordinal']);

/** CLDR plural/ordinal category names, plus ICU's `other`. */
const CATEGORY = /^(?:zero|one|two|few|many|other)$/;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Parse an ICU message.
 *
 * @param text raw ARB message value, ICU syntax and all
 */
export function parseIcu(text: string): IcuParseResult {
    const errors: IcuParseError[] = [];
    const parser = new Parser(text, errors);
    const nodes = parser.parseNodes(undefined);
    return { nodes, errors };
}

/**
 * Roles ordered by how tightly they constrain the generated Dart type.
 *
 * `plain` is the loosest: `{count}` only says the value is interpolated, which
 * is compatible with every operand role. An operand role is stricter, because
 * it hands the name to a typed `intl` entry point — `Intl.plural` requires a
 * `num`, so the strictest role has to decide the parameter's type.
 */
const ROLE_RANK: Record<ArgRole, number> = {
    plain: 0,
    selectOperand: 1,
    pluralOperand: 2,
    ordinalOperand: 3,
};

/**
 * Every argument a message needs, in first-appearance order, each tagged with
 * the role it was reached through.
 *
 * This **recurses into case bodies**, which is what makes a `select` nested
 * inside a plural become a real parameter. The previous top-level-only scan
 * dropped it and the generated method then referenced an undefined identifier.
 *
 * Where a name is reached through several roles the strictest one wins, so
 * `You have {count} items. {count, plural, …}` types `count` as a `num` rather
 * than as the `Object` a `plain`-first reading would leave — that `Object` was
 * then passed straight to `Intl.plural`, which does not compile.
 */
export function collectArgs(nodes: IcuNode[]): IcuArg[] {
    const found = new Map<string, ArgRole[]>();

    const record = (name: string, role: ArgRole) => {
        const roles = found.get(name);
        if (!roles) {
            found.set(name, [role]);
        } else if (!roles.includes(role)) {
            roles.push(role);
        }
    };

    const walk = (list: IcuNode[]): void => {
        for (const node of list) {
            switch (node.kind) {
                case 'arg':
                    record(node.name, 'plain');
                    break;
                case 'select':
                    record(node.name, 'selectOperand');
                    for (const body of node.cases.values()) walk(body);
                    break;
                case 'plural':
                    record(node.name, node.ordinal ? 'ordinalOperand' : 'pluralOperand');
                    for (const body of node.cases.values()) walk(body);
                    break;
                case 'text':
                case 'hash':
                case 'invalid':
                    break;
            }
        }
    };

    walk(nodes);

    const args: IcuArg[] = [];
    for (const [name, roles] of found) {
        // Sorted descending by how much the role constrains the type, so
        // `ranked[0]` is the role that decides it.
        const ranked = [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
        const operandRoles = ranked.filter((role) => role !== 'plain');

        args.push(
            operandRoles.length > 1
                ? { name, role: ranked[0], conflict: operandRoles.slice(1) }
                : { name, role: ranked[0] }
        );
    }
    return args;
}

/**
 * A short, stable description of a message's ICU *control* structure: the
 * `select` / `plural` / `selectordinal` blocks it contains and the arguments
 * they select on, in source order, recursively.
 *
 * Literal text and plain `{name}` positions are deliberately absent. They carry
 * no structural meaning, and including them made this a fingerprint of the
 * *wording* rather than of the structure — so "Willkommen, {name}!" disagreed
 * with "Hello {name}" and a locale was judged structurally incompatible over
 * nothing more than a moved comma. Whether a locale renders is decided instead
 * by whether its arguments and roles are compatible with the canonical
 * signature; see `lookupFallbackReason` in the generator.
 *
 * What this still distinguishes is a message that selects on a *number of
 * blocks* or on *different operands*, which is worth telling a translator about.
 */
export function describeIcuControls(nodes: IcuNode[]): string {
    const parts: string[] = [];

    const walk = (list: IcuNode[]): void => {
        for (const node of list) {
            switch (node.kind) {
                case 'select':
                    parts.push(`select(${node.name})`);
                    for (const body of node.cases.values()) walk(body);
                    break;
                case 'plural':
                    // `offset:` changes how the block reads its operand, so it is
                    // part of its identity rather than a detail.
                    parts.push(
                        `${node.ordinal ? 'ordinal' : 'plural'}(${node.name}${
                            node.offset ? ` offset:${node.offset}` : ''
                        })`
                    );
                    for (const body of node.cases.values()) walk(body);
                    break;
                case 'text':
                case 'hash':
                case 'arg':
                case 'invalid':
                    break;
            }
        }
    };

    walk(nodes);
    return parts.join('+');
}

class Parser {
    private pos = 0;

    constructor(
        private readonly src: string,
        private readonly errors: IcuParseError[]
    ) {}

    /**
     * Parse until the end of input, or until the `}` that closes an enclosing
     * block. A `stopAtClose` flag is what lets one method serve the top level
     * and every nested case body.
     *
     * @param inPlural when true, a bare `#` is a plural-value reference rather
     *   than literal text.
     */
    parseNodes(inPlural: boolean | undefined, stopAtClose = false): IcuNode[] {
        const nodes: IcuNode[] = [];

        while (this.pos < this.src.length) {
            const ch = this.src[this.pos];

            if (ch === '}') {
                if (stopAtClose) break;
                // A stray `}` with no owner. gen_l10n rejects this; record it
                // and keep the character so no text is silently lost.
                this.errors.push({
                    message: "Unmatched '}'",
                    start: this.pos,
                    end: this.pos + 1,
                });
                nodes.push({ kind: 'text', value: '}', start: this.pos, end: this.pos + 1 });
                this.pos++;
                continue;
            }

            if (ch === '{') {
                nodes.push(this.parseArgument(inPlural));
                continue;
            }

            if (ch === '#') {
                nodes.push(this.readHash(inPlural));
                continue;
            }

            const start = this.pos;
            const text = this.readText(inPlural, stopAtClose);
            if (text.value.length > 0) nodes.push(text);
            // Defensive: never loop forever on an unconsumable character.
            if (this.pos === start) this.pos++;
        }

        return nodes;
    }

    private parseArgument(inPlural: boolean | undefined): IcuNode {
        const start = this.pos;

        // Consume the '{'.
        this.pos++;
        this.skipWhitespace();

        const name = this.readIdentifier();
        if (!name) {
            return this.invalid(start, this.pos, 'Expected a placeholder name after \'{\'');
        }

        this.skipWhitespace();

        // `{name}` — a plain placeholder. Anything else is a block.
        if (this.src[this.pos] === '}') {
            const end = this.pos + 1;
            this.pos = end;
            return { kind: 'arg', name, start, end };
        }

        if (this.src[this.pos] !== ',') {
            return this.invalid(
                start,
                this.pos,
                `Expected ',' or '}' in placeholder "${name}"`
            );
        }

        // `{name, type, …`
        this.pos++;
        this.skipWhitespace();
        const typeStart = this.pos;
        const type = this.readIdentifier();
        if (!type) {
            return this.invalid(start, this.pos, `Expected a type after ',' in "${name}"`);
        }

        if (!ICU_TYPES.has(type)) {
            // `date`, `number`, `time` and friends are valid ICU but not
            // supported here. Consume to the matching '}' so the rest of the
            // message still parses.
            const end = this.skipToBlockEnd();
            this.errors.push({
                message: `Unsupported ICU argument type "${type}" in "${name}"; it will be rendered as literal text`,
                start: typeStart,
                end,
            });
            return {
                kind: 'invalid',
                raw: this.src.slice(start, end),
                error: `unsupported type "${type}"`,
                start,
                end,
            };
        }

        this.skipWhitespace();
        if (this.src[this.pos] !== ',') {
            return this.invalid(
                start,
                this.pos,
                `Expected ',' after "${type}" in "${name}"`
            );
        }
        this.pos++;

        if (type === 'select') {
            return this.parseSelectBody(name, start, inPlural === true);
        }
        return this.parsePluralBody(name, type === 'selectordinal', start);
    }

    /**
     * `inheritedPlural` is whether this select sits inside a plural body.
     *
     * A `select` has no numeric operand of its own, but ICU resolves `#` from
     * the nearest *enclosing* plural, so
     *   `{c, plural, other{{g, select, male{he has #} other{#}}}}`
     * substitutes the plural's value in both branches. Losing that binding
     * renders a literal `#` to the user.
     */
    private parseSelectBody(
        name: string,
        start: number,
        inheritedPlural: boolean
    ): IcuNode {
        const cases = new Map<string, IcuNode[]>();
        const end = this.parseCases(cases, 'select', start, name, undefined, inheritedPlural);
        return { kind: 'select', name, cases, start, end };
    }

    private parsePluralBody(
        name: string,
        ordinal: boolean,
        start: number
    ): IcuPlural | IcuInvalid {
        const cases = new Map<string, IcuNode[]>();
        const exactSelectors: string[] = [];
        let offset = 0;

        // `offset:n` may precede the first selector.
        this.skipWhitespace();
        const offsetMatch = /^offset\s*:\s*(\d+)/.exec(this.src.slice(this.pos));
        if (offsetMatch) {
            offset = parseInt(offsetMatch[1], 10);
            this.pos += offsetMatch[0].length;
        }

        const end = this.parseCases(cases, 'plural', start, name, exactSelectors, true);
        return { kind: 'plural', name, ordinal, offset, cases, exactSelectors, start, end };
    }

    /**
     * Shared case-list parser for `select` and `plural`/`selectordinal`.
     *
     * `inPlural` is threaded into the case bodies and then inherited by any
     * nested `select`, because `#` resolves against the nearest enclosing
     * plural rather than the block that lexically contains it.
     */
    private parseCases(
        cases: Map<string, IcuNode[]>,
        type: 'select' | 'plural',
        blockStart: number,
        name: string,
        exactSelectors?: string[],
        inPlural = false
    ): number {
        while (true) {
            this.skipWhitespace();
            const ch = this.src[this.pos];

            if (ch === undefined) {
                this.errors.push({
                    message: `Unclosed "${type}" block for "${name}"`,
                    start: blockStart,
                    end: this.src.length,
                });
                return this.src.length;
            }

            if (ch === '}') {
                const end = this.pos + 1;
                this.pos = end;
                // A missing `other` is not reported here. The renderer
                // synthesizes a fallback so the output still compiles, which
                // makes it a translation problem rather than a parse problem;
                // `icu_diagnostics` owns that diagnostic, and having it in both
                // places produced two squiggles for one problem.
                return end;
            }

            const selectorStart = this.pos;

            // `=5` — an exact selector, distinct from a category name.
            if (ch === '=') {
                this.pos++;
                const digits = /^\d+/.exec(this.src.slice(this.pos));
                if (!digits) {
                    this.errors.push({
                        message: `Expected a number after '=' in "${name}"`,
                        start: selectorStart,
                        end: this.pos,
                    });
                    this.skipToBlockEnd();
                    return this.pos;
                }
                this.pos += digits[0].length;
                const selector = `=${digits[0]}`;
                // Checked here rather than with the categories below: the exact
                // branch used to `continue` before that check, so a repeated
                // `=1` was silently accepted, and the renderer emits one
                // equality test per entry in `exactSelectors` — the second would
                // shadow the first.
                if (cases.has(selector)) {
                    this.errors.push({
                        message: `Duplicate case "${selector}" in "${name}"`,
                        start: selectorStart,
                        end: this.pos,
                    });
                }
                exactSelectors?.push(selector);
                const bodyEnd = this.readCaseBody(cases, selector, name, inPlural);
                if (bodyEnd === null) return this.pos;
                continue;
            }

            if (!IDENTIFIER.test(this.src.slice(this.pos))) {
                this.errors.push({
                    message: `Expected a case name in "${name}"`,
                    start: selectorStart,
                    end: this.pos,
                });
                this.skipToBlockEnd();
                return this.pos;
            }

            const selector = this.readIdentifier()!;

            // A `select` keyword is arbitrary — `male`, `p`, `x` are all valid.
            // Only a plural/ordinal selector is constrained, to a CLDR category
            // or an exact `=N`.
            if (type === 'plural' && !CATEGORY.test(selector)) {
                this.errors.push({
                    message: `"${selector}" is not a plural category for "${name}" (expected zero, one, two, few, many, other, or =N)`,
                    start: selectorStart,
                    end: this.pos,
                });
            }

            if (cases.has(selector)) {
                this.errors.push({
                    message: `Duplicate case "${selector}" in "${name}"`,
                    start: selectorStart,
                    end: this.pos,
                });
            }

            const bodyEnd = this.readCaseBody(cases, selector, name, inPlural);
            if (bodyEnd === null) return this.pos;
        }
    }

    /**
     * Read one `caseName { body }` and record it. Returns the offset after the
     * body, or `null` when parsing had to bail out.
     */
    private readCaseBody(
        cases: Map<string, IcuNode[]>,
        selector: string,
        name: string,
        inPlural: boolean
    ): number | null {
        this.skipWhitespace();

        if (this.src[this.pos] !== '{') {
            this.errors.push({
                message: `Expected '{' after case "${selector}" in "${name}"`,
                start: this.pos,
                end: this.pos,
            });
            this.skipToBlockEnd();
            return null;
        }
        this.pos++;

        const bodyStart = this.pos;
        const body = this.parseNodes(inPlural, true);

        if (this.src[this.pos] !== '}') {
            this.errors.push({
                message: `Unclosed case "${selector}" in "${name}"`,
                start: bodyStart,
                end: this.src.length,
            });
            cases.set(selector, body);
            return this.src.length;
        }

        cases.set(selector, body);
        const end = this.pos + 1;
        this.pos = end;
        return end;
    }

    /**
     * Read literal text up to the next `{`, `}` or — inside a plural — `#`.
     *
     * Handles ICU quoting: `''` is one literal apostrophe, and a `'` before a
     * syntax character opens a quoted run that ends at the next lone `'` — so
     * `'{name}'` is the literal text `{name}` and not an interpolation.
     *
     * @param inPlural whether this text sits inside a plural body. It decides
     *   two things, both of which ICU 4.8 made context-sensitive: a bare `#` is
     *   only a plural-value reference there, and only there does a `'` before
     *   `#` open a quoted run.
     */
    private readText(inPlural: boolean | undefined, stopAtClose: boolean): IcuText {
        const start = this.pos;
        let out = '';
        let quotedSyntax = false;
        /**
         * Source offset of each literal `#` in `value`, in order.
         *
         * A diagnostic that points at a `#` cannot use `node.start +
         * value.indexOf('#')`: the two index different strings. `value` has
         * `''` collapsed and quoted runs unwrapped, so `Don't order #5` puts the
         * `#` at 12 in the value and 13 in the source — one character early for
         * every escape before it, which is exactly the string this diagnostic
         * exists for.
         */
        const sourceHashOffsets: number[] = [];

        while (this.pos < this.src.length) {
            const ch = this.src[this.pos];

            if (ch === '{' || ch === '}' || (ch === '#' && inPlural === true)) {
                break;
            }

            if (ch === "'") {
                const next = this.src[this.pos + 1];

                // '' -> a literal apostrophe.
                if (next === "'") {
                    out += "'";
                    this.pos += 2;
                    continue;
                }

                // A quote only opens a literal run before a syntax character.
                // `#` is one only inside a plural, so `Press '#' to go` keeps
                // both apostrophes as text rather than swallowing them.
                //
                // `|` is deliberately absent. In ICU it is a syntax character
                // only inside the case list of a `select`, and this parser never
                // reads a case list as text — it dispatches on `{` directly. So
                // quoting `|` here had no case where it helped and one where it
                // hurt: `x '|' y` lost both apostrophes, which ICU keeps.
                const quotesHash = next === '#' && inPlural === true;
                if (next === '{' || next === '}' || quotesHash) {
                    const runStart = this.pos + 1;
                    let sawSyntax = quotesHash;
                    let closed = false;
                    this.pos++;
                    while (this.pos < this.src.length) {
                        const inner = this.src[this.pos];

                        if (inner === '{' || inner === '}' || inner === '#') {
                            sawSyntax = true;
                        }

                        if (inner === "'") {
                            // '' inside a run is a literal apostrophe.
                            if (this.src[this.pos + 1] === "'") {
                                out += "'";
                                this.pos += 2;
                                continue;
                            }
                            this.pos++;
                            closed = true;
                            break;
                        }
                        out += inner;
                        this.pos++;
                    }
                    if (sawSyntax) quotedSyntax = true;
                    this.reportQuotedRun(runStart, this.pos, closed);
                    continue;
                }

                // A lone apostrophe is just an apostrophe.
                out += "'";
                // `Press '#' to go`: outside a plural the apostrophe does not
                // open a quoted run, so the `#` is literal text — and it was
                // fenced between apostrophes deliberately. Flag it so the
                // "this # should be a plural" advice does not fire at it.
                if (next === '#') quotedSyntax = true;
                this.pos++;
                continue;
            }

            // Only reached outside a plural — inside one, `#` breaks the loop
            // above and becomes a `hash` node.
            if (ch === '#') sourceHashOffsets.push(this.pos);

            out += ch;
            this.pos++;
        }

        return {
            kind: 'text',
            value: out,
            start,
            end: this.pos,
            ...(quotedSyntax ? { quotedSyntax: true } : {}),
            ...(sourceHashOffsets.length > 0 ? { sourceHashOffsets } : {}),
        };
    }

    /**
     * Report the two ways an apostrophe-quoted run goes wrong.
     *
     * Both are *valid* ICU, so the parse is not wrong — but both are almost
     * always a mistake, and the mistake is invisible in the output.
     *
     * 1. The run swallowed a placeholder. `Bienvenue à l'{place} aujourd'hui`
     *    opens a run at `'{`, and ICU ends it at the next lone apostrophe —
     *    the one in `aujourd'hui`. So `place` becomes literal text and the
     *    message silently loses a parameter. Common in French, Italian and
     *    Catalan, where an elision sits directly against a placeholder.
     * 2. The run never closes, so it swallows the rest of the message.
     *
     * Reported at `error` severity because the rendered text is wrong in both
     * cases, but the remedy is in the ARB rather than in the generator: `''`
     * for a literal apostrophe, or `'{place}'` to quote the braces.
     */
    private reportQuotedRun(runStart: number, runEnd: number, closed: boolean): void {
        if (!closed) {
            this.errors.push({
                message:
                    'This apostrophe opens a quoted run that never closes, so everything ' +
                    'after it is literal text. Write "\'\'" for a literal apostrophe.',
                start: runStart - 1,
                end: runEnd,
            });
            return;
        }

        const inner = this.src.slice(runStart, runEnd - 1);
        const swallowed = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,[^}]*)?\}/.exec(inner);
        if (swallowed) {
            this.errors.push({
                message:
                    `This apostrophe quotes "{" as literal text, so "{${swallowed[1]}}" is ` +
                    'not interpolated and the message has no such parameter. Write "\'\'" ' +
                    `for a literal apostrophe, or quote the whole placeholder as '{${swallowed[1]}}'.`,
                start: runStart - 1,
                end: runEnd,
            });
        }
    }

    /**
     * Produce a `#` node, or literal text when `#` appears with no enclosing
     * plural. ICU treats a bare `#` outside a plural as ordinary text, and so
     * does `MessageFormat` — `Order #{id}` must keep its `#`.
     *
     * The literal branch is a safety net rather than a live path:
     * {@link readText} no longer stops at a `#` outside a plural, so this is
     * only reached if that ever changes.
     */
    private readHash(inPlural: boolean | undefined): IcuNode {
        const start = this.pos;
        this.pos++;

        if (inPlural) {
            return { kind: 'hash', start, end: this.pos };
        }
        return { kind: 'text', value: '#', start, end: this.pos };
    }

    private skipWhitespace(): void {
        while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) {
            this.pos++;
        }
    }

    private readIdentifier(): string | null {
        const match = IDENTIFIER.exec(this.src.slice(this.pos));
        if (!match) return null;
        this.pos += match[0].length;
        return match[0];
    }

    /** Consume to just past the `}` that closes the current block. */
    private skipToBlockEnd(): number {
        let depth = 1;
        let i = this.pos;
        while (i < this.src.length && depth > 0) {
            if (this.src[i] === '{') depth++;
            else if (this.src[i] === '}') depth--;
            if (depth === 0) break;
            i++;
        }
        this.pos = Math.min(i + 1, this.src.length);
        return this.pos;
    }

    private invalid(start: number, end: number, error: string): IcuInvalid {
        const raw = this.src.slice(start, Math.max(end, start));
        this.errors.push({ message: error, start, end: Math.max(end, start) });
        return { kind: 'invalid', raw, error, start, end: Math.max(end, start) };
    }
}
