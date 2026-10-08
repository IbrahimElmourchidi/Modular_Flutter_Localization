import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';
import { resolveEffectiveDefaultLocale } from './pubspec_config';
import { Logger } from './logger';
import { diagnoseIcuMessage, IcuDiagnostic, IcuSeverity } from './icu_diagnostics';
import { indexJsonEntries, offsetToPosition, rawOffsetFor } from './json_index';
import { collectArgs, parseIcu } from './icu_parser';
import { buildCanonicalArgs, CanonicalArg } from './icu_types';
import { PlaceholderInfo } from './arb_parser';

/**
 * Diagnostics for a project's ARB files.
 *
 * Two kinds, collected in one pass so a file is reported once:
 *   - missing or empty translations, against the template locale
 *   - ICU problems, which the generator would otherwise repair silently
 *
 * Both accumulate per URI and are written with a single `set` per file:
 * `DiagnosticCollection.set` replaces a file's diagnostics wholesale, so a second
 * pass calling it for the same URI would erase the first pass's findings.
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

    /** String values from a parsed ARB file, for the cross-locale check. */
    private templateValues(data: Record<string, unknown>): Record<string, string> {
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(data)) {
            if (!key.startsWith('@') && typeof value === 'string') values[key] = value;
        }
        return values;
    }

    /**
     * Per key, the template's arguments and the Dart type each is given.
     *
     * This is what a translation has to be renderable with, so it is the basis of
     * the cross-locale check. Derived here with the same helper the generator
     * uses for its signatures, rather than restated, so the diagnostic and the
     * generated code cannot disagree about what compiles.
     */
    private canonicalArgsByKey(data: Record<string, unknown>): Map<string, CanonicalArg[]> {
        const byKey = new Map<string, CanonicalArg[]>();

        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('@') || typeof value !== 'string') continue;

            const args = collectArgs(parseIcu(value).nodes);
            // `@key`, not `@key.placeholders`. The resolver reads
            // `placeholders[name].type`, so handed the metadata object itself
            // every declared type came back undefined and every placeholder
            // resolved to `Object` — which made a translation that adds a plural
            // to an `int` placeholder look incompatible with the template,
            // while the generator, reading the right object, rendered it.
            const placeholders = (
                data[`@${key}`] as { placeholders?: Record<string, PlaceholderInfo> } | undefined
            )?.placeholders;
            byKey.set(key, buildCanonicalArgs(args, placeholders));
        }
        return byKey;
    }

    /** A VS Code range for a character span in `source`. */
    private rangeFor(source: string, start: number, end: number): vscode.Range {
        const from = offsetToPosition(source, start);
        const to = offsetToPosition(source, end + 1);
        return new vscode.Range(
            new vscode.Position(from.line, from.character),
            new vscode.Position(to.line, to.character)
        );
    }

    private static readonly SEVERITY: Record<IcuSeverity, vscode.DiagnosticSeverity> = {
        error: vscode.DiagnosticSeverity.Error,
        warning: vscode.DiagnosticSeverity.Warning,
        hint: vscode.DiagnosticSeverity.Information,
    };

    /**
     * Add ICU diagnostics for one ARB file to `target`.
     *
     * @param template the template-locale value per key, for the cross-locale
     *                 shape check
     */
    private collectIcuDiagnostics(
        filePath: string,
        source: string,
        template: Record<string, string>,
        canonicalArgs: Map<string, CanonicalArg[]>,
        target: vscode.Diagnostic[]
    ): void {
        let entries;
        try {
            entries = indexJsonEntries(source);
        } catch {
            // Malformed JSON: the missing-translation pass already reports it.
            return;
        }

        for (const [key, range] of entries) {
            if (range.isMetadata) continue;

            const text = JSON.parse(
                source.slice(range.valueStart, range.valueEnd + 1)
            ) as string;
            if (typeof text !== 'string') continue;

            for (const d of diagnoseIcuMessage(
                key,
                text,
                template[key],
                canonicalArgs.get(key)
            )) {
                // Offsets are relative to the decoded value, so they are mapped
                // back onto the file before being turned into a range. Adding
                // them to a raw position directly drifts by one per JSON escape
                // earlier in the value.
                const start = offsetToPosition(source, rawOffsetFor(range, d.start));
                const end = offsetToPosition(source, rawOffsetFor(range, d.end));
                const diag = new vscode.Diagnostic(
                    new vscode.Range(
                        new vscode.Position(start.line, start.character),
                        new vscode.Position(end.line, end.character)
                    ),
                    d.message,
                    MissingTranslationDiagnostics.SEVERITY[d.severity]
                );
                diag.source = 'Modular L10n';
                diag.code = d.code;
                target.push(diag);
            }
        }
    }

    /**
     * Run diagnostics on all modules, reporting missing translations and ICU
     * problems.
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
        const { modules, detectedLocales, warnings } = await scanner.scanModules();

        // The scanner's own notes — a non-canonical `@@locale`, two ARB files
        // claiming one locale — used to be reported only by the generation
        // command. On-save diagnostics is the run a developer sees most, so they
        // are surfaced here too rather than needing a manual generate to find
        // out that a locale name was rewritten.
        const scannerWarnings = warnings ?? [];
        for (const warning of scannerWarnings) {
            logger.warn(warning);
        }

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

        const effectiveDefault =
            resolveEffectiveDefaultLocale(config.defaultLocale, detectedLocales) ??
            config.defaultLocale;
        if (effectiveDefault !== config.defaultLocale) {
            logger.warn(
                `Configured default locale "${config.defaultLocale}" is not in the ARB files; ` +
                `checking against "${effectiveDefault}", which is what generation uses.`
            );
        }

        let totalMissing = 0;

        for (const module of modules) {
            // The *effective* default, not the configured one. The generator falls
            // back to the first detected locale when the configured default is
            // absent from the ARB files; skipping the module here meant a project
            // in that state got no ICU diagnostics at all, while its output was
            // generated from a different locale than these checks assume.
            const defaultArbFile = module.arbFiles.find(f => f.locale === effectiveDefault);
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
                // `effectiveDefault`, matching the file read above: comparing
                // against the configured one would check the template against
                // itself and report every one of its keys as missing.
                if (locale === effectiveDefault) {
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
                const entries = indexJsonEntries(fileContent);

                for (const key of translationKeys) {
                    const value = localeData[key];
                    if (value === undefined || value === null) {
                        // Key is completely missing
                        const range = new vscode.Range(0, 0, 0, 1);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Missing translation key "${key}" (exists in ${effectiveDefault})`,
                            vscode.DiagnosticSeverity.Error
                        );
                        diag.source = 'Modular L10n';
                        diag.code = 'missing-translation';
                        diagnostics.push(diag);
                        totalMissing++;
                    } else if (typeof value === 'string' && value.trim() === '') {
                        // Key exists but is empty. Anchored on the value's own
                        // offset: a substring search for `"key"` also matches the
                        // metadata entry `"@key"` and picks the wrong line.
                        const entry = entries.get(key);
                        const range = entry
                            ? this.rangeFor(
                                  fileContent,
                                  entry.valueStart,
                                  entry.valueEnd
                              )
                            : new vscode.Range(0, 0, 0, 1);
                        const diag = new vscode.Diagnostic(
                            range,
                            `Empty translation for key "${key}" (${effectiveDefault}: "${defaultData[key]}")`,
                            vscode.DiagnosticSeverity.Warning
                        );
                        diag.source = 'Modular L10n';
                        diag.code = 'empty-translation';
                        diagnostics.push(diag);
                    }
                }

                // The same file's ICU findings join the translation findings:
                // `set` replaces per URI, so they must be written together.
                const template = this.templateValues(defaultData);
                this.collectIcuDiagnostics(
                    localeArbFile.path,
                    fileContent,
                    template,
                    this.canonicalArgsByKey(defaultData),
                    diagnostics
                );

                if (diagnostics.length > 0) {
                    const uri = vscode.Uri.file(localeArbFile.path);
                    this.diagnosticCollection.set(uri, diagnostics);
                }
            }

            // The template locale is checked too. A structural problem there is
            // the one every locale inherits, so reporting it only against the
            // translations would point at the wrong file.
            const templateDiagnostics: vscode.Diagnostic[] = [];
            const templateContent = fs.readFileSync(defaultArbFile.path, 'utf-8');
            this.collectIcuDiagnostics(
                defaultArbFile.path,
                templateContent,
                this.templateValues(defaultData),
                this.canonicalArgsByKey(defaultData),
                templateDiagnostics
            );
            if (templateDiagnostics.length > 0) {
                const uri = vscode.Uri.file(defaultArbFile.path);
                const existing = this.diagnosticCollection.get(uri) ?? [];
                this.diagnosticCollection.set(uri, [
                    ...existing,
                    ...templateDiagnostics,
                ]);
            }
        }

        const suffix =
            scannerWarnings.length > 0
                ? ` ${scannerWarnings.length} scanner note(s) — see the output.`
                : '';

        if (totalMissing > 0) {
            logger.summary(
                `Found ${totalMissing} missing/empty translation(s). Check the Problems panel.${suffix}`
            );
            if (!auto) {
                await logger.notifyWarning(
                    `Found ${totalMissing} missing/empty translation(s). Check the Problems panel.${suffix}`
                );
            }
        } else {
            logger.summary('All translations are complete!' + suffix);
            if (!auto) {
                await logger.notifyInfo('All translations are complete!' + suffix);
            }
        }
    }
}
