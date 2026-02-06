import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ArbParser } from './arb_parser';
import { DartGenerator } from './dart_generator';
import { FileWatcher } from './file_watcher';
import { ModuleScanner, ScanResult } from './module_scanner';

let fileWatcher: FileWatcher | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Modular Flutter L10n extension is now active!');

    const outputChannel = vscode.window.createOutputChannel('Modular L10n');

    // Register generate command
    const generateCommand = vscode.commands.registerCommand(
        'modularL10n.generate',
        async () => {
            await generateTranslations(outputChannel);
        }
    );

    // Register add key command
    const addKeyCommand = vscode.commands.registerCommand(
        'modularL10n.addKey',
        async () => {
            await addTranslationKey(outputChannel);
        }
    );

    // Register create module command
    const createModuleCommand = vscode.commands.registerCommand(
        'modularL10n.createModule',
        async () => {
            await createNewModule(outputChannel);
        }
    );

    // Register context menu command for adding l10n folder
    const addL10nFolderCommand = vscode.commands.registerCommand(
        'modularL10n.addL10nFolder',
        async (uri: vscode.Uri) => {
            await addL10nFolderToDirectory(uri, outputChannel);
        }
    );

    context.subscriptions.push(
        generateCommand,
        addKeyCommand,
        createModuleCommand,
        addL10nFolderCommand
    );

    // Start file watcher if enabled
    const config = vscode.workspace.getConfiguration('modularL10n');
    if (config.get<boolean>('watchMode', true)) {
        startFileWatcher(outputChannel);
    }

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('modularL10n')) {
            const newConfig = vscode.workspace.getConfiguration('modularL10n');
            if (newConfig.get<boolean>('watchMode', true)) {
                startFileWatcher(outputChannel);
            } else {
                stopFileWatcher();
            }
        }
    });
}

/**
 * Add l10n folder to a directory via context menu
 */
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
    const config = vscode.workspace.getConfiguration('modularL10n');

    // Check if l10n folder already exists
    const l10nPath = path.join(targetPath, 'l10n');
    if (fs.existsSync(l10nPath)) {
        const overwrite = await vscode.window.showWarningMessage(
            'An l10n folder already exists in this directory. Do you want to add missing locale files?',
            'Yes',
            'No'
        );
        if (overwrite !== 'Yes') {
            return;
        }
    }

    // Get module name from folder name or ask user
    const folderName = path.basename(targetPath);
    const moduleName = await vscode.window.showInputBox({
        prompt: 'Enter the module name (snake_case)',
        placeHolder: 'e.g., auth, home, settings',
        value: toSnakeCase(folderName),
        validateInput: (value) => {
            if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) {
                return 'Module name must be snake_case starting with lowercase letter';
            }
            return null;
        },
    });

    if (!moduleName) {
        return;
    }

    // Scan existing modules to get detected locales
    const scanner = new ModuleScanner(
        rootPath,
        config.get<string>('arbFilePattern', '**/l10n/*.arb')
    );
    const { detectedLocales } = await scanner.scanModules();

    // Ask for locales if none detected
    let localesToCreate = detectedLocales;

    if (localesToCreate.length === 0) {
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Enter locales to create (comma-separated)',
            placeHolder: 'e.g., en, ar, de',
            value: 'en, ar',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter at least one locale';
                }
                return null;
            },
        });

        if (!localesInput) {
            return;
        }

        localesToCreate = localesInput
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    } else {
        // Show detected locales and allow modification
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Detected locales from existing modules. Modify if needed:',
            value: localesToCreate.join(', '),
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter at least one locale';
                }
                return null;
            },
        });

        if (!localesInput) {
            return;
        }

        localesToCreate = localesInput
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    }

    // Create l10n directory
    fs.mkdirSync(l10nPath, { recursive: true });

    // Create ARB files for each locale
    const createdFiles: string[] = [];
    const skippedFiles: string[] = [];

    for (const locale of localesToCreate) {
        const arbFileName = `${moduleName}_${locale}.arb`;
        const arbPath = path.join(l10nPath, arbFileName);

        // Skip if file already exists
        if (fs.existsSync(arbPath)) {
            skippedFiles.push(arbFileName);
            continue;
        }

        const arbContent = {
            '@@locale': locale,
            '@@context': moduleName,
            [`${moduleName}Title`]: locale === 'en' ? `${toPascalCase(moduleName)} Title` : '',
        };

        fs.writeFileSync(arbPath, JSON.stringify(arbContent, null, 2), 'utf-8');
        createdFiles.push(arbFileName);
    }

    // Log results
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

    // Show success message
    if (createdFiles.length > 0) {
        const message = `Created l10n module "${moduleName}" with ${createdFiles.length} locale(s)`;
        const action = await vscode.window.showInformationMessage(
            message,
            'Generate Translations',
            'Open Files'
        );

        if (action === 'Generate Translations') {
            await generateTranslations(outputChannel);
        } else if (action === 'Open Files') {
            // Open the first created file
            const firstFile = path.join(l10nPath, createdFiles[0]);
            const document = await vscode.workspace.openTextDocument(firstFile);
            await vscode.window.showTextDocument(document);
        }
    } else {
        vscode.window.showInformationMessage('All locale files already exist.');
    }
}

