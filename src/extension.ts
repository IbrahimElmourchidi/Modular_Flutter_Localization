import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArbParser } from './arb_parser';
import { DartGenerator } from './dart_generator';
import { FileWatcher } from './file_watcher';
import { ModuleScanner, ScanResult } from './module_scanner';
import { PubspecConfigReader, mergeConfigs, EffectiveConfig } from './pubspec_config';
import { Logger, DEFAULT_LOG_LEVEL, normalizeLogLevel } from './logger';
import { ExtractToArbProvider, executeExtractToArb } from './extract_action_provider';
import { MissingTranslationDiagnostics } from './diagnostics_provider';
import { scanHardcodedStrings, disposeHardcodedDiagnostics } from './hardcoded_string_scanner';
import { TranslationHoverProvider } from './hover_provider';
import { TranslationDefinitionProvider } from './definition_provider';
import { sortArbKeys } from './arb_sort';
import { findUnusedKeys } from './unused_key_scanner';
import { renameKey } from './key_rename';
import { exportTranslations, importTranslations } from './export_import';
import { generatePseudoLocale } from './pseudo_locale';

let fileWatcher: FileWatcher | undefined;
let diagnosticsProvider: MissingTranslationDiagnostics | undefined;

/**
 * Get effective configuration by merging VS Code settings with pubspec.yaml.
 * Exported so other modules (e.g., extract_action_provider) can use it.
 */
export function getEffectiveConfig(rootPath: string): EffectiveConfig {
    const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');

    const vscodeValues: EffectiveConfig = {
        // VS Code has no "off" setting; only pubspec.yaml can disable the extension.
        enabled: true,
        className: vscodeConfig.get<string>('className', 'ML'),
        outputPath: vscodeConfig.get<string>('outputPath', 'lib/generated/modular_l10n'),
        defaultLocale: vscodeConfig.get<string>('defaultLocale', 'en'),
        arbFilePattern: vscodeConfig.get<string>('arbFilePattern', '**/l10n/*.arb'),
        generateCombinedArb: vscodeConfig.get<boolean>('generateCombinedArb', true),
        useDeferredLoading: vscodeConfig.get<boolean>('useDeferredLoading', false),
        watchMode: vscodeConfig.get<boolean>('watchMode', true),
        logLevel: normalizeLogLevel(
            vscodeConfig.get<string>('logLevel', DEFAULT_LOG_LEVEL),
            DEFAULT_LOG_LEVEL
        ),
    };

    // Try reading from pubspec.yaml (takes precedence)
    const pubspecReader = new PubspecConfigReader(rootPath);
    const pubspecConfig = pubspecReader.readConfig();

    return mergeConfigs(vscodeValues, pubspecConfig);
}

/**
 * True when `modular_l10n.enabled: false` is set in pubspec.yaml.
 *
 * When disabled, generation, watching, and diagnostics all stay out of the way;
 * only the explicit Initialize command still runs, so the project can be turned
 * back on without hand-editing YAML.
 */
export function isDisabled(rootPath: string): boolean {
    return getEffectiveConfig(rootPath).enabled === false;
}

/** {@link isDisabled} for the first workspace folder; false when none is open. */
export function workspaceRootIsDisabled(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    return folders ? isDisabled(folders[0].uri.fsPath) : false;
}

/**
 * Guard for commands that must not run while the extension is switched off.
 * Returns true (and explains why) when the command should abort.
 */
async function abortIfDisabled(logger: Logger): Promise<boolean> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return false;
    if (!isDisabled(folders[0].uri.fsPath)) return false;

    logger.warn('Modular L10n is disabled (modular_l10n.enabled: false in pubspec.yaml).');
    await logger.notifyWarning(
        'Modular L10n is disabled in pubspec.yaml. Set `modular_l10n.enabled: true` to re-enable it.'
    );
    return true;
}

/**
 * Re-read the configured log level and apply it to the shared logger.
 * Called on activation, on settings change, and before every command so a
 * pubspec.yaml edit takes effect without reloading the window.
 */
