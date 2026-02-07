import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArbParser } from './arb_parser';
import { DartGenerator } from './dart_generator';
import { FileWatcher } from './file_watcher';
import { ModuleScanner, ScanResult } from './module_scanner';
import { PubspecConfigReader, mergeConfigs } from './pubspec_config';
import { ExtractToArbProvider, executeExtractToArb } from './extract_action_provider';

let fileWatcher: FileWatcher | undefined;

/**
 * Get effective configuration by merging VS Code settings with pubspec.yaml.
 * Exported so other modules (e.g., extract_action_provider) can use it.
 */
export function getEffectiveConfig(rootPath: string): {
    className: string;
    outputPath: string;
    defaultLocale: string;
    arbFilePattern: string;
    generateCombinedArb: boolean;
    useDeferredLoading: boolean;
    watchMode: boolean;
} {
    const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');

    const vscodeValues = {
        className: vscodeConfig.get<string>('className', 'ML'),
        outputPath: vscodeConfig.get<string>('outputPath', 'lib/generated/modular_l10n'),
        defaultLocale: vscodeConfig.get<string>('defaultLocale', 'en'),
        arbFilePattern: vscodeConfig.get<string>('arbFilePattern', '**/l10n/*.arb'),
        generateCombinedArb: vscodeConfig.get<boolean>('generateCombinedArb', true),
        useDeferredLoading: vscodeConfig.get<boolean>('useDeferredLoading', false),
        watchMode: vscodeConfig.get<boolean>('watchMode', true),
    };

    // Try reading from pubspec.yaml (takes precedence)
    const pubspecReader = new PubspecConfigReader(rootPath);
    const pubspecConfig = pubspecReader.readConfig();

    return mergeConfigs(vscodeValues, pubspecConfig);
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Modular Flutter L10n extension is now active!');

    const outputChannel = vscode.window.createOutputChannel('Modular L10n');

    // Check for conflicting extensions on activation
    checkForConflictingExtensions(outputChannel);

    // ─── Register commands ────────────────────────────────────────────

    const generateCommand = vscode.commands.registerCommand(
        'modularL10n.generate',
        async () => {
            await generateTranslations(outputChannel);
        }
    );

    const addKeyCommand = vscode.commands.registerCommand(
        'modularL10n.addKey',
        async () => {
            await addTranslationKey(outputChannel);
        }
    );

    const createModuleCommand = vscode.commands.registerCommand(
        'modularL10n.createModule',
        async () => {
            await createNewModule(outputChannel);
        }
    );

    const addL10nFolderCommand = vscode.commands.registerCommand(
        'modularL10n.addL10nFolder',
        async (uri: vscode.Uri) => {
            await addL10nFolderToDirectory(uri, outputChannel);
        }
    );

    const migrateFromFlutterIntlCommand = vscode.commands.registerCommand(
        'modularL10n.migrateFromFlutterIntl',
        async () => {
            await migrateFromFlutterIntl(outputChannel);
        }
    );

    // NEW: Initialize command (like Flutter Intl's "Initialize")
    const initializeCommand = vscode.commands.registerCommand(
        'modularL10n.initialize',
        async () => {
            await initializeProject(outputChannel);
        }
    );

    // NEW: Add locale command
    const addLocaleCommand = vscode.commands.registerCommand(
        'modularL10n.addLocale',
        async () => {
            await addLocale(outputChannel);
        }
    );

    // NEW: Remove locale command
    const removeLocaleCommand = vscode.commands.registerCommand(
        'modularL10n.removeLocale',
        async () => {
            await removeLocale(outputChannel);
        }
    );

    // NEW: Extract to ARB command (called by code action)
    const extractToArbCommand = vscode.commands.registerCommand(
        'modularL10n.extractToArb',
        async (document: vscode.TextDocument, range: vscode.Range) => {
            await executeExtractToArb(document, range, outputChannel);
        }
    );

    // NEW: Check compatibility command
    const checkCompatibilityCommand = vscode.commands.registerCommand(
        'modularL10n.checkCompatibility',
        async () => {
            await checkForConflictingExtensions(outputChannel, true);
        }
    );

    // NEW: Register code action provider for "Extract to ARB"
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        { language: 'dart', scheme: 'file' },
        new ExtractToArbProvider(),
        { providedCodeActionKinds: ExtractToArbProvider.providedCodeActionKinds }
    );

    context.subscriptions.push(
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
        codeActionProvider
    );

    // Start file watcher if enabled
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const config = getEffectiveConfig(workspaceFolders[0].uri.fsPath);
        if (config.watchMode) {
            startFileWatcher(outputChannel);
        }
    }

    // FIXED: Push config change listener disposable into subscriptions
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('modularL10n')) {
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
                const newConfig = getEffectiveConfig(folders[0].uri.fsPath);
                if (newConfig.watchMode) {
                    startFileWatcher(outputChannel);
                } else {
                    stopFileWatcher();
                }
            }
        }
    });
    context.subscriptions.push(configChangeDisposable);
}

