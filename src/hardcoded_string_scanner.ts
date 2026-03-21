import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

/**
 * Result of scanning a single file for hardcoded strings.
 */
export interface HardcodedStringResult {
    filePath: string;
    line: number;
    column: number;
    text: string;
    context: string; // surrounding code snippet
}

/**
 * UI widget constructors and parameters that typically contain user-facing strings.
 */
const UI_PATTERNS = [
    // Widget constructors with string args
    /Text\s*\(\s*(['"])/,
    /Text\.rich\s*\(/,
    /TextSpan\s*\(\s*text\s*:\s*(['"])/,
    /RichText\s*\(/,

    // Common widget string properties
    /(?:label|hint|helper|error|title|subtitle|message|content|description|tooltip|placeholder|semantics)\s*(?:Text)?\s*:\s*(['"])/i,

    // AppBar / Dialog / Scaffold
    /AppBar\s*\(\s*title\s*:\s*Text\s*\(\s*(['"])/,
    /showDialog[^)]*title\s*:\s*Text\s*\(\s*(['"])/,
    /AlertDialog\s*\([^)]*title\s*:\s*Text\s*\(\s*(['"])/,

    // Snackbar / Toast
    /SnackBar\s*\(\s*content\s*:\s*Text\s*\(\s*(['"])/,
    /ScaffoldMessenger[^)]*showSnackBar/,

    // Buttons with text
    /(?:Elevated|Text|Outlined|Filled)Button\s*\([^)]*child\s*:\s*Text\s*\(\s*(['"])/,

    // Input decoration
    /InputDecoration\s*\([^)]*(?:label|hint|helper|error|prefix|suffix|counter)Text\s*:\s*(['"])/,

    // Tab / BottomNavigationBarItem
    /Tab\s*\(\s*text\s*:\s*(['"])/,
    /BottomNavigationBarItem\s*\([^)]*label\s*:\s*(['"])/,

    // ListTile
    /ListTile\s*\([^)]*title\s*:\s*Text\s*\(\s*(['"])/,
    /ListTile\s*\([^)]*subtitle\s*:\s*Text\s*\(\s*(['"])/,
];

/**
 * Patterns that indicate a string is NOT user-facing (should be excluded).
 */
const EXCLUDE_PATTERNS = [
    // Import/export statements
    /^import\s+/,
    /^export\s+/,
    /^part\s+/,

    // Route names / paths
    /(?:route|path|navigate|push|pop)\s*[\(:]\s*['"][\w\/\-:]+['"]/i,

    // Asset paths
    /(?:asset|image|icon|font)\s*[\(:]\s*['"][\w\/\-\.]+['"]/i,
    /['"](?:assets|images|icons|fonts)\//,
    /['"]packages?\//,

    // Keys / identifiers
    /(?:key|id|tag|hero)\s*:\s*['"][\w\-]+['"]/i,
    /Key\s*\(\s*['"][\w\-]+['"]\s*\)/,

    // URLs
    /['"]https?:\/\//,

    // Single character strings
    /['"]\s*.\s*['"]/,

    // Empty strings
    /['"]["']/,

    // Package names / technical identifiers
    /['"][\w\.]+\/[\w\.]+['"]/,

    // Dart annotations
    /^@\w+/,

    // Debug / log / print statements
    /(?:print|debugPrint|log|logger)\s*\(/i,

    // Comment lines
    /^\s*\/\//,
    /^\s*\/\*/,
    /^\s*\*/,

    // String concatenation pieces that are clearly formatting
    /['"]\s*[\+\$]\s*/,

    // Platform channel names
    /MethodChannel\s*\(\s*['"]/,
    /EventChannel\s*\(\s*['"]/,

    // Regex patterns
    /RegExp\s*\(\s*['"]/,

    // Map/JSON keys
    /\[\s*['"][\w]+['"]\s*\]/,
];

/**
 * Scan all Dart files in lib/ for hardcoded user-facing strings.
 */
export async function scanHardcodedStrings(
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const libPath = path.join(rootPath, 'lib');

    if (!fs.existsSync(libPath)) {
        vscode.window.showErrorMessage('No lib/ directory found');
        return;
    }

    outputChannel.show();
    outputChannel.appendLine('--- Scanning for hardcoded strings ---');

    const dartFiles = await findDartFiles(libPath);
    const results: HardcodedStringResult[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning for hardcoded strings...',
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < dartFiles.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }

                progress.report({
                    increment: (1 / dartFiles.length) * 100,
                    message: `${i + 1}/${dartFiles.length} files`,
                });

                const filePath = dartFiles[i];

                // Skip generated files
                if (filePath.includes('generated') ||
                    filePath.includes('.g.dart') ||
                    filePath.includes('.freezed.dart') ||
                    filePath.includes('.gr.dart')) {
                    continue;
                }

                const fileResults = scanFile(filePath);
                results.push(...fileResults);
            }
        }
    );

    // Show results
    if (results.length === 0) {
        vscode.window.showInformationMessage('No hardcoded user-facing strings found!');
        outputChannel.appendLine('No hardcoded strings found.');
        return;
    }

    outputChannel.appendLine(`Found ${results.length} potential hardcoded string(s):\n`);

    // Group by file
    const byFile = new Map<string, HardcodedStringResult[]>();
    for (const result of results) {
        const relPath = path.relative(rootPath, result.filePath);
        if (!byFile.has(relPath)) {
            byFile.set(relPath, []);
        }
        byFile.get(relPath)!.push(result);
    }

    for (const [filePath, fileResults] of byFile) {
        outputChannel.appendLine(`${filePath}:`);
        for (const r of fileResults) {
            outputChannel.appendLine(`  Line ${r.line + 1}: ${r.text.trim()}`);
            outputChannel.appendLine(`    Context: ${r.context.trim()}`);
        }
        outputChannel.appendLine('');
    }

    outputChannel.appendLine(`Total: ${results.length} hardcoded string(s) in ${byFile.size} file(s)`);

    // Also show as diagnostics
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('modularL10n.hardcoded');
    for (const [, fileResults] of byFile) {
        if (fileResults.length === 0) { continue; }
        const uri = vscode.Uri.file(fileResults[0].filePath);
        const diagnostics = fileResults.map(r => {
            const range = new vscode.Range(r.line, r.column, r.line, r.column + r.text.length);
            const diag = new vscode.Diagnostic(
                range,
                `Hardcoded string: ${r.text.trim().substring(0, 50)}...`,
                vscode.DiagnosticSeverity.Hint
            );
            diag.source = 'Modular L10n';
            diag.code = 'hardcoded-string';
            return diag;
        });
        diagnosticCollection.set(uri, diagnostics);
    }

    vscode.window.showInformationMessage(
        `Found ${results.length} hardcoded string(s) in ${byFile.size} file(s). Check the Output/Problems panel.`
    );
}

function scanFile(filePath: string): HardcodedStringResult[] {
    const results: HardcodedStringResult[] = [];

    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return results;
    }

    const lines = content.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];

        // Quick exclude: skip lines that are clearly not user-facing
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            continue;
        }
        if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.startsWith('part ')) {
            continue;
        }

        // Check if any exclude pattern matches
        if (EXCLUDE_PATTERNS.some(p => p.test(trimmed))) {
            continue;
        }

        // Check if any UI pattern matches
        const isUIContext = UI_PATTERNS.some(p => p.test(line));
        if (!isUIContext) {
            continue;
        }

        // Find string literals on this line
        const stringMatches = findStringLiteralsOnLine(line);
        for (const match of stringMatches) {
            // Filter out non-user-facing strings
            const strContent = match.text.slice(1, -1); // Remove quotes
            if (strContent.length < 2) { continue; } // Skip very short strings
            if (/^[\w\/\.\-:]+$/.test(strContent) && !strContent.includes(' ')) { continue; } // Skip identifiers/paths
            if (/^#[0-9a-fA-F]+$/.test(strContent)) { continue; } // Skip color codes

            results.push({
                filePath,
                line: lineNum,
                column: match.start,
                text: match.text,
                context: line.trim(),
            });
        }
    }

    return results;
}

interface StringMatch {
    start: number;
    text: string;
}

function findStringLiteralsOnLine(line: string): StringMatch[] {
    const matches: StringMatch[] = [];
    let i = 0;

    while (i < line.length) {
        const ch = line[i];
        if (ch === "'" || ch === '"') {
            // Skip triple quotes
            if (line[i + 1] === ch && line[i + 2] === ch) {
                i += 3;
                while (i < line.length) {
                    if (line[i] === '\\') { i += 2; continue; }
                    if (line[i] === ch && line[i + 1] === ch && line[i + 2] === ch) {
                        i += 3;
                        break;
                    }
                    i++;
                }
                continue;
            }

            const start = i;
            i++; // skip opening quote
            while (i < line.length) {
                if (line[i] === '\\') { i += 2; continue; }
                if (line[i] === ch) {
                    const text = line.substring(start, i + 1);
                    matches.push({ start, text });
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        i++;
    }

    return matches;
}

async function findDartFiles(dirPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        glob('**/*.dart', { cwd: dirPath, absolute: true }, (err, matches) => {
            if (err) {
                reject(err);
            } else {
                resolve(matches);
            }
        });
    });
}
