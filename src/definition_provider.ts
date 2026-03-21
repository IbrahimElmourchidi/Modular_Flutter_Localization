import * as vscode from 'vscode';
import * as fs from 'fs';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';

/**
 * Provides "Go to Definition" for translation keys.
 * Ctrl+Click on ML.of(context).auth.loginButton navigates to the ARB file entry.
 */
export class TranslationDefinitionProvider implements vscode.DefinitionProvider {

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const config = getEffectiveConfig(rootPath);
        const className = config.className;

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

            if (position.character >= matchStart && position.character <= matchEnd) {
                const moduleAccessor = match[2];
                const keyName = match[3];

                return this.findDefinition(rootPath, config, moduleAccessor, keyName);
            }
        }

        return undefined;
    }

    private async findDefinition(
        rootPath: string,
        config: ReturnType<typeof getEffectiveConfig>,
        moduleAccessor: string,
        keyName: string
    ): Promise<vscode.Location | undefined> {
        const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
        const { modules } = await scanner.scanModules();

        const module = modules.find(m => toCamelCase(m.name) === moduleAccessor);
        if (!module) {
            return undefined;
        }

        // Navigate to the default locale ARB file
        const defaultArbFile = module.arbFiles.find(f => f.locale === config.defaultLocale);
        if (!defaultArbFile) {
            // Fallback to first available ARB file
            if (module.arbFiles.length === 0) { return undefined; }
            return this.findKeyInFile(module.arbFiles[0].path, keyName);
        }

        return this.findKeyInFile(defaultArbFile.path, keyName);
    }

    private findKeyInFile(filePath: string, keyName: string): vscode.Location | undefined {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const keyPattern = `"${keyName}"`;

            for (let i = 0; i < lines.length; i++) {
                const col = lines[i].indexOf(keyPattern);
                if (col !== -1 && !lines[i].includes(`"@${keyName}"`)) {
                    return new vscode.Location(
                        vscode.Uri.file(filePath),
                        new vscode.Position(i, col)
                    );
                }
            }

            // Key not found at specific line, navigate to file start
            return new vscode.Location(
                vscode.Uri.file(filePath),
                new vscode.Position(0, 0)
            );
        } catch {
            return undefined;
        }
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