// ─── NEW: Initialize Project ─────────────────────────────────────────────────

/**
 * One-click project initialization.
 * Creates initial ARB files, writes config to pubspec.yaml, and generates code.
 */
async function initializeProject(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    // Check if pubspec.yaml exists
    const pubspecPath = path.join(rootPath, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        vscode.window.showErrorMessage('No pubspec.yaml found. Is this a Flutter project?');
        return;
    }

    // Check if already initialized
    const pubspecReader = new PubspecConfigReader(rootPath);
    if (pubspecReader.readConfig()) {
        const proceed = await vscode.window.showWarningMessage(
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
    if (className === 'S') {
        const flutterIntlConfig = pubspecReader.readFlutterIntlConfig();
        if (flutterIntlConfig) {
            const proceed = await vscode.window.showWarningMessage(
                'Flutter Intl is detected and also uses class name "S". This will cause compilation errors. Use a different name?',
                'Change to ML',
                'Keep S'
            );
            if (proceed === 'Change to ML') {
                // We'll use ML below
            }
            // If they want to keep S, that's their choice
        }
    }

    const finalClassName = className === 'S' ? className : className;

    outputChannel.appendLine('');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine('🚀 Initializing Modular L10n...');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.show();

    try {
        // 1. Write config to pubspec.yaml
        pubspecReader.writeConfig({
            enabled: true,
            className: finalClassName,
            defaultLocale,
            outputDir: `lib/generated/modular_l10n`,
        });
        outputChannel.appendLine('✅ Added modular_l10n config to pubspec.yaml');

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
        outputChannel.appendLine(`✅ Created ${path.relative(rootPath, arbPath)}`);

        // 3. Generate translations
        await generateTranslations(outputChannel);

        outputChannel.appendLine('');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('✅ Initialization complete!');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('');
        outputChannel.appendLine('Next steps:');
        outputChannel.appendLine(`  1. Add flutter_localizations to pubspec.yaml dependencies`);
        outputChannel.appendLine(`  2. Add ${finalClassName}.delegate to your MaterialApp's localizationsDelegates`);
        outputChannel.appendLine(`  3. Add ${finalClassName}.supportedLocales to supportedLocales`);
        outputChannel.appendLine(`  4. Use ${finalClassName}.of(context).${moduleName}.yourKey in your widgets`);

        vscode.window.showInformationMessage(
            `Modular L10n initialized! Module "${moduleName}" created with locale "${defaultLocale}".`,
            'Open ARB File'
        ).then((action) => {
            if (action === 'Open ARB File') {
                vscode.workspace.openTextDocument(arbPath).then((doc) => {
                    vscode.window.showTextDocument(doc);
                });
            }
        });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`❌ Error: ${msg}`);
        vscode.window.showErrorMessage(`Initialization failed: ${msg}`);
    }
}

// ─── NEW: Add Locale ─────────────────────────────────────────────────────────

/**
 * Add a new locale to all existing modules.
 * Creates new ARB files for the locale in every module that doesn't have it.
 */
async function addLocale(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        vscode.window.showErrorMessage(
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

    outputChannel.appendLine('');
    outputChannel.appendLine(`🌍 Adding locale "${locale}" to all modules...`);
    outputChannel.show();

    let filesCreated = 0;

    for (const module of modules) {
        // Check if this module already has this locale
        if (module.arbFiles.some((f) => f.locale === locale)) {
            outputChannel.appendLine(`⏭️  ${module.name}: already has locale "${locale}"`);
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
        outputChannel.appendLine(`✅ Created ${path.relative(rootPath, newFilePath)}`);
        filesCreated++;
    }

    if (filesCreated > 0) {
        vscode.window.showInformationMessage(
            `Added locale "${locale}" to ${filesCreated} module(s).`,
            'Generate Translations'
        ).then((action) => {
            if (action === 'Generate Translations') {
                generateTranslations(outputChannel);
            }
        });
    } else {
        vscode.window.showInformationMessage(`Locale "${locale}" already exists in all modules.`);
    }
}

// ─── NEW: Remove Locale ──────────────────────────────────────────────────────

/**
 * Remove a locale from all modules.
 * Deletes the corresponding ARB files.
 */
async function removeLocale(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (detectedLocales.length === 0) {
        vscode.window.showErrorMessage('No locales found.');
        return;
    }

    // Filter out the default locale (can't remove it)
    const removableLocales = detectedLocales.filter((l) => l !== config.defaultLocale);

    if (removableLocales.length === 0) {
        vscode.window.showErrorMessage(
            `Only the default locale "${config.defaultLocale}" exists. Cannot remove it.`
        );
        return;
    }

    const localeToRemove = await vscode.window.showQuickPick(removableLocales, {
        placeHolder: 'Select locale to remove',
    });

    if (!localeToRemove) return;

    // Confirm
    const confirm = await vscode.window.showWarningMessage(
        `This will DELETE all ARB files for locale "${localeToRemove}" across all modules. Continue?`,
        { modal: true },
        'Delete'
    );

    if (confirm !== 'Delete') return;

    outputChannel.appendLine('');
    outputChannel.appendLine(`🗑️  Removing locale "${localeToRemove}"...`);
    outputChannel.show();

    let filesDeleted = 0;

    for (const module of modules) {
        const arbFile = module.arbFiles.find((f) => f.locale === localeToRemove);
        if (arbFile) {
            try {
                fs.unlinkSync(arbFile.path);
                outputChannel.appendLine(`✅ Deleted ${path.relative(rootPath, arbFile.path)}`);
                filesDeleted++;
            } catch (error) {
                outputChannel.appendLine(`❌ Failed to delete ${arbFile.path}: ${error}`);
            }
        }
    }

    if (filesDeleted > 0) {
        vscode.window.showInformationMessage(
            `Removed locale "${localeToRemove}" (${filesDeleted} file(s) deleted).`,
            'Generate Translations'
        ).then((action) => {
            if (action === 'Generate Translations') {
                generateTranslations(outputChannel);
            }
        });
    }
}

// ─── Conflict Detection ──────────────────────────────────────────────────────

/**
 * Check for conflicting extensions and configuration.
 * ENHANCED: Checks className and outputPath collisions.
 */
async function checkForConflictingExtensions(
    outputChannel: vscode.OutputChannel,
    forceShow: boolean = false
): Promise<void> {
    const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');

    if (!forceShow && !vscodeConfig.get<boolean>('compatibility.warnOnConflict', true)) {
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
            vscode.window.showInformationMessage('No Flutter Intl detected. No conflicts.');
        }
        return;
    }

    const config = getEffectiveConfig(rootPath);
    const issues: string[] = [];

    outputChannel.appendLine('');
    outputChannel.appendLine('⚠️  Flutter Intl detected in this project');
    outputChannel.appendLine('   Both extensions can coexist — they use different file patterns.');
    outputChannel.appendLine('   • Flutter Intl: lib/l10n/intl_*.arb');
    outputChannel.appendLine('   • Modular L10n: lib/**/l10n/*_*.arb (excluding intl_*.arb)');

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
        outputChannel.appendLine('');
        for (const issue of issues) {
            outputChannel.appendLine(`   ${issue}`);
        }
        outputChannel.appendLine('');
    }

    if (!forceShow) {
        const choice = await vscode.window.showInformationMessage(
            `Flutter Intl detected.${issues.length > 0 ? ` ${issues.length} potential conflict(s) found.` : ' Both extensions can work together.'}`,
            'Continue',
            'View Details',
            "Don't Show Again"
        );

        if (choice === 'View Details') {
            outputChannel.show();
        } else if (choice === "Don't Show Again") {
            await vscodeConfig.update('compatibility.warnOnConflict', false, true);
        }
    } else {
        outputChannel.show();
        if (issues.length > 0) {
            vscode.window.showWarningMessage(
                `Found ${issues.length} potential conflict(s) with Flutter Intl. See output for details.`
            );
        } else {
            vscode.window.showInformationMessage(
                'Flutter Intl detected but no conflicts found. Both extensions can coexist.'
            );
        }
    }
}

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrateFromFlutterIntl(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const intlDir = path.join(rootPath, 'lib/l10n');

    if (!fs.existsSync(intlDir)) {
        vscode.window.showWarningMessage('No lib/l10n directory found. Nothing to migrate.');
        return;
    }

    // FIXED: Wrap in try-catch
    let arbFiles: string[] = [];
    try {
        arbFiles = fs.readdirSync(intlDir)
            .filter((f) => f.startsWith('intl_') && f.endsWith('.arb'))
            .map((f) => path.join(intlDir, f));
    } catch {
        vscode.window.showErrorMessage('Cannot read lib/l10n directory.');
        return;
    }

    if (arbFiles.length === 0) {
        vscode.window.showWarningMessage('No intl_*.arb files found in lib/l10n/');
        return;
    }

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
                outputChannel.appendLine(`✅ Created ${newFileName}`);
                filesCreated++;
            } catch (error) {
                outputChannel.appendLine(`❌ Error migrating ${path.basename(arbFile)}: ${error}`);
            }
        }

        vscode.window.showInformationMessage(
            `Successfully migrated ${filesCreated} file(s) to ${destPath}/l10n/`,
            'Generate Translations'
        ).then((action) => {
            if (action === 'Generate Translations') {
                generateTranslations(outputChannel);
            }
        });
    } else if (choice === 'Split by Key Prefix') {
        await migrateSplitByPrefix(rootPath, arbFiles, outputChannel);
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
    outputChannel: vscode.OutputChannel
): Promise<void> {
    // Read the first ARB file to analyze key prefixes
    const firstFile = arbFiles[0];
    let content: Record<string, unknown>;
    try {
        content = JSON.parse(fs.readFileSync(firstFile, 'utf-8'));
    } catch {
        vscode.window.showErrorMessage('Cannot parse ARB file.');
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
        vscode.window.showWarningMessage('Could not detect key prefixes. Use "Create Single Module" instead.');
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

    outputChannel.appendLine('');
    outputChannel.appendLine('📦 Splitting by prefix...');
    outputChannel.show();

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
            outputChannel.appendLine(`✅ Created ${path.relative(rootPath, newFilePath)}`);
        }
    }

    vscode.window.showInformationMessage(
        'Migration complete! Review the created modules.',
        'Generate Translations'
    ).then((action) => {
        if (action === 'Generate Translations') {
            generateTranslations(outputChannel);
        }
    });
}

