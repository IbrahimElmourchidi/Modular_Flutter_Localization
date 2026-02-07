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
    isCustomDateFormat?: string;
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
            const content = this.readArbFile(arbFile.path);
            for (const [key, value] of Object.entries(content)) {
                // Skip metadata keys and Flutter Intl specific keys
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

    /**
     * Read and parse an ARB file (synchronous - no need for async wrapper)
     */
    private readArbFile(filePath: string): Record<string, unknown> {
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
                isCustomDateFormat: placeholderInfo.isCustomDateFormat as string | undefined,
                optionalParameters: placeholderInfo.optionalParameters as Record<string, string> | undefined,
            };
        }
        return result;
    }

    /**
     * Extract placeholders from a translation string.
     * Handles complex ICU messages with nested braces.
     * e.g., "Hello {name}" -> ["name"]
     * e.g., "{count, plural, =0{none} other{{count} items}}" -> ["count"]
     */
    static extractPlaceholders(text: string): string[] {
        const placeholders: Set<string> = new Set();

        // First pass: extract ICU message variable names
        const icuVars: Set<string> = new Set();
        const icuPattern = /\{(\w+)\s*,\s*(plural|select|selectordinal)\s*,/g;
        let match;
        while ((match = icuPattern.exec(text)) !== null) {
            icuVars.add(match[1]);
            placeholders.add(match[1]);
        }

        // Second pass: walk through the string tracking brace depth
        // to find simple {varName} placeholders that are NOT inside ICU case content
        let i = 0;
        while (i < text.length) {
            if (text[i] === '{') {
                // Try to match a simple placeholder {word}
                const simpleMatch = text.substring(i).match(/^\{(\w+)\}/);
                if (simpleMatch) {
                    const varName = simpleMatch[1];
                    // Check if this is the start of an ICU expression
                    const icuStartMatch = text.substring(i).match(/^\{(\w+)\s*,\s*(plural|select|selectordinal)\s*,/);
                    if (icuStartMatch) {
                        // This is an ICU variable, already added above — skip past the ICU block
                        i = this.skipIcuBlock(text, i);
                        continue;
                    }
                    // Check if we're inside an ICU block (nested reference)
                    // ICU variables referenced inside their own block should still be added
                    if (!icuVars.has(varName) || !this.isInsideIcuBlock(text, i)) {
                        placeholders.add(varName);
                    } else {
                        // It's a nested reference to the ICU variable (e.g., {count} inside plural cases)
                        // Already added from the first pass
                    }
                    i += simpleMatch[0].length;
                    continue;
                }
            }
            i++;
        }

        return Array.from(placeholders);
    }

    /**
     * Skip past an entire ICU block starting at position, returning the index after the closing brace.
     */
    private static skipIcuBlock(text: string, startPos: number): number {
        let braceDepth = 0;
        for (let i = startPos; i < text.length; i++) {
            if (text[i] === '{') {
                braceDepth++;
            } else if (text[i] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    return i + 1;
                }
            }
        }
        return text.length;
    }

    /**
     * Check if a position in the text is inside an ICU message block.
     */
    private static isInsideIcuBlock(text: string, position: number): boolean {
        let braceDepth = 0;
        let inIcu = false;

        for (let i = 0; i < position; i++) {
            if (text[i] === '{') {
                braceDepth++;
                const remaining = text.substring(i);
                if (/^\{\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(remaining)) {
                    inIcu = true;
                }
            } else if (text[i] === '}') {
                braceDepth--;
                if (braceDepth === 0) {
                    inIcu = false;
                }
            }
        }

        return braceDepth > 0 && inIcu;
    }

    /**
     * Check if a translation has ICU message syntax (plural, select, selectordinal)
     */
    static hasIcuSyntax(text: string): boolean {
        return /\{\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(text);
    }

    /**
     * Determine the type of ICU message (plural, select, selectordinal).
     * Returns the type of the FIRST ICU expression found.
     */
    static getIcuType(text: string): 'plural' | 'select' | 'selectordinal' | null {
        const match = text.match(/\{\w+\s*,\s*(plural|select|selectordinal)\s*,/);
        return match ? (match[1] as 'plural' | 'select' | 'selectordinal') : null;
    }

    /**
     * Extract all ICU segments from a message string.
     * Each segment represents one {var, plural/select/selectordinal, ...} block.
     */
    static getIcuSegments(text: string): {
        variable: string;
        type: 'plural' | 'select' | 'selectordinal';
        start: number;
        end: number;
        raw: string;
    }[] {
        const segments: {
            variable: string;
            type: 'plural' | 'select' | 'selectordinal';
            start: number;
            end: number;
            raw: string;
        }[] = [];

        const pattern = /\{(\w+)\s*,\s*(plural|select|selectordinal)\s*,/g;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const start = match.index;
            let braceDepth = 0;
            let end = start;
            for (let i = start; i < text.length; i++) {
                if (text[i] === '{') braceDepth++;
                else if (text[i] === '}') {
                    braceDepth--;
                    if (braceDepth === 0) {
                        end = i + 1;
                        break;
                    }
                }
            }
            segments.push({
                variable: match[1],
                type: match[2] as 'plural' | 'select' | 'selectordinal',
                start,
                end,
                raw: text.substring(start, end),
            });
        }

        return segments;
    }

    /**
     * Check if a message contains multiple ICU expressions (compound message).
     * e.g., "{gender, select, male{He} other{They}} has {count, plural, one{1 item} other{{count} items}}"
     */
    static isCompoundMessage(text: string): boolean {
        return this.getIcuSegments(text).length > 1;
    }

    /**
     * Validate ICU message syntax.
     * Returns true if the ICU message is well-formed.
     */
    static validateIcuSyntax(text: string): { valid: boolean; error?: string } {
        if (!this.hasIcuSyntax(text)) {
            return { valid: true };
        }

        // Check for balanced braces
        let braceCount = 0;
        for (const char of text) {
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;

            if (braceCount < 0) {
                return { valid: false, error: 'Unmatched closing brace' };
            }
        }

        if (braceCount !== 0) {
            return { valid: false, error: 'Unmatched opening brace' };
        }

        // Check for required ICU parts based on type
        const icuType = this.getIcuType(text);
        if (icuType === 'plural' || icuType === 'selectordinal') {
            if (!text.includes('other{')) {
                return { valid: false, error: `ICU ${icuType} message missing required 'other' case` };
            }
        }

        return { valid: true };
    }

    /**
     * Extract the ordered placeholder names from metadata.
     * This ensures parameter order matches the ARB specification.
     */
    static getOrderedPlaceholders(
        text: string,
        metadata?: Record<string, PlaceholderInfo>
    ): string[] {
        if (!metadata) {
            return this.extractPlaceholders(text);
        }

        const orderedKeys = Object.keys(metadata);
        if (orderedKeys.length > 0) {
            return orderedKeys;
        }

        return this.extractPlaceholders(text);
    }
}