function syncLogLevel(logger: Logger): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
        logger.setLevel(
            normalizeLogLevel(
                vscode.workspace.getConfiguration('modularL10n').get<string>('logLevel'),
                DEFAULT_LOG_LEVEL
            )
        );
        return;
    }
    logger.setLevel(getEffectiveConfig(folders[0].uri.fsPath).logLevel);
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Modular L10n');
    const logger = new Logger(outputChannel);
    syncLogLevel(logger);

    logger.debug('Modular Flutter L10n extension is now active!');

    /**
     * Wrap a command handler so the log level is re-read right before it runs.
     * pubspec.yaml edits don't fire onDidChangeConfiguration, so this is what
     * makes `modular_l10n.log_level` apply without a window reload.
     *
     * `alwaysAvailable` opts a command out of the `enabled: false` guard —
     * used for Initialize and Check Compatibility, which must work on a project
     * that is currently switched off.
     */
    const command = (
        id: string,
        handler: (...args: any[]) => Promise<void>,
        alwaysAvailable = false
    ) =>
        vscode.commands.registerCommand(id, async (...args: any[]) => {
            syncLogLevel(logger);
            if (!alwaysAvailable && (await abortIfDisabled(logger))) return;
            await handler(...args);
        });

    // Check for conflicting extensions on activation (skipped when switched off)
    if (!workspaceRootIsDisabled()) {
        checkForConflictingExtensions(logger);
    }

    // ─── Register commands ────────────────────────────────────────────

    const generateCommand = command('modularL10n.generate', async () => {
        await generateTranslations(logger);
    });

    const addKeyCommand = command('modularL10n.addKey', async () => {
        await addTranslationKey(logger);
    });

    const createModuleCommand = command('modularL10n.createModule', async () => {
        await createNewModule(logger);
    });

    const addL10nFolderCommand = command(
        'modularL10n.addL10nFolder',
        async (uri: vscode.Uri) => {
            await addL10nFolderToDirectory(uri, logger);
        }
    );

    const migrateFromFlutterIntlCommand = command(
        'modularL10n.migrateFromFlutterIntl',
        async () => {
            await migrateFromFlutterIntl(logger);
        }
    );

    // NEW: Initialize command (like Flutter Intl's "Initialize")
    // Always available: this is how a disabled project gets re-enabled.
    const initializeCommand = command('modularL10n.initialize', async () => {
        await initializeProject(logger);
    }, true);

    // NEW: Add locale command
    const addLocaleCommand = command('modularL10n.addLocale', async () => {
        await addLocale(logger);
    });

    // NEW: Remove locale command
    const removeLocaleCommand = command('modularL10n.removeLocale', async () => {
        await removeLocale(logger);
    });

    // NEW: Extract to ARB command (called by code action)
    const extractToArbCommand = command(
        'modularL10n.extractToArb',
        async (document: vscode.TextDocument, range: vscode.Range) => {
            await executeExtractToArb(document, range, logger);
        }
    );

    // NEW: Check compatibility command
    // Always available: a diagnostic command should still answer when off.
    const checkCompatibilityCommand = command('modularL10n.checkCompatibility', async () => {
        await checkForConflictingExtensions(logger, true);
    }, true);

    // ─── New feature commands ─────────────────────────────────────────

    const checkMissingTranslationsCommand = command(
        'modularL10n.checkMissingTranslations',
        async () => {
            if (!diagnosticsProvider) {
                diagnosticsProvider = new MissingTranslationDiagnostics();
            }
            await diagnosticsProvider.runDiagnostics(logger);
        }
    );

    const scanHardcodedStringsCommand = command(
        'modularL10n.scanHardcodedStrings',
        async () => {
            await scanHardcodedStrings(logger);
        }
    );

    const sortArbKeysCommand = command('modularL10n.sortArbKeys', async () => {
        await sortArbKeys(logger);
    });

    const findUnusedKeysCommand = command('modularL10n.findUnusedKeys', async () => {
        await findUnusedKeys(logger);
    });

    const renameKeyCommand = command('modularL10n.renameKey', async () => {
        await renameKey(logger);
    });

    const exportTranslationsCommand = command('modularL10n.exportTranslations', async () => {
        await exportTranslations(logger);
    });

    const importTranslationsCommand = command('modularL10n.importTranslations', async () => {
        await importTranslations(logger);
    });

    const generatePseudoLocaleCommand = command(
        'modularL10n.generatePseudoLocale',
        async () => {
            await generatePseudoLocale(logger);
        }
    );

    // ─── Register providers ───────────────────────────────────────────

    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        { language: 'dart', scheme: 'file' },
        new ExtractToArbProvider(),
        { providedCodeActionKinds: ExtractToArbProvider.providedCodeActionKinds }
    );

    const hoverProvider = vscode.languages.registerHoverProvider(
        { language: 'dart', scheme: 'file' },
        new TranslationHoverProvider()
    );

    const definitionProvider = vscode.languages.registerDefinitionProvider(
        { language: 'dart', scheme: 'file' },
        new TranslationDefinitionProvider()
    );

    // ─── Initialize diagnostics provider ──────────────────────────────
    diagnosticsProvider = new MissingTranslationDiagnostics();

    // Run diagnostics on ARB file save
    const arbSaveWatcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.fileName.endsWith('.arb') && diagnosticsProvider) {
            syncLogLevel(logger);
            const folders = vscode.workspace.workspaceFolders;
            if (folders && isDisabled(folders[0].uri.fsPath)) return;
            await diagnosticsProvider.runDiagnostics(logger, { auto: true });
        }
    });

    context.subscriptions.push(
        outputChannel,
        generateCommand,
        addKeyCommand,
        createModuleCommand,
        addL10nFolderCommand,
        migrateFromFlutterIntlCommand,
        initializeCommand,
        addLocaleCommand,
        removeLocaleCommand,
        extractToArbCommand,
        checkCompatibilityCommand,
        checkMissingTranslationsCommand,
        scanHardcodedStringsCommand,
        sortArbKeysCommand,
        findUnusedKeysCommand,
        renameKeyCommand,
        exportTranslationsCommand,
        importTranslationsCommand,
        generatePseudoLocaleCommand,
        codeActionProvider,
        hoverProvider,
        definitionProvider,
        diagnosticsProvider.getDiagnosticCollection(),
        arbSaveWatcher
    );

    // Start file watcher if enabled
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const config = getEffectiveConfig(workspaceFolders[0].uri.fsPath);
        if (config.enabled && config.watchMode) {
            startFileWatcher(logger);
        }
    }

    // FIXED: Push config change listener disposable into subscriptions
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('modularL10n')) {
            syncLogLevel(logger);
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
                const newConfig = getEffectiveConfig(folders[0].uri.fsPath);
                if (newConfig.enabled && newConfig.watchMode) {
                    startFileWatcher(logger);
                } else {
                    stopFileWatcher();
                }
            }
        }
    });
    context.subscriptions.push(configChangeDisposable);

    // EXT-13: onDidChangeConfiguration only fires for VS Code settings, so a
    // pubspec.yaml edit would otherwise need a window reload to take effect.
    const pubspecWatcher = vscode.workspace.createFileSystemWatcher('**/pubspec.yaml');
    const reconfigure = () => {
        syncLogLevel(logger);
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;
        const cfg = getEffectiveConfig(folders[0].uri.fsPath);
        if (cfg.enabled && cfg.watchMode) {
            startFileWatcher(logger);
        } else {
            stopFileWatcher();
        }
    };
    pubspecWatcher.onDidChange(reconfigure);
    pubspecWatcher.onDidCreate(reconfigure);
    pubspecWatcher.onDidDelete(reconfigure);
    context.subscriptions.push(pubspecWatcher);
}

