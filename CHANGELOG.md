# Changelog

All notable changes to the "Modular Flutter Localization" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.2.0] - 2026-10-08

ICU correctness, in two parts: the fixes that were making generated code wrong or
uncompilable, then real ordinal support.

### Breaking

**Some method signatures change.** A message with text around a `plural` used to
lose that text and the placeholders in it, silently. It now keeps both, which
means the method takes an extra argument.

```dart
// app_en.arb:  "{name} has {count, plural, one{1 item} other{{count} items}}"
l10n.textAroundPlural(5);      // before: rendered "5 items" — "Ada has" was dropped
l10n.textAroundPlural('Ada', 5); // now
```

Search your code for messages that place a plural or select in the middle of a
sentence and update the call sites. Two more, smaller changes:

- A plural argument is now `num` rather than `int`, matching gen_l10n. Source
  compatible — passing an `int` still works.
- A placeholder declared `"type": "bool"` is now `bool` rather than `Object`.

### Fixed

Messages that did not compile:

- **A `plural` inside a `plural`.** The inner block's cases were read as the outer
  one's, producing `Undefined name 'd'`.
- **A case name inside a word.** `{n, plural, other{Someone{ commented}}}` matched
  the substring `one{` inside "Someone{" and emitted garbage. Cases are now found
  by parsing, not by substring search.
- **A `select` without `other`.** `Intl.select`'s and `Intl.plural`'s `other` is a
  *required* named parameter, so this was a compile error. `other` is now
  synthesized from the first case and the problem is reported as a diagnostic.

Messages that compiled but rendered wrong:

- **`#` in a plural body** rendered as a literal `#`. `{count, plural, one{# item}
  other{# items}}` now renders `1 item` / `5 items`.
- **`offset:n` was ignored.** It is now applied: exact `=N` selectors match the
  raw value, categories and `#` use the value minus the offset, per ICU.
- **`=N` beyond `=0`/`=1`/`=2` was silently dropped.** Any `=N` now works, and is
  emitted as an equality test rather than folded into `one`/`two` — folding is why
  Russian 21 read "exactly one".
- **`''` rendered as two apostrophes.** `It''s` now reads `It's`. ICU quoting is
  implemented, so `'{name}'` is the literal text `{name}` and no longer an
  interpolation.
- **A `select` nested in a `plural`** was emitted as literal ICU text and shown to
  the user. `#` inside such a nested `select` correctly resolves against the
  enclosing plural's value.
- **A locale with a different ICU shape from the template** threw
  `NoSuchMethodError` on first use. The template translation is used instead and
  the mismatch is reported.
- **A hyphenated `@@locale`** such as `zh-Hans` was accepted by the scanner but
  generated `Locale('zh-Hans')`, which is not a valid `Locale`, so that locale's
  translations never loaded. `@@locale` is now normalised to `zh_Hans` on the way
  in, and the default-locale setting is normalised too so the two compare equal.
  Two files that collide after normalisation are reported.

`gen_l10n` treats a literal `#` outside a plural as ordinary text, and so does
this extension: `Order #{id}` still renders `Order #7`.

### Added

- **Real ordinal support.** `selectordinal` was resolved with cardinal rules, so
  English gave `#th` for 2. CLDR's 28 ordinal rule sets are now compiled into a
  generated `intl/modular_ordinal.dart` — only the sets the project's locales
  reference — and `selectordinal` selects against them. `1st`, `2nd`, `3rd`,
  `4th`, `11th` are now correct, as are Welsh, Azerbaijani, Italian and the rest.
  A locale with no ordinal data falls back to `other` and says so.
  `intl`'s own `MessageFormat` cannot be used for this: it delegates ordinal
  selection to the cardinal rules.
- **ICU diagnostics** in the Problems panel: malformed messages, a missing
  `other` case, a locale whose structure disagrees with the template, a literal
  `#` that looks like it was meant to be a plural, and an exact selector in an
  ordinal block. Anchored on the value's own offset, so a key whose name is a
  substring of another's is no longer misattributed.
- **Locale notes** in the output channel for a normalised `@@locale`, colliding
  files, and a locale with no ordinal rules.

### Changed

- `optionalParameters` accepts bare JSON numbers, emitting `decimalDigits: 2`
  rather than `decimalDigits: '2'`.
- `example` accepts a non-string value instead of being ignored.
- Generated imports are sorted, so output no longer trips `directives_ordering`.
- **A `format:` on a placeholder that is also a plural operand is now ignored**,
  and the placeholder renders unformatted everywhere. It used to be applied in the
  module method but not in the per-locale lookup table, so the two disagreed and
  the unformatted reading is the one `intl` dispatched to. This matches `#`, which
  has always substituted the raw operand: `1234` renders as `1234`, not `1,234`,
  which is also what Flutter's own `gen_l10n` does. A non-operand placeholder is
  unaffected — `{price}` with `"format": "currency"` is still formatted.

### Fixed

Problems found in a review of the changes above, all verified by running the
generator or the diagnostics over the fixture corpus:

- **A `selectordinal` nested inside a `select` or `plural` produced Dart that
  would not compile.** Ordinal detection only looked at top-level nodes, so
  `intl/modular_ordinal.dart` was never written and nothing imported it, while
  the message tables still called `modularOrdinalBranch`. Detection is now
  recursive, and so is the `Intl.plural`/`Intl.select` check that decides the
  `package:intl` import.
- **An empty locale value rendered the template text under that locale's
  ordinal rules** — English `selectordinal` text with English suffixes read as
  German `1th`, `2th`, `3th`. "Create module" writes `""` for every non-default
  locale it creates, so this was reachable on a freshly scaffolded project. The
  value and the locale that owns it are now decided by one predicate, and the
  combined ARB uses it too.
- **The editor reported translations as uncompilable that the generator
  rendered.** The diagnostics provider passed the whole `@key` object where the
  type resolver reads `@key.placeholders`, so every declared type came back
  undefined: `es: {count, plural, …}` against a template declaring
  `"type": "int"` drew an `icu-argument-mismatch` **error** while the generated
  Spanish was fine. Both paths now build the canonical argument list with one
  shared function.

Diagnostics noise:

- An empty translation no longer also reports "this locale drops ICU blocks the
  template has". `empty-translation` already said it, and it renders nothing.
- `Order #{id}` no longer reports that its `#` "is not inside a plural" — a
  number sign introducing a placeholder is ordinary text, and the corpus's own
  fixture was drawing the hint.
- A locale whose configured default locale is absent from its ARB files is now
  checked against the locale generation actually uses. Previously the whole
  module was skipped and produced no diagnostics at all.
- A parse error and its consequence are reported once, not twice: an unclosed
  block and a mistyped `Other` no longer each draw both `icu-syntax` and
  `icu-missing-other`.

New diagnostics:

- **An apostrophe that swallows a placeholder.** `Bienvenue à l'{place}
  aujourd'hui` is valid ICU, and the `{place}` becomes literal text, so the
  message silently loses a parameter — common wherever an elision sits against a
  placeholder. An unclosed quoted run is reported the same way. Both name the two
  fixes: `''`, or quote the whole placeholder as `'{place}'`.
- **A placeholder or message key that is a Dart reserved word.** `default`,
  `class` and `new` are emitted verbatim as parameter and method names, so the
  generated file does not compile. Diagnosed, not renamed: changing a key changes
  the generated public API, which is a decision for the project.
- A repeated `=N` selector, which was silently accepted and emitted two equality
  tests where the second shadowed the first.

Corrected:

- `'|'` outside a `select` case list is literal text. It was treated as a syntax
  character everywhere, so `x '|' y` lost both apostrophes. ICU keeps them.
- The `#` diagnostic now points at the right character. It indexed the decoded
  text, so every `''` before the `#` moved it one character early.
- The `=0` hint no longer claims CLDR gives 0 the `other` category in every
  locale. Welsh does not; 0 is `zero` there.
- A duplicated key in an ARB file is now indexed at its last occurrence, matching
  `JSON.parse` — the generator reads the values through `JSON.parse`, so a
  duplicate could anchor its diagnostic on a different occurrence than the text
  it was complaining about.

## [4.0.0] - 2026-10-07

One entry point. Generated module files are now parts of the generated library,
so `import '…/auth_l10n.dart'` no longer compiles — `l10n.dart` / `ml.dart` is
the only way in.

**If you upgrade, run `Modular L10n: Generate Translations` and fix the module
imports in your own code.** For each `import '…/<module>_l10n.dart';` line,
either delete it (if the file already imports `l10n.dart`) or replace it with
`import '…/l10n.dart';` — the module class names still resolve, because the
barrel re-exports them. Code that called `XxxL10n.instance` or `.load` also has
to move to `ML.of(context)` / `ML.current`. Regenerating alone is not enough: it
fixes the generated side, not your imports.

To migrate without a flag day, pin the old layout in `pubspec.yaml` and move over
when you can:

```yaml
modular_l10n:
  module_access: library   # revert to `part` when the migration is done
```

### Added

- `moduleAccess` setting (`module_access` in `pubspec.yaml`), enum `part` |
  `library`, default `part`. `library` reproduces the previous output byte for
  byte and exists as a migration escape hatch.
- A `direct-module-import` warning on `import`/`export` of a generated
  `<module>_l10n.dart`, raised on open and on save. It names the fix instead of
  leaving you with the analyzer's `can't have a part-of directive`, and offers a
  quick fix that repoints the import at the entry point. One document is checked
  per event — no workspace walk.

### Changed

- **Breaking.** `<module>_l10n.dart` files are emitted as `part of` the entry
  point instead of standalone libraries. The module classes are unchanged: same
  names, same getters, same `ML.of(context).<module>` API. `l10n.dart` no
  longer re-exports the module files directly — it re-exports the entry point,
  which contains them, so the barrel's surface is identical.
- The generated entry point lists modules with `part` directives; in `library`
  mode it still lists `import` directives. Nothing else in the output differs.

## [3.1.1] - 2026-08-16

Packaging fix. No functional changes — identical to 3.1.0, which failed to
upload and was never published.

### Fixed

- Local development files are no longer swept into the published package.
  `.vscodeignore` now excludes credential files, environment files, and
  previously built `.vsix` archives by pattern rather than by exact filename.

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
