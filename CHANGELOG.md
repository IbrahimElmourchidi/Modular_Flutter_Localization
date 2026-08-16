# Changelog

All notable changes to the "Modular Flutter Localization" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-08-16

A correctness release. Every ICU plural, select, and compound message the
generator produced was broken at runtime; `Initialize` could destroy a
`pubspec.yaml`. Both are fixed and verified end to end.

**If you use ICU messages, regenerate after upgrading** — run
`Modular L10n: Generate Translations`. The generated output changes; your ARB
files and the `ML.of(context).module.key` API do not.

### Added

- **Log verbosity control.** New `modularL10n.logLevel` setting, and
  `modular_l10n.log_level` in `pubspec.yaml`, with four levels — `silent`,
  `error`, `warning`, `verbose`. Controls how much reaches the Output panel,
  when the panel auto-reveals, and which notifications appear.
  - `log_level` is optional in `pubspec.yaml`: omit it and your VS Code setting
    still applies.
  - Takes effect on the next command — no window reload.
  - Prompts that need an answer (overwrite confirmations, Flutter Intl conflict
    resolution, the Remove Locale confirmation) are never suppressed.
- **`enabled: false` is a real off switch.** Generation, watching, diagnostics,
  hover, go-to-definition, and the extract code action all stand down.
  `Initialize` and `Check Compatibility` keep working so a project can be
  switched back on without hand-editing YAML.
- **Generation warnings for unusable placeholders.** When a translation uses a
  placeholder the default locale doesn't declare, the Output panel names the key
  and locale instead of shipping `{foo}` to users.

### Changed

- **Quieter by default.** At the new default `warning` level the Output panel
  shows failures, warnings, and a one-line result summary per run rather than
  the full per-file trace. Set `logLevel` to `verbose` for the previous output.
- **On-save diagnostics no longer steal focus.** Saving an `.arb` still
  refreshes the Problems panel but no longer force-reveals the Output panel or
  raises a notification. The **Check Missing Translations** command is unchanged.
- **`extensionDependencies` became `extensionPack`**, so installing this
  extension no longer force-installs the Flutter extension.
- The generated main class now documents that it supports one active locale at a
  time — module accessors and `Intl.defaultLocale` are global, so nested
  `Localizations` scopes with different locales all read the most recently
  loaded one.
- Internal `console.log` / `console.warn` calls in the file watcher, ARB parser,
  and Dart generator route through the level-aware logger instead of the
  extension host console.

### Fixed — Critical

- **`Initialize` no longer damages `pubspec.yaml`.** The config section was
  located with a plain substring search for `modular_l10n:`, which also matches
  the *dependency* entry of the same name — the exact project shape this
  toolchain is built for. A regex replace anchored on that match deleted every
  dependency declared after it and wrote the config at dependency indentation,
  producing YAML that no longer parsed. `writeConfig` now edits the parsed YAML
  document, so only the top-level node is touched and surrounding comments and
  formatting survive.
- **Plural and select keys no longer crash with `StackOverflowError`.** Entries
  in the generated lookup table passed `name:` and `args:` to `Intl.plural` /
  `Intl.select`. Passing `name` is what makes `intl` perform a lookup — and the
  lookup for that name resolved back to the same closure, recursing until the
  stack blew on the first call.
- **ICU case content renders its values again.** `{count}` was converted to
  `$count` and the result then escaped, turning the interpolation into the
  literal text `\$count`. Escaping and placeholder conversion are now a single
  pass, so `other: '$count items'` renders "5 items", not "$count items".
- **Compound ICU messages work.** Messages combining several ICU expressions
  emitted their own Dart source as a string literal, and the placeholder scanner
  treated select *case bodies* as placeholders — `{gender, select, male{He}
  other{They}}` produced the parameters `He` and `They`. Case interiors are now
  skipped, and the expression is assembled from escaped literal runs plus raw
  interpolations.