// ─── NEW: Initialize Project ─────────────────────────────────────────────────

/**
 * One-click project initialization.
 * Creates initial ARB files, writes config to pubspec.yaml, and generates code.
 */
async function initializeProject(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Check if pubspec.yaml exists
    const pubspecPath = path.join(rootPath, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        await logger.notifyError('No pubspec.yaml found. Is this a Flutter project?');
        return;
    }

    // Check if already initialized
    const pubspecReader = new PubspecConfigReader(rootPath);
    if (pubspecReader.readConfig()) {
        const proceed = await logger.ask(
            'Modular L10n is already configured in pubspec.yaml. Re-initialize?',
            'Yes',
            'No'
        );
        if (proceed !== 'Yes') return;
    }

    // Ask for default locale
    const defaultLocale = await vscode.window.showInputBox({
        prompt: 'Default locale',
        placeHolder: 'en',
        value: 'en',
        validateInput: (v) => (!v ? 'Locale is required' : null),
    });
    if (!defaultLocale) return;

    // Ask for first module name
    const moduleName = await vscode.window.showInputBox({
        prompt: 'Name of your first module (snake_case)',
        placeHolder: 'e.g., app, common, home',
        value: 'app',
        validateInput: (v) => {
            if (!v || !/^[a-z][a-z0-9_]*$/.test(v)) return 'Must be snake_case';
            return null;
        },
    });
    if (!moduleName) return;

    // Ask for module path
    const modulePath = await vscode.window.showInputBox({
        prompt: 'Module path relative to lib/',
        placeHolder: `e.g., features/${moduleName}`,
        value: `features/${moduleName}`,
    });
    if (!modulePath) return;

    // Ask for class name
    const className = await vscode.window.showInputBox({
        prompt: 'Generated class name (use ML to avoid Flutter Intl conflict)',
        placeHolder: 'ML',
        value: 'ML',
        validateInput: (v) => {
            if (!v || !/^[A-Z][a-zA-Z0-9]*$/.test(v)) return 'Must be PascalCase';
            return null;
        },
    });
    if (!className) return;

    // Warn if className is 'S' and Flutter Intl is detected
    let finalClassName = className;
    if (className === 'S' && pubspecReader.readFlutterIntlConfig()) {
        const proceed = await logger.ask(
            'Flutter Intl is detected and also uses class name "S". This will cause compilation errors. Use a different name?',
            'Change to ML',
            'Keep S'
        );
        if (proceed === undefined) {
            return; // dismissed — don't guess
        }
        if (proceed === 'Change to ML') {
            finalClassName = 'ML';
        }
        // "Keep S" is their call; generation will warn again.
    }

    logger.banner('🚀 Initializing Modular L10n...');
    logger.reveal();

    try {
        // 1. Write config to pubspec.yaml
        pubspecReader.writeConfig({
            enabled: true,
            className: finalClassName,
            defaultLocale,
            outputDir: `lib/generated/modular_l10n`,
            logLevel: logger.getLevel(),
        });
        logger.info('✅ Added modular_l10n config to pubspec.yaml');

        // 2. Create the module's l10n directory and ARB file
        const fullModulePath = path.join(rootPath, 'lib', modulePath);
        const l10nPath = path.join(fullModulePath, 'l10n');
        fs.mkdirSync(l10nPath, { recursive: true });

        const arbContent = {
            '@@locale': defaultLocale,
            '@@context': moduleName,
            [`${moduleName}Title`]: `${toPascalCase(moduleName)} Title`,
        };

        const arbPath = path.join(l10nPath, `${moduleName}_${defaultLocale}.arb`);
        fs.writeFileSync(arbPath, JSON.stringify(arbContent, null, 2), 'utf-8');
        logger.info(`✅ Created ${path.relative(rootPath, arbPath)}`);

        // 3. Generate translations
        await generateTranslations(logger);

        logger.banner('✅ Initialization complete!');
        logger.info('');
        logger.info('Next steps:');
        logger.info(`  1. Add flutter_localizations to pubspec.yaml dependencies`);
        logger.info(`  2. Add ${finalClassName}.delegate to your MaterialApp's localizationsDelegates`);
        logger.info(`  3. Add ${finalClassName}.supportedLocales to supportedLocales`);
        logger.info(`  4. Use ${finalClassName}.of(context).${moduleName}.yourKey in your widgets`);

        const action = await logger.notifyInfo(
            `Modular L10n initialized! Module "${moduleName}" created with locale "${defaultLocale}".`,
            'Open ARB File'
        );
        if (action === 'Open ARB File') {
            const doc = await vscode.workspace.openTextDocument(arbPath);
            await vscode.window.showTextDocument(doc);
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`❌ Error: ${msg}`);
        await logger.notifyError(`Initialization failed: ${msg}`);
    }
}

// ─── NEW: Add Locale ─────────────────────────────────────────────────────────

/**
 * Add a new locale to all existing modules.
 * Creates new ARB files for the locale in every module that doesn't have it.
 */
