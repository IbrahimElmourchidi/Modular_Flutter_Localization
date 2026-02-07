import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';

export class FileWatcher {
    private watcher: chokidar.FSWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly debounceMs = 500;

    constructor(
        private rootPath: string,
        private pattern: string,
        private onChange: () => Promise<void>
    ) {}

    start(): void {
        if (this.watcher) {
            return;
        }

        const watchPath = path.join(this.rootPath, '**', 'l10n', '*.arb');

        this.watcher = chokidar.watch(watchPath, {
            ignored: [
                /(^|[\/\\])\../, // dotfiles
                /node_modules/,
                /generated/,
                /\.dart_tool/,
                /build/,
                // CRITICAL: Ignore Flutter Intl files (any intl_*.arb including intl_zh_Hans_CN.arb)
                /intl_.*\.arb$/,
            ],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        });

        this.watcher
            .on('add', (filePath) => this.handleChange('add', filePath))
            .on('change', (filePath) => this.handleChange('change', filePath))
            .on('unlink', (filePath) => this.handleChange('unlink', filePath))
            .on('error', (error) => console.error('File watcher error:', error));
    }

    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private handleChange(event: string, filePath: string): void {
        // Only react to .arb files
        if (!filePath.endsWith('.arb')) {
            return;
        }

        // CRITICAL: Skip Flutter Intl files (any file starting with intl_)
        const fileName = path.basename(filePath);
        if (/^intl_.*\.arb$/.test(fileName)) {
            console.log(`Skipping Flutter Intl file: ${fileName}`);
            return;
        }

        // Ignore generated files
        if (
            filePath.includes('generated') ||
            filePath.includes('.dart_tool') ||
            filePath.includes('build')
        ) {
            return;
        }

        // Validate that file has @@context before triggering
        if (event !== 'unlink' && !this.isModularL10nFile(filePath)) {
            console.log(`Skipping non-Modular L10n file: ${fileName}`);
            return;
        }

        console.log(`File ${event}: ${filePath}`);

        // Debounce to avoid multiple rapid regenerations
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            try {
                await this.onChange();
            } catch (error) {
                console.error('Error in onChange callback:', error);
            }
        }, this.debounceMs);
    }

    /**
     * Check if file is a Modular L10n file (has @@context property).
     * FIXED: Wrapped in try-catch for permission/read errors.
     */
    private isModularL10nFile(filePath: string): boolean {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const json = JSON.parse(content);
            return json['@@context'] !== undefined;
        } catch {
            return false;
        }
    }
}