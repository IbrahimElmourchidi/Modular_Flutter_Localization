import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { LogLevel, normalizeLogLevel } from './log_level';

/**
 * Configuration that can be read from pubspec.yaml under the `modular_l10n:` key.
 * This makes config portable across team members (no VS Code settings dependency).
 *
 * Example pubspec.yaml:
 *
 * modular_l10n:
 *   enabled: true
 *   class_name: ML
 *   default_locale: en
 *   output_dir: lib/generated/modular_l10n
 *   arb_dir_pattern: "** /l10n/*.arb"
 *   generate_combined_arb: true
 *   use_deferred_loading: false
 *   watch_mode: true
 *   log_level: warning   # silent | error | warning | verbose
 *   module_access: part  # part | library
 *
 * Every field is optional. A key that is absent from pubspec.yaml stays
 * `undefined` here so {@link mergeConfigs} can fall back to the VS Code
 * setting for that key alone, rather than replacing the whole config.
 */

/**
 * How the per-module files relate to the generated entry-point library.
 *
 * - `part` — every `<module>_l10n.dart` is a `part of` the `<class>.dart`
 *   library, so importing one is a compile error and the entry point is the
 *   only way in. The classes stay public, so their types are still nameable.
 * - `library` — each module file is its own library and can be imported
 *   directly. Kept as an escape hatch for projects still migrating.
 */
export type ModuleAccess = 'part' | 'library';

/** Accepted spellings of `module_access`; anything else is ignored. */
export const MODULE_ACCESS_VALUES: readonly ModuleAccess[] = ['part', 'library'];

export interface PubspecConfig {
    enabled: boolean;
    className?: string;
    defaultLocale?: string;
    outputDir?: string;
    arbDirPattern?: string;
    generateCombinedArb?: boolean;
    useDeferredLoading?: boolean;
    watchMode?: boolean;
    logLevel?: LogLevel;
    moduleAccess?: ModuleAccess;
}

/**
 * Canonical form of a locale name: `zh-Hans` -> `zh_Hans`.
 *
 * The scanner accepts either separator, and everything downstream compares
 * locale strings with `===`. Without one canonical form, `zh-Hans` in an ARB
 * file and `zh_Hans` in the default-locale setting compare unequal, and the
 * project silently falls back to the first detected locale.
 */
export function normalizeLocale(locale: string): string {
    return locale.trim().replace(/-/g, '_');
}

/**
 * The locale that actually serves as the template: the configured default when
 * the project's ARB files contain it, otherwise the first one detected.
 *
 * Shared because two callers need this and disagreed. The generator fell back to
 * `detectedLocales[0]`, while the diagnostics looked for an ARB file named after
 * `config.defaultLocale` and skipped the whole module when there was none — so a
 * project whose configured default was absent got generated output from one
 * locale and no ICU diagnostics at all, for any module.
 *
 * @returns the effective default, or `undefined` when nothing was detected
 */
export function resolveEffectiveDefaultLocale(
    configuredDefault: string,
    detectedLocales: readonly string[]
): string | undefined {
    const wanted = normalizeLocale(configuredDefault);
    return detectedLocales.includes(wanted) ? wanted : detectedLocales[0];
}

/** Values used when neither pubspec.yaml nor VS Code settings supply one. */
export const DEFAULT_CONFIG: Required<PubspecConfig> = {
    enabled: true,
    className: 'ML',
    defaultLocale: 'en',
    outputDir: 'lib/generated/modular_l10n',
    arbDirPattern: '**/l10n/*.arb',
    generateCombinedArb: true,
    useDeferredLoading: false,
    watchMode: true,
    logLevel: 'warning',
    moduleAccess: 'part',
};

/** Only these types are accepted for a given key; anything else is ignored. */
function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/**
 * Accept only one of a fixed set of strings.
 *
 * A typo in `pubspec.yaml` must not silently select a different file layout,
 * so anything outside `allowed` is dropped — leaving the key `undefined` and
 * letting {@link mergeConfigs} fall through to the VS Code setting.
 */
function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : undefined;
}

export class PubspecConfigReader {
    private pubspecPath: string;

    constructor(private rootPath: string) {
        this.pubspecPath = path.join(rootPath, 'pubspec.yaml');
    }

    /**
     * Check if pubspec.yaml exists
     */
    hasPubspec(): boolean {
        return fs.existsSync(this.pubspecPath);
    }

