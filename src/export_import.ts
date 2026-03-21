import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ModuleScanner, Module } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Export translations to CSV format for external translators.
 */
export async function exportTranslations(outputChannel: vscode.OutputChannel): Promise<void> {
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
        vscode.window.showInformationMessage('No modules found.');
        return;
    }

    // Select format
    const format = await vscode.window.showQuickPick(
        [
            { label: 'CSV', description: 'Comma-separated values', value: 'csv' },
            { label: 'XLIFF 1.2', description: 'XML Localization Interchange File Format', value: 'xliff' },
        ],
        { placeHolder: 'Select export format' }
    );
    if (!format) { return; }

    // Select modules to export
    const scope = await vscode.window.showQuickPick(
        [
            { label: 'All modules', description: `Export all ${modules.length} modules`, value: 'all' },
            ...modules.map(m => ({
                label: m.name,
                description: `${m.arbFiles.length} locale file(s)`,
                value: m.name,
            })),
        ],
        { placeHolder: 'Select module(s) to export' }
    );
    if (!scope) { return; }

    const targetModules = scope.value === 'all'
        ? modules
        : modules.filter(m => m.name === scope.value);

    // Choose save location
    const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
            path.join(rootPath, `translations.${format.value === 'csv' ? 'csv' : 'xlf'}`)
        ),
        filters: format.value === 'csv'
            ? { 'CSV Files': ['csv'] }
            : { 'XLIFF Files': ['xlf', 'xliff'] },
    });
    if (!saveUri) { return; }

    outputChannel.show();

    if (format.value === 'csv') {
        exportToCsv(targetModules, detectedLocales, config, saveUri.fsPath, outputChannel);
    } else {
        exportToXliff(targetModules, detectedLocales, config, saveUri.fsPath, outputChannel);
    }
}

function exportToCsv(
    modules: Module[],
    locales: string[],
    config: ReturnType<typeof getEffectiveConfig>,
    filePath: string,
    outputChannel: vscode.OutputChannel
): void {
    const rows: string[][] = [];

    // Header
    rows.push(['Module', 'Key', 'Description', ...locales]);

    for (const module of modules) {
        // Read all locale data for this module
        const localeData: Map<string, Record<string, unknown>> = new Map();
        for (const arbFile of module.arbFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(arbFile.path, 'utf-8'));
                localeData.set(arbFile.locale, data);
            } catch { /* skip */ }
        }

        // Get keys from default locale
        const defaultData = localeData.get(config.defaultLocale) || {};
        const keys = Object.keys(defaultData).filter(k => !k.startsWith('@'));

        for (const key of keys) {
            const meta = defaultData[`@${key}`] as Record<string, unknown> | undefined;
            const description = (meta?.description as string) || '';

            const translations = locales.map(locale => {
                const data = localeData.get(locale);
                if (!data || data[key] === undefined) { return ''; }
                return String(data[key]);
            });

            rows.push([module.name, key, description, ...translations]);
        }
    }

    // Write CSV with proper escaping
    const csv = rows.map(row =>
        row.map(cell => {
            if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
        }).join(',')
    ).join('\n');

    fs.writeFileSync(filePath, '\ufeff' + csv, 'utf-8'); // BOM for Excel compatibility
    outputChannel.appendLine(`Exported ${rows.length - 1} keys to ${filePath}`);
    vscode.window.showInformationMessage(`Exported translations to CSV (${rows.length - 1} keys)`);
}

