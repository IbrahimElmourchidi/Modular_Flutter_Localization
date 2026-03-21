import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Detect the string literal surrounding the cursor position.
 * Handles single quotes, double quotes, triple quotes, raw strings,
 * and properly accounts for escape characters.
 *
 * Returns the Range covering the full string literal (including quotes),
 * or undefined if the cursor is not inside a string.
 */
export function detectStringAtCursor(
    document: vscode.TextDocument,
    position: vscode.Position
): vscode.Range | undefined {
    const line = document.lineAt(position.line).text;
    const col = position.character;

    // --- Try triple-quoted strings first (may span multiple lines) ---
    const tripleResult = detectTripleQuotedString(document, position);
    if (tripleResult) {
        return tripleResult;
    }

    // --- Single-line string detection ---
    // Check for raw string prefix
    // We scan backward to find an opening quote and forward to find the closing quote.

    // Find all string regions on this line and check if cursor is in one
    const regions = findStringRegionsOnLine(line);
    for (const region of regions) {
        // region.start is the index of the opening quote (or 'r' for raw strings)
        // region.end is the index AFTER the closing quote
        if (col >= region.start && col < region.end) {
            return new vscode.Range(
                position.line, region.start,
                position.line, region.end
            );
        }
    }

    return undefined;
}

interface StringRegion {
    start: number;  // index of start (includes r prefix if raw)
    end: number;    // index after closing quote
    isRaw: boolean;
    quote: string;  // ' or "
    contentStart: number; // index of first content char (after opening quote)
    contentEnd: number;   // index of closing quote
}

/**
 * Find all single-line string literal regions on a line.
 * Handles: 'str', "str", r'str', r"str", and escaped quotes.
 * Does NOT handle triple-quoted strings (handled separately).
 */
function findStringRegionsOnLine(line: string): StringRegion[] {
    const regions: StringRegion[] = [];
    let i = 0;

    while (i < line.length) {
        const isRaw = line[i] === 'r' && (line[i + 1] === "'" || line[i + 1] === '"');
        const quoteStart = isRaw ? i + 1 : i;
        const ch = line[quoteStart];

        if (ch !== "'" && ch !== '"') {
            i++;
            continue;
        }

        // Skip triple quotes on this pass (handled by detectTripleQuotedString)
        if (line[quoteStart + 1] === ch && line[quoteStart + 2] === ch) {
            i = quoteStart + 3;
            // Skip to the end of the triple-quoted string on this line (or end of line)
            while (i < line.length) {
                if (line[i] === '\\' && !isRaw) {
                    i += 2;
                    continue;
                }
                if (line[i] === ch && line[i + 1] === ch && line[i + 2] === ch) {
                    i += 3;
                    break;
                }
                i++;
            }
            continue;
        }

        // Single-line string: scan forward for the closing quote
        const contentStart = quoteStart + 1;
        let j = contentStart;
        let closed = false;

        while (j < line.length) {
            if (!isRaw && line[j] === '\\') {
                j += 2; // skip escaped character
                continue;
            }
            if (line[j] === ch) {
                // Found closing quote
                regions.push({
                    start: isRaw ? i : quoteStart,
                    end: j + 1,
                    isRaw,
                    quote: ch,
                    contentStart,
                    contentEnd: j,
                });
                closed = true;
                i = j + 1;
                break;
            }
            j++;
        }

        if (!closed) {
            // Unclosed string on this line — skip
            i = quoteStart + 1;
        }
    }

    return regions;
}

/**
 * Detect triple-quoted strings (''' or \"\"\") which may span multiple lines.
 * Scans backward from the cursor to find the opening triple-quote,
 * then forward to find the closing triple-quote.
 */
