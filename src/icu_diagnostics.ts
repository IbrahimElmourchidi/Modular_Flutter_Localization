import {
    parseIcu,
    collectArgs,
    IcuNode,
    IcuParseError,
    describeIcuControls,
} from './icu_parser';
import { CanonicalArg, firstIncompatibleArg } from './icu_types';

/**
 * ICU diagnostics, independent of VS Code.
 *
 * The generator is lenient — it repairs what it can so a broken ARB file still
 * produces buildable Dart — which means a message that would once fail loudly at
 * compile time can now be quietly wrong. These checks put it back in front of the
 * translator, in the file they are editing.
 *
 * Kept free of `vscode` imports so the rules can be exercised directly.
 */

export type IcuSeverity = 'error' | 'warning' | 'hint';

export interface IcuDiagnostic {
    /** ARB message key the problem belongs to. */
    key: string;
    /** Offset into the *message value*, not the file. */
    start: number;
    end: number;
    severity: IcuSeverity;
    message: string;
    /** Stable identifier, for a quick fix or a suppression. */
    code: string;
}

/**
 * Dart's reserved words, plus the built-in identifiers that cannot be used as
 * parameter or member names.
 *
 * A placeholder becomes a method parameter and a message key becomes a getter
 * or method name, so either one being a keyword produces Dart that does not
 * compile — and the failure surfaces in the generated file, not in the ARB the
 * author is editing. Diagnosed rather than renamed: silently rewriting a key
 * would change the generated public API, which is a decision for the project,
 * not for a lint.
 */
const DART_RESERVED = new Set([
    'abstract', 'as', 'assert', 'async', 'augment', 'await', 'base', 'break',
    'case', 'catch', 'class', 'const', 'continue', 'covariant', 'default',
    'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends',
    'extension', 'external', 'factory', 'false', 'final', 'finally', 'for',
    'Function', 'get', 'hide', 'if', 'implements', 'import', 'in', 'interface',
    'is', 'late', 'library', 'mixin', 'new', 'null', 'on', 'operator', 'part',
    'required', 'rethrow', 'return', 'sealed', 'set', 'show', 'static', 'super',
    'switch', 'sync', 'this', 'throw', 'true', 'try', 'type', 'typedef', 'var',
    'void', 'when', 'while', 'with', 'yield',
]);

/**
 * Check one ARB message.
 *
 * @param key           message key, for the diagnostic message
 * @param text          the message value
 * @param template      the template-locale value for the same key, when the
 *                      caller has one — used for the control-difference hint
 * @param canonicalArgs the template's arguments and their Dart types, which is
 *                      what a translation must be renderable with. Without it the
 *                      cross-locale check is skipped rather than guessed.
 */
export function diagnoseIcuMessage(
    key: string,
    text: string,
    template?: string,
    canonicalArgs?: readonly CanonicalArg[]
): IcuDiagnostic[] {
    const diagnostics: IcuDiagnostic[] = [];
    const { nodes, errors } = parseIcu(text);

    // The key becomes a getter or method name; `{name}` becomes a parameter.
    // Both are emitted verbatim, so a Dart keyword in either position is a
    // compile error in the generated file.
    // Guarded on non-empty: the caller always supplies a real ARB key, and an
    // empty string is only ever a probe.
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    if (key !== '' && (!identifier.test(key) || DART_RESERVED.has(key))) {
        diagnostics.push({
            key,
            start: 0,
            end: key.length,
            severity: 'error',
            message:
                `"${key}" cannot be used as a Dart method name. Rename the message key.`,
            code: 'icu-dart-keyword',
        });
    }
    for (const arg of collectArgs(nodes)) {
        if (identifier.test(arg.name) && !DART_RESERVED.has(arg.name)) continue;
        // The parser records no offsets per argument, and a name can appear more
        // than once; the first occurrence is close enough to point at the right
        // message, and `-1` (no literal `{name}` — the run was quoted) falls back
        // to the whole value rather than a negative range.
        const at = Math.max(text.indexOf(`{${arg.name}}`), 0);
        diagnostics.push({
            key,
            start: at,
            end: at + arg.name.length + 2,
            severity: 'error',
            message:
                `"{${arg.name}}" cannot be used as a Dart parameter name. Rename the ` +
                'placeholder in the message and in @' + key + '.placeholders.',
            code: 'icu-dart-keyword',
        });
    }

    for (const error of errors) {
        diagnostics.push({
            key,
            start: error.start,
            end: error.end,
            // A parse error becomes literal text in the generated Dart, so it is
            // visible to end users rather than fatal.
            severity: 'error',
            message: error.message,
            code: 'icu-syntax',
        });
    }

    for (const [index, node] of nodes.entries()) {
        collectBlockDiagnostics(key, node, index, nodes, errors, diagnostics);
    }

    // Cross-locale: the generated lookup entry is called with the template's
    // argument list, so a translation that needs a different one is a compile
    // error. Anything else — different wording, punctuation, word order, or a
    // plural only one of the two has — renders correctly and is left alone.
    const incompatible =
        canonicalArgs === undefined
            ? null
            : firstIncompatibleArg(canonicalArgs, collectArgs(nodes));

    if (incompatible) {
        diagnostics.push({
            key,
            start: 0,
            end: text.length,
            severity: 'error',
            message:
                `This translation cannot be generated: ${incompatible.reason}. ` +
                `The template translation will be used for this locale instead.`,
            code: 'icu-argument-mismatch',
        });
    }

    // Control structure differing is not a fault — both directions render — but a
    // plural in only one locale is worth a translator's attention, since it is
    // usually an oversight rather than a decision.
    //
    // Skipped once the argument check has already spoken: the two always fire
    // together (a locale that introduces a plural introduces it on some
    // argument), and one problem should not be reported twice.
    //
    // An empty translation is skipped: it is already reported as
    // `empty-translation`, and "this locale drops ICU blocks the template has"
    // is a second way of saying the same thing about a value that renders
    // nothing at all.
    if (
        incompatible === null &&
        text.trim() !== '' &&
        template !== undefined &&
        template !== text
    ) {
        const controls = describeIcuControls(nodes);
        const templateControls = describeIcuControls(parseIcu(template).nodes);
        if (controls !== templateControls && (controls === '' || templateControls === '')) {
            diagnostics.push({
                key,
                start: 0,
                end: text.length,
                severity: 'hint',
                message:
                    `This locale ${controls ? 'adds' : 'drops'} ICU blocks the template does not ` +
                    `have (template: ${templateControls || 'none'}, here: ${controls || 'none'}). ` +
                    'Both render, but check the wording agrees.',
                code: 'icu-control-difference',
            });
        }
    }

    return diagnostics;
}

