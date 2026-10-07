import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EffectiveConfig } from './pubspec_config';
import { getEffectiveConfig } from './extension';
import { toSnakeCaseName } from './dart_generator';

/**
 * Flags `import '…/<module>_l10n.dart'` in hand-written code.
 *
 * In the default `part` layout a module file is part of the entry-point
 * library, so importing one is a compile error — but the analyzer's message
 * ("Expected a library, got a part file") says nothing about what to do next.
 * This names the fix: import the entry point and reach the module through
 * `ML.of(context).<module>`, which also keeps the widget subscribed to locale
 * changes instead of reading whatever the last `ML.load` left in a static.
 */

/**
 * Single shared collection for direct-import warnings.
 *
 * Created lazily and reused, so repeated checks replace their findings instead
 * of stacking a new undisposable collection into the Problems panel.
 * Registered via {@link disposeDirectImportDiagnostics} on deactivate.
 */
let directImportDiagnostics: vscode.DiagnosticCollection | undefined;

function getDirectImportDiagnostics(): vscode.DiagnosticCollection {
    directImportDiagnostics ??= vscode.languages.createDiagnosticCollection(
        'modularL10n.directImport'
    );
    return directImportDiagnostics;
}

/** Dispose the shared collection. Called from the extension's deactivate(). */
export function disposeDirectImportDiagnostics(): void {
    directImportDiagnostics?.dispose();
    directImportDiagnostics = undefined;
}

/**
 * A module-class import found in one file.
 */
export interface DirectImportFinding {
    /** Zero-based line of the import directive. */
    line: number;
    /** Range of the quoted URI, for the diagnostic and the fix's edit range. */
    start: number;
    end: number;
    /** The module file being imported, e.g. `wishlist_l10n.dart`. */
    fileName: string;
}

/**
 * Path of the generated entry point for this project, as a bare file name.
 *
 * Module files end in `_l10n.dart`; the entry point (`ml.dart` or whatever
 * `class_name` is set to) and the barrel (`l10n.dart`) do not, so the suffix
 * test below distinguishes them without depending on `className`.
 */
const MODULE_FILE_RE = /^[a-z0-9_]+_l10n\.dart$/;

/** Matches one `import`/`export`/`part` URI, capturing line and columns. */
const DIRECTIVE_RE = /^[ \t]*(?:import|export|part)\s+['"]([^'"]+)['"]/gm;

/**
 * Path of the generated entry point for this project.
 */
function entryPointFile(config: EffectiveConfig): string {
    return `${toSnakeCaseName(config.className)}.dart`;
}

/**
 * Resolve an import URI to an absolute path, or null if it isn't ours.
 *
 * Relative URIs resolve against the importing file, `package:` URIs against
 * `lib/` — the only two forms the generator's output can be reached through.
 * Returns null for anything unresolved (a bare identifier package, a URI that
 * doesn't exist on disk), which is the common case in a workspace full of
 * third-party imports and must stay cheap to reject.
 */
function resolveGeneratedFile(
    uri: string,
    documentUri: vscode.Uri,
    rootPath: string,
    config: EffectiveConfig
): string | null {
    const libPath = path.join(rootPath, 'lib');
    let absolute: string | undefined;

    if (uri.startsWith('package:')) {
        // Drop the scheme *and* the package name: `package:app/lib/x.dart`
        // refers to `<root>/lib/x.dart`, not `<root>/lib/app/lib/x.dart`.
        const segments = uri.slice('package:'.length).split('/');
        if (segments.length < 2) {
            return null;
        }
        segments.shift();
        absolute = path.join(libPath, ...segments);
    } else if (uri.startsWith('.') || uri.startsWith('/')) {
        absolute = path.resolve(
            path.dirname(documentUri.fsPath),
            ...(uri.startsWith('/') ? [uri.slice(1)] : uri.split('/'))
        );
    } else {
        return null;
    }

    const generatedDir = path.join(rootPath, config.outputPath);
    const relative = path.relative(generatedDir, absolute);
    // A path outside the output directory escapes with `..`.
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }
    // `relative` is nested inside the output dir only if it names a file there.
    if (path.dirname(relative) !== '.') {
        return null;
    }
    return relative;
}

/**
 * Find every direct module-class import in one document.
 *
 * Scans the document's own text only — no filesystem walk — because this runs
 * on every Dart save. Files inside the output directory are skipped: their
 * imports are the generated wiring, which is correct by construction.
 */