function detectTripleQuotedString(
    document: vscode.TextDocument,
    position: vscode.Position
): vscode.Range | undefined {
    const cursorLine = position.line;
    const cursorCol = position.character;

    // Search backward for opening triple quote (up to 50 lines back for sanity)
    const maxLookback = Math.max(0, cursorLine - 50);

    for (let searchLine = cursorLine; searchLine >= maxLookback; searchLine--) {
        const lineText = document.lineAt(searchLine).text;
        // Look for ''' or """ on this line
        for (const tripleQuote of ["'''", '"""']) {
            const q = tripleQuote[0];
            let searchFrom = searchLine === cursorLine ? cursorCol : lineText.length - 1;

            // Scan backward through this line for the triple quote
            for (let idx = searchFrom; idx >= 0; idx--) {
                if (lineText[idx] === q && idx + 2 < lineText.length &&
                    lineText[idx + 1] === q && lineText[idx + 2] === q) {

                    // Check it's not a closing triple quote by seeing if there's an opening before it
                    // Actually, we need to determine if this is an opening or closing quote.
                    // An opening triple quote: either at the start of expression or preceded by = ( , etc.
                    // Simplification: check if raw prefix
                    const isRaw = idx > 0 && lineText[idx - 1] === 'r';
                    const startCol = isRaw ? idx - 1 : idx;
                    const contentStartCol = idx + 3;

                    // Now find the closing triple quote, searching forward from after the opening
                    const closePos = findClosingTripleQuote(
                        document, searchLine, contentStartCol, q, isRaw
                    );

                    if (closePos) {
                        const openRange = new vscode.Range(searchLine, startCol, closePos.line, closePos.character);
                        // Check if cursor is within this range
                        const cursorPos = new vscode.Position(cursorLine, cursorCol);
                        if (openRange.contains(cursorPos) || openRange.end.isEqual(cursorPos)) {
                            return openRange;
                        }
                    }
                }
            }
        }
    }

    return undefined;
}

function findClosingTripleQuote(
    document: vscode.TextDocument,
    startLine: number,
    startCol: number,
    quoteChar: string,
    isRaw: boolean
): vscode.Position | undefined {
    const maxLine = Math.min(document.lineCount - 1, startLine + 100);

    for (let line = startLine; line <= maxLine; line++) {
        const lineText = document.lineAt(line).text;
        const from = line === startLine ? startCol : 0;

        for (let i = from; i < lineText.length; i++) {
            if (!isRaw && lineText[i] === '\\') {
                i++; // skip escaped character
                continue;
            }
            if (lineText[i] === quoteChar &&
                i + 1 < lineText.length && lineText[i + 1] === quoteChar &&
                i + 2 < lineText.length && lineText[i + 2] === quoteChar) {
                return new vscode.Position(line, i + 3);
            }
        }
    }

    return undefined;
}

/**
 * Unescape a Dart string literal's content.
 * Converts escape sequences to their actual characters for ARB storage.
 */
export function unescapeDartString(content: string, isRaw: boolean): string {
    if (isRaw) {
        return content; // Raw strings have no escape processing
    }

    let result = '';
    let i = 0;
    while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
            const next = content[i + 1];
            switch (next) {
                case '\\': result += '\\'; break;
                case "'": result += "'"; break;
                case '"': result += '"'; break;
                case 'n': result += '\n'; break;
                case 't': result += '\t'; break;
                case 'r': result += '\r'; break;
                case 'b': result += '\b'; break;
                case 'f': result += '\f'; break;
                case '$': result += '$'; break;
                default: result += '\\' + next; break;
            }
            i += 2;
        } else {
            result += content[i];
            i++;
        }
    }
    return result;
}

/**
 * Convert Dart string interpolation ($var, ${expr}) to ARB placeholders ({var}).
 * Returns the converted string and info about detected placeholders.
 */
