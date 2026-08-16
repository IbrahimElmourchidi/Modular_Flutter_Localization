/**
 * Log-level vocabulary, kept free of any `vscode` import so config parsing
 * (and tests) can use it without the extension host.
 */

/**
 * Log verbosity levels, ordered from quietest to loudest.
 *
 * - `silent`  — nothing is written to the output channel, the panel never
 *               auto-reveals, and no notifications are shown at all.
 * - `error`   — only failures. The panel reveals itself when one occurs.
 * - `warning` — failures, warnings, and one-line result summaries (default).
 * - `verbose` — everything, including per-file and per-key progress.
 */
export type LogLevel = 'silent' | 'error' | 'warning' | 'verbose';

export const LEVEL_RANK: Record<LogLevel, number> = {
    silent: 0,
    error: 1,
    warning: 2,
    verbose: 3,
};

export const DEFAULT_LOG_LEVEL: LogLevel = 'warning';

/**
 * Normalize an arbitrary value (VS Code setting or pubspec.yaml value) into a
 * valid LogLevel. Accepts a few friendly aliases so `log_level: errors` or
 * `log_level: heavy` do what the user expects instead of silently falling back.
 */
export function normalizeLogLevel(
    value: unknown,
    fallback: LogLevel = DEFAULT_LOG_LEVEL
): LogLevel {
    if (typeof value !== 'string') {
        return fallback;
    }

    switch (value.trim().toLowerCase()) {
        case 'silent':
        case 'none':
        case 'off':
        case 'quiet':
            return 'silent';
        case 'error':
        case 'errors':
            return 'error';
        case 'warn':
        case 'warning':
        case 'warnings':
            return 'warning';
        case 'verbose':
        case 'heavy':
        case 'debug':
        case 'all':
        case 'info':
            return 'verbose';
        default:
            return fallback;
    }
}
