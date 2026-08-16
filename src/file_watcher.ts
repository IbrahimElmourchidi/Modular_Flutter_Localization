import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';
import { isInExcludedDirectory } from './module_scanner';

export class FileWatcher {
    private watcher: chokidar.FSWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly debounceMs = 500;

    constructor(
        private rootPath: string,
        private pattern: string,
        private onChange: () => Promise<void>,
        /** Level-aware trace sink. Defaults to a no-op so the watcher stays silent. */
        private trace: (message: string) => void = () => {}
    ) {}

    start(): void {
        if (this.watcher) {
            return;
        }

        // Watch the *configured* pattern, relative to the workspace root.
        //
        // Two things matter here. Hardcoding `**/l10n/*.arb` made a custom
        // `arb_dir_pattern` work for generation but silently never fire the
        // watcher. And chokidar's glob matcher only understands forward
        // slashes, so joining an absolute Windows path produced a pattern that
        // never matched anything — watch mode was dead on Windows regardless
        // of the pattern.
        this.watcher = chokidar.watch(this.pattern, {
            cwd: this.rootPath,
            ignored: [
                /(^|[\/\\])\../, // dotfiles
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
            .on('error', (error) => this.trace(`File watcher error: ${error}`));
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

    private handleChange(event: string, relativePath: string): void {
        // chokidar reports paths relative to `cwd`; work in absolute terms.
        const filePath = path.resolve(this.rootPath, relativePath);

        // Only react to .arb files
        if (!filePath.endsWith('.arb')) {
            return;
        }

        // CRITICAL: Skip Flutter Intl files (any file starting with intl_)
        const fileName = path.basename(filePath);
        if (/^intl_.*\.arb$/.test(fileName)) {
            this.trace(`Skipping Flutter Intl file: ${fileName}`);
            return;
        }

        // Ignore build output and generated files. Segment-wise, so a module
        // legitimately named e.g. `build_order` is not silently skipped.
        if (isInExcludedDirectory(filePath, this.rootPath)) {
            this.trace(`Skipping excluded directory: ${relativePath}`);
            return;
        }

        // Validate that file has @@context before triggering
        if (event !== 'unlink' && !this.isModularL10nFile(filePath)) {
            this.trace(`Skipping non-Modular L10n file: ${fileName}`);
            return;
        }

        this.trace(`File ${event}: ${filePath}`);

        // Debounce to avoid multiple rapid regenerations
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            try {
                await this.onChange();
            } catch (error) {
                this.trace(`Error in onChange callback: ${error}`);
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