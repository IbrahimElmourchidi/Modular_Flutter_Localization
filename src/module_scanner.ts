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
}

// Known valid locales (ISO 639-1 + common regional variants)
const VALID_LOCALES = new Set([
    // English variants
    'en', 'en_US', 'en_GB', 'en_AU', 'en_CA', 'en_NZ', 'en_IE', 'en_ZA', 'en_IN',

    // Arabic variants
    'ar', 'ar_EG', 'ar_SA', 'ar_AE', 'ar_KW', 'ar_QA', 'ar_BH', 'ar_OM', 'ar_JO',
    'ar_LB', 'ar_SY', 'ar_IQ', 'ar_YE', 'ar_LY', 'ar_TN', 'ar_DZ', 'ar_MA', 'ar_SD',

    // German variants
    'de', 'de_DE', 'de_AT', 'de_CH', 'de_LI', 'de_LU',

    // Spanish variants
    'es', 'es_ES', 'es_MX', 'es_AR', 'es_CO', 'es_CL', 'es_PE', 'es_VE', 'es_EC',
    'es_GT', 'es_CU', 'es_BO', 'es_DO', 'es_HN', 'es_PY', 'es_SV', 'es_NI', 'es_CR',
    'es_PA', 'es_UY', 'es_PR',

    // French variants
    'fr', 'fr_FR', 'fr_CA', 'fr_BE', 'fr_CH', 'fr_LU', 'fr_MC',

    // Italian variants
    'it', 'it_IT', 'it_CH',

    // Portuguese variants
    'pt', 'pt_BR', 'pt_PT', 'pt_AO', 'pt_MZ',

    // Russian variants
    'ru', 'ru_RU', 'ru_UA', 'ru_BY', 'ru_KZ',

    // Chinese variants
    'zh', 'zh_CN', 'zh_TW', 'zh_HK', 'zh_SG', 'zh_MO',

    // Japanese
    'ja', 'ja_JP',

    // Korean
    'ko', 'ko_KR', 'ko_KP',

    // Dutch variants
    'nl', 'nl_NL', 'nl_BE',

    // Polish
    'pl', 'pl_PL',

    // Turkish
    'tr', 'tr_TR',

    // Swedish
    'sv', 'sv_SE', 'sv_FI',

    // Norwegian
    'no', 'nb', 'nn', 'nb_NO', 'nn_NO',

    // Danish
    'da', 'da_DK',

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
    'ta', 'ta_IN', 'ta_LK', 'ta_SG',

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
    'he', 'he_IL',

    // Swahili
    'sw', 'sw_KE', 'sw_TZ',

    // Afrikaans
    'af', 'af_ZA',

    // Other common languages
    'am', 'am_ET',           // Amharic
    'az', 'az_AZ',           // Azerbaijani
    'be', 'be_BY',           // Belarusian
    'bg', 'bg_BG',           // Bulgarian
    'bs', 'bs_BA',           // Bosnian
    'ca', 'ca_ES',           // Catalan
    'cy', 'cy_GB',           // Welsh
    'et', 'et_EE',           // Estonian
    'eu', 'eu_ES',           // Basque
    'fil', 'fil_PH',         // Filipino
    'gl', 'gl_ES',           // Galician
    'hr', 'hr_HR',           // Croatian
    'hy', 'hy_AM',           // Armenian
    'is', 'is_IS',           // Icelandic
    'ka', 'ka_GE',           // Georgian
    'kk', 'kk_KZ',           // Kazakh
    'km', 'km_KH',           // Khmer
    'ky', 'ky_KG',           // Kyrgyz
    'lo', 'lo_LA',           // Lao
    'lt', 'lt_LT',           // Lithuanian
    'lv', 'lv_LV',           // Latvian
    'mk', 'mk_MK',           // Macedonian
    'mn', 'mn_MN',           // Mongolian
    'my', 'my_MM',           // Burmese
    'ne', 'ne_NP',           // Nepali
    'or', 'or_IN',           // Odia
    'ps', 'ps_AF',           // Pashto
    'sd', 'sd_PK',           // Sindhi
    'si', 'si_LK',           // Sinhala
    'sk', 'sk_SK',           // Slovak
    'sl', 'sl_SI',           // Slovenian
    'so', 'so_SO',           // Somali
    'sq', 'sq_AL',           // Albanian
    'sr', 'sr_RS', 'sr_Latn', 'sr_Cyrl',  // Serbian
    'tl', 'tl_PH',           // Tagalog
    'tk', 'tk_TM',           // Turkmen
    'ug', 'ug_CN',           // Uyghur
    'uz', 'uz_UZ',           // Uzbek
    'yi',                    // Yiddish
    'zu', 'zu_ZA',           // Zulu
    'dv', 'dv_MV',           // Divehi
]);

