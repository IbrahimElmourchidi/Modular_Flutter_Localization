import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Character map for pseudo-localization.
 * Replaces ASCII chars with visually similar accented characters.
 */
const PSEUDO_CHAR_MAP: Record<string, string> = {
    'a': 'å', 'b': 'ƀ', 'c': 'ç', 'd': 'ð', 'e': 'ë', 'f': 'ƒ',
    'g': 'ğ', 'h': 'ĥ', 'i': 'ï', 'j': 'ĵ', 'k': 'ĸ', 'l': 'ĺ',
    'm': 'ɱ', 'n': 'ñ', 'o': 'ö', 'p': 'þ', 'q': 'ǫ', 'r': 'ř',
    's': 'š', 't': 'ţ', 'u': 'ü', 'v': 'ṽ', 'w': 'ŵ', 'x': 'ẋ',
    'y': 'ÿ', 'z': 'ž',
    'A': 'Å', 'B': 'Ɓ', 'C': 'Ç', 'D': 'Ð', 'E': 'Ë', 'F': 'Ƒ',
    'G': 'Ğ', 'H': 'Ĥ', 'I': 'Ï', 'J': 'Ĵ', 'K': 'Ķ', 'L': 'Ĺ',
    'M': 'Ṁ', 'N': 'Ñ', 'O': 'Ö', 'P': 'Þ', 'Q': 'Ǫ', 'R': 'Ř',
    'S': 'Š', 'T': 'Ţ', 'U': 'Ü', 'V': 'Ṽ', 'W': 'Ŵ', 'X': 'Ẋ',
    'Y': 'Ÿ', 'Z': 'Ž',
};

/**
 * Generate pseudo-localized translations from the default locale.
 * Creates a special locale (en_XA) with accented characters and expanded text.
 */
export async function generatePseudoLocale(outputChannel: vscode.OutputChannel): Promise<void> {
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

    // Ask for pseudo-locale code
    const pseudoLocale = await vscode.window.showInputBox({
        prompt: 'Enter the pseudo-locale code',
        value: 'en_XA',
        placeHolder: 'e.g., en_XA (Android convention for pseudo-locale)',
    });
    if (!pseudoLocale) { return; }

    // Select expansion level
    const expansion = await vscode.window.showQuickPick(
        [
            { label: 'Normal (~30% longer)', description: 'Simulates languages like German/French', value: 0.3 },
            { label: 'Long (~50% longer)', description: 'Simulates verbose languages', value: 0.5 },
            { label: 'No expansion', description: 'Only apply character substitution', value: 0 },
        ],
        { placeHolder: 'Select text expansion level' }
    );
    if (!expansion) { return; }

    outputChannel.show();
    outputChannel.appendLine(`--- Generating pseudo-locale "${pseudoLocale}" ---`);

    let fileCount = 0;

    for (const module of modules) {
        const defaultArb = module.arbFiles.find(f => f.locale === config.defaultLocale);
        if (!defaultArb) { continue; }

        let defaultData: Record<string, unknown>;
        try {
            defaultData = JSON.parse(fs.readFileSync(defaultArb.path, 'utf-8'));
        } catch { continue; }

        // Create pseudo-localized data
        const pseudoData: Record<string, unknown> = {
            '@@locale': pseudoLocale,
            '@@context': defaultData['@@context'],
        };

        if (defaultData['@@last_modified']) {
            pseudoData['@@last_modified'] = new Date().toISOString().split('T')[0];
        }

        const keys = Object.keys(defaultData).filter(k => !k.startsWith('@'));

        for (const key of keys) {
            const value = defaultData[key];
            if (typeof value === 'string') {
                pseudoData[key] = pseudoLocalize(value, expansion.value);
            } else {
                pseudoData[key] = value;
            }

            // Copy metadata
            const metaKey = `@${key}`;
            if (defaultData[metaKey]) {
                pseudoData[metaKey] = defaultData[metaKey];
            }
        }

        // Write to the same directory as the default locale file
        const dir = path.dirname(defaultArb.path);
        const pseudoFileName = `${module.name}_${pseudoLocale}.arb`;
        const pseudoFilePath = path.join(dir, pseudoFileName);

        fs.writeFileSync(pseudoFilePath, JSON.stringify(pseudoData, null, 2), 'utf-8');
        fileCount++;
        outputChannel.appendLine(`Created: ${pseudoFileName}`);
    }

    outputChannel.appendLine(`\nGenerated ${fileCount} pseudo-locale file(s).`);
    vscode.window.showInformationMessage(
        `Generated pseudo-locale "${pseudoLocale}" for ${fileCount} module(s). ` +
        'Run "Generate Translations" to include it.'
    );
}

/**
 * Apply pseudo-localization to a string.
 * - Replaces ASCII letters with accented equivalents
 * - Wraps in brackets to detect concatenation issues
 * - Expands text to simulate longer translations
 * - Preserves ARB placeholders {name} and ICU syntax
 */
function pseudoLocalize(text: string, expansionRatio: number): string {
    let result = '';
    let i = 0;

    while (i < text.length) {
        // Preserve ARB placeholders and ICU syntax
        if (text[i] === '{') {
            let braceDepth = 1;
            let j = i + 1;
            while (j < text.length && braceDepth > 0) {
                if (text[j] === '{') { braceDepth++; }
                else if (text[j] === '}') { braceDepth--; }
                j++;
            }
            result += text.substring(i, j);
            i = j;
            continue;
        }

        // Preserve escape sequences
        if (text[i] === '\\' && i + 1 < text.length) {
            result += text[i] + text[i + 1];
            i += 2;
            continue;
        }

        // Replace with accented character
        const ch = text[i];
        result += PSEUDO_CHAR_MAP[ch] || ch;
        i++;
    }

    // Apply text expansion
    if (expansionRatio > 0) {
        const words = result.split(' ');
        const extraChars = Math.ceil(result.length * expansionRatio);
        const padding = '~'.repeat(extraChars);
        result = result + ' ' + padding;
    }

    // Wrap in brackets to detect concatenation/truncation issues
    result = `[${result}]`;

    return result;
}