function exportToXliff(
    modules: Module[],
    locales: string[],
    config: ReturnType<typeof getEffectiveConfig>,
    filePath: string,
    outputChannel: vscode.OutputChannel
): void {
    const targetLocales = locales.filter(l => l !== config.defaultLocale);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n`;

    let keyCount = 0;

    for (const targetLocale of targetLocales) {
        xml += `  <file source-language="${config.defaultLocale}" target-language="${targetLocale}" datatype="plaintext" original="modular_l10n">\n`;
        xml += `    <body>\n`;

        for (const module of modules) {
            const defaultArb = module.arbFiles.find(f => f.locale === config.defaultLocale);
            const targetArb = module.arbFiles.find(f => f.locale === targetLocale);

            if (!defaultArb) { continue; }

            let defaultData: Record<string, unknown>;
            let targetData: Record<string, unknown> = {};
            try {
                defaultData = JSON.parse(fs.readFileSync(defaultArb.path, 'utf-8'));
                if (targetArb) {
                    targetData = JSON.parse(fs.readFileSync(targetArb.path, 'utf-8'));
                }
            } catch { continue; }

            const keys = Object.keys(defaultData).filter(k => !k.startsWith('@'));

            for (const key of keys) {
                const sourceText = escapeXml(String(defaultData[key] || ''));
                const targetText = escapeXml(String(targetData[key] || ''));
                const meta = defaultData[`@${key}`] as Record<string, unknown> | undefined;
                const note = meta?.description ? `\n        <note>${escapeXml(String(meta.description))}</note>` : '';

                xml += `      <trans-unit id="${module.name}.${key}" resname="${key}">${note}\n`;
                xml += `        <source>${sourceText}</source>\n`;
                xml += `        <target>${targetText}</target>\n`;
                xml += `      </trans-unit>\n`;
                keyCount++;
            }
        }

        xml += `    </body>\n`;
        xml += `  </file>\n`;
    }

    xml += `</xliff>\n`;

    fs.writeFileSync(filePath, xml, 'utf-8');
    outputChannel.appendLine(`Exported ${keyCount} translation unit(s) to ${filePath}`);
    vscode.window.showInformationMessage(`Exported translations to XLIFF (${keyCount} units)`);
}

/**
 * Import translations from CSV or XLIFF format.
 */
export async function importTranslations(outputChannel: vscode.OutputChannel): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);
    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules } = await scanner.scanModules();

    // Select file to import
    const fileUri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: {
            'Translation Files': ['csv', 'xlf', 'xliff'],
        },
    });
    if (!fileUri || fileUri.length === 0) { return; }

    const filePath = fileUri[0].fsPath;
    const ext = path.extname(filePath).toLowerCase();

    outputChannel.show();
    outputChannel.appendLine(`--- Importing translations from ${path.basename(filePath)} ---`);

    if (ext === '.csv') {
        await importFromCsv(filePath, modules, config, outputChannel);
    } else {
        await importFromXliff(filePath, modules, config, outputChannel);
    }

    // Regenerate
    vscode.commands.executeCommand('modularL10n.generate');
}

async function importFromCsv(
    filePath: string,
    modules: Module[],
    config: ReturnType<typeof getEffectiveConfig>,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8').replace(/^\ufeff/, ''); // Remove BOM
    const rows = parseCsv(content);

    if (rows.length < 2) {
        vscode.window.showErrorMessage('CSV file is empty or has no data rows');
        return;
    }

    const header = rows[0];
    // Expected: Module, Key, Description, locale1, locale2, ...
    const localeColumns = header.slice(3);
    let updateCount = 0;

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 4) { continue; }

        const moduleName = row[0];
        const key = row[1];
        // row[2] is description (skip for import)

        const module = modules.find(m => m.name === moduleName);
        if (!module) {
            outputChannel.appendLine(`Skipping: module "${moduleName}" not found`);
            continue;
        }

        for (let j = 0; j < localeColumns.length; j++) {
            const locale = localeColumns[j];
            const value = row[j + 3];
            if (value === undefined || value === '') { continue; }

            const arbFile = module.arbFiles.find(f => f.locale === locale);
            if (!arbFile) { continue; }

            try {
                const arbContent = fs.readFileSync(arbFile.path, 'utf-8');
                const arbData = JSON.parse(arbContent);
                arbData[key] = value;
                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                updateCount++;
            } catch (error) {
                outputChannel.appendLine(`Error updating ${arbFile.path}: ${error}`);
            }
        }
    }

    outputChannel.appendLine(`Imported ${updateCount} translation(s) from CSV`);
    vscode.window.showInformationMessage(`Imported ${updateCount} translation(s) from CSV`);
}

async function importFromXliff(
    filePath: string,
    modules: Module[],
    _config: ReturnType<typeof getEffectiveConfig>,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    let updateCount = 0;

    // Simple XML parsing for XLIFF (avoid adding xml2js dependency)
    const filePattern = /<file[^>]*target-language="([^"]*)"[^>]*>([\s\S]*?)<\/file>/g;
    let fileMatch: RegExpExecArray | null;

    while ((fileMatch = filePattern.exec(content)) !== null) {
        const targetLocale = fileMatch[1];
        const fileBody = fileMatch[2];

        const unitPattern = /<trans-unit[^>]*id="([^"]*)"[^>]*>[\s\S]*?<target>([\s\S]*?)<\/target>[\s\S]*?<\/trans-unit>/g;
        let unitMatch: RegExpExecArray | null;

        while ((unitMatch = unitPattern.exec(fileBody)) !== null) {
            const id = unitMatch[1]; // module.key format
            const targetText = unescapeXml(unitMatch[2]);

            const dotIndex = id.indexOf('.');
            if (dotIndex === -1) { continue; }

            const moduleName = id.substring(0, dotIndex);
            const key = id.substring(dotIndex + 1);

            const module = modules.find(m => m.name === moduleName);
            if (!module) { continue; }

            const arbFile = module.arbFiles.find(f => f.locale === targetLocale);
            if (!arbFile) { continue; }

            try {
                const arbContent = fs.readFileSync(arbFile.path, 'utf-8');
                const arbData = JSON.parse(arbContent);
                arbData[key] = targetText;
                fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                updateCount++;
            } catch (error) {
                outputChannel.appendLine(`Error updating ${arbFile.path}: ${error}`);
            }
        }
    }

    outputChannel.appendLine(`Imported ${updateCount} translation(s) from XLIFF`);
    vscode.window.showInformationMessage(`Imported ${updateCount} translation(s) from XLIFF`);
}

/**
 * Simple CSV parser that handles quoted fields with commas and newlines.
 */
function parseCsv(content: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
        const ch = content[i];

        if (inQuotes) {
            if (ch === '"') {
                if (content[i + 1] === '"') {
                    currentField += '"';
                    i += 2;
                } else {
                    inQuotes = false;
                    i++;
                }
            } else {
                currentField += ch;
                i++;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            } else if (ch === ',') {
                currentRow.push(currentField);
                currentField = '';
                i++;
            } else if (ch === '\n' || ch === '\r') {
                currentRow.push(currentField);
                currentField = '';
                if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                if (ch === '\r' && content[i + 1] === '\n') {
                    i += 2;
                } else {
                    i++;
                }
            } else {
                currentField += ch;
                i++;
            }
        }
    }

    // Last field/row
    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
    return text
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}
