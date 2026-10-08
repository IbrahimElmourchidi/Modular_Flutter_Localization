import * as fs from 'fs';
import { Module, ArbFile } from './module_scanner';
import { parseIcu, collectArgs, describeIcuControls, IcuArg, IcuNode } from './icu_parser';

export interface TranslationKey {
    key: string;
    translations: Record<string, string>;
    description?: string;
    placeholders?: Record<string, PlaceholderInfo>;
}

export interface PlaceholderInfo {
    type?: string;
    /** `String(...)` on read: ARB metadata sometimes carries a bare number. */
    example?: string;
    format?: string;
    isCustomDateFormat?: string;
    optionalParameters?: Record<string, string | number>;
}

/**
 * ARB allows any JSON scalar in `optionalParameters`, and Dart's `NumberFormat`
 * named arguments are typed — `decimalDigits` is an `int`, not a `String`.
 * Keeping numbers as numbers here is what lets the generator emit
 * `decimalDigits: 2` rather than `decimalDigits: '2'`.
 */
function normalizeOptionalParameters(value: unknown): Record<string, string | number> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

    const result: Record<string, string | number> = {};
    for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'number' || typeof entry === 'string') result[name] = entry;
    }
    return Object.keys(result).length > 0 ? result : undefined;
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
                type:
                    typeof placeholderInfo.type === 'string'
                        ? placeholderInfo.type
                        : undefined,
                // ARB examples are usually strings, but `"example": 42` is valid
                // JSON and shows up in hand-written files. Stringifying keeps
                // the declared type `string | undefined` instead of leaking
                // `unknown` into every consumer.
                example:
                    placeholderInfo.example === undefined || placeholderInfo.example === null
                        ? undefined
                        : String(placeholderInfo.example),
                format:
                    typeof placeholderInfo.format === 'string'
                        ? placeholderInfo.format
                        : undefined,
                isCustomDateFormat:
                    typeof placeholderInfo.isCustomDateFormat === 'string'
                        ? placeholderInfo.isCustomDateFormat
                        : undefined,
                optionalParameters: normalizeOptionalParameters(
                    placeholderInfo.optionalParameters
                ),
            };
        }
        return result;
    }

    // ─── ICU ────────────────────────────────────────────────────────────
    //
    // Everything below reads the tree from `icu_parser` rather than scanning
    // the message string. Regexes and `indexOf` could not see block structure,
    // which is what let a `select` nested in a plural through as literal text
    // and let `indexOf('one{')` match inside the word "Someone{".

    /** The parse tree for a message, plus any non-fatal parse errors. */
    static parse(text: string): { nodes: IcuNode[]; errors: { message: string; start: number; end: number }[] } {
        return parseIcu(text);
    }

    /** Arguments the message needs, in first-appearance order, with their ICU role. */
    static getArguments(text: string): IcuArg[] {
        return collectArgs(parseIcu(text).nodes);
    }

    /**
     * Argument names in first-appearance order, including those reached through
     * nested case bodies.
     *
     * A `select` inside a plural contributes its keyword here, which the old
     * top-level-only scan missed — the generated method then referenced an
     * identifier that was never a parameter.
     */
    static extractPlaceholders(text: string): string[] {
        return collectArgs(parseIcu(text).nodes).map((a) => a.name);
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

    /**
     * A stable description of a message's ICU control structure — its
     * `select` / `plural` / `selectordinal` blocks and the arguments they select
     * on. Literal text and plain `{name}` positions are excluded.
     */
    static describeControls(text: string): string {
        return describeIcuControls(parseIcu(text).nodes);
    }

    /**
     * Check whether a message is well-formed ICU.
     *
     * The parser is lenient by design — it always returns a usable tree — so
     * this is what surfaces problems to the user. `Intl.plural` and
     * `Intl.select` both take `other` as a *required* named parameter, so a
     * missing case is a compile error in the generated Dart, not a runtime one.
     */
    static validateIcuSyntax(text: string): { valid: boolean; error?: string } {
        const { errors } = parseIcu(text);
        if (errors.length === 0) {
            return { valid: true };
        }
        return { valid: false, error: errors.map((e) => e.message).join('; ') };
    }
}