/**
 * Walk a block tree reporting the problems the parser does not: `other` is
 * required by `Intl.plural` and `Intl.select` but is not a parse error, and the
 * `#` and ordinal-exact hints are advice rather than faults.
 */
function collectBlockDiagnostics(
    key: string,
    node: IcuNode,
    index: number,
    siblings: readonly IcuNode[],
    parseErrors: readonly IcuParseError[],
    out: IcuDiagnostic[]
): void {
    /**
     * Whether a parse error falls inside this block, which means the block's
     * case list is already broken and a second complaint about it is noise.
     *
     * One root cause, one squiggle. `{n, plural, one{a}` reported both
     * `icu-syntax` ("unclosed") and `icu-missing-other`, and a mistyped `Other`
     * reported the category error and the missing `other` — neither pair telling
     * the author anything the first one did not.
     */
    const brokenByParseError = (): boolean =>
        parseErrors.some(
            (e) => e.start >= node.start && e.start < node.end
        );

    switch (node.kind) {
        case 'plural': {
            const kind = node.ordinal ? 'selectordinal' : 'plural';

            if (!node.cases.has('other') && !brokenByParseError()) {
                out.push({
                    key,
                    start: node.start,
                    end: node.end,
                    severity: 'error',
                    message: `"${kind}" block for "${node.name}" has no "other" case. Add one — it is required.`,
                    code: 'icu-missing-other',
                });
            }

            for (const selector of node.exactSelectors) {
                if (selector === '=0' && node.ordinal) {
                    out.push({
                        key,
                        start: node.start,
                        end: node.end,
                        severity: 'hint',
                        message:
                            'An exact "=0" selector in an ordinal block wins for 0 itself, ' +
                            'before CLDR rules are consulted. Most locales give 0 the ' +
                            '"other" category, so "0th" comes out as an ordinary ordinal ' +
                            'there — but some (Welsh, for one, where 0 is "zero") do not, ' +
                            'so check the ordinals read correctly for this locale.',
                        code: 'icu-ordinal-exact',
                    });
                }
            }

            for (const body of node.cases.values()) {
                for (const [i, child] of body.entries()) {
                    collectBlockDiagnostics(key, child, i, body, parseErrors, out);
                }
            }
            break;
        }

        case 'select': {
            if (!node.cases.has('other') && !brokenByParseError()) {
                out.push({
                    key,
                    start: node.start,
                    end: node.end,
                    severity: 'error',
                    message: `"select" block for "${node.name}" has no "other" case. Add one — it is required.`,
                    code: 'icu-missing-other',
                });
            }
            for (const body of node.cases.values()) {
                for (const [i, child] of body.entries()) {
                    collectBlockDiagnostics(key, child, i, body, parseErrors, out);
                }
            }
            break;
        }

        case 'text': {
            // A `#` with no enclosing plural is literal text in ICU, so this is
            // only worth saying when it looks like it was meant to be one.
            if (!node.value.includes('#')) break;

            // A `#` the author fenced off — inside a quoted run, or between apostrophes
            // as in `Press '#' to go` — was quoted on purpose. The parser
            // unwraps the quotes, so only the flag it left behind shows that.
            // Without it, `{c, plural, other{Press '#' then # more}}` is told its
            // `#` "is not inside a plural" while it plainly is.
            if (node.quotedSyntax) break;

            // `Order #{id}` — a number sign introducing a placeholder, which is a
            // common way to write an order number and is not a plural reference.
            // The `#` is the last node before the `{`, so the text node ends
            // exactly where the argument begins. Without this the corpus's own
            // `hashLiteral` fixture drew the hint, which taught translators to
            // ignore it.
            const next = siblings[index + 1];
            if (next?.kind === 'arg' && node.end === next.start) break;

            // The parser's own offsets, not `start + value.indexOf('#')`: `value`
            // is decoded, so `Don''t order #5` would place the squiggle one
            // character early. Falls back to the decoded index only if a future
            // text node carries a `#` without the offsets.
            const hash =
                node.sourceHashOffsets?.[0] ?? node.start + node.value.indexOf('#');
            out.push({
                key,
                start: hash,
                end: hash + 1,
                severity: 'hint',
                message:
                    'This "#" is literal text because it is not inside a plural or ordinal ' +
                    'block. Use "{count, plural, …}" if it should become the number.',
                code: 'icu-hash-literal',
            });
            break;
        }

        case 'invalid':
            // Already reported by the parser's error list.
            break;

        case 'hash':
        case 'arg':
            break;
    }
}
