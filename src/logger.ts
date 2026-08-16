import * as vscode from 'vscode';
import { LogLevel, LEVEL_RANK, DEFAULT_LOG_LEVEL } from './log_level';

export { LogLevel, DEFAULT_LOG_LEVEL, normalizeLogLevel } from './log_level';

/**
 * Level-aware wrapper around the extension's output channel.
 *
 * Every user-facing message goes through here so a single setting
 * (`modularL10n.logLevel` / `modular_l10n.log_level`) controls both how much
 * gets written to the Output panel and how loudly the extension interrupts
 * with notifications.
 */
export class Logger {
    private level: LogLevel = DEFAULT_LOG_LEVEL;

    constructor(private readonly channel: vscode.OutputChannel) {}

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    getLevel(): LogLevel {
        return this.level;
    }

    /** True when messages at `level` should be emitted. */
    private enabled(level: Exclude<LogLevel, 'silent'>): boolean {
        return LEVEL_RANK[this.level] >= LEVEL_RANK[level];
    }

    // ─── Output channel ──────────────────────────────────────────────────

    /** Failures. Shown at `error` and above. */
    error(message: string): void {
        if (!this.enabled('error')) return;
        this.channel.appendLine(message);
    }

    /** Recoverable problems. Shown at `warning` and above. */
    warn(message: string): void {
        if (!this.enabled('warning')) return;
        this.channel.appendLine(message);
    }

    /**
     * Short result lines worth keeping at the default level
     * ("Generated 42 keys for 3 locales"). Shown at `warning` and above.
     */
    summary(message: string): void {
        if (!this.enabled('warning')) return;
        this.channel.appendLine(message);
    }

    /** Per-file / per-key progress chatter. Only shown at `verbose`. */
    info(message: string): void {
        if (!this.enabled('verbose')) return;
        this.channel.appendLine(message);
    }

    /** Internal diagnostics. Only shown at `verbose`. */
    debug(message: string): void {
        if (!this.enabled('verbose')) return;
        this.channel.appendLine(message);
    }

    /** A blank separator line, emitted only when the given level is active. */
    blank(level: Exclude<LogLevel, 'silent'> = 'verbose'): void {
        if (!this.enabled(level)) return;
        this.channel.appendLine('');
    }

    /** A `═`-style banner. Only shown at `verbose`. */
    banner(title: string, width = 60): void {
        if (!this.enabled('verbose')) return;
        const rule = '═'.repeat(width);
        this.channel.appendLine('');
        this.channel.appendLine(rule);
        this.channel.appendLine(title);
        this.channel.appendLine(rule);
    }

    // ─── Panel reveal ────────────────────────────────────────────────────

    /**
     * Reveal the Output panel, but only when the caller's severity is within
     * the configured level. `silent` never reveals.
     */
    reveal(level: Exclude<LogLevel, 'silent'> = 'verbose'): void {
        if (!this.enabled(level)) return;
        this.channel.show(true);
    }

    // ─── Notifications ───────────────────────────────────────────────────

    /**
     * Informational toast (successes, "N files created"). Suppressed below
     * `warning` so `error` and `silent` stay out of the way.
     *
     * Returns `undefined` (no user choice) when suppressed, so callers can
     * treat the result exactly like a dismissed notification.
     */
    async notifyInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        if (!this.enabled('warning')) return undefined;
        return vscode.window.showInformationMessage(message, ...actions);
    }

    /** Warning toast. Suppressed below `warning`. */
    async notifyWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        if (!this.enabled('warning')) return undefined;
        return vscode.window.showWarningMessage(message, ...actions);
    }

    /** Error toast. Suppressed only at `silent`. */
    async notifyError(message: string, ...actions: string[]): Promise<string | undefined> {
        if (!this.enabled('error')) return undefined;
        return vscode.window.showErrorMessage(message, ...actions);
    }

    /**
     * A prompt the user must answer for the command to continue (overwrite
     * confirmations, conflict resolution, destructive actions).
     *
     * These are NOT suppressed by the log level — silencing a question would
     * change behaviour, not just verbosity.
     */
    async ask(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showWarningMessage(message, ...actions);
    }

    /** Modal variant of {@link ask}. Never suppressed. */
    async askModal(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showWarningMessage(message, { modal: true }, ...actions);
    }
}
