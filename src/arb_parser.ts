import * as fs from 'fs';
import { Module, ArbFile } from './module_scanner';

export interface TranslationKey {
    key: string;
    translations: Record<string, string>;
    description?: string;
    placeholders?: Record<string, PlaceholderInfo>;
}

export interface PlaceholderInfo {
    type?: string;
    example?: string;
    format?: string;
    optionalParameters?: Record<string, string>;
}

export interface ParsedModule {
    name: string;
    path: string;
    keys: TranslationKey[];
}

export class ArbParser {
    async parseModules(modules: Module[], supportedLocales: string[]): Promise<ParsedModule[]> {
        const parsedModules: ParsedModule[] = [];
        for (const module of modules) {
            const keys = await this.parseModule(module, supportedLocales);
            parsedModules.push({
                name: module.name,
                path: module.path,
                keys,
            });
        }
        return parsedModules;
    }

    private async parseModule(module: Module, supportedLocales: string[]): Promise<TranslationKey[]> {
        const keysMap: Map<string, TranslationKey> = new Map();

        for (const arbFile of module.arbFiles) {
            const content = await this.readArbFile(arbFile.path);
            for (const [key, value] of Object.entries(content)) {
                // Skip metadata keys
                if (key.startsWith('@@') || key.startsWith('@')) {
                    continue;
                }

                if (!keysMap.has(key)) {
                    // Check for metadata
                    const metadataKey = `@${key}`;
                    const metadata = content[metadataKey] as Record<string, unknown> | undefined;

                    keysMap.set(key, {
                        key,
                        translations: {},
                        description: metadata?.description as string | undefined,
                        placeholders: this.parsePlaceholders(metadata?.placeholders as Record<string, unknown> | undefined),
                    });
                }

                keysMap.get(key)!.translations[arbFile.locale] = value as string;
            }
        }

        return Array.from(keysMap.values());
    }

    private async readArbFile(filePath: string): Promise<Record<string, unknown>> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`Error reading ARB file ${filePath}:`, error);
            return {};
        }
    }

    private parsePlaceholders(
        placeholders: Record<string, unknown> | undefined
    ): Record<string, PlaceholderInfo> | undefined {
        if (!placeholders) {
            return undefined;
        }

        const result: Record<string, PlaceholderInfo> = {};
        for (const [name, info] of Object.entries(placeholders)) {
            const placeholderInfo = info as Record<string, unknown>;
            result[name] = {
                type: placeholderInfo.type as string | undefined,
                example: placeholderInfo.example as string | undefined,
                format: placeholderInfo.format as string | undefined,
                optionalParameters: placeholderInfo.optionalParameters as Record<string, string> | undefined,
            };
        }
        return result;
    }

    /**
     * Extract placeholders from a translation string
     * e.g., "Hello {name}" -> ["name"]
     */
    static extractPlaceholders(text: string): string[] {
        const regex = /\{([^}]+)\}/g;
        const placeholders: string[] = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            placeholders.push(match[1]);
        }
        return placeholders;
    }

    /**
     * Check if a translation has ICU message syntax (plural, select, etc.)
     */
    static hasIcuSyntax(text: string): boolean {
        return /\{[^}]+,\s*(plural|select|selectordinal)\s*,/.test(text);
    }

    // static hasIcuSyntax(text: string): boolean {
    //     return /\{[^}]+,\s*(plural|select)\s*,/.test(text);
    // }
}