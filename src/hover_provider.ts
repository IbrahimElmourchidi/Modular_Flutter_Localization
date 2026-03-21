import * as vscode from 'vscode';
import * as fs from 'fs';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Provides hover tooltips for translation keys in Dart code.
 * When hovering over ML.of(context).auth.loginButton, shows all locale translations.
 */
export class TranslationHoverProvider implements vscode.HoverProvider {

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const config = getEffectiveConfig(rootPath);
        const className = config.className;

        // Get the full line and find the translation access pattern
        const line = document.lineAt(position).text;

        // Match: ClassName.of(context).module.key or ClassName.current.module.key
        const pattern = new RegExp(
            `(${escapeRegex(className)}\\s*\\.\\s*(?:of\\s*\\([^)]*\\)|current)\\s*\\.\\s*(\\w+)\\s*\\.\\s*(\\w+))`,
            'g'
        );

        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
            const matchStart = match.index;
            const matchEnd = matchStart + match[0].length;

            // Check if cursor is within this match
            if (position.character >= matchStart && position.character <= matchEnd) {
                const moduleAccessor = match[2]; // camelCase module name
                const keyName = match[3];

                return this.getTranslationHover(
                    rootPath, config, moduleAccessor, keyName,
                    new vscode.Range(position.line, matchStart, position.line, matchEnd)
                );
            }
        }

        return undefined;
    }

    private async getTranslationHover(
        rootPath: string,
        config: ReturnType<typeof getEffectiveConfig>,
        moduleAccessor: string,
        keyName: string,
        range: vscode.Range
    ): Promise<vscode.Hover | undefined> {
        const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
        const { modules } = await scanner.scanModules();

        // Find the module matching the camelCase accessor
        const module = modules.find(m => toCamelCase(m.name) === moduleAccessor);
        if (!module) {
            return undefined;
        }

        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`**${module.name}** / \`${keyName}\`\n\n`);
        md.appendMarkdown('| Locale | Translation |\n');
        md.appendMarkdown('|--------|-------------|\n');

        let foundAny = false;
        for (const arbFile of module.arbFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(arbFile.path, 'utf-8'));
                const value = data[keyName];
                if (value !== undefined) {
                    foundAny = true;
                    const displayValue = typeof value === 'string'
                        ? value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
                        : String(value);
                    const isDefault = arbFile.locale === config.defaultLocale;
                    const locale = isDefault ? `**${arbFile.locale}**` : arbFile.locale;
                    md.appendMarkdown(`| ${locale} | ${displayValue || '_(empty)_'} |\n`);
                }
            } catch { /* skip */ }
        }

        if (!foundAny) {
            return undefined;
        }

        // Add metadata if available
        const defaultArb = module.arbFiles.find(f => f.locale === config.defaultLocale);
        if (defaultArb) {
            try {
                const data = JSON.parse(fs.readFileSync(defaultArb.path, 'utf-8'));
                const meta = data[`@${keyName}`];
                if (meta?.description) {
                    md.appendMarkdown(`\n_${meta.description}_\n`);
                }
                if (meta?.placeholders) {
                    const params = Object.entries(meta.placeholders)
                        .map(([name, info]: [string, any]) => `\`${name}\`: ${info.type || 'String'}`)
                        .join(', ');
                    md.appendMarkdown(`\n**Params:** ${params}\n`);
                }
            } catch { /* skip */ }
        }

        return new vscode.Hover(md, range);
    }
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
