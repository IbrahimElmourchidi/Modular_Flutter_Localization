import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ModuleScanner } from './module_scanner';
import { getEffectiveConfig } from './extension';
import { Logger } from './logger';

/**
 * Scans for translation keys that exist in ARB files but are never referenced in Dart code.
 */
export async function findUnusedKeys(logger: Logger): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        await logger.notifyError('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = getEffectiveConfig(rootPath);
    const scanner = new ModuleScanner(rootPath, config.arbFilePattern);
    const { modules } = await scanner.scanModules();

    if (modules.length === 0) {
        await logger.notifyInfo('No modules found.');
        return;
    }

    logger.reveal('warning');
    logger.summary('--- Scanning for unused translation keys ---');

    // Read all Dart files in lib/
    const libPath = path.join(rootPath, 'lib');
    if (!fs.existsSync(libPath)) {
        await logger.notifyError('No lib/ directory found');
        return;
    }

    const dartFiles = await findDartFiles(libPath);
    let allDartContent = '';

    for (const dartFile of dartFiles) {
        // Skip generated files
        if (dartFile.includes('generated') ||
            dartFile.includes('.g.dart') ||
            dartFile.includes('.freezed.dart')) {
            continue;
        }
        try {
            allDartContent += fs.readFileSync(dartFile, 'utf-8') + '\n';
        } catch { /* skip */ }
    }

    let totalUnused = 0;
    const unusedByModule: Map<string, string[]> = new Map();

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Scanning for unused keys...',
            cancellable: false,
        },
        async (progress) => {
            for (let i = 0; i < modules.length; i++) {
                const module = modules[i];
                progress.report({
                    increment: (1 / modules.length) * 100,
                    message: `Module: ${module.name}`,
                });

                const camelName = toCamelCase(module.name);

                // Get all keys from the default locale ARB file
                const defaultArb = module.arbFiles.find(f => f.locale === config.defaultLocale);
                if (!defaultArb) { continue; }

                let arbData: Record<string, unknown>;
                try {
                    arbData = JSON.parse(fs.readFileSync(defaultArb.path, 'utf-8'));
                } catch { continue; }

                const keys = Object.keys(arbData).filter(k => !k.startsWith('@'));
                const unusedKeys: string[] = [];

                for (const key of keys) {
                    // Search for the key being used in Dart code
                    // Patterns: .moduleName.keyName or accessor pattern
                    const usagePattern = new RegExp(
                        `\\.${escapeRegex(camelName)}\\.${escapeRegex(key)}\\b`
                    );

                    if (!usagePattern.test(allDartContent)) {
                        unusedKeys.push(key);
                    }
                }

                if (unusedKeys.length > 0) {
                    unusedByModule.set(module.name, unusedKeys);
                    totalUnused += unusedKeys.length;
                }
            }
        }
    );

    if (totalUnused === 0) {
        logger.summary('All translation keys are in use.');
        await logger.notifyInfo('All translation keys are in use!');
        return;
    }

    logger.summary(`\nFound ${totalUnused} potentially unused key(s):\n`);

    for (const [moduleName, keys] of unusedByModule) {
        logger.summary(`Module "${moduleName}":`);
        for (const key of keys) {
            logger.summary(`  - ${key}`);
        }
        logger.blank('warning');
    }

    // Offer to remove unused keys
    const removeAction = await logger.ask(
        `Found ${totalUnused} potentially unused key(s) across ${unusedByModule.size} module(s). ` +
        'Note: some keys may be used dynamically. Review the Output panel before removing.',
        'Remove All Unused', 'Cancel'
    );

    if (removeAction === 'Remove All Unused') {
        let removedCount = 0;

        for (const module of modules) {
            const unusedKeys = unusedByModule.get(module.name);
            if (!unusedKeys || unusedKeys.length === 0) { continue; }

            for (const arbFile of module.arbFiles) {
                try {
                    const content = fs.readFileSync(arbFile.path, 'utf-8');
                    const arbData = JSON.parse(content);

                    for (const key of unusedKeys) {
                        if (arbData[key] !== undefined) {
                            delete arbData[key];
                            delete arbData[`@${key}`]; // Also remove metadata
                            removedCount++;
                        }
                    }

                    fs.writeFileSync(arbFile.path, JSON.stringify(arbData, null, 2), 'utf-8');
                } catch (error) {
                    logger.error(`Error updating ${arbFile.path}: ${error}`);
                    logger.reveal('error');
                }
            }
        }

        logger.summary(`Removed ${removedCount} key entries from ARB files.`);
        await logger.notifyInfo(`Removed ${removedCount} unused key entries.`);

        // Regenerate
        vscode.commands.executeCommand('modularL10n.generate');
    }
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
