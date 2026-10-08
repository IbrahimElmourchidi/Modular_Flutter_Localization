/**
 * Locate a JSON key's value range in an ARB file.
 *
 * The existing missing-translation check finds a key's line with
 * `fileLines[i].includes('"key"')`, which matches the metadata key `"@key"` too
 * and picks whichever line comes first. This scans the file once and records
 * real character offsets, so a diagnostic can point at the value rather than at
 * the whole line — and so a key whose name is a substring of another's name
 * cannot be misattributed.
 */

export interface JsonEntryRange {
    /** Offset of the opening quote of the key. */
    keyStart: number;
    keyEnd: number;
    /** Offset of the opening quote of the value. */
    valueStart: number;
    valueEnd: number;
    /** True when the entry is metadata (`"@key"`) or a `@@` special. */
    isMetadata: boolean;
    /**
     * For a string value: the raw offset of each decoded character, plus one
     * trailing entry for the end. Present so a diagnostic computed against the
     * decoded value can still point at the right characters in the file.
     *
     * A value with any escape in it — `\"`, `\n`, `\uXXXX` — is longer on disk
     * than it is after `JSON.parse`, so adding a decoded offset to a raw file
     * position drifts by one per escape. With `\"He said \"hi\" }"` the squiggle
     * landed a character early and then progressively further off.
     */
    decodedToRaw?: number[];
}

export type JsonEntryMap = Map<string, JsonEntryRange>;

/**
 * Index every top-level key in a JSON object, with the byte range of its value.
 *
 * A hand-rolled scan rather than `JSON.parse`, because the ranges are not
 * something `JSON.parse` exposes. Brace and string state are tracked so a brace
 * inside a value cannot be mistaken for structure.
 */
export function indexJsonEntries(source: string): JsonEntryMap {
    const entries: JsonEntryMap = new Map();

    let i = 0;
    const length = source.length;

    const skipWhitespace = (): void => {
        while (i < length && /\s/.test(source[i])) i++;
    };

    /** Skip a JSON string starting at the opening quote; leaves i past the close. */
    const skipString = (): void => {
        i++; // opening quote
        while (i < length) {
            if (source[i] === '\\') {
                i += 2;
                continue;
            }
            if (source[i] === '"') {
                i++;
                return;
            }
            i++;
        }
    };

    /**
     * Skip a JSON string while recording where each decoded character came from.
     *
     * The result has one entry per decoded character plus a trailing entry for
     * the position just past the last of them, so an end offset needs no
     * separate treatment.
     */
    const scanStringWithOffsets = (): number[] => {
        const decodedToRaw: number[] = [];

        i++; // opening quote
        while (i < length) {
            if (source[i] === '"') {
                decodedToRaw.push(i);
                i++;
                return decodedToRaw;
            }

            decodedToRaw.push(i);

            if (source[i] === '\\') {
                // `\uXXXX` is six source characters standing for one decoded
                // unit. A surrogate pair is two such escapes, so each half
                // records its own offset and the pair needs no special case.
                i += source[i + 1] === 'u' ? 6 : 2;
                continue;
            }
            i++;
        }
        return decodedToRaw;
    };

    skipWhitespace();
    if (source[i] !== '{') return entries;
    i++;

    while (i < length) {
        skipWhitespace();

        if (source[i] === '}') break;
        if (source[i] !== '"') {
            // Not a key: consume one value and continue, so malformed input
            // cannot loop forever.
            skipValue();
            skipWhitespace();
            if (source[i] === ',') i++;
            continue;
        }

        const keyStart = i;
        skipString();
        const keyEnd = i;
        const key = JSON.parse(source.slice(keyStart, keyEnd)) as string;

        skipWhitespace();
        let valueStart = i;
        let valueEnd = i;

        const range: JsonEntryRange = {
            keyStart,
            keyEnd,
            valueStart,
            valueEnd,
            isMetadata: key.startsWith('@'),
        };

        if (source[i] === ':') {
            i++;
            skipWhitespace();
            range.valueStart = i;
            range.valueEnd = skipValue(range);
        }

        // Last occurrence wins, matching `JSON.parse` — which is what the
        // generator reads the values through. Keeping the first meant a
        // duplicated key got diagnostics anchored on one occurrence while the
        // message the generator emitted came from the other.
        entries.set(key, range);

        skipWhitespace();
        if (source[i] === ',') i++;
    }

    return entries;

    /**
     * Advance past one value; returns the offset of its last character.
     *
     * For a string, also records the decoded-to-raw offset map on
     * `mapTarget`, which is null for values whose offsets nobody reports on.
     */
    function skipValue(mapTarget?: JsonEntryRange): number {
        skipWhitespace();
        const start = i;

        if (source[i] === '"') {
            const decodedToRaw = scanStringWithOffsets();
            if (mapTarget) mapTarget.decodedToRaw = decodedToRaw;
            return i - 1;
        }

        if (source[i] === '{' || source[i] === '[') {
            let depth = 0;
            while (i < length) {
                const ch = source[i];
                if (ch === '"') {
                    skipString();
                    continue;
                }
                if (ch === '{' || ch === '[') depth++;
                else if (ch === '}' || ch === ']') {
                    depth--;
                    if (depth === 0) {
                        i++;
                        return i - 1;
                    }
                }
                i++;
            }
            return i;
        }

        // Number, true, false, null — up to the next structural character.
        while (i < length && !/[,}\]\s]/.test(source[i])) i++;
        return i > start ? i - 1 : start;
    }
}

/**
 * The raw file offset for a position inside a JSON string value.
 *
 * ICU diagnostics are computed against the *decoded* value — the string as
 * `JSON.parse` returns it — while a squiggle has to be drawn in the file. The
 * two disagree wherever the value contains an escape, since each `\"`, `\n` or
 * `\uXXXX` occupies several file characters but one decoded character. Mapping
 * through {@link JsonEntryRange.decodedToRaw} keeps the two aligned.
 *
 * Falls back to the escape-free arithmetic for a value with no recorded map,
 * which is exact whenever the value contains no escapes anyway.
 */
export function rawOffsetFor(range: JsonEntryRange, decodedOffset: number): number {
    const map = range.decodedToRaw;
    if (!map || map.length === 0) return range.valueStart + 1 + decodedOffset;

    // An end offset can sit one past the last decoded character; the map carries
    // a trailing entry for exactly that, so clamp rather than read past the end.
    const index = Math.max(0, Math.min(decodedOffset, map.length - 1));
    return map[index];
}

/** A character offset in a file, as a line/column pair. */
export interface LineColumn {
    line: number;
    character: number;
}

/** Convert a character offset to a zero-based line and column. */
export function offsetToPosition(source: string, offset: number): LineColumn {
    let line = 0;
    let lineStart = 0;

    for (let i = 0; i < offset && i < source.length; i++) {
        if (source[i] === '\n') {
            line++;
            lineStart = i + 1;
        }
    }

    return { line, character: offset - lineStart };
}