// ─── Add l10n folder to directory ────────────────────────────────────────────

async function addL10nFolderToDirectory(
    uri: vscode.Uri,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const targetPath = uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const l10nPath = path.join(targetPath, 'l10n');
    if (fs.existsSync(l10nPath)) {
        const overwrite = await vscode.window.showWarningMessage(
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

    outputChannel.appendLine('');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine(`📁 Created l10n folder in: ${path.relative(rootPath, targetPath)}`);
    outputChannel.appendLine('═'.repeat(60));

    if (createdFiles.length > 0) {
        outputChannel.appendLine('');
        outputChannel.appendLine('✅ Created files:');
        for (const file of createdFiles) {
            outputChannel.appendLine(`   • ${file}`);
        }
    }

    if (skippedFiles.length > 0) {
        outputChannel.appendLine('');
        outputChannel.appendLine('⏭️  Skipped (already exist):');
        for (const file of skippedFiles) {
            outputChannel.appendLine(`   • ${file}`);
        }
    }

    outputChannel.show();

    if (createdFiles.length > 0) {
        const action = await vscode.window.showInformationMessage(
            `Created l10n module "${moduleName}" with ${createdFiles.length} locale(s)`,
            'Generate Translations',
            'Open Files'
        );
        if (action === 'Generate Translations') {
            await generateTranslations(outputChannel);
        } else if (action === 'Open Files') {
            const firstFile = path.join(l10nPath, createdFiles[0]);
            const document = await vscode.workspace.openTextDocument(firstFile);
            await vscode.window.showTextDocument(document);
        }
    } else {
        vscode.window.showInformationMessage('All locale files already exist.');
    }
}

// ─── Generate Translations ───────────────────────────────────────────────────

async function generateTranslations(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
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
            const action = await vscode.window.showWarningMessage(
                `Class name "${config.className}" conflicts with Flutter Intl's "${flutterIntlClassName}". This will cause Dart compilation errors.`,
                'Change to ML',
                'Generate Anyway'
            );
            if (action === 'Change to ML') {
                const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');
                await vscodeConfig.update('className', 'ML', false);
                outputChannel.appendLine('ℹ️  Changed class name to "ML" to avoid conflict.');
                return generateTranslations(outputChannel);
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
            const action = await vscode.window.showWarningMessage(
                `Output path "${ourOutput}" overlaps with Flutter Intl's "${flutterIntlOutput}". Generated files may conflict.`,
                'Change to lib/generated/modular_l10n',
                'Generate Anyway'
            );
            if (action === 'Change to lib/generated/modular_l10n') {
                const vscodeConfig = vscode.workspace.getConfiguration('modularL10n');
                await vscodeConfig.update('outputPath', 'lib/generated/modular_l10n', false);
                outputChannel.appendLine('ℹ️  Changed output path to "lib/generated/modular_l10n" to avoid conflict.');
                return generateTranslations(outputChannel);
            } else if (action !== 'Generate Anyway') {
                return;
            }
        }
    }

    outputChannel.appendLine('');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine('🚀 Starting translation generation...');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.show();

    try {
        const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
        const { modules, detectedLocales, validationErrors } = await scanner.scanModules();

        if (validationErrors && validationErrors.length > 0) {
            outputChannel.appendLine('');
            outputChannel.appendLine('⚠️  Validation Issues:');
            for (const error of validationErrors) {
                outputChannel.appendLine(`   ${error}`);
            }
            outputChannel.appendLine('');
        }

        if (modules.length === 0) {
            outputChannel.appendLine('');
            outputChannel.appendLine('⚠️  No valid ARB files found.');
            outputChannel.appendLine('');
            outputChannel.appendLine('Make sure your ARB files have both required properties:');
            outputChannel.appendLine('  {');
            outputChannel.appendLine('    "@@locale": "en",');
            outputChannel.appendLine('    "@@context": "module_name",');
            outputChannel.appendLine('    ...');
            outputChannel.appendLine('  }');
            vscode.window.showWarningMessage(
                'No valid ARB files found. Make sure files have @@locale and @@context properties.'
            );
            return;
        }

        if (detectedLocales.length === 0) {
            outputChannel.appendLine('⚠️  No valid locales detected.');
            vscode.window.showWarningMessage('No valid locales detected in ARB files.');
            return;
        }

        outputChannel.appendLine('');
        outputChannel.appendLine(`📦 Found ${modules.length} module(s):`);
        for (const module of modules) {
            const locales = module.arbFiles.map((f) => f.locale).join(', ');
            outputChannel.appendLine(`   • ${module.name} [${locales}]`);
        }
        outputChannel.appendLine('');
        outputChannel.appendLine(`🌍 Detected locales: ${detectedLocales.join(', ')}`);

        const parser = new ArbParser();
        const parsedModules = await parser.parseModules(modules, detectedLocales);

        const configDefaultLocale = config.defaultLocale;
        const defaultLocale = detectedLocales.includes(configDefaultLocale)
            ? configDefaultLocale
            : detectedLocales[0];

        if (!detectedLocales.includes(configDefaultLocale)) {
            outputChannel.appendLine('');
            outputChannel.appendLine(
                `⚠️  Configured default locale "${configDefaultLocale}" not found in ARB files.`
            );
            outputChannel.appendLine(`   Using "${defaultLocale}" as default.`);
        }

        const generator = new DartGenerator({
            outputPath: path.join(rootPath, config.outputPath),
            className: config.className,
            defaultLocale,
            supportedLocales: detectedLocales,
            generateCombinedArb: config.generateCombinedArb,
            useDeferredLoading: config.useDeferredLoading,
        });

        await generator.generate(parsedModules);

        const totalKeys = parsedModules.reduce((sum, m) => sum + m.keys.length, 0);

        outputChannel.appendLine('');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('✅ Translation generation completed!');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine(`   Modules: ${modules.length}`);
        outputChannel.appendLine(`   Locales: ${detectedLocales.length} (${detectedLocales.join(', ')})`);
        outputChannel.appendLine(`   Keys: ${totalKeys}`);
        outputChannel.appendLine(`   Output: ${config.outputPath}`);
        outputChannel.appendLine('');

        vscode.window.showInformationMessage(
            `✅ Generated ${totalKeys} translation keys for ${detectedLocales.length} locales`
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine('');
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
        if (error instanceof Error && error.stack) {
            outputChannel.appendLine('Stack trace:');
            outputChannel.appendLine(error.stack);
        }
        vscode.window.showErrorMessage(`Failed to generate translations: ${errorMessage}`);
    }
}

// ─── Add Translation Key ─────────────────────────────────────────────────────

async function addTranslationKey(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        vscode.window.showErrorMessage(
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
                outputChannel.appendLine(`✅ Added "${keyName}" to ${path.basename(arbFile.path)}`);
            } catch (error) {
                outputChannel.appendLine(`❌ Error updating ${arbFile.path}: ${error}`);
            }
        } else {
            outputChannel.appendLine(
                `⚠️  No ARB file found for locale "${locale}" in module "${selectedModule}"`
            );
        }
    }

    vscode.window.showInformationMessage(
        `Added key "${keyName}" to ${selectedModule} module for ${detectedLocales.length} locale(s)`
    );

    await generateTranslations(outputChannel);
}

// ─── Create New Module ───────────────────────────────────────────────────────

async function createNewModule(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
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
        outputChannel.appendLine(`✅ Created ${path.basename(arbPath)}`);
    }

    vscode.window.showInformationMessage(
        `Created module "${moduleName}" with ${localesToCreate.length} locale(s): ${localesToCreate.join(', ')}`
    );

    await generateTranslations(outputChannel);
}

// ─── File Watcher ────────────────────────────────────────────────────────────

function startFileWatcher(outputChannel: vscode.OutputChannel): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    stopFileWatcher();

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    fileWatcher = new FileWatcher(rootPath, config.arbFilePattern, async () => {
        outputChannel.appendLine('');
        outputChannel.appendLine('🔄 ARB file change detected, regenerating...');
        await generateTranslations(outputChannel);
    });

    fileWatcher.start();
    outputChannel.appendLine('👁️  File watcher started');
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
}