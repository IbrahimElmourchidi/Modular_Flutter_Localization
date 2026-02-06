import * as chokidar from 'chokidar';
import * as path from 'path';

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
            .on('unlink', (filePath) => this.handleChange('unlink', filePath));
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

        // Ignore generated files
        if (filePath.includes('generated') || filePath.includes('.dart_tool')) {
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
}
