import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';
import { Logger } from './logger';

/**
 * Provides diagnostics for missing translations across locales.
 * Shows warnings in the Problems panel when keys are present in the default locale
 * but missing in other locales.
 */
export class MissingTranslationDiagnostics {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('modularL10n');
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }

    getDiagnosticCollection(): vscode.DiagnosticCollection {
        return this.diagnosticCollection;
    }

    /**
     * Run diagnostics on all modules, reporting missing translations.
     */
    async runDiagnostics(
        logger: Logger,
        /**
         * `auto: true` for the on-save run. Automatic runs never steal focus
         * and never raise notifications — the Problems panel is the signal.
         */
        options: { auto?: boolean } = {}
    ): Promise<void> {
        const auto = options.auto === true;

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            if (!auto) await logger.notifyWarning('No workspace folder open.');
            return;
        }

        logger.info('Checking for missing translations...');
        if (!auto) logger.reveal();

        const rootPath = workspaceFolders[0].uri.fsPath;
        const config = getEffectiveConfig(rootPath);
        const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
        const { modules, detectedLocales } = await scanner.scanModules();

        this.diagnosticCollection.clear();

        if (modules.length === 0) {
            logger.warn('No modules found. Make sure your ARB files have @@locale and @@context properties.');
            if (!auto) {
                await logger.notifyWarning(
                    'No L10n modules found. Check that ARB files contain @@locale and @@context.'
                );
            }
            return;
        }

        logger.info(`Found ${modules.length} module(s) with ${detectedLocales.length} locale(s): ${detectedLocales.join(', ')}`);

        let totalMissing = 0;

        for (const module of modules) {
            // Find the default locale ARB file
            const defaultArbFile = module.arbFiles.find(f => f.locale === config.defaultLocale);
            if (!defaultArbFile) {
                continue;
            }

            let defaultData: Record<string, unknown>;
            try {
                defaultData = JSON.parse(fs.readFileSync(defaultArbFile.path, 'utf-8'));
            } catch {
                continue;
            }

            // Get all translation keys from default locale
            const translationKeys = Object.keys(defaultData).filter(
                k => !k.startsWith('@')
            );

            // Check each non-default locale
            for (const locale of detectedLocales) {
                if (locale === config.defaultLocale) {
                    continue;
                }

                const localeArbFile = module.arbFiles.find(f => f.locale === locale);
                if (!localeArbFile) {
                    // Entire locale file missing for this module
                    const diagnostics: vscode.Diagnostic[] = [];
                    const range = new vscode.Range(0, 0, 0, 0);
                    const diag = new vscode.Diagnostic(
                        range,
                        `Missing locale file for "${locale}" in module "${module.name}"`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diag.source = 'Modular L10n';
                    diag.code = 'missing-locale-file';
                    diagnostics.push(diag);

                    const uri = vscode.Uri.file(defaultArbFile.path);
                    const existing = this.diagnosticCollection.get(uri) || [];
                    this.diagnosticCollection.set(uri, [...existing, ...diagnostics]);
                    totalMissing += translationKeys.length;
                    continue;
                }

                let localeData: Record<string, unknown>;
                try {
                    localeData = JSON.parse(fs.readFileSync(localeArbFile.path, 'utf-8'));
                } catch {
                    continue;
                }

                const diagnostics: vscode.Diagnostic[] = [];
                const fileContent = fs.readFileSync(localeArbFile.path, 'utf-8');
                const fileLines = fileContent.split('\n');

                for (const key of translationKeys) {
                    const value = localeData[key];
                    if (value === undefined || value === null) {
                        // Key is completely missing
                        const range = new vscode.Range(0, 0, 0, 1);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Missing translation key "${key}" (exists in ${config.defaultLocale})`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diag.source = 'Modular L10n';
                        diag.code = 'missing-translation';
                        diagnostics.push(diag);
                        totalMissing++;
                    } else if (typeof value === 'string' && value.trim() === '') {
                        // Key exists but is empty — find its line
                        const keyPattern = `"${key}"`;
                        let lineNum = 0;
                        for (let i = 0; i < fileLines.length; i++) {
                            if (fileLines[i].includes(keyPattern) && !fileLines[i].includes(`"@${key}"`)) {
                                lineNum = i;
                                break;
                            }
                        }
                        const range = new vscode.Range(lineNum, 0, lineNum, fileLines[lineNum]?.length || 0);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Empty translation for key "${key}" (default: "${defaultData[key]}")`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diag.source = 'Modular L10n';
                        diag.code = 'empty-translation';
                        diagnostics.push(diag);
                    }
                }

                if (diagnostics.length > 0) {
                    const uri = vscode.Uri.file(localeArbFile.path);
                    this.diagnosticCollection.set(uri, diagnostics);
                }
            }
        }

        if (totalMissing > 0) {
            logger.summary(
                `Found ${totalMissing} missing/empty translation(s). Check the Problems panel.`
            );
            if (!auto) {
                await logger.notifyWarning(
                    `Found ${totalMissing} missing/empty translation(s). Check the Problems panel.`
                );
            }
        } else {
            logger.summary('All translations are complete!');
            if (!auto) {
                await logger.notifyInfo('All translations are complete!');
            }
        }
    }
}