async function addLocale(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        await logger.notifyError(
            'No modules found. Run "Modular L10n: Initialize" first.'
        );
        return;
    }

    // Ask for new locale
    const newLocale = await vscode.window.showInputBox({
        prompt: 'Enter locale to add (e.g., ar, de, zh_Hans)',
        placeHolder: 'e.g., ar',
        validateInput: (v) => {
            if (!v || v.trim().length === 0) return 'Locale is required';
            if (detectedLocales.includes(v.trim())) return `Locale "${v}" already exists`;
            return null;
        },
    });

    if (!newLocale) return;

    const locale = newLocale.trim();

    logger.blank();
    logger.info(`🌍 Adding locale "${locale}" to all modules...`);
    logger.reveal();

    let filesCreated = 0;

    for (const module of modules) {
        // Check if this module already has this locale
        if (module.arbFiles.some((f) => f.locale === locale)) {
            logger.info(`⏭️  ${module.name}: already has locale "${locale}"`);
            continue;
        }

        // Find the module's l10n directory
        const existingFile = module.arbFiles[0];
        if (!existingFile) continue;

        const l10nDir = path.dirname(existingFile.path);

        // Read the default locale file as a template
        const defaultFile = module.arbFiles.find((f) => f.locale === config.defaultLocale);
        let template: Record<string, unknown> = {
            '@@locale': locale,
            '@@context': module.name,
        };

        if (defaultFile) {
            try {
                const content = JSON.parse(fs.readFileSync(defaultFile.path, 'utf-8'));
                // Copy keys with empty values
                for (const [key, value] of Object.entries(content)) {
                    if (key.startsWith('@')) {
                        if (key === '@@locale') {
                            template[key] = locale;
                        } else {
                            template[key] = value;
                        }
                    } else {
                        template[key] = ''; // Empty translation for new locale
                    }
                }
            } catch {
                // Use simple template
            }
        }

        const newFilePath = path.join(l10nDir, `${module.name}_${locale}.arb`);
        fs.writeFileSync(newFilePath, JSON.stringify(template, null, 2), 'utf-8');
        logger.info(`✅ Created ${path.relative(rootPath, newFilePath)}`);
        filesCreated++;
    }

    if (filesCreated > 0) {
        logger.summary(`Added locale "${locale}" to ${filesCreated} module(s).`);
        const action = await logger.notifyInfo(
            `Added locale "${locale}" to ${filesCreated} module(s).`,
            'Generate Translations'
        );
        if (action === 'Generate Translations') {
            await generateTranslations(logger);
        }
    } else {
        await logger.notifyInfo(`Locale "${locale}" already exists in all modules.`);
    }
}

// ─── NEW: Remove Locale ──────────────────────────────────────────────────────

/**
 * Remove a locale from all modules.
 * Deletes the corresponding ARB files.
 */
async function removeLocale(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (detectedLocales.length === 0) {
        await logger.notifyError('No locales found.');
        return;
    }

    // Filter out the default locale (can't remove it)
    const removableLocales = detectedLocales.filter((l) => l !== config.defaultLocale);

    if (removableLocales.length === 0) {
        await logger.notifyError(
            `Only the default locale "${config.defaultLocale}" exists. Cannot remove it.`
        );
        return;
    }

    const localeToRemove = await vscode.window.showQuickPick(removableLocales, {
        placeHolder: 'Select locale to remove',
    });

    if (!localeToRemove) return;

    // Confirm
    const confirm = await logger.askModal(
        `This will DELETE all ARB files for locale "${localeToRemove}" across all modules. Continue?`,
        'Delete'
    );

    if (confirm !== 'Delete') return;

    logger.blank();
    logger.info(`🗑️  Removing locale "${localeToRemove}"...`);
    logger.reveal();

    let filesDeleted = 0;

    for (const module of modules) {
        const arbFile = module.arbFiles.find((f) => f.locale === localeToRemove);
        if (arbFile) {
            try {
                fs.unlinkSync(arbFile.path);
                logger.info(`✅ Deleted ${path.relative(rootPath, arbFile.path)}`);
                filesDeleted++;
            } catch (error) {
                logger.error(`❌ Failed to delete ${arbFile.path}: ${error}`);
                logger.reveal('error');
            }
        }
    }

    if (filesDeleted > 0) {
        logger.summary(`Removed locale "${localeToRemove}" (${filesDeleted} file(s) deleted).`);
        const action = await logger.notifyInfo(
            `Removed locale "${localeToRemove}" (${filesDeleted} file(s) deleted).`,
            'Generate Translations'
        );
        if (action === 'Generate Translations') {
            await generateTranslations(logger);
        }
    }
}

// ─── Conflict Detection ──────────────────────────────────────────────────────

/**
 * Check for conflicting extensions and configuration.
 * ENHANCED: Checks className and outputPath collisions.
 */
