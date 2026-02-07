import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

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
 */
export interface PubspecConfig {
    enabled: boolean;
    className: string;
    defaultLocale: string;
    outputDir: string;
    arbDirPattern: string;
    generateCombinedArb: boolean;
    useDeferredLoading: boolean;
    watchMode: boolean;
}

const DEFAULT_CONFIG: PubspecConfig = {
    enabled: true,
    className: 'ML',
    defaultLocale: 'en',
    outputDir: 'lib/generated/modular_l10n',
    arbDirPattern: '**/l10n/*.arb',
    generateCombinedArb: true,
    useDeferredLoading: false,
    watchMode: true,
};

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
     * Returns null if no config section exists.
     */
    readConfig(): PubspecConfig | null {
        if (!this.hasPubspec()) {
            return null;
        }

        try {
            const content = fs.readFileSync(this.pubspecPath, 'utf-8');
            const doc = yaml.parse(content);

            if (!doc || !doc['modular_l10n']) {
                return null;
            }

            const cfg = doc['modular_l10n'];

            if (cfg.enabled === false) {
                return null;
            }

            return {
                enabled: cfg.enabled !== false,
                className: cfg.class_name || DEFAULT_CONFIG.className,
                defaultLocale: cfg.default_locale || cfg.main_locale || DEFAULT_CONFIG.defaultLocale,
                outputDir: cfg.output_dir || DEFAULT_CONFIG.outputDir,
                arbDirPattern: cfg.arb_dir_pattern || DEFAULT_CONFIG.arbDirPattern,
                generateCombinedArb: cfg.generate_combined_arb ?? DEFAULT_CONFIG.generateCombinedArb,
                useDeferredLoading: cfg.use_deferred_loading ?? DEFAULT_CONFIG.useDeferredLoading,
                watchMode: cfg.watch_mode ?? DEFAULT_CONFIG.watchMode,
            };
        } catch (error) {
            console.error('Error reading pubspec.yaml config:', error);
            return null;
        }
    }

    /**
     * Write modular_l10n config section into pubspec.yaml.
     * Used by the initialize command.
     */
    writeConfig(config?: Partial<PubspecConfig>): void {
        if (!this.hasPubspec()) {
            throw new Error('pubspec.yaml not found');
        }

        const mergedConfig = { ...DEFAULT_CONFIG, ...config };

        try {
            let content = fs.readFileSync(this.pubspecPath, 'utf-8');

            // Check if modular_l10n section already exists
            if (content.includes('modular_l10n:')) {
                // Replace existing section
                content = content.replace(
                    /modular_l10n:[\s\S]*?(?=\n\w|\n$|$)/,
                    this.buildConfigYaml(mergedConfig)
                );
            } else {
                // Append at the end
                content = content.trimEnd() + '\n\n' + this.buildConfigYaml(mergedConfig) + '\n';
            }

            fs.writeFileSync(this.pubspecPath, content, 'utf-8');
        } catch (error) {
            throw new Error(`Failed to write pubspec.yaml: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Check if Flutter Intl config exists in pubspec.yaml
     */
    hasFlutterIntlConfig(): boolean {
        if (!this.hasPubspec()) {
            return false;
        }

        try {
            const content = fs.readFileSync(this.pubspecPath, 'utf-8');
            return content.includes('flutter_intl:');
        } catch {
            return false;
        }
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

            if (!doc || !doc['flutter_intl']) {
                return null;
            }

            const cfg = doc['flutter_intl'];
            return {
                className: cfg.class_name || 'S',
                outputDir: cfg.output_dir || 'lib/generated',
                arbDir: cfg.arb_dir || 'lib/l10n',
            };
        } catch {
            return null;
        }
    }

    private buildConfigYaml(config: PubspecConfig): string {
        const lines = [
            'modular_l10n:',
            `  enabled: ${config.enabled}`,
            `  class_name: ${config.className}`,
            `  default_locale: ${config.defaultLocale}`,
            `  output_dir: ${config.outputDir}`,
            `  arb_dir_pattern: "${config.arbDirPattern}"`,
            `  generate_combined_arb: ${config.generateCombinedArb}`,
            `  use_deferred_loading: ${config.useDeferredLoading}`,
            `  watch_mode: ${config.watchMode}`,
        ];
        return lines.join('\n');
    }
}

/**
 * Merge VS Code settings with pubspec.yaml config.
 * pubspec.yaml takes precedence when present.
 */
export function mergeConfigs(
    vscodeConfig: {
        className: string;
        outputPath: string;
        defaultLocale: string;
        arbFilePattern: string;
        generateCombinedArb: boolean;
        useDeferredLoading: boolean;
        watchMode: boolean;
    },
    pubspecConfig: PubspecConfig | null
): {
    className: string;
    outputPath: string;
    defaultLocale: string;
    arbFilePattern: string;
    generateCombinedArb: boolean;
    useDeferredLoading: boolean;
    watchMode: boolean;
} {
    if (!pubspecConfig) {
        return vscodeConfig;
    }

    return {
        className: pubspecConfig.className,
        outputPath: pubspecConfig.outputDir,
        defaultLocale: pubspecConfig.defaultLocale,
        arbFilePattern: pubspecConfig.arbDirPattern,
        generateCombinedArb: pubspecConfig.generateCombinedArb,
        useDeferredLoading: pubspecConfig.useDeferredLoading,
        watchMode: pubspecConfig.watchMode,
    };
}