export function convertInterpolationToPlaceholders(text: string): {
    converted: string;
    placeholders: string[];
    hasComplexExpressions: boolean;
} {
    const placeholders: string[] = [];
    let hasComplexExpressions = false;
    let result = '';
    let i = 0;

    while (i < text.length) {
        if (text[i] === '$' && i + 1 < text.length) {
            if (text[i + 1] === '{') {
                // Complex expression: ${...}
                let braceDepth = 1;
                let j = i + 2;
                while (j < text.length && braceDepth > 0) {
                    if (text[j] === '{') { braceDepth++; }
                    else if (text[j] === '}') { braceDepth--; }
                    j++;
                }
                const expr = text.substring(i + 2, j - 1);
                // Simple identifier inside ${}
                if (/^\w+$/.test(expr)) {
                    placeholders.push(expr);
                    result += `{${expr}}`;
                } else {
                    hasComplexExpressions = true;
                    placeholders.push(expr);
                    result += `{${expr}}`;
                }
                i = j;
            } else if (/[a-zA-Z_]/.test(text[i + 1])) {
                // Simple variable: $name
                let j = i + 1;
                while (j < text.length && /[\w]/.test(text[j])) {
                    j++;
                }
                const varName = text.substring(i + 1, j);
                placeholders.push(varName);
                result += `{${varName}}`;
                i = j;
            } else {
                result += text[i];
                i++;
            }
        } else {
            result += text[i];
            i++;
        }
    }

    return { converted: result, placeholders, hasComplexExpressions };
}

/**
 * Code Action Provider that enables extracting string literals from Dart code
 * into ARB localization files.
 *
 * Works with:
 * - Full string selection (backward compatible)
 * - Cursor placed anywhere inside a string literal (auto-detection)
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

        let stringRange: vscode.Range | undefined;

        // Check if there's a non-empty selection that looks like a full string literal
        const selectedText = document.getText(range);
        if (selectedText && selectedText.trim().length > 0) {
            const trimmed = selectedText.trim();
            const isFullStringSelected =
                (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length > 2) ||
                (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) ||
                (trimmed.startsWith("r'") && trimmed.endsWith("'") && trimmed.length > 3) ||
                (trimmed.startsWith('r"') && trimmed.endsWith('"') && trimmed.length > 3) ||
                (trimmed.startsWith("'''") && trimmed.endsWith("'''") && trimmed.length > 6) ||
                (trimmed.startsWith('"""') && trimmed.endsWith('"""') && trimmed.length > 6) ||
                (trimmed.startsWith("r'''") && trimmed.endsWith("'''") && trimmed.length > 7) ||
                (trimmed.startsWith('r"""') && trimmed.endsWith('"""') && trimmed.length > 7);

            if (isFullStringSelected) {
                stringRange = range;
            }
        }

        // If no valid full-string selection, try auto-detecting from cursor position
        if (!stringRange) {
            const cursorPos = range instanceof vscode.Selection ? range.active : range.start;
            stringRange = detectStringAtCursor(document, cursorPos);
        }

        if (!stringRange) {
            return undefined;
        }

        // Verify the detected text is actually a string literal
        const detectedText = document.getText(stringRange).trim();
        if (!looksLikeStringLiteral(detectedText)) {
            return undefined;
        }

        const action = new vscode.CodeAction(
            'Modular L10n: Extract to ARB',
            vscode.CodeActionKind.RefactorExtract
        );

        action.command = {
            command: 'modularL10n.extractToArb',
            title: 'Extract to ARB',
            arguments: [document, stringRange],
        };

        return [action];
    }
}

/**
 * Check if text looks like a Dart string literal.
 */
function looksLikeStringLiteral(text: string): boolean {
    if (text.startsWith("r'''") && text.endsWith("'''") && text.length > 7) { return true; }
    if (text.startsWith('r"""') && text.endsWith('"""') && text.length > 7) { return true; }
    if (text.startsWith("'''") && text.endsWith("'''") && text.length > 6) { return true; }
    if (text.startsWith('"""') && text.endsWith('"""') && text.length > 6) { return true; }
    if (text.startsWith("r'") && text.endsWith("'") && text.length > 3) { return true; }
    if (text.startsWith('r"') && text.endsWith('"') && text.length > 3) { return true; }
    if (text.startsWith("'") && text.endsWith("'") && text.length > 2) { return true; }
    if (text.startsWith('"') && text.endsWith('"') && text.length > 2) { return true; }
    return false;
}