async function checkForConflictingExtensions(
    logger: Logger,
    forceShow: boolean = false
): Promise<void> {
    const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');

    if (!forceShow && !vscodeConfig.get<boolean>('compatibility.warnOnConflict', true)) {
        return;
    }

    // Passive startup check: stay quiet unless warnings are enabled.
    if (!forceShow && logger.getLevel() !== 'warning' && logger.getLevel() !== 'verbose') {
        return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Check if flutter-intl extension is installed
    const flutterIntl = vscode.extensions.getExtension('localizely.flutter-intl');

    // Check for Flutter Intl config in pubspec.yaml
    const pubspecReader = new PubspecConfigReader(rootPath);
    const hasFlutterIntlConfig = pubspecReader.hasFlutterIntlConfig();
    const flutterIntlConfig = pubspecReader.readFlutterIntlConfig();

    // FIXED: Wrap in try-catch for permission/read errors
    let hasIntlArbFiles = false;
    try {
        const l10nDir = path.join(rootPath, 'lib/l10n');
        if (fs.existsSync(l10nDir)) {
            const files = fs.readdirSync(l10nDir);
            hasIntlArbFiles = files.some(
                (file) => file.startsWith('intl_') && file.endsWith('.arb')
            );
        }
    } catch {
        // Ignore read errors
    }

    if (!flutterIntl && !hasFlutterIntlConfig && !hasIntlArbFiles) {
        if (forceShow) {
            await logger.notifyInfo('No Flutter Intl detected. No conflicts.');
        }
        return;
    }

    const config = getEffectiveConfig(rootPath);
    const issues: string[] = [];

    logger.blank('warning');
    logger.warn('⚠️  Flutter Intl detected in this project');
    logger.info('   Both extensions can coexist — they use different file patterns.');
    logger.info('   • Flutter Intl: lib/l10n/intl_*.arb');
    logger.info('   • Modular L10n: lib/**/l10n/*_*.arb (excluding intl_*.arb)');

    // Check className collision
    if (flutterIntlConfig) {
        if (config.className === (flutterIntlConfig.className || 'S')) {
            issues.push(
                `⚠️  Class name "${config.className}" conflicts with Flutter Intl. Consider changing to "ML".`
            );
        }

        // Check output path overlap
        const flutterIntlOutput = flutterIntlConfig.outputDir || 'lib/generated';
        if (config.outputPath.startsWith(flutterIntlOutput) || flutterIntlOutput.startsWith(config.outputPath)) {
            issues.push(
                `⚠️  Output path "${config.outputPath}" may overlap with Flutter Intl's "${flutterIntlOutput}".`
            );
        }
    }

    if (issues.length > 0) {
        logger.blank('warning');
        for (const issue of issues) {
            logger.warn(`   ${issue}`);
        }
        logger.blank('warning');
    }

    if (!forceShow) {
        const choice = await logger.notifyInfo(
            `Flutter Intl detected.${issues.length > 0 ? ` ${issues.length} potential conflict(s) found.` : ' Both extensions can work together.'}`,
            'Continue',
            'View Details',
            "Don't Show Again"
        );

        if (choice === 'View Details') {
            logger.reveal('error');
        } else if (choice === "Don't Show Again") {
            await vscodeConfig.update('compatibility.warnOnConflict', false, true);
        }
    } else {
        // Explicit "Check Compatibility" command — always report back.
        logger.reveal('error');
        if (issues.length > 0) {
            await logger.notifyWarning(
                `Found ${issues.length} potential conflict(s) with Flutter Intl. See output for details.`
            );
        } else {
            await logger.notifyInfo(
                'Flutter Intl detected but no conflicts found. Both extensions can coexist.'
            );
        }
    }
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrateFromFlutterIntl(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const intlDir = path.join(rootPath, 'lib/l10n');

    if (!fs.existsSync(intlDir)) {
        await logger.notifyWarning('No lib/l10n directory found. Nothing to migrate.');
        return;
    }

    // FIXED: Wrap in try-catch
    let arbFiles: string[] = [];
    try {
        arbFiles = fs.readdirSync(intlDir)
            .filter((f) => f.startsWith('intl_') && f.endsWith('.arb'))
            .map((f) => path.join(intlDir, f));
    } catch {
        await logger.notifyError('Cannot read lib/l10n directory.');
        return;
    }

    if (arbFiles.length === 0) {
        await logger.notifyWarning('No intl_*.arb files found in lib/l10n/');
        return;
    }

    // A migration prompt drives behaviour, so it bypasses the log level.
    const choice = await vscode.window.showInformationMessage(
        `Found ${arbFiles.length} Flutter Intl ARB file(s). How would you like to migrate?`,
        'Create Single Module',
        'Split by Key Prefix',
        'Cancel'
    );

    if (choice === 'Cancel' || !choice) return;

    if (choice === 'Create Single Module') {
        const moduleName = await vscode.window.showInputBox({
            prompt: 'Enter the module name for migrated translations',
            placeHolder: 'e.g., app, common, main',
            value: 'app',
            validateInput: (value) => {
                if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) return 'Module name must be snake_case';
                return null;
            },
        });
        if (!moduleName) return;

        const destPath = await vscode.window.showInputBox({
            prompt: 'Enter destination path (relative to lib/)',
            placeHolder: `e.g., features/${moduleName}`,
            value: `features/${moduleName}`,
        });
        if (!destPath) return;

        const fullDestPath = path.join(rootPath, 'lib', destPath, 'l10n');
        fs.mkdirSync(fullDestPath, { recursive: true });

        let filesCreated = 0;
        for (const arbFile of arbFiles) {
            const locale = path.basename(arbFile).replace('intl_', '').replace('.arb', '');
            try {
                const content = JSON.parse(fs.readFileSync(arbFile, 'utf-8'));
                content['@@context'] = moduleName;
                if (!content['@@locale']) {
                    content['@@locale'] = locale;
                }

                const newFileName = `${moduleName}_${locale}.arb`;
                const newFilePath = path.join(fullDestPath, newFileName);
                fs.writeFileSync(newFilePath, JSON.stringify(content, null, 2), 'utf-8');
                logger.info(`✅ Created ${newFileName}`);
                filesCreated++;
            } catch (error) {
                logger.error(`❌ Error migrating ${path.basename(arbFile)}: ${error}`);
                logger.reveal('error');
            }
        }

        logger.summary(`Migrated ${filesCreated} file(s) to ${destPath}/l10n/`);
        const action = await logger.notifyInfo(
            `Successfully migrated ${filesCreated} file(s) to ${destPath}/l10n/`,
            'Generate Translations'
        );
        if (action === 'Generate Translations') {
            await generateTranslations(logger);
        }
    } else if (choice === 'Split by Key Prefix') {
        await migrateSplitByPrefix(rootPath, arbFiles, logger);
    }
}

/**
 * NEW: Split Flutter Intl keys by prefix into separate modules.
 * e.g., keys like "authLogin", "authRegister" → auth module
 *       keys like "homeWelcome", "homeTitle" → home module
 */
async function migrateSplitByPrefix(
    rootPath: string,
    arbFiles: string[],
    logger: Logger
): Promise<void> {
    // Read the first ARB file to analyze key prefixes
    const firstFile = arbFiles[0];
    let content: Record<string, unknown>;
    try {
        content = JSON.parse(fs.readFileSync(firstFile, 'utf-8'));
    } catch {
        await logger.notifyError('Cannot parse ARB file.');
        return;
    }

    // Extract prefixes
    const keys = Object.keys(content).filter((k) => !k.startsWith('@'));
    const prefixCounts = new Map<string, number>();

    for (const key of keys) {
        // Try to detect camelCase prefix (e.g., "authLogin" → "auth")
        const match = key.match(/^([a-z]+)[A-Z]/);
        if (match) {
            const prefix = match[1];
            prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        }
    }

    if (prefixCounts.size === 0) {
        await logger.notifyWarning('Could not detect key prefixes. Use "Create Single Module" instead.');
        return;
    }

    // Show detected prefixes
    const prefixList = Array.from(prefixCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([prefix, count]) => `${prefix} (${count} keys)`)
        .join(', ');

    const proceed = await vscode.window.showInformationMessage(
        `Detected prefixes: ${prefixList}. Continue?`,
        'Yes',
        'No'
    );

    if (proceed !== 'Yes') return;

    logger.blank();
    logger.info('📦 Splitting by prefix...');
    logger.reveal();

    for (const arbFile of arbFiles) {
        const locale = path.basename(arbFile).replace('intl_', '').replace('.arb', '');
        let fileContent: Record<string, unknown>;
        try {
            fileContent = JSON.parse(fs.readFileSync(arbFile, 'utf-8'));
        } catch {
            continue;
        }

        // Group keys by prefix
        const groups = new Map<string, Record<string, unknown>>();

        for (const [key, value] of Object.entries(fileContent)) {
            if (key.startsWith('@')) continue;

            const match = key.match(/^([a-z]+)[A-Z]/);
            const prefix = match ? match[1] : 'common';

            if (!groups.has(prefix)) {
                groups.set(prefix, {
                    '@@locale': locale,
                    '@@context': prefix,
                });
            }

            groups.get(prefix)![key] = value;

            // Copy metadata if exists
            const metaKey = `@${key}`;
            if (fileContent[metaKey]) {
                groups.get(prefix)![metaKey] = fileContent[metaKey];
            }
        }

        // Write each group to a separate module
        for (const [prefix, groupContent] of groups.entries()) {
            const modulePath = path.join(rootPath, 'lib', 'features', prefix, 'l10n');
            fs.mkdirSync(modulePath, { recursive: true });

            const newFilePath = path.join(modulePath, `${prefix}_${locale}.arb`);
            fs.writeFileSync(newFilePath, JSON.stringify(groupContent, null, 2), 'utf-8');
            logger.info(`✅ Created ${path.relative(rootPath, newFilePath)}`);
        }
    }

    logger.summary('Migration complete.');
    const action = await logger.notifyInfo(
        'Migration complete! Review the created modules.',
        'Generate Translations'
    );
    if (action === 'Generate Translations') {
        await generateTranslations(logger);
    }
}

// ─── Add l10n folder to directory ────────────────────────────────────────────

async function addL10nFolderToDirectory(
    uri: vscode.Uri,
    logger: Logger
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const targetPath = uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const l10nPath = path.join(targetPath, 'l10n');
    if (fs.existsSync(l10nPath)) {
        const overwrite = await logger.ask(
            'An l10n folder already exists. Add missing locale files?',
            'Yes',
            'No'
        );
        if (overwrite !== 'Yes') return;
    }

    const folderName = path.basename(targetPath);
    const moduleName = await vscode.window.showInputBox({
        prompt: 'Enter the module name (snake_case)',
        placeHolder: 'e.g., auth, home, settings',
        value: toSnakeCase(folderName),
        validateInput: (value) => {
            if (!value || !/^[a-z][a-z0-9_]*$/.test(value))
                return 'Module name must be snake_case starting with lowercase letter';
            return null;
        },
    });
    if (!moduleName) return;

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { detectedLocales } = await scanner.scanModules();

    let localesToCreate = detectedLocales;

    if (localesToCreate.length === 0) {
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Enter locales to create (comma-separated)',
            placeHolder: 'e.g., en, ar, de',
            value: 'en, ar',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) return 'Please enter at least one locale';
                return null;
            },
        });
        if (!localesInput) return;
        localesToCreate = localesInput.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
    } else {
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Detected locales from existing modules. Modify if needed:',
            value: localesToCreate.join(', '),
            validateInput: (value) => {
                if (!value || value.trim().length === 0) return 'Please enter at least one locale';
                return null;
            },
        });
        if (!localesInput) return;
        localesToCreate = localesInput.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
    }

    fs.mkdirSync(l10nPath, { recursive: true });

    const createdFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const locale of localesToCreate) {
        const arbFileName = `${moduleName}_${locale}.arb`;
        const arbPath = path.join(l10nPath, arbFileName);

        if (fs.existsSync(arbPath)) {
            skippedFiles.push(arbFileName);
            continue;
        }

        const arbContent = {
            '@@locale': locale,
            '@@context': moduleName,
            [`${moduleName}Title`]: locale === config.defaultLocale ? `${toPascalCase(moduleName)} Title` : '',
        };

        fs.writeFileSync(arbPath, JSON.stringify(arbContent, null, 2), 'utf-8');
        createdFiles.push(arbFileName);
    }

    logger.banner(`📁 Created l10n folder in: ${path.relative(rootPath, targetPath)}`);

    if (createdFiles.length > 0) {
        logger.info('');
        logger.info('✅ Created files:');
        for (const file of createdFiles) {
            logger.info(`   • ${file}`);
        }
    }

    if (skippedFiles.length > 0) {
        logger.info('');
        logger.info('⏭️  Skipped (already exist):');
        for (const file of skippedFiles) {
            logger.info(`   • ${file}`);
        }
    }

    logger.reveal();

    if (createdFiles.length > 0) {
        logger.summary(
            `Created l10n module "${moduleName}" with ${createdFiles.length} locale(s)`
        );
        const action = await logger.notifyInfo(
            `Created l10n module "${moduleName}" with ${createdFiles.length} locale(s)`,
            'Generate Translations',
            'Open Files'
        );
        if (action === 'Generate Translations') {
            await generateTranslations(logger);
        } else if (action === 'Open Files') {
            const firstFile = path.join(l10nPath, createdFiles[0]);
            const document = await vscode.workspace.openTextDocument(firstFile);
            await vscode.window.showTextDocument(document);
        }
    } else {
        await logger.notifyInfo('All locale files already exist.');
    }
}

