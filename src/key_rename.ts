import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Rename a translation key across all ARB files and Dart code references.
 */
export async function renameKey(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);
    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules } = await scanner.scanModules();

    if (modules.length === 0) {
        vscode.window.showInformationMessage('No modules found.');
        return;
    }

    // Select module
    const moduleNames = modules.map(m => m.name);
    const selectedModule = await vscode.window.showQuickPick(moduleNames, {
        placeHolder: 'Select the module containing the key to rename',
    });
    if (!selectedModule) { return; }

    const module = modules.find(m => m.name === selectedModule)!;

    // Get keys from default locale
    const defaultArb = module.arbFiles.find(f => f.locale === config.defaultLocale);
    if (!defaultArb) {
        vscode.window.showErrorMessage(`No default locale file found for module "${selectedModule}"`);
        return;
    }

    let arbData: Record<string, unknown>;
    try {
        arbData = JSON.parse(fs.readFileSync(defaultArb.path, 'utf-8'));
    } catch {
        vscode.window.showErrorMessage('Failed to parse default ARB file');
        return;
    }

    const keys = Object.keys(arbData).filter(k => !k.startsWith('@'));
    if (keys.length === 0) {
        vscode.window.showInformationMessage('No keys found in this module.');
        return;
    }

    // Select key to rename
    const oldKey = await vscode.window.showQuickPick(
        keys.map(k => ({
            label: k,
            description: typeof arbData[k] === 'string' ? arbData[k] as string : '',
        })),
        { placeHolder: 'Select the key to rename' }
    );
    if (!oldKey) { return; }

    // Enter new key name
    const newKey = await vscode.window.showInputBox({
        prompt: 'Enter the new key name (camelCase)',
        placeHolder: 'e.g., welcomeMessage',
        value: oldKey.label,
        validateInput: (value) => {
            if (!value || !/^[a-z][a-zA-Z0-9]*$/.test(value)) {
                return 'Key must be camelCase starting with a lowercase letter';
            }
            if (value === oldKey.label) {
                return 'New key must be different from the old key';
            }
            if (keys.includes(value)) {
                return `Key "${value}" already exists in this module`;
            }
            return null;
        },
    });
    if (!newKey) { return; }

    outputChannel.show();
    outputChannel.appendLine(`--- Renaming "${oldKey.label}" → "${newKey}" in module "${selectedModule}" ---`);

    // 1. Update all ARB files
    let arbUpdateCount = 0;
    for (const arbFile of module.arbFiles) {
        try {
            const content = fs.readFileSync(arbFile.path, 'utf-8');
            const data = JSON.parse(content);

            if (data[oldKey.label] !== undefined) {
                // Rename the key
                data[newKey] = data[oldKey.label];
                delete data[oldKey.label];

                // Rename metadata
                const oldMetaKey = `@${oldKey.label}`;
                const newMetaKey = `@${newKey}`;
                if (data[oldMetaKey] !== undefined) {
                    data[newMetaKey] = data[oldMetaKey];
                    delete data[oldMetaKey];
                }

                fs.writeFileSync(arbFile.path, JSON.stringify(data, null, 2), 'utf-8');
                arbUpdateCount++;
                outputChannel.appendLine(`Updated: ${path.basename(arbFile.path)}`);
            }
        } catch (error) {
            outputChannel.appendLine(`Error updating ${arbFile.path}: ${error}`);
        }
    }

    // 2. Update Dart code references
    const libPath = path.join(rootPath, 'lib');
    let dartUpdateCount = 0;

    if (fs.existsSync(libPath)) {
        const dartFiles = await findDartFiles(libPath);
        const camelModule = toCamelCase(selectedModule);

        // Pattern: .moduleName.oldKey (with word boundary after)
        const oldPattern = new RegExp(
            `\\.${escapeRegex(camelModule)}\\.${escapeRegex(oldKey.label)}\\b`,
            'g'
        );
        const replacement = `.${camelModule}.${newKey}`;

        for (const dartFile of dartFiles) {
            // Skip generated files
            if (dartFile.includes('generated') ||
                dartFile.includes('.g.dart') ||
                dartFile.includes('.freezed.dart')) {
                continue;
            }

            try {
                const content = fs.readFileSync(dartFile, 'utf-8');
                if (oldPattern.test(content)) {
                    oldPattern.lastIndex = 0; // Reset regex state
                    const updated = content.replace(oldPattern, replacement);
                    fs.writeFileSync(dartFile, updated, 'utf-8');
                    dartUpdateCount++;
                    const relPath = path.relative(rootPath, dartFile);
                    outputChannel.appendLine(`Updated Dart: ${relPath}`);
                }
            } catch (error) {
                outputChannel.appendLine(`Error updating ${dartFile}: ${error}`);
            }
        }
    }

    outputChannel.appendLine(`\nDone! Updated ${arbUpdateCount} ARB file(s) and ${dartUpdateCount} Dart file(s).`);
    vscode.window.showInformationMessage(
        `Renamed "${oldKey.label}" → "${newKey}": ${arbUpdateCount} ARB file(s), ${dartUpdateCount} Dart file(s)`
    );

    // Regenerate
    vscode.commands.executeCommand('modularL10n.generate');
}

async function findDartFiles(dirPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        glob('**/*.dart', { cwd: dirPath, absolute: true }, (err, matches) => {
            if (err) { reject(err); }
            else { resolve(matches); }
        });
    });
}

function toCamelCase(str: string): string {
    return str
        .split('_')
        .map((word, i) => {
            if (i === 0) { return word.toLowerCase(); }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
