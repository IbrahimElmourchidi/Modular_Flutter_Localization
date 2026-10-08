import { CLDR_ORDINAL_VERSION, ORDINAL_GROUPS, ordinalGroupFor } from './cldr_ordinals';

/**
 * Compiles the CLDR ordinal rules into Dart.
 *
 * intl has no ordinal support — its own `MessageFormat` resolves
 * `selectordinal` with cardinal rules, so `2nd` would come back as `4th`. The
 * rules are therefore emitted into a generated file and called directly.
 *
 * Two constraints shape the output:
 *
 * - CLDR ordinal rules use only `n` and `i`, which coincide for a whole
 *   number, so the emitted predicates take a single `int`.
 * - Only the groups the project's locales actually reference are emitted, so a
 *   project with English ordinals does not carry all 28.
 */

/** A Dart predicate for one CLDR rule. */
interface CompiledRule {
    category: string;
    /** Dart source for a `bool` expression over `n` and `i`. */
    test: string;
}

interface CompiledGroup {
    id: string;
    rules: CompiledRule[];
}

/**
 * Translate a CLDR plural-rule condition into Dart.
 *
 * The grammar in CLDR ordinal data is tiny — `=`, `!=`, `%`, `..`, `,`, `and`,
 * `or`, over `n` and `i` — so a direct translation is safer than a general
 * parser would be: anything unexpected throws at generation time rather than
 * silently producing wrong ordinals.
 *
 * Precedence matters and is the one thing worth stating: CLDR binds `and`
 * tighter than `or`, and `=` tighter than both.
 */
function compileCondition(condition: string): string {
    // Split on 'or' at the top level, then each part on 'and'.
    const orParts = splitKeyword(condition, 'or');
    const andParts = orParts.map((part) =>
        splitKeyword(part, 'and')
            .map((clause) => compileClause(clause))
            .join(' && ')
    );
    return andParts.join(' || ');
}

/**
 * Split a condition on a bare `and`/`or`, keeping each part tokenized.
 *
 * Each part is rebuilt with a space between tokens so a later split still sees
 * the keyword: concatenating without a separator would turn `1` `and` `n` into
 * the single word `1andn`. Operators that must stay adjacent are re-normalised
 * afterwards, so the part reads the same however it was cut.
 */
function splitKeyword(text: string, keyword: string): string[] {
    const tokens = text.match(/\.\.|!=|==|[%=<>!(),]|\w+/g) ?? [];
    const parts: string[] = [];
    let current = '';

    const flush = (): void => {
        const part = current.trim().replace(/\s*\.\.\s*/g, '..');
        if (part.length > 0) parts.push(part);
        current = '';
    };

    for (const token of tokens) {
        if (token === keyword) {
            flush();
            continue;
        }
        current += `${token} `;
    }
    flush();

    return parts;
}

/** Compile `operand [% mod] (=|!=) value_list`. */
function compileClause(clause: string): string {
    const match = /^([ni])(?:\s*%\s*(\d+))?\s*(!?=)\s*(.+)$/.exec(clause.trim());
    if (!match) {
        throw new Error(`Unsupported CLDR ordinal condition: "${clause}"`);
    }

    // `n` is the absolute value and `i` its integer part. For a whole number
    // they coincide, so both compile to the caller's absolute value — and
    // ordinal categories are not defined for fractions in any case.
    const operand = 'v';
    const modulo = match[2];
    const negated = match[3] === '!=';
    const values = match[4];

    const left = modulo ? `${operand} % ${modulo}` : operand;
    void match[1];
    const alternatives = values
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .map((value) => compileValue(left, value));

    if (alternatives.length === 0) {
        throw new Error(`CLDR ordinal condition has no values: "${clause}"`);
    }

    const joined =
        alternatives.length === 1
            ? alternatives[0]
            : `(${alternatives.join(' || ')})`;

    return negated ? `!(${joined})` : joined;
}

/** One comparison: an exact value, or a `low..high` range test. */
function compileValue(left: string, value: string): string {
    const range = /^(\d+)\.\.(\d+)$/.exec(value);
    if (range) {
        return `${left} >= ${range[1]} && ${left} <= ${range[2]}`;
    }
    if (!/^\d+$/.test(value)) {
        throw new Error(`Unsupported CLDR ordinal value: "${value}"`);
    }
    return `${left} == ${value}`;
}

function compileGroup(id: string, rules: { category: string; condition: string }[]): CompiledGroup {
    return {
        id,
        rules: rules.map((rule) => ({
            category: rule.category,
            test: compileCondition(rule.condition),
        })),
    };
}

/**
 * The compiled groups a project needs, and the locale→group mapping for them.
 *
 * Locales with no CLDR ordinal data fall back to `other` only, and are reported
 * so the translator knows the message will not be grammatical.
 */
export function compileOrdinals(locales: string[]): {
    content: string;
    usedLocales: string[];
    unmapped: string[];
} {
    const groupIds = new Set<string>();
    const mapped: Record<string, string> = {};
    const unmapped: string[] = [];

    for (const locale of locales) {
        const group = ordinalGroupFor(locale);
        if (group === undefined) {
            if (!unmapped.includes(locale)) unmapped.push(locale);
            continue;
        }
        groupIds.add(group);
        mapped[locale] = group;
    }

    const groups = [...groupIds]
        .sort()
        .map((id) => compileGroup(id, ORDINAL_GROUPS[id].rules));

    return {
        content: renderOrdinalFile(groups, mapped),
        usedLocales: Object.keys(mapped),
        unmapped,
    };
}

/** The generated resolver: one function per rule set, plus a locale lookup. */
function renderOrdinalFile(groups: CompiledGroup[], mapped: Record<string, string>): string {
    const functions = groups
        .map((group) => {
            // `other` is CLDR's mandatory fallback: a locale with no other
            // rule still has to answer, so the chain always ends there.
            const body = group.rules.flatMap((rule) => [
                `  if (${rule.test}) {`,
                `    return '${rule.category}';`,
                `  }`,
            ]);
            body.push(`  return 'other';`);

            const name = `_ordinal${group.id.charAt(0).toUpperCase()}${group.id.slice(1)}`;

            // A rule set with no conditions has no use for the absolute value,
            // so it is not declared — an unused local is an analyzer warning.
            const header =
                group.rules.length > 0
                    ? `/// CLDR ordinal rule set \`${group.id}\` (${CLDR_ORDINAL_VERSION}).
///
/// [n] is read as an absolute value, so a negative position ordinal reads the
/// same as its positive counterpart.
String ${name}(int n) {
  final v = n.abs();`
                    : `/// CLDR ordinal rule set \`${group.id}\` (${CLDR_ORDINAL_VERSION}).
///
/// This locale defines no ordinal categories of its own, so every value
/// resolves to \`other\`.
String ${name}(int n) {`;

            return `${header}
${body.join('\n')}
}`;
        })
        .join('\n\n');

    // The locale table maps to a group id; an absent locale yields 'other'.
    const entries = Object.entries(mapped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([locale, group]) => `  '${locale}': _ordinal${group.charAt(0).toUpperCase()}${group.slice(1)},`)
        .join('\n');

    return `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
// CLDR data: ${CLDR_ORDINAL_VERSION}
${GENERATED_ORDINAL_IGNORES}

/// The CLDR ordinal category for [n] in [locale]: one of
/// \`zero\`, \`one\`, \`two\`, \`few\`, \`many\` or \`other\`.
///
/// intl resolves \`selectordinal\` with cardinal rules, so ordinals are
/// selected here instead. [locale] names come from the generated message
/// tables; an unrecognised locale yields \`other\`.
///
/// [n] is taken as a \`num\` so an \`int\`, \`num\` or \`double\` placeholder can
/// all be passed; ordinal categories are defined over integers, so a fractional
/// value is truncated rather than rejected.
String modularOrdinalCategory(String locale, num n) {
  return _ordinalRules[locale]?.call(n.truncate()) ?? 'other';
}

/// Pick the branch [category] names from a rendered case list.
///
/// Public, unlike the rule sets: this is called from the message tables and the
/// module files, which are separate libraries. A Dart underscore prefix is
/// library-private, so a private helper would not resolve at the call site.
String modularOrdinalBranch(String category, Map<String, String> cases) {
  return cases[category] ?? cases['other']!;
}

typedef _OrdinalRule = String Function(int n);

final Map<String, _OrdinalRule> _ordinalRules = <String, _OrdinalRule>{
${entries}
};

${functions}
`;
}

const GENERATED_ORDINAL_IGNORES =
    '// ignore_for_file: non_constant_identifier_names, unnecessary_string_escapes,\n' +
    '// ignore_for_file: unnecessary_brace_in_string_interps, unused_import, prefer_single_quotes';
