import * as fs from 'fs';
import { Module, ArbFile } from './module_scanner';

export interface TranslationKey {
    key: string;
    translations: Record<string, string>;
    description?: string;
    placeholders?: Record<string, PlaceholderInfo>;
}

export interface PlaceholderInfo {
    type?: string;
    example?: string;
    format?: string;
    isCustomDateFormat?: string;
    optionalParameters?: Record<string, string>;
}

export interface ParsedModule {
    name: string;
    path: string;
    keys: TranslationKey[];
}

export class ArbParser {
    /**
     * Sink for non-fatal parse problems. Routed through the extension's
     * level-aware logger; defaults to a no-op.
     */
    constructor(private onWarning?: (message: string) => void) {}

    async parseModules(
        modules: Module[],
        supportedLocales: string[],
        defaultLocale?: string
    ): Promise<ParsedModule[]> {
        const parsedModules: ParsedModule[] = [];
        for (const module of modules) {
            const keys = await this.parseModule(module, supportedLocales, defaultLocale);
            parsedModules.push({
                name: module.name,
                path: module.path,
                keys,
            });
        }
        return parsedModules;
    }

    private async parseModule(
        module: Module,
        supportedLocales: string[],
        defaultLocale?: string
    ): Promise<TranslationKey[]> {
        const keysMap: Map<string, TranslationKey> = new Map();

        // Read the default-locale file first.
        //
        // `@key` metadata — descriptions, placeholder types, number and date
        // formats — is authored once, in the default locale. Files arrive in
        // glob (alphabetical) order, so reading them as-is means a locale that
        // sorts earlier (ar before en) creates the key first, with no metadata,
        // and the default locale's metadata is then never read: every parameter
        // silently degrades to `Object` and every format directive is lost.
        const orderedFiles = defaultLocale
            ? [
                ...module.arbFiles.filter((f) => f.locale === defaultLocale),
                ...module.arbFiles.filter((f) => f.locale !== defaultLocale),
            ]
            : module.arbFiles;

        for (const arbFile of orderedFiles) {
            const content = this.readArbFile(arbFile.path);
            for (const [key, value] of Object.entries(content)) {
                // Skip metadata keys and Flutter Intl specific keys
                if (key.startsWith('@@') || key.startsWith('@')) {
                    continue;
                }

                const metadata = content[`@${key}`] as Record<string, unknown> | undefined;

                if (!keysMap.has(key)) {
                    keysMap.set(key, {
                        key,
                        translations: {},
                        description: metadata?.description as string | undefined,
                        placeholders: this.parsePlaceholders(
                            metadata?.placeholders as Record<string, unknown> | undefined
                        ),
                    });
                } else if (metadata) {
                    // A non-default locale may still carry metadata the default
                    // one omitted; fill gaps without overriding what's set.
                    const existing = keysMap.get(key)!;
                    existing.description ??= metadata.description as string | undefined;
                    existing.placeholders ??= this.parsePlaceholders(
                        metadata.placeholders as Record<string, unknown> | undefined
                    );
                }

                keysMap.get(key)!.translations[arbFile.locale] = value as string;
            }
        }

        return Array.from(keysMap.values());
    }