- **Arguments no longer get swapped between locales.** Each locale's lookup
  closure derived its own parameter order from its own translation, while the
  caller always passed arguments in the default locale's order — and `intl`
  dispatches positionally. A translation that reorders placeholders (routine in
  Arabic, German, Japanese) silently received them transposed. The parameter
  list is now computed once from the default locale and reused everywhere.

### Fixed

- **Placeholder metadata is no longer lost.** ARB files were read in glob order,
  so a locale sorting before the default one (`ar` before `en`) created each key
  first with no metadata, and the default locale's `@key` block was then never
  read. Every parameter degraded to `Object` and all `NumberFormat` /
  `DateFormat` directives were dropped. The default-locale file is read first.
- **Parameterized fallback strings interpolate.** `Intl.message` received the
  raw ARB text, so an unsupported locale — or any call before
  `initializeModularMessages` resolved — rendered `Hello {name}` to the user.
- **The file watcher honours `arb_dir_pattern`.** It hardcoded `**/l10n/*.arb`
  and ignored the configured pattern, so custom layouts had generation but no
  watch mode. It also joined an absolute path into the glob, which never matched
  on Windows — watch mode was effectively dead there.
- **`pubspec.yaml` config merges per key.** A `modular_l10n:` block replaced the
  entire configuration, so specifying only `class_name` silently reset
  `output_dir`, `default_locale`, and the rest to built-in defaults instead of
  the developer's VS Code settings — contradicting the documented precedence.
- **Directory exclusions match path segments, not substrings.**
  `lib/features/generated_reports/l10n/` and `lib/features/build_order/l10n/`
  were silently skipped, and a project checked out under a directory named
  `build` or `generated` had its entire workspace excluded.
- **Locale resolution in the generated delegate.** `isSupported` matched on
  language alone but then handed `load()` the *device* locale, for which no
  message table is registered. The delegate resolves to the closest supported
  locale first.
- **The hardcoded-string scan no longer leaks.** Each run created a
  `DiagnosticCollection` that was never disposed or registered, so stale
  findings accumulated in the Problems panel with no way to clear them.
- **Combined ARB files stop churning git.** `@@last_modified` carried a full ISO
  timestamp that changed on every run; it is now a date, and generated files are
  only written when their content actually differs.
- **`pubspec.yaml` edits apply without a window reload.**
  `onDidChangeConfiguration` only fires for VS Code settings, so changing
  `watch_mode` or `arb_dir_pattern` in pubspec did nothing until restart.
- **The "Change to ML" prompt in `Initialize` does something.** The branch body
  was empty and `finalClassName` was assigned the same value on both sides of
  its ternary.
- **Generated Dart passes `flutter_lints` cleanly** — verified with
  `flutter analyze` on the example app. Imports are ordered, the unused
  `MessageIfAbsent` typedef is gone, `package:intl/intl.dart` is imported only
  when an entry uses it, and the `ignore_for_file` header covers
  `implementation_imports` and `library_prefixes`.
- **Packaging.** `.vscodeignore` now excludes `*.vsix` and `publish.sh` — three
  stale VSIXs, 1.1 MB combined, would have shipped inside the next package — and
  `package` / `publish` run `npm ci` first, so the build no longer fails on a
  `node_modules` tree copied from another platform.

## [3.0.2] - 2026-03-21

### Fixed

- **Check Missing Translations**: Command now shows proper feedback when no modules are found, instead of silently doing nothing
- **Diagnostics Severity**: Missing translations now show as errors (not warnings) in the Problems panel for better visibility
- **Empty Translations**: Empty translation values now show as warnings instead of info hints
- **Output Panel**: Output channel now opens automatically when running diagnostics

## [3.0.0] - 2026-03-21

### Added

- **Smart String Detection**: Extract to ARB now works with just the cursor placed inside a string — no need to select the full string. Supports single/double quotes, triple-quoted strings, raw strings (`r'...'`), and properly handles escape characters.
- **Dart Interpolation to ARB Placeholders**: Strings with `$variable` or `${expression}` are automatically converted to ARB `{variable}` placeholders with metadata.
- **Missing Translation Diagnostics**: Warnings appear in the Problems panel when keys are missing or empty in non-default locales. Auto-runs on ARB file save.
- **Hardcoded String Scanner**: New command scans `lib/` for user-facing hardcoded strings in `Text()`, `label:`, `title:`, etc. Reports results in Output and Problems panels.
- **Inline Translation Hover**: Hover over `ML.of(context).module.key` to see all locale translations in a tooltip table.
- **Go to ARB Definition**: Ctrl+Click on a translation key navigates to the corresponding entry in the default locale ARB file.
- **Sort ARB Keys**: New command sorts keys alphabetically in ARB files, keeping `@key` metadata adjacent and `@@` meta keys at the top. Supports per-module or all-modules scope.
- **Find Unused Keys**: New command scans Dart code for unreferenced translation keys, with an option to bulk-remove them.
- **Rename Translation Key**: Rename a key across all ARB locale files and all Dart code references in one action.
- **Export Translations (CSV/XLIFF)**: Export translations to CSV or XLIFF 1.2 format for external translators.
- **Import Translations (CSV/XLIFF)**: Import translated CSV or XLIFF files back into ARB structure.
- **Pseudo-Localization Generator**: Generate a pseudo-locale (e.g., `en_XA`) with accented characters, text expansion, and bracket wrapping to test UI layout.

### New Commands

- `Modular L10n: Check Missing Translations`
- `Modular L10n: Scan Hardcoded Strings`
- `Modular L10n: Sort ARB Keys`
- `Modular L10n: Find Unused Keys`
- `Modular L10n: Rename Translation Key`
- `Modular L10n: Export Translations (CSV/XLIFF)`
- `Modular L10n: Import Translations (CSV/XLIFF)`
- `Modular L10n: Generate Pseudo-Locale`

## [1.0.2] - 2025-01-12

### Added
- **Context Menu Support**: Right-click any folder in Explorer → "New L10n Module" to instantly create l10n folder with ARB files
- **Auto-Detect Locales**: Locales are now automatically detected from ARB files - no manual configuration needed
- **Content-Based Detection**: ARB files are identified by `@@locale` and `@@context` properties instead of filename patterns
- **Locale Validation**: 170+ valid locales supported with clear error messages for invalid ones
- **Smart Module Creation**: When creating a new module, existing locales are automatically detected and pre-filled
- **Rich Console Output**: Improved logging with emojis, formatting, and detailed statistics

### Changed
- `supportedLocales` setting removed - locales are now auto-detected from ARB files
- Module scanning now uses file content (`@@locale`, `@@context`) instead of filename patterns
- Better error messages when ARB files are missing required properties

### Fixed
- TypeScript strict mode compatibility in `dart_generator.ts`
- Improved placeholder extraction in `arb_parser.ts`

## [1.0.1] - 2024-01-15
- fixed the command issues
## [1.0.0] - 2024-01-15

### Added

- 🎉 Initial release
- 📦 Modular organization - keep translations alongside feature code
- 🔄 Watch mode with automatic code generation on file changes
- 🌍 Full RTL support for Arabic, Hebrew, and other RTL languages
- 🧩 Easy module reuse across projects
- 📝 Type-safe generated Dart code
- 🎯 Nested access API (`S.auth.email` instead of flat keys)
- 🔢 ICU message format support for pluralization
- ⚙️ Configurable output path, supported locales, and class name
- 🛠️ Commands for generating translations, adding keys, and creating modules

### Commands

- `Modular L10n: Generate Translations` - Regenerate all translation files
- `Modular L10n: Add Translation Key` - Add a new key to a specific module
- `Modular L10n: Create New Module` - Create a new feature module with l10n scaffold

### Configuration Options

- `modularL10n.outputPath` - Output path for generated Dart files
- `modularL10n.supportedLocales` - List of supported locale codes
- `modularL10n.defaultLocale` - Default locale code
- `modularL10n.arbFilePattern` - Glob pattern to find ARB files
- `modularL10n.watchMode` - Watch for file changes and auto-generate
- `modularL10n.generateCombinedArb` - Generate combined ARB files
- `modularL10n.className` - Name of the generated localization class
