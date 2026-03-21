import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Sort ARB file keys alphabetically, keeping metadata (@key) adjacent to its key
 * and @@-prefixed meta keys at the top.
 */
export async function sortArbKeys(outputChannel: vscode.OutputChannel): Promise<void> {
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

    // Let user choose scope
    const scope = await vscode.window.showQuickPick(
        [
            { label: 'All modules', description: 'Sort keys in all ARB files', value: 'all' },
            ...modules.map(m => ({
                label: m.name,
                description: `Sort keys in ${m.name} module (${m.arbFiles.length} files)`,
                value: m.name,
            })),
        ],
        { placeHolder: 'Select which module(s) to sort' }
    );

    if (!scope) {
        return;
    }

    const targetModules = scope.value === 'all'
        ? modules
        : modules.filter(m => m.name === scope.value);

    let sortedCount = 0;

    for (const module of targetModules) {
        for (const arbFile of module.arbFiles) {
            try {
                const content = fs.readFileSync(arbFile.path, 'utf-8');
                const data = JSON.parse(content);

                const sorted = sortArbData(data);
                const newContent = JSON.stringify(sorted, null, 2);

                if (newContent !== content) {
                    fs.writeFileSync(arbFile.path, newContent, 'utf-8');
                    sortedCount++;
                    outputChannel.appendLine(`Sorted: ${path.basename(arbFile.path)}`);
                }
            } catch (error) {
                outputChannel.appendLine(`Error sorting ${arbFile.path}: ${error}`);
            }
        }
    }

    if (sortedCount > 0) {
        vscode.window.showInformationMessage(`Sorted keys in ${sortedCount} ARB file(s).`);
    } else {
        vscode.window.showInformationMessage('All ARB files are already sorted.');
    }
}

/**
 * Sort an ARB data object:
 * 1. @@-prefixed meta keys first (@@locale, @@context, @@last_modified)
 * 2. Translation keys alphabetically, with their @key metadata immediately after
 */
function sortArbData(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // 1. Add all @@-prefixed keys first, in a stable order
    const metaOrder = ['@@locale', '@@context', '@@last_modified'];
    for (const metaKey of metaOrder) {
        if (data[metaKey] !== undefined) {
            result[metaKey] = data[metaKey];
        }
    }
    // Any other @@-prefixed keys
    for (const key of Object.keys(data)) {
        if (key.startsWith('@@') && result[key] === undefined) {
            result[key] = data[key];
        }
    }

    // 2. Get translation keys (not starting with @), sort alphabetically
    const translationKeys = Object.keys(data)
        .filter(k => !k.startsWith('@'))
        .sort((a, b) => a.localeCompare(b));

    // 3. Add each translation key followed by its @key metadata
    for (const key of translationKeys) {
        result[key] = data[key];
        const metaKey = `@${key}`;
        if (data[metaKey] !== undefined) {
            result[metaKey] = data[metaKey];
        }
    }

    return result;
}