async function generateTranslations(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('modularL10n');

    outputChannel.appendLine('');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.appendLine('Starting translation generation...');
    outputChannel.appendLine('═'.repeat(60));
    outputChannel.show();

    try {
        // Scan for modules (now returns ScanResult with detectedLocales)
        const scanner = new ModuleScanner(
            rootPath,
            config.get<string>('arbFilePattern', '**/l10n/*.arb')
        );
        const { modules, detectedLocales } = await scanner.scanModules();

        // Check if any valid modules found
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

        // Check if any locales detected
        if (detectedLocales.length === 0) {
            outputChannel.appendLine('⚠️  No valid locales detected.');
            vscode.window.showWarningMessage('No valid locales detected in ARB files.');
            return;
        }

        // Log discovered modules and locales
        outputChannel.appendLine('');
        outputChannel.appendLine(`📦 Found ${modules.length} module(s):`);
        for (const module of modules) {
            const locales = module.arbFiles.map((f) => f.locale).join(', ');
            outputChannel.appendLine(`   • ${module.name} [${locales}]`);
        }
        outputChannel.appendLine('');
        outputChannel.appendLine(`🌍 Detected locales: ${detectedLocales.join(', ')}`);

        // Parse ARB files
        const parser = new ArbParser();
        const parsedModules = await parser.parseModules(modules, detectedLocales);

        // Determine default locale
        const configDefaultLocale = config.get<string>('defaultLocale', 'en');
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

        // Generate Dart code
        const generator = new DartGenerator({
            outputPath: path.join(
                rootPath,
                config.get<string>('outputPath', 'lib/generated/l10n')
            ),
            className: config.get<string>('className', 'S'),
            defaultLocale: defaultLocale,
            supportedLocales: detectedLocales,
            generateCombinedArb: config.get<boolean>('generateCombinedArb', true),
        });

        await generator.generate(parsedModules);

        // Count total keys
        const totalKeys = parsedModules.reduce((sum, m) => sum + m.keys.length, 0);

        outputChannel.appendLine('');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine('✅ Translation generation completed!');
        outputChannel.appendLine('═'.repeat(60));
        outputChannel.appendLine(`   Modules: ${modules.length}`);
        outputChannel.appendLine(`   Locales: ${detectedLocales.length} (${detectedLocales.join(', ')})`);
        outputChannel.appendLine(`   Keys: ${totalKeys}`);
        outputChannel.appendLine(`   Output: ${config.get<string>('outputPath', 'lib/generated/l10n')}`);
        outputChannel.appendLine('');

        vscode.window.showInformationMessage(
            `Generated ${totalKeys} translation keys for ${detectedLocales.length} locales: ${detectedLocales.join(', ')}`
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine('');
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to generate translations: ${errorMessage}`);
    }
}

async function addTranslationKey(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('modularL10n');

    // Scan for available modules
    const scanner = new ModuleScanner(
        rootPath,
        config.get<string>('arbFilePattern', '**/l10n/*.arb')
    );
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        vscode.window.showErrorMessage(
            'No modules with valid ARB files found. Create ARB files with @@locale and @@context first.'
        );
        return;
    }

    // Let user select module
    const moduleNames = modules.map((m) => m.name);
    const selectedModule = await vscode.window.showQuickPick(moduleNames, {
        placeHolder: 'Select module to add translation key',
    });

    if (!selectedModule) {
        return;
    }

    // Get key name
    const keyName = await vscode.window.showInputBox({
        prompt: 'Enter the translation key name (camelCase)',
        placeHolder: 'e.g., welcomeMessage',
        validateInput: (value) => {
            if (!value || !/^[a-z][a-zA-Z0-9]*$/.test(value)) {
                return 'Key must be camelCase starting with lowercase letter';
            }
            return null;
        },
    });

    if (!keyName) {
        return;
    }

    // Get translations for each detected locale
    const translations: Record<string, string> = {};

    for (const locale of detectedLocales) {
        const value = await vscode.window.showInputBox({
            prompt: `Enter translation for "${keyName}" in ${locale}`,
            placeHolder: `Translation in ${locale}`,
        });

        if (value === undefined) {
            return; // User cancelled
        }

        translations[locale] = value;
    }

    // Add to ARB files
    const module = modules.find((m) => m.name === selectedModule)!;

    for (const locale of detectedLocales) {
        const arbFile = module.arbFiles.find((f) => f.locale === locale);
        if (arbFile) {
            try {
                const content = fs.readFileSync(arbFile.path, 'utf-8');
                const arbData = JSON.parse(content);
                arbData[keyName] = translations[locale];
                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                outputChannel.appendLine(`Added "${keyName}" to ${arbFile.path}`);
            } catch (error) {
                outputChannel.appendLine(`Error updating ${arbFile.path}: ${error}`);
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

    // Regenerate
    await generateTranslations(outputChannel);
}

async function createNewModule(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('modularL10n');

    // Scan existing modules to get detected locales
    const scanner = new ModuleScanner(
        rootPath,
        config.get<string>('arbFilePattern', '**/l10n/*.arb')
    );
    const { detectedLocales } = await scanner.scanModules();

    // Get module name
    const moduleName = await vscode.window.showInputBox({
        prompt: 'Enter the module name (snake_case)',
        placeHolder: 'e.g., auth, home, settings',
        validateInput: (value) => {
            if (!value || !/^[a-z][a-z0-9_]*$/.test(value)) {
                return 'Module name must be snake_case starting with lowercase letter';
            }
            return null;
        },
    });

    if (!moduleName) {
        return;
    }

    // Get module path
    const modulePath = await vscode.window.showInputBox({
        prompt: 'Enter the module path relative to lib/',
        placeHolder: `e.g., features/${moduleName}`,
        value: `features/${moduleName}`,
    });

    if (!modulePath) {
        return;
    }

    // Ask for locales if none detected
    let localesToCreate = detectedLocales;

    if (localesToCreate.length === 0) {
        const localesInput = await vscode.window.showInputBox({
            prompt: 'Enter locales to create (comma-separated)',
            placeHolder: 'e.g., en, ar, de',
            value: 'en, ar',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Please enter at least one locale';
                }
                return null;
            },
        });

        if (!localesInput) {
            return;
        }

        localesToCreate = localesInput
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
    }

    const fullModulePath = path.join(rootPath, 'lib', modulePath);
    const l10nPath = path.join(fullModulePath, 'l10n');

    // Create l10n directory
    fs.mkdirSync(l10nPath, { recursive: true });

    // Create ARB files for each locale
    for (const locale of localesToCreate) {
        const arbContent = {
            '@@locale': locale,
            '@@context': moduleName,
        };

        const arbPath = path.join(l10nPath, `${moduleName}_${locale}.arb`);
        fs.writeFileSync(arbPath, JSON.stringify(arbContent, null, 2), 'utf-8');
        outputChannel.appendLine(`Created ${arbPath}`);
    }

    vscode.window.showInformationMessage(
        `Created module "${moduleName}" with ${localesToCreate.length} locale(s): ${localesToCreate.join(', ')}`
    );

    // Regenerate
    await generateTranslations(outputChannel);
}

function startFileWatcher(outputChannel: vscode.OutputChannel): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    stopFileWatcher();

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('modularL10n');
    const pattern = config.get<string>('arbFilePattern', '**/l10n/*.arb');

    fileWatcher = new FileWatcher(rootPath, pattern, async () => {
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

// Helper functions
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