import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Code Action Provider that enables extracting string literals from Dart code
 * into ARB localization files. Similar to Flutter Intl's "Extract to ARB" feature.
 *
 * Usage: Select a string literal in Dart code → click the lightbulb → "Extract to ARB"
 */
export class ExtractToArbProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.RefactorExtract,
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        // Only for Dart files
        if (document.languageId !== 'dart') {
            return undefined;
        }

        // Get selected text
        const selectedText = document.getText(range);
        if (!selectedText) {
            return undefined;
        }

        // Check if selection looks like a string literal
        const trimmed = selectedText.trim();
        const isStringLiteral =
            (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'));

        if (!isStringLiteral || trimmed.length <= 2) {
            return undefined;
        }

        const action = new vscode.CodeAction(
            'Modular L10n: Extract to ARB',
            vscode.CodeActionKind.RefactorExtract
        );

        action.command = {
            command: 'modularL10n.extractToArb',
            title: 'Extract to ARB',
            arguments: [document, range],
        };

        return [action];
    }
}

/**
 * Execute the extract-to-ARB action.
 * Prompts the user for a key name and module, then adds the string to all ARB files
 * and replaces the original string with a localization call.
 */
export async function executeExtractToArb(
    document: vscode.TextDocument,
    range: vscode.Range,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);

    // Get selected string
    const selectedText = document.getText(range).trim();
    const stringContent = selectedText.slice(1, -1); // Remove surrounding quotes

    // Scan for modules
    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules, detectedLocales } = await scanner.scanModules();

    if (modules.length === 0) {
        vscode.window.showErrorMessage(
            'No modules found. Run "Modular L10n: Initialize" or create ARB files first.'
        );
        return;
    }

    // Let user select module
    const moduleNames = modules.map((m) => m.name);
    const selectedModule = await vscode.window.showQuickPick(moduleNames, {
        placeHolder: 'Select target module for the translation key',
    });

    if (!selectedModule) {
        return;
    }

    // Suggest a key name based on the string content
    const suggestedKey = suggestKeyName(stringContent);

    // Get key name
    const keyName = await vscode.window.showInputBox({
        prompt: 'Enter the translation key name (camelCase)',
        placeHolder: 'e.g., welcomeMessage',
        value: suggestedKey,
        validateInput: (value) => {
            if (!value || !/^[a-z][a-zA-Z0-9]*$/.test(value)) {
                return 'Key must be camelCase starting with a lowercase letter';
            }
            return null;
        },
    });

    if (!keyName) {
        return;
    }

    // Add to ARB files
    const module = modules.find((m) => m.name === selectedModule)!;
    let addedCount = 0;

    for (const locale of detectedLocales) {
        const arbFile = module.arbFiles.find((f) => f.locale === locale);
        if (arbFile) {
            try {
                const content = fs.readFileSync(arbFile.path, 'utf-8');
                const arbData = JSON.parse(content);

                // Check for duplicate key
                if (arbData[keyName] !== undefined) {
                    const overwrite = await vscode.window.showWarningMessage(
                        `Key "${keyName}" already exists in ${path.basename(arbFile.path)}. Overwrite?`,
                        'Yes',
                        'No'
                    );
                    if (overwrite !== 'Yes') {
                        continue;
                    }
                }

                // Add the string to the default locale, empty string for others
                if (locale === config.defaultLocale) {
                    arbData[keyName] = stringContent;
                } else {
                    arbData[keyName] = arbData[keyName] || '';
                }

                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                addedCount++;
                outputChannel.appendLine(`✅ Added "${keyName}" to ${path.basename(arbFile.path)}`);
            } catch (error) {
                outputChannel.appendLine(`❌ Error updating ${arbFile.path}: ${error}`);
            }
        }
    }

    if (addedCount === 0) {
        vscode.window.showErrorMessage('Failed to add key to any ARB file.');
        return;
    }

    // Replace the string in the Dart code with the localization call
    const replacement = `${config.className}.of(context).${selectedModule}.${keyName}`;

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, replacement);
    await vscode.workspace.applyEdit(edit);

    vscode.window.showInformationMessage(
        `Extracted "${keyName}" to ${selectedModule} module (${addedCount} locale file(s))`
    );

    // Regenerate
    vscode.commands.executeCommand('modularL10n.generate');
}

/**
 * Suggest a camelCase key name from the string content.
 */
function suggestKeyName(text: string): string {
    // Take first few words, clean up, convert to camelCase
    const words = text
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .filter((w) => w.length > 0);

    if (words.length === 0) {
        return 'newKey';
    }

    return words
        .map((word, i) => {
            const lower = word.toLowerCase();
            if (i === 0) return lower;
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('');
}