// ─── Generate Translations ───────────────────────────────────────────────────

async function generateTranslations(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    // ─── Safety checks: detect Flutter Intl conflicts at generation time ───
    const pubspecReader = new PubspecConfigReader(rootPath);
    const flutterIntlConfig = pubspecReader.readFlutterIntlConfig();

    if (flutterIntlConfig) {
        // Fix 3: className collision — would cause Dart compilation errors
        const flutterIntlClassName = flutterIntlConfig.className || 'S';
        if (config.className === flutterIntlClassName) {
            const action = await logger.ask(
                `Class name "${config.className}" conflicts with Flutter Intl's "${flutterIntlClassName}". This will cause Dart compilation errors.`,
                'Change to ML',
                'Generate Anyway'
            );
            if (action === 'Change to ML') {
                const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');
                await vscodeConfig.update('className', 'ML', false);
                logger.warn('ℹ️  Changed class name to "ML" to avoid conflict.');
                return generateTranslations(logger);
            } else if (action !== 'Generate Anyway') {
                return; // user dismissed
            }
        }

        // Fix 4: output path overlap — generated files would collide
        const flutterIntlOutput = flutterIntlConfig.outputDir || 'lib/generated';
        const ourOutput = config.outputPath;
        if (
            ourOutput === flutterIntlOutput ||
            ourOutput.startsWith(flutterIntlOutput + '/') ||
            flutterIntlOutput.startsWith(ourOutput + '/')
        ) {
            const action = await logger.ask(
                `Output path "${ourOutput}" overlaps with Flutter Intl's "${flutterIntlOutput}". Generated files may conflict.`,
                'Change to lib/generated/modular_l10n',
                'Generate Anyway'
            );
            if (action === 'Change to lib/generated/modular_l10n') {
                const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');
                await vscodeConfig.update('outputPath', 'lib/generated/modular_l10n', false);
                logger.warn('ℹ️  Changed output path to "lib/generated/modular_l10n" to avoid conflict.');
                return generateTranslations(logger);
            } else if (action !== 'Generate Anyway') {
                return;
            }
        }
    }

    logger.banner('🚀 Starting translation generation...');
    logger.reveal();

    try {
        const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
        const { modules, detectedLocales, validationErrors } = await scanner.scanModules();

        if (validationErrors && validationErrors.length > 0) {
            logger.blank('warning');
            logger.warn('⚠️  Validation Issues:');
            for (const error of validationErrors) {
                logger.warn(`   ${error}`);
            }
            logger.blank('warning');
            logger.reveal('warning');
        }

        if (modules.length === 0) {
            logger.blank('warning');
            logger.warn('⚠️  No valid ARB files found.');
            logger.info('');
            logger.info('Make sure your ARB files have both required properties:');
            logger.info('  {');
            logger.info('    "@@locale": "en",');
            logger.info('    "@@context": "module_name",');
            logger.info('    ...');
            logger.info('  }');
            await logger.notifyWarning(
                'No valid ARB files found. Make sure files have @@locale and @@context properties.'
            );
            return;
        }

        if (detectedLocales.length === 0) {
            logger.warn('⚠️  No valid locales detected.');
            await logger.notifyWarning('No valid locales detected in ARB files.');
            return;
        }

        logger.info('');
        logger.info(`📦 Found ${modules.length} module(s):`);
        for (const module of modules) {
            const locales = module.arbFiles.map((f) => f.locale).join(', ');
            logger.info(`   • ${module.name} [${locales}]`);
        }
        logger.info('');
        logger.info(`🌍 Detected locales: ${detectedLocales.join(', ')}`);

        const configDefaultLocale = config.defaultLocale;
        const defaultLocale = detectedLocales.includes(configDefaultLocale)
            ? configDefaultLocale
            : detectedLocales[0];

        const parser = new ArbParser((message) => logger.warn(`   ⚠️  ${message}`));
        const parsedModules = await parser.parseModules(
            modules,
            detectedLocales,
            defaultLocale
        );

        if (!detectedLocales.includes(configDefaultLocale)) {
            logger.blank('warning');
            logger.warn(
                `⚠️  Configured default locale "${configDefaultLocale}" not found in ARB files.`
            );
            logger.warn(`   Using "${defaultLocale}" as default.`);
        }

        const generator = new DartGenerator({
            outputPath: path.join(rootPath, config.outputPath),
            className: config.className,
            defaultLocale,
            supportedLocales: detectedLocales,
            generateCombinedArb: config.generateCombinedArb,
            useDeferredLoading: config.useDeferredLoading,
            onWarning: (message) => logger.warn(`   ⚠️  ${message}`),
        });

        await generator.generate(parsedModules);

        const totalKeys = parsedModules.reduce((sum, m) => sum + m.keys.length, 0);

        logger.banner('✅ Translation generation completed!');
        logger.summary(
            `✅ Generated ${totalKeys} key(s) · ${modules.length} module(s) · ` +
            `${detectedLocales.length} locale(s) [${detectedLocales.join(', ')}] → ${config.outputPath}`
        );
        logger.blank();

        await logger.notifyInfo(
            `✅ Generated ${totalKeys} translation keys for ${detectedLocales.length} locales`
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.blank('error');
        logger.error(`❌ Error: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
            logger.debug('Stack trace:');
            logger.debug(error.stack);
        }
        logger.reveal('error');
        await logger.notifyError(`Failed to generate translations: ${errorMessage}`);
    }
}

// ─── Add Translation Key ─────────────────────────────────────────────────────

async function addTranslationKey(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        await logger.notifyError(
            'No modules with valid ARB files found. Create ARB files with @@locale and @@context first.'
        );
        return;
    }

    const moduleNames = modules.map((m) => m.name);
    const selectedModule = await vscode.window.showQuickPick(moduleNames, {
        placeHolder: 'Select module to add translation key',
    });
    if (!selectedModule) return;

    const keyName = await vscode.window.showInputBox({
        prompt: 'Enter the translation key name (camelCase)',
        placeHolder: 'e.g., welcomeMessage',
        validateInput: (value) => {
            if (!value || !/^[a-z][a-zA-Z0-9]*$/.test(value))
                return 'Key must be camelCase starting with lowercase letter';
            return null;
        },
    });
    if (!keyName) return;

    const translations: Record<string, string> = {};
    for (const locale of detectedLocales) {
        const value = await vscode.window.showInputBox({
            prompt: `Enter translation for "${keyName}" in ${locale}`,
            placeHolder: `Translation in ${locale}`,
        });
        if (value === undefined) return;
        translations[locale] = value;
    }

    const module = modules.find((m) => m.name === selectedModule)!;
    for (const locale of detectedLocales) {
        const arbFile = module.arbFiles.find((f) => f.locale === locale);
        if (arbFile) {
            try {
                const content = fs.readFileSync(arbFile.path, 'utf-8');
                const arbData = JSON.parse(content);
                arbData[keyName] = translations[locale];
                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                logger.info(`✅ Added "${keyName}" to ${path.basename(arbFile.path)}`);
            } catch (error) {
                logger.error(`❌ Error updating ${arbFile.path}: ${error}`);
                logger.reveal('error');
            }
        } else {
            logger.warn(
                `⚠️  No ARB file found for locale "${locale}" in module "${selectedModule}"`
            );
        }
    }

    await logger.notifyInfo(
        `Added key "${keyName}" to ${selectedModule} module for ${detectedLocales.length} locale(s)`
    );

    await generateTranslations(logger);
}

// ─── Create New Module ───────────────────────────────────────────────────────

async function createNewModule(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { detectedLocales } = await scanner.scanModules();

    const moduleName = await vscode.window.showInputBox({
        prompt: 'Enter the module name (snake_case)',
        placeHolder: 'e.g., auth, home, settings',
        validateInput: (value) => {
            if (!value || !/^[a-z][a-z0-9_]*$/.test(value))
                return 'Module name must be snake_case starting with lowercase letter';
            return null;
        },
    });
    if (!moduleName) return;

    const modulePath = await vscode.window.showInputBox({
        prompt: 'Enter the module path relative to lib/',
        placeHolder: `e.g., features/${moduleName}`,
        value: `features/${moduleName}`,
    });
    if (!modulePath) return;

    let localesToCreate = detectedLocales;
    if (localesToCreate.length === 0) {
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Enter locales to create (comma-separated)',
            placeHolder: 'e.g., en, ar, de',
            value: 'en, ar',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) return 'Please enter at least one locale';
                return null;
            },
        });
        if (!localesInput) return;
        localesToCreate = localesInput.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
    }

    const fullModulePath = path.join(rootPath, 'lib', modulePath);
    const l10nPath = path.join(fullModulePath, 'l10n');
    fs.mkdirSync(l10nPath, { recursive: true });

    for (const locale of localesToCreate) {
        const arbContent = {
            '@@locale': locale,
            '@@context': moduleName,
        };

        const arbPath = path.join(l10nPath, `${moduleName}_${locale}.arb`);
        fs.writeFileSync(arbPath, JSON.stringify(arbContent, null, 2), 'utf-8');
        logger.info(`✅ Created ${path.basename(arbPath)}`);
    }

    await logger.notifyInfo(
        `Created module "${moduleName}" with ${localesToCreate.length} locale(s): ${localesToCreate.join(', ')}`
    );

    await generateTranslations(logger);
}

// ─── File Watcher ────────────────────────────────────────────────────────────

function startFileWatcher(logger: Logger): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    stopFileWatcher();

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    fileWatcher = new FileWatcher(
        rootPath,
        config.arbFilePattern,
        async () => {
            // Re-read the level: a pubspec.yaml edit may have changed it.
            syncLogLevel(logger);
            logger.blank();
            logger.info('🔄 ARB file change detected, regenerating...');
            await generateTranslations(logger);
        },
        (message) => logger.debug(message)
    );

    fileWatcher.start();
    logger.info('👁️  File watcher started');
}

function stopFileWatcher(): void {
    if (fileWatcher) {
        fileWatcher.stop();
        fileWatcher = undefined;
    }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function toSnakeCase(str: string): string {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[-\s]+/g, '_')
        .toLowerCase();
}

function toPascalCase(str: string): string {
    return str
        .split(/[_\-\s]+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
}

export function deactivate() {
    stopFileWatcher();
    disposeHardcodedDiagnostics();
}