/**
 * Parse a string literal text to extract its content (without quotes)
 * and metadata about the string type.
 */
function parseStringLiteral(text: string): {
    content: string;
    isRaw: boolean;
    isTriple: boolean;
    quote: string;
} {
    let s = text;
    const isRaw = s.startsWith('r');
    if (isRaw) { s = s.substring(1); }

    let isTriple = false;
    let quote = s[0];

    if (s.startsWith("'''") || s.startsWith('"""')) {
        isTriple = true;
        return { content: s.slice(3, -3), isRaw, isTriple, quote };
    }

    return { content: s.slice(1, -1), isRaw, isTriple, quote };
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

    // Get the string literal and parse it
    const literalText = document.getText(range).trim();
    const { content: rawContent, isRaw } = parseStringLiteral(literalText);

    // Unescape the string content
    const unescaped = unescapeDartString(rawContent, isRaw);

    // Convert Dart interpolation to ARB placeholders
    const { converted: arbValue, placeholders, hasComplexExpressions } =
        convertInterpolationToPlaceholders(unescaped);

    // Warn about complex expressions
    if (hasComplexExpressions) {
        const proceed = await vscode.window.showWarningMessage(
            'This string contains complex interpolation expressions (e.g., ${expr}). ' +
            'The placeholders may need manual adjustment in the ARB file.',
            'Continue', 'Cancel'
        );
        if (proceed !== 'Continue') {
            return;
        }
    }

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
    const suggestedKey = suggestKeyName(arbValue);

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
                    arbData[keyName] = arbValue;

                    // Add placeholder metadata if we detected placeholders
                    if (placeholders.length > 0) {
                        const metaKey = `@${keyName}`;
                        const placeholderMeta: Record<string, { type: string; example: string }> = {};
                        for (const p of placeholders) {
                            // Only add simple identifiers as metadata
                            if (/^\w+$/.test(p)) {
                                placeholderMeta[p] = { type: 'String', example: p };
                            }
                        }
                        if (Object.keys(placeholderMeta).length > 0) {
                            arbData[metaKey] = {
                                description: keyName,
                                placeholders: placeholderMeta,
                            };
                        }
                    }
                } else {
                    arbData[keyName] = arbData[keyName] || '';
                }

                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                addedCount++;
                outputChannel.appendLine(`Added "${keyName}" to ${path.basename(arbFile.path)}`);
            } catch (error) {
                outputChannel.appendLine(`Error updating ${arbFile.path}: ${error}`);
            }
        }
    }

    if (addedCount === 0) {
        vscode.window.showErrorMessage('Failed to add key to any ARB file.');
        return;
    }

    // Replace the string in the Dart code with the localization call
    const moduleCamelCase = toCamelCase(selectedModule);
    let replacement: string;

    if (placeholders.length > 0) {
        // For parameterized strings, generate a method call
        const simpleParams = placeholders.filter(p => /^\w+$/.test(p));
        if (simpleParams.length > 0) {
            replacement = `${config.className}.of(context).${moduleCamelCase}.${keyName}(${simpleParams.join(', ')})`;
        } else {
            replacement = `${config.className}.of(context).${moduleCamelCase}.${keyName}`;
        }
    } else {
        replacement = `${config.className}.of(context).${moduleCamelCase}.${keyName}`;
    }

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
    // Remove ARB placeholders for key name suggestion
    const cleaned = text.replace(/\{[^}]+\}/g, '');
    const words = cleaned
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
            if (i === 0) { return lower; }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join('');
}

/**
 * Convert snake_case to camelCase.
 * Used to match the generated Dart code's module getter names.
 */
function toCamelCase(str: string): string {
    return str
        .split('_')
        .map((word, i) => {
            if (i === 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');
}
