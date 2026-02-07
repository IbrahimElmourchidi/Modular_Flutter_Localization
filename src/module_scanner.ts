import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface ArbFile {
    path: string;
    locale: string;
    moduleName: string;
}

export interface Module {
    name: string;
    path: string;
    arbFiles: ArbFile[];
}

export interface ScanResult {
    modules: Module[];
    detectedLocales: string[];
    validationErrors?: string[];
    flutterIntlDetected?: boolean;
    skippedFlutterIntlFiles?: string[];
}

export interface ValidationError {
    filePath: string;
    errors: string[];
}

// Comprehensive list of valid locales (ISO 639-1/2/3 + UN M.49 regions + script codes)
const VALID_LOCALES = new Set([
    // English variants
    'en', 'en_US', 'en_GB', 'en_AU', 'en_CA', 'en_NZ', 'en_IE', 'en_ZA', 'en_IN', 'en_SG',
    'en_PH', 'en_MY', 'en_HK', 'en_PK', 'en_NG', 'en_KE', 'en_TZ', 'en_GH', 'en_ZW',

    // Arabic variants
    'ar', 'ar_EG', 'ar_SA', 'ar_AE', 'ar_KW', 'ar_QA', 'ar_BH', 'ar_OM', 'ar_JO',
    'ar_LB', 'ar_SY', 'ar_IQ', 'ar_YE', 'ar_LY', 'ar_TN', 'ar_DZ', 'ar_MA', 'ar_SD',
    'ar_PS', 'ar_MR', 'ar_SO', 'ar_DJ', 'ar_KM',

    // German variants
    'de', 'de_DE', 'de_AT', 'de_CH', 'de_LI', 'de_LU', 'de_BE',

    // Spanish variants
    'es', 'es_ES', 'es_MX', 'es_AR', 'es_CO', 'es_CL', 'es_PE', 'es_VE', 'es_EC',
    'es_GT', 'es_CU', 'es_BO', 'es_DO', 'es_HN', 'es_PY', 'es_SV', 'es_NI', 'es_CR',
    'es_PA', 'es_UY', 'es_PR', 'es_GQ', 'es_US',

    // French variants
    'fr', 'fr_FR', 'fr_CA', 'fr_BE', 'fr_CH', 'fr_LU', 'fr_MC', 'fr_SN', 'fr_CI',
    'fr_CM', 'fr_BF', 'fr_NE', 'fr_ML', 'fr_MG', 'fr_CD', 'fr_HT', 'fr_RE',

    // Italian variants
    'it', 'it_IT', 'it_CH', 'it_SM', 'it_VA',

    // Portuguese variants
    'pt', 'pt_BR', 'pt_PT', 'pt_AO', 'pt_MZ', 'pt_GW', 'pt_CV', 'pt_ST', 'pt_TL',

    // Russian variants
    'ru', 'ru_RU', 'ru_UA', 'ru_BY', 'ru_KZ', 'ru_KG', 'ru_MD',

    // Chinese variants (with script codes)
    'zh', 'zh_CN', 'zh_TW', 'zh_HK', 'zh_SG', 'zh_MO',
    'zh_Hans', 'zh_Hant', 'zh_Hans_CN', 'zh_Hans_SG', 'zh_Hant_TW', 'zh_Hant_HK', 'zh_Hant_MO',

    // Japanese
    'ja', 'ja_JP',

    // Korean
    'ko', 'ko_KR', 'ko_KP',

    // Dutch variants
    'nl', 'nl_NL', 'nl_BE', 'nl_SR', 'nl_AW', 'nl_CW',

    // Polish
    'pl', 'pl_PL',

    // Turkish
    'tr', 'tr_TR', 'tr_CY',

    // Swedish
    'sv', 'sv_SE', 'sv_FI', 'sv_AX',

    // Norwegian variants
    'no', 'nb', 'nn', 'nb_NO', 'nn_NO', 'no_NO',

    // Danish
    'da', 'da_DK', 'da_GL',

    // Finnish
    'fi', 'fi_FI',

    // Greek
    'el', 'el_GR', 'el_CY',

    // Czech
    'cs', 'cs_CZ',

    // Romanian
    'ro', 'ro_RO', 'ro_MD',

    // Hungarian
    'hu', 'hu_HU',

    // Ukrainian
    'uk', 'uk_UA',

    // Thai
    'th', 'th_TH',

    // Vietnamese
    'vi', 'vi_VN',

    // Indonesian
    'id', 'id_ID',

    // Malay
    'ms', 'ms_MY', 'ms_SG', 'ms_BN',

    // Hindi
    'hi', 'hi_IN',

    // Bengali
    'bn', 'bn_BD', 'bn_IN',

    // Tamil
    'ta', 'ta_IN', 'ta_LK', 'ta_SG', 'ta_MY',

    // Telugu
    'te', 'te_IN',

    // Marathi
    'mr', 'mr_IN',

    // Gujarati
    'gu', 'gu_IN',

    // Kannada
    'kn', 'kn_IN',

    // Malayalam
    'ml', 'ml_IN',

    // Punjabi
    'pa', 'pa_IN', 'pa_PK',

    // Urdu
    'ur', 'ur_PK', 'ur_IN',

    // Persian/Farsi
    'fa', 'fa_IR', 'fa_AF',

    // Hebrew
    'he', 'he_IL', 'iw', 'iw_IL',

    // Swahili
    'sw', 'sw_KE', 'sw_TZ', 'sw_UG',

    // Afrikaans
    'af', 'af_ZA', 'af_NA',

    // Serbian (with script codes)
    'sr', 'sr_RS', 'sr_ME', 'sr_BA', 'sr_Latn', 'sr_Cyrl',
    'sr_Latn_RS', 'sr_Latn_ME', 'sr_Latn_BA', 'sr_Cyrl_RS', 'sr_Cyrl_ME', 'sr_Cyrl_BA',

    // Other major languages
    'am', 'am_ET', 'az', 'az_AZ', 'be', 'be_BY', 'bg', 'bg_BG',
    'bs', 'bs_BA', 'ca', 'ca_ES', 'ca_AD', 'cy', 'cy_GB',
    'et', 'et_EE', 'eu', 'eu_ES', 'fil', 'fil_PH', 'gl', 'gl_ES',
    'hr', 'hr_HR', 'hr_BA', 'hy', 'hy_AM', 'is', 'is_IS',
    'ka', 'ka_GE', 'kk', 'kk_KZ', 'km', 'km_KH', 'ky', 'ky_KG',
    'lo', 'lo_LA', 'lt', 'lt_LT', 'lv', 'lv_LV', 'mk', 'mk_MK',
    'mn', 'mn_MN', 'my', 'my_MM', 'ne', 'ne_NP', 'ne_IN',
    'or', 'or_IN', 'ps', 'ps_AF', 'sd', 'sd_PK', 'si', 'si_LK',
    'sk', 'sk_SK', 'sl', 'sl_SI', 'so', 'so_SO', 'sq', 'sq_AL', 'sq_MK',
    'tl', 'tl_PH', 'tk', 'tk_TM', 'ug', 'ug_CN', 'uz', 'uz_UZ',
    'yi', 'yi_001', 'zu', 'zu_ZA', 'dv', 'dv_MV', 'ga', 'ga_IE',
    'gd', 'gd_GB', 'ha', 'ha_NG', 'ig', 'ig_NG', 'jv', 'jv_ID',
    'ku', 'ku_TR', 'la', 'la_VA', 'lb', 'lb_LU', 'mg', 'mg_MG',
    'mt', 'mt_MT', 'yo', 'yo_NG',
]);

const VALID_SCRIPTS = new Set([
    'Hans', 'Hant', 'Latn', 'Cyrl', 'Arab', 'Deva', 'Beng', 'Jpan', 'Kore',
]);

export class ModuleScanner {
    constructor(
        private rootPath: string,
        private arbPattern: string
    ) {}

    async scanModules(): Promise<ScanResult> {
        const modules: Map<string, Module> = new Map();
        const detectedLocales: Set<string> = new Set();
        const validationErrors: string[] = [];
        const skippedFlutterIntlFiles: string[] = [];
        let flutterIntlDetected = false;

        const arbFilePaths = await this.findArbFiles();

        for (const arbFilePath of arbFilePaths) {
            // CRITICAL: Skip Flutter Intl files (intl_*.arb pattern)
            if (this.isFlutterIntlFile(arbFilePath)) {
                flutterIntlDetected = true;
                skippedFlutterIntlFiles.push(this.getRelativePath(arbFilePath));
                continue;
            }

            const validation = this.validateAndParseArbFile(arbFilePath);

            if (!validation.isValid) {
                validationErrors.push(
                    ...validation.errors.map(
                        (err) => `❌ ${this.getRelativePath(arbFilePath)}: ${err}`
                    )
                );
                continue;
            }

            const { moduleName, locale } = validation;
            const modulePath = path.dirname(path.dirname(arbFilePath));

            detectedLocales.add(locale!);

            if (!modules.has(moduleName!)) {
                modules.set(moduleName!, {
                    name: moduleName!,
                    path: modulePath,
                    arbFiles: [],
                });
            }

            modules.get(moduleName!)!.arbFiles.push({
                path: arbFilePath,
                locale: locale!,
                moduleName: moduleName!,
            });
        }

        return {
            modules: Array.from(modules.values()),
            detectedLocales: Array.from(detectedLocales).sort(),
            validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
            flutterIntlDetected,
            skippedFlutterIntlFiles:
                skippedFlutterIntlFiles.length > 0 ? skippedFlutterIntlFiles : undefined,
        };
    }

