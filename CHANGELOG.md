# Changelog

All notable changes to the "Modular Flutter Localization" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