    /**
     * Read and parse an ARB file (synchronous - no need for async wrapper)
     */
    private readArbFile(filePath: string): Record<string, unknown> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            this.onWarning?.(`Error reading ARB file ${filePath}: ${error}`);
            return {};
        }
    }

    private parsePlaceholders(
        placeholders: Record<string, unknown> | undefined
    ): Record<string, PlaceholderInfo> | undefined {
        if (!placeholders) {
            return undefined;
        }

        const result: Record<string, PlaceholderInfo> = {};
        for (const [name, info] of Object.entries(placeholders)) {
            const placeholderInfo = info as Record<string, unknown>;
            result[name] = {
                type: placeholderInfo.type as string | undefined,
                example: placeholderInfo.example as string | undefined,
                format: placeholderInfo.format as string | undefined,
                isCustomDateFormat: placeholderInfo.isCustomDateFormat as string | undefined,
                optionalParameters: placeholderInfo.optionalParameters as Record<string, string> | undefined,
            };
        }
        return result;
    }

    /** Matches the head of an ICU block: `{var, plural|select|selectordinal,` */
    private static readonly ICU_HEAD = /^\{(\w+)\s*,\s*(plural|select|selectordinal)\s*,/;

    /**
     * Extract the placeholder names a message takes as parameters, in order of
     * first appearance.
     *
     * Only *top-level* text is scanned. The interior of an ICU block is skipped
     * entirely, because a case body is content, not a parameter list:
     * `{gender, select, male{He} other{They}}` takes one parameter, `gender` —
     * `He` and `They` are translations, and treating them as placeholders puts
     * bogus arguments into the generated method signature.
     *
     * e.g. "Hello {name}"                                     -> ["name"]
     * e.g. "{count, plural, =0{none} other{{count} items}}"    -> ["count"]
     * e.g. "{g, select, male{He} other{They}} has {n} items"   -> ["g", "n"]
     */
    static extractPlaceholders(text: string): string[] {
        const placeholders: string[] = [];
        const seen = new Set<string>();

        const add = (name: string) => {
            if (!seen.has(name)) {
                seen.add(name);
                placeholders.push(name);
            }
        };

        let i = 0;
        while (i < text.length) {
            if (text[i] !== '{') {
                i++;
                continue;
            }

            const rest = text.substring(i);

            // An ICU block contributes its control variable, then is skipped whole.
            const icuHead = rest.match(this.ICU_HEAD);
            if (icuHead) {
                add(icuHead[1]);
                i = this.skipIcuBlock(text, i);
                continue;
            }

            // A plain {name} placeholder.
            const simple = rest.match(/^\{(\w+)\}/);
            if (simple) {
                add(simple[1]);
                i += simple[0].length;
                continue;
            }

            i++;
        }

        return placeholders;
    }

    /**
     * Skip past an entire ICU block starting at position, returning the index after the closing brace.
     */
    private static skipIcuBlock(text: string, startPos: number): number {
        let braceDepth = 0;
        for (let i = startPos; i < text.length; i++) {
            if (text[i] === '{') {
                braceDepth++;
            } else if (text[i] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    return i + 1;
                }
            }
        }
        return text.length;
    }

    /**
     * Check if a translation has ICU message syntax (plural, select, selectordinal)
     */
    static hasIcuSyntax(text: string): boolean {
        return /\{\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(text);
    }

    /**
     * Determine the type of ICU message (plural, select, selectordinal).
     * Returns the type of the FIRST ICU expression found.
     */
    static getIcuType(text: string): 'plural' | 'select' | 'selectordinal' | null {
        const match = text.match(/\{\w+\s*,\s*(plural|select|selectordinal)\s*,/);
        return match ? (match[1] as 'plural' | 'select' | 'selectordinal') : null;
    }

    /**
     * Extract the **top-level** ICU segments from a message string.
     * Each segment represents one `{var, plural|select|selectordinal, ...}` block.
     *
     * Blocks nested inside another block are not returned: they belong to their
     * parent's case content and are rendered as part of it. Returning them would
     * produce overlapping ranges, and would make a message with a single nested
     * block look like a compound message to {@link isCompoundMessage}.
     */
    static getIcuSegments(text: string): {
        variable: string;
        type: 'plural' | 'select' | 'selectordinal';
        start: number;
        end: number;
        raw: string;
    }[] {
        const segments: {
            variable: string;
            type: 'plural' | 'select' | 'selectordinal';
            start: number;
            end: number;
            raw: string;
        }[] = [];

        let i = 0;
        while (i < text.length) {
            if (text[i] !== '{') {
                i++;
                continue;
            }

            const match = text.substring(i).match(this.ICU_HEAD);
            if (!match) {
                i++;
                continue;
            }

            const start = i;
            const end = this.skipIcuBlock(text, start);
            segments.push({
                variable: match[1],
                type: match[2] as 'plural' | 'select' | 'selectordinal',
                start,
                end,
                raw: text.substring(start, end),
            });

            // Resume *after* the block so nested heads are not reported.
            i = end;
        }

        return segments;
    }

    /**
     * Check if a message contains multiple ICU expressions (compound message).
     * e.g., "{gender, select, male{He} other{They}} has {count, plural, one{1 item} other{{count} items}}"
     */
    static isCompoundMessage(text: string): boolean {
        return this.getIcuSegments(text).length > 1;
    }

    /**
     * Validate ICU message syntax.
     * Returns true if the ICU message is well-formed.
     */
    static validateIcuSyntax(text: string): { valid: boolean; error?: string } {
        if (!this.hasIcuSyntax(text)) {
            return { valid: true };
        }

        // Check for balanced braces
        let braceCount = 0;
        for (const char of text) {
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;

            if (braceCount < 0) {
                return { valid: false, error: 'Unmatched closing brace' };
            }
        }

        if (braceCount !== 0) {
            return { valid: false, error: 'Unmatched opening brace' };
        }

        // Check for required ICU parts based on type
        const icuType = this.getIcuType(text);
        if (icuType === 'plural' || icuType === 'selectordinal') {
            if (!text.includes('other{')) {
                return { valid: false, error: `ICU ${icuType} message missing required 'other' case` };
            }
        }

        return { valid: true };
    }

    /**
     * The canonical, ordered parameter list for a message.
     *
     * ARB lets `@key.placeholders` declare the intended parameter order, so that
     * wins — but only for names the message actually uses. A metadata entry for a
     * placeholder that no longer appears in the text would otherwise add a
     * parameter nothing supplies, and a placeholder used in the text but missing
     * from metadata would be dropped from the signature entirely.
     *
     * This list is computed once per key from the default locale and reused for
     * every locale's lookup entry, so positional `Function.apply` dispatch stays
     * consistent when a translator reorders placeholders.
     */
    static getOrderedPlaceholders(
        text: string,
        metadata?: Record<string, PlaceholderInfo>
    ): string[] {
        const used = this.extractPlaceholders(text);
        if (!metadata) {
            return used;
        }

        const usedSet = new Set(used);
        const declared = Object.keys(metadata).filter((name) => usedSet.has(name));
        const declaredSet = new Set(declared);

        // Metadata order first, then anything the text uses that metadata omitted.
        return [...declared, ...used.filter((name) => !declaredSet.has(name))];
    }
}