    /**
     * Detect Flutter Intl files to avoid conflicts.
     * Simple prefix check catches all locale formats including script codes
     * (intl_zh_Hans.arb, intl_sr_Latn_RS.arb, etc.)
     */
    private isFlutterIntlFile(filePath: string): boolean {
        const fileName = path.basename(filePath);
        return /^intl_.*\.arb$/.test(fileName);
    }

    private async findArbFiles(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            glob(this.arbPattern, { cwd: this.rootPath, absolute: true }, (err, matches) => {
                if (err) {
                    reject(err);
                } else {
                    const filtered = matches.filter(
                        (f) =>
                            !f.includes('generated') &&
                            !f.includes('.dart_tool') &&
                            !f.includes('build') &&
                            !f.includes('node_modules') &&
                            !f.includes('.git') &&
                            !f.includes('.idea') &&
                            !f.includes('.vscode') &&
                            !f.includes('/outputs/') &&
                            !f.includes('/output/') &&
                            !f.includes('/dist/') &&
                            !f.includes('/tmp/')
                    );
                    resolve(filtered);
                }
            });
        });
    }

    /**
     * Validate and parse ARB file content.
     * Synchronous - no need for async.
     */
    private validateAndParseArbFile(
        arbFilePath: string
    ): { isValid: boolean; moduleName?: string; locale?: string; errors: string[] } {
        const errors: string[] = [];

        try {
            const content = fs.readFileSync(arbFilePath, 'utf-8');
            let json: any;

            try {
                json = JSON.parse(content);
            } catch {
                errors.push('Invalid JSON syntax');
                return { isValid: false, errors };
            }

            const locale = json['@@locale'];
            const moduleName = json['@@context'];

            if (!locale) {
                errors.push('Missing required property "@@locale" (required for Modular L10n)');
            } else if (typeof locale !== 'string') {
                errors.push('"@@locale" must be a string');
            } else if (!this.isValidLocale(locale)) {
                errors.push(
                    `Invalid or unknown locale "${locale}". Valid examples: en, en_US, zh_Hans_CN, ar_EG, sr_Latn_RS`
                );
            }

            if (!moduleName) {
                errors.push(
                    'Missing required property "@@context" (required for Modular L10n to distinguish from Flutter Intl files)'
                );
            } else if (typeof moduleName !== 'string') {
                errors.push('"@@context" must be a string');
            } else if (!this.isValidModuleName(moduleName)) {
                errors.push(
                    `Invalid module name "${moduleName}". Must be snake_case (e.g., auth, user_profile, home_screen)`
                );
            }

            const keys = Object.keys(json).filter((k) => !k.startsWith('@'));
            if (keys.length === 0) {
                // Only a warning — new modules may have no keys yet
                // Don't block validation for this
            }

            if (errors.length > 0) {
                return { isValid: false, errors };
            }

            return { isValid: true, moduleName, locale, errors: [] };
        } catch (error) {
            errors.push(
                `Error reading file: ${error instanceof Error ? error.message : String(error)}`
            );
            return { isValid: false, errors };
        }
    }

    /**
     * Check if locale is valid against comprehensive locale list.
     */
    private isValidLocale(locale: string): boolean {
        const normalizedLocale = locale.replace(/-/g, '_');

        if (VALID_LOCALES.has(normalizedLocale)) {
            return true;
        }

        const parts = normalizedLocale.split('_');

        if (parts.length === 1) {
            return VALID_LOCALES.has(parts[0]);
        } else if (parts.length === 2) {
            const [lang, second] = parts;
            if (VALID_SCRIPTS.has(second)) {
                return VALID_LOCALES.has(lang) || VALID_LOCALES.has(normalizedLocale);
            } else {
                return VALID_LOCALES.has(lang) || VALID_LOCALES.has(normalizedLocale);
            }
        } else if (parts.length === 3) {
            const [lang, script] = parts;
            const langValid = VALID_LOCALES.has(lang);
            const scriptValid = VALID_SCRIPTS.has(script);
            if (langValid && scriptValid) {
                return true;
            }
            return VALID_LOCALES.has(normalizedLocale);
        }

        return false;
    }

    /**
     * Check if module name is valid snake_case.
     */
    private isValidModuleName(name: string): boolean {
        if (!name || /^_+$/.test(name)) {
            return false;
        }
        return /^[a-z][a-z0-9_]*$/.test(name);
    }

    private getRelativePath(fullPath: string): string {
        return path.relative(this.rootPath, fullPath);
    }
}