    /**
     * Read the modular_l10n config from pubspec.yaml.
     * Returns null when the file has no `modular_l10n:` section at all.
     *
     * A section with `enabled: false` is still returned (with `enabled: false`)
     * so callers can honour the off switch — returning null there would make it
     * indistinguishable from "no config", and the extension would keep running.
     */
    readConfig(): PubspecConfig | null {
        if (!this.hasPubspec()) {
            return null;
        }

        try {
            const content = fs.readFileSync(this.pubspecPath, 'utf-8');
            const doc = yaml.parse(content);

            if (!doc || typeof doc !== 'object') {
                return null;
            }

            const cfg = (doc as Record<string, unknown>)['modular_l10n'];
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
                return null;
            }

            const c = cfg as Record<string, unknown>;

            return {
                enabled: asBoolean(c.enabled) ?? true,
                className: asString(c.class_name),
                defaultLocale: asString(c.default_locale) ?? asString(c.main_locale),
                outputDir: asString(c.output_dir),
                arbDirPattern: asString(c.arb_dir_pattern),
                generateCombinedArb: asBoolean(c.generate_combined_arb),
                useDeferredLoading: asBoolean(c.use_deferred_loading),
                watchMode: asBoolean(c.watch_mode),
                logLevel:
                    c.log_level === undefined ? undefined : normalizeLogLevel(c.log_level),
                moduleAccess: asEnum(c.module_access, MODULE_ACCESS_VALUES),
            };
        } catch {
            // Malformed YAML: fall back to VS Code settings rather than throwing
            // during activation. `generateTranslations` surfaces parse errors.
            return null;
        }
    }

    /**
     * Write the modular_l10n config section into pubspec.yaml.
     *
     * Edits the YAML document rather than the raw text. String surgery here is
     * unsafe: `modular_l10n` is also a legitimate dependency name, so a
     * substring search matches the entry under `dependencies:` and a regex
     * replace anchored on it destroys the rest of the dependency block.
     * Going through the parser guarantees the top-level node is the one edited,
     * and the `yaml` package preserves surrounding comments and formatting.
     */
    writeConfig(config?: Partial<PubspecConfig>): void {
        if (!this.hasPubspec()) {
            throw new Error('pubspec.yaml not found');
        }

        const merged: Required<PubspecConfig> = { ...DEFAULT_CONFIG, ...stripUndefined(config) };

        try {
            const content = fs.readFileSync(this.pubspecPath, 'utf-8');
            const doc = yaml.parseDocument(content);

            if (doc.errors.length > 0) {
                throw new Error(
                    `pubspec.yaml is not valid YAML (${doc.errors[0].message}). ` +
                    'Fix the file and try again.'
                );
            }

            doc.set('modular_l10n', {
                enabled: merged.enabled,
                class_name: merged.className,
                default_locale: merged.defaultLocale,
                output_dir: merged.outputDir,
                arb_dir_pattern: merged.arbDirPattern,
                generate_combined_arb: merged.generateCombinedArb,
                use_deferred_loading: merged.useDeferredLoading,
                watch_mode: merged.watchMode,
                log_level: merged.logLevel,
                module_access: merged.moduleAccess,
            });

            fs.writeFileSync(this.pubspecPath, String(doc), 'utf-8');
        } catch (error) {
            throw new Error(
                `Failed to write pubspec.yaml: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Check if Flutter Intl config exists in pubspec.yaml.
     * Reads the parsed document so a `flutter_intl` dependency entry is not
     * mistaken for a top-level `flutter_intl:` config block.
     */
    hasFlutterIntlConfig(): boolean {
        return this.readFlutterIntlConfig() !== null;
    }

    /**
     * Read Flutter Intl configuration to detect potential conflicts
     */
    readFlutterIntlConfig(): { className?: string; outputDir?: string; arbDir?: string } | null {
        if (!this.hasPubspec()) {
            return null;
        }

        try {
            const content = fs.readFileSync(this.pubspecPath, 'utf-8');
            const doc = yaml.parse(content);

            if (!doc || typeof doc !== 'object') {
                return null;
            }

            const cfg = (doc as Record<string, unknown>)['flutter_intl'];
            if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
                return null;
            }

            const c = cfg as Record<string, unknown>;
            return {
                className: asString(c.class_name) ?? 'S',
                outputDir: asString(c.output_dir) ?? 'lib/generated',
                arbDir: asString(c.arb_dir) ?? 'lib/l10n',
            };
        } catch {
            return null;
        }
    }
}

/** Drop `undefined` values so they don't clobber defaults during a spread. */
function stripUndefined<T extends object>(obj?: Partial<T>): Partial<T> {
    if (!obj) return {};
    const out: Partial<T> = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) {
            (out as Record<string, unknown>)[k] = v;
        }
    }
    return out;
}

export interface EffectiveConfig {
    enabled: boolean;
    className: string;
    outputPath: string;
    defaultLocale: string;
    arbFilePattern: string;
    generateCombinedArb: boolean;
    useDeferredLoading: boolean;
    watchMode: boolean;
    logLevel: LogLevel;
    moduleAccess: ModuleAccess;
}

/**
 * Merge VS Code settings with pubspec.yaml config, **per key**.
 *
 * A key present in pubspec.yaml wins; a key absent from it falls through to the
 * VS Code setting, and only then to the built-in default. This matches the
 * documented precedence — pubspec.yaml > VS Code settings > defaults — which a
 * whole-object replacement would silently break for every key the team left out.
 */
export function mergeConfigs(
    vscodeConfig: EffectiveConfig,
    pubspecConfig: PubspecConfig | null
): EffectiveConfig {
    if (!pubspecConfig) {
        return vscodeConfig;
    }

    const result = {
        enabled: pubspecConfig.enabled,
        className: pubspecConfig.className ?? vscodeConfig.className,
        outputPath: pubspecConfig.outputDir ?? vscodeConfig.outputPath,
        defaultLocale: pubspecConfig.defaultLocale ?? vscodeConfig.defaultLocale,
        arbFilePattern: pubspecConfig.arbDirPattern ?? vscodeConfig.arbFilePattern,
        generateCombinedArb:
            pubspecConfig.generateCombinedArb ?? vscodeConfig.generateCombinedArb,
        useDeferredLoading:
            pubspecConfig.useDeferredLoading ?? vscodeConfig.useDeferredLoading,
        watchMode: pubspecConfig.watchMode ?? vscodeConfig.watchMode,
        logLevel: pubspecConfig.logLevel ?? vscodeConfig.logLevel,
        moduleAccess: pubspecConfig.moduleAccess ?? vscodeConfig.moduleAccess,
    };
    // Normalised last, so whichever source won still ends up canonical.
    result.defaultLocale = normalizeLocale(result.defaultLocale);
    return result;
}