export function findDirectModuleImports(
    document: vscode.TextDocument,
    rootPath: string,
    config: EffectiveConfig
): DirectImportFinding[] {
    const findings: DirectImportFinding[] = [];

    if (!document.fileName.endsWith('.dart')) {
        return findings;
    }

    // In `library` mode direct module imports are the configured layout, so
    // warning about them would contradict the project's own setting.
    if (config.moduleAccess !== 'part') {
        return findings;
    }

    const generatedDir = path.join(rootPath, config.outputPath);
    const relativeToGenerated = path.relative(generatedDir, document.uri.fsPath);
    if (!relativeToGenerated.startsWith('..')) {
        return findings;
    }

    const text = document.getText();
    let match: RegExpExecArray | null;
    DIRECTIVE_RE.lastIndex = 0;

    while ((match = DIRECTIVE_RE.exec(text)) !== null) {
        const uri = match[1];
        const quoteStart = match.index + match[0].indexOf(uri) - 1;
        const resolved = resolveGeneratedFile(uri, document.uri, rootPath, config);

        if (!resolved || !MODULE_FILE_RE.test(resolved)) {
            continue;
        }

        findings.push({
            line: document.positionAt(match.index).line,
            start: quoteStart,
            end: quoteStart + uri.length + 2,
            fileName: resolved,
        });
    }

    return findings;
}

/**
 * Re-check one document and update its diagnostics.
 *
 * Always replaces the file's entry rather than appending, so a fixed import
 * clears the warning on the next save.
 */
export function checkDocumentForDirectImports(
    document: vscode.TextDocument,
    rootPath: string,
    config: EffectiveConfig
): void {
    const findings = findDirectModuleImports(document, rootPath, config);
    const collection = getDirectImportDiagnostics();

    if (findings.length === 0) {
        collection.delete(document.uri);
        return;
    }

    const diagnostics = findings.map((finding) => {
        const range = new vscode.Range(
            new vscode.Position(finding.line, finding.start),
            document.positionAt(finding.end)
        );
        const diag = new vscode.Diagnostic(
            range,
            `Do not import '${finding.fileName}' directly. Import '${entryPointFile(config)}' ` +
                `and read strings through ${config.className}.of(context).<module>.`,
            vscode.DiagnosticSeverity.Warning
        );
        diag.source = 'Modular L10n';
        diag.code = 'direct-module-import';
        return diag;
    });

    collection.set(document.uri, diagnostics);
}

/**
 * Quick-fix provider for `direct-module-import`: repoint the import at the
 * generated entry point.
 *
 * Repointing alone is enough for the common case, where a module class was
 * imported only to type a parameter — the class name still resolves through
 * the entry point, because `l10n.dart` re-exports it. Code that used
 * `XxxL10n.instance` or `.load` still has to switch to
 * `ML.of(context)`/`ML.current`, which no import rewrite can do.
 */
export class DirectImportCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            return [];
        }

        const rootPath = folders[0].uri.fsPath;
        const config = getEffectiveConfig(rootPath);
        if (!config.enabled || token.isCancellationRequested) {
            return [];
        }

        const entryPointPath = path.join(rootPath, config.outputPath, entryPointFile(config));
        // Don't offer a fix that would leave a dangling import.
        if (!fs.existsSync(entryPointPath)) {
            return [];
        }

        const entryUri = path
            .relative(path.dirname(document.uri.fsPath), entryPointPath)
            .split(path.sep)
            .join('/');

        return findDirectModuleImports(document, rootPath, config)
            .filter((finding) => {
                const line = document.lineAt(finding.line);
                return range.intersection(
                    new vscode.Range(
                        new vscode.Position(finding.line, 0),
                        new vscode.Position(finding.line, line.text.length)
                    )
                ) !== undefined;
            })
            .map((finding) => {
                const action = new vscode.CodeAction(
                    `Import '${entryUri}' instead`,
                    vscode.CodeActionKind.QuickFix
                );
                action.isPreferred = true;
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(
                        new vscode.Position(finding.line, finding.start),
                        new vscode.Position(finding.line, finding.end)
                    ),
                    `'${entryUri}'`
                );
                action.edit = edit;
                action.diagnostics = [
                    new vscode.Diagnostic(
                        new vscode.Range(
                            new vscode.Position(finding.line, finding.start),
                            new vscode.Position(finding.line, finding.end)
                        ),
                        '',
                        vscode.DiagnosticSeverity.Warning
                    ),
                ];
                return action;
            });
    }
}