export class ModuleScanner {
    constructor(
        private rootPath: string,
        private arbPattern: string
    ) {}

    async scanModules(): Promise<ScanResult> {
        const modules: Map<string, Module> = new Map();
        const detectedLocales: Set<string> = new Set();

        // Find all ARB files
        const arbFilePaths = await this.findArbFiles();

        for (const arbFilePath of arbFilePaths) {
            const parsed = await this.parseArbFileContent(arbFilePath);

            // Skip files without required metadata
            if (!parsed) {
                continue;
            }

            const { moduleName, locale } = parsed;
            const modulePath = path.dirname(path.dirname(arbFilePath)); // Go up from l10n folder

            // Track detected locales
            detectedLocales.add(locale);

            if (!modules.has(moduleName)) {
                modules.set(moduleName, {
                    name: moduleName,
                    path: modulePath,
                    arbFiles: [],
                });
            }

            modules.get(moduleName)!.arbFiles.push({
                path: arbFilePath,
                locale,
                moduleName,
            });
        }

        return {
            modules: Array.from(modules.values()),
            detectedLocales: Array.from(detectedLocales).sort(),
        };
    }

    private async findArbFiles(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            glob(this.arbPattern, { cwd: this.rootPath, absolute: true }, (err, matches) => {
                if (err) {
                    reject(err);
                } else {
                    // Filter out generated files and build artifacts
                    const filtered = matches.filter(
                        (f) =>
                            !f.includes('generated') &&
                            !f.includes('.dart_tool') &&
                            !f.includes('build') &&
                            !f.includes('node_modules')
                    );
                    resolve(filtered);
                }
            });
        });
    }

    /**
     * Parse ARB file content to extract @@locale and @@context
     * Returns null if either is missing or invalid (file will be skipped)
     */
    private async parseArbFileContent(
        arbFilePath: string
    ): Promise<{ moduleName: string; locale: string } | null> {
        try {
            const content = fs.readFileSync(arbFilePath, 'utf-8');
            const json = JSON.parse(content);

            const locale = json['@@locale'];
            const moduleName = json['@@context'];

            // Check for missing @@locale
            if (!locale) {
                console.log(`⚠️  Skipping ${this.getRelativePath(arbFilePath)}`);
                console.log(`   Missing "@@locale" property`);
                return null;
            }

            // Check for missing @@context
            if (!moduleName) {
                console.log(`⚠️  Skipping ${this.getRelativePath(arbFilePath)}`);
                console.log(`   Missing "@@context" property`);
                return null;
            }

            // Validate locale against known locales
            if (!this.isValidLocale(locale)) {
                console.log(`⚠️  Skipping ${this.getRelativePath(arbFilePath)}`);
                console.log(`   Unknown locale "${locale}"`);
                console.log(`   Examples of valid locales: en, en_US, ar, ar_EG, de, fr, es, zh, ja, ko`);
                return null;
            }

            // Validate module name format (snake_case)
            if (!this.isValidModuleName(moduleName)) {
                console.log(`⚠️  Skipping ${this.getRelativePath(arbFilePath)}`);
                console.log(`   Invalid module name "${moduleName}"`);
                console.log(`   Module name must be snake_case (e.g., auth, user_profile, home_screen)`);
                return null;
            }

            return { moduleName, locale };
        } catch (error) {
            if (error instanceof SyntaxError) {
                console.log(`⚠️  Skipping ${this.getRelativePath(arbFilePath)}`);
                console.log(`   Invalid JSON syntax`);
            } else {
                console.error(`⚠️  Error reading ${this.getRelativePath(arbFilePath)}:`, error);
            }
            return null;
        }
    }

    /**
     * Check if locale is valid against known locales
     */
    private isValidLocale(locale: string): boolean {
        // Normalize locale format (support both en-US and en_US)
        const normalizedLocale = locale.replace('-', '_');

        // Check exact match first
        if (VALID_LOCALES.has(normalizedLocale)) {
            return true;
        }

        // Check base language (e.g., "en" from "en_AU")
        const baseLang = normalizedLocale.split('_')[0];
        if (VALID_LOCALES.has(baseLang)) {
            return true;
        }

        return false;
    }

    /**
     * Check if module name is valid snake_case
     */
    private isValidModuleName(name: string): boolean {
        return /^[a-z][a-z0-9_]*$/.test(name);
    }

    /**
     * Get relative path for cleaner log output
     */
    private getRelativePath(fullPath: string): string {
        return path.relative(this.rootPath, fullPath);
    }
}