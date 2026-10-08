import ordinals from './data/cldr_ordinals.json';

/**
 * A CLDR plural rule: an ordered list of conditions, first match wins.
 *
 * Ordinal rules only ever use `n` and `i`, so this evaluates against a single
 * `int` — `n` and `i` coincide for a whole number, and ordinal categories are
 * not defined for fractions.
 */
export interface OrdinalRule {
    category: 'zero' | 'one' | 'two' | 'few' | 'many';
    condition: string;
}

export interface OrdinalGroup {
    locales: string[];
    rules: OrdinalRule[];
}

/** Version stamp of the CLDR data these rules came from. */
export const CLDR_ORDINAL_VERSION: string = (ordinals as { version: string }).version;

/** Named rule sets, keyed by group id. */
export const ORDINAL_GROUPS: Record<string, OrdinalGroup> = (
    ordinals as unknown as { groups: Record<string, OrdinalGroup> }
).groups;

/**
 * Group id for a locale, falling back from `pt_PT` to `pt`, from `zh_Hans_CN` to
 * `zh_Hans` and on to `zh`.
 *
 * CLDR lists `kok_Latn` separately from `kok`, so a script or region in the
 * project's locale name is not automatically a different rule set — only the
 * exact ids in the data are. Subtraction therefore continues one subtag at a
 * time rather than once: stripping only the last subtag left `zh_Hans_CN`
 * resolving to `zh_Hans` and stopping there, even when `zh_Hans` is absent from
 * the data. Such a locale went unmapped, every ordinal in it fell back to
 * `other`, and English-influenced Chinese came out as "1th" instead of "1st".
 */
export function ordinalGroupFor(locale: string): string | undefined {
    let candidate = locale.replace(/-/g, '_');

    // Longest first, so `kok_Latn` is matched before `kok`.
    for (;;) {
        for (const [group, { locales }] of Object.entries(ORDINAL_GROUPS)) {
            if (locales.includes(candidate)) return group;
        }

        const shorter = candidate.replace(/_[A-Za-z0-9]+$/, '');
        if (shorter === candidate) return undefined;
        candidate = shorter;
    }
}
