# Modular Flutter L10n

![Modular Flutter L10n Logo](https://raw.githubusercontent.com/IbrahimElmourchidi/Modular_Flutter_Localization/dde6063290c7b91c4400c993a4215772b8557436/images/icon.png)

> **Scale your Flutter localization with modular architecture** – Organize translations by feature while maintaining full compatibility with Flutter's official Intl library.

[![Version](https://img.shields.io/vscode-marketplace/v/UtaniumOrg.modular-flutter-l10n)](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)
[![Installs](https://img.shields.io/vscode-marketplace/i/UtaniumOrg.modular-flutter-l10n)](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)
[![Ratings](https://img.shields.io/vscode-marketplace/r/UtaniumOrg.modular-flutter-l10n)](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization)

---

## ✨ Why Modular Localization?

Traditional Flutter localization stores **all translations in a single namespace**. In large apps, this creates:

❌ **Naming collisions** – Need verbose prefixes like `authLoginButton`, `authSignupButton`  
❌ **Team conflicts** – Multiple developers editing the same massive ARB files  
❌ **Poor organization** – Hard to find translations for specific features  
❌ **Tight coupling** – Changes to one feature's strings require regenerating everything

✅ **Modular L10n solves this** by:
- Organizing translations by **feature/module** (`auth/`, `settings/`, `payments/`)
- Generating **type-safe accessors** (`ML.of(context).auth.loginButton`)
- Supporting **independent locale management** per module
- **Coexisting peacefully** with Flutter Intl for legacy projects

---

## 🚀 Quick Start

### 1. Install Extension

**Via VS Code:**
1. Open Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search **"Modular Flutter L10n"**
3. Click **Install**

**Prerequisites:**
- [Flutter extension](https://marketplace.visualstudio.com/items?itemName=Dart-Code.flutter) installed
- Flutter project with `pubspec.yaml`

### 2. Initialize Project (One Command!)

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run: `Modular L10n: Initialize`
3. Answer prompts:
   ```
   Default locale: en
   First module name: auth
   Module path: features/auth
   Generated class name: ML  ← KEEP THIS (avoids Flutter Intl conflicts)
   ```

**What happens:**
- ✅ Creates `lib/features/auth/l10n/auth_en.arb`
- ✅ Adds config to `pubspec.yaml`
- ✅ Generates Dart files in `lib/generated/modular_l10n/`
- ✅ Sets up everything needed for localization

---

## 📁 Project Structure

```
lib/
├── features/
│   ├── auth/
│   │   └── l10n/
│   │       ├── auth_en.arb      ← English auth translations
│   │       └── auth_ar.arb      ← Arabic auth translations
│   ├── home/
│   │   └── l10n/
│   │       ├── home_en.arb
│   │       └── home_ar.arb
│   └── settings/
│       └── l10n/
│           ├── settings_en.arb
│           └── settings_ar.arb
├── generated/
│   └── modular_l10n/            ← Auto-generated (DON'T EDIT!)
│       ├── ml.dart              ← Main entry point
│       ├── auth_l10n.dart       ← Auth module class
│       ├── home_l10n.dart
│       ├── settings_l10n.dart
│       ├── app_localization_delegate.dart
│       └── intl/                ← Message lookup tables
│           ├── modular_messages_all.dart
│           ├── modular_messages_en.dart
│           └── modular_messages_ar.dart
└── main.dart
```

---

## 📝 ARB File Format (Critical!)

Every ARB file **MUST** include two metadata properties:

```json
{
  "@@locale": "en",
  "@@context": "auth",
  
  "loginButton": "Log In",
  "emailLabel": "Email Address",
  "passwordLabel": "Password",
  
  "@loginButton": {
    "description": "Label for login button"
  }
}
```

| Property | Required | Purpose |
|----------|----------|---------|
| `@@locale` | ✅ Yes | Locale code (`en`, `ar`, `fr_FR`, `zh_Hans_CN`, etc.) |
| `@@context` | ✅ Yes | **Module name** – identifies which module owns these translations |
| `@key` | ❌ Optional | Metadata (description, placeholders, formatting) |

> ⚠️ **Without `@@context`**, the extension **skips the file**. This distinguishes modular ARB files from Flutter Intl's `intl_*.arb` files.

### Supported Locale Formats

The extension validates locales against comprehensive standards:

```
Simple:     en, ar, fr, de, ja, zh
Regional:   en_US, ar_EG, fr_CA, zh_CN
Script:     zh_Hans, zh_Hant, sr_Latn, sr_Cyrl
Complex:    zh_Hans_CN, zh_Hant_TW, sr_Latn_RS
```

See full list in [module_scanner.ts](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/blob/main/src/module_scanner.ts#L20-L100).

---

## 🔧 Flutter Setup

### 1. Add Dependencies

```yaml
# pubspec.yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  intl: ^0.19.0
```

Run:
```bash
flutter pub get
```

### 2. Configure MaterialApp

```dart
import 'package:flutter_localizations/flutter_localizations.dart';
import 'generated/modular_l10n/l10n.dart';

MaterialApp(
  // Add delegates
  localizationsDelegates: const [
    ML.delegate,                              // ← Modular L10n
    GlobalMaterialLocalizations.delegate,     // ← Material widgets
    GlobalWidgetsLocalizations.delegate,      // ← Flutter widgets
    GlobalCupertinoLocalizations.delegate,    // ← Cupertino widgets
  ],
  
  // Supported locales (auto-detected from ARB files)
  supportedLocales: ML.supportedLocales,
  
  // Optional: Set initial locale
  locale: const Locale('en'),
  
  home: MyHomePage(),
)
```

**That's it!** No need for `Directionality` wrapper – the delegates handle RTL automatically.

### 3. Platform Configuration (For In-App Switching)

Only needed if you want to **change language without restarting the app**.

#### Android (`android/app/src/main/AndroidManifest.xml`)

```xml
<activity
  android:name=".MainActivity"
  android:configChanges="locale|layoutDirection"  ← Add this
  android:supportsRtl="true">                      ← Add this for RTL
  <!-- ... -->
</activity>
```

#### iOS (`ios/Runner/Info.plist`)

```xml
<key>CFBundleLocalizations</key>
<array>
  <string>en</string>
  <string>ar</string>
  <!-- Add all supported locales -->
</array>
```

> **Why?** Without these, the OS restarts your app when locale changes. With them, the change is instant.

---

## 💻 Using Translations in Code

### In Widgets (with BuildContext)

```dart
// Simple strings
Text(ML.of(context).auth.loginButton)

// With placeholders
Text(ML.of(context).auth.welcomeMessage('John'))

// ICU plurals
Text(ML.of(context).home.messageCount(5))
// Outputs: "5 messages" (or "1 message" for count=1)

// ICU gender/select
Text(ML.of(context).profile.greeting('male'))
// Outputs: "Hello, sir!" (or "Hello, ma'am!" for 'female')
```

### In Non-Widget Code (Services/Blocs/Cubits)

```dart
// Access without context
final message = ML.current.auth.loginButton;
final greeting = ML.current.auth.welcomeMessage('Sarah');

// Check current locale
final locale = ML.current.auth.instance; // Returns localized instance
```

### In-App Language Switching

> 💡 **Note**: This example uses **Cubit** (from `flutter_bloc`), but you can use any state management solution you prefer (Provider, Riverpod, GetX, etc.). The key is to store the locale in state and rebuild `MaterialApp` when it changes.

#### 1. Create Locale Cubit

```dart
// lib/core/locale/locale_cubit.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocaleCubit extends Cubit<Locale> {
  static const _localeKey = 'app_locale';
  
  LocaleCubit() : super(const Locale('en')) {
    _loadSavedLocale();
  }

  /// Load saved locale from storage on app start
  Future<void> _loadSavedLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final savedLocale = prefs.getString(_localeKey);
    
    if (savedLocale != null) {
      emit(_localeFromString(savedLocale));
    }
  }

  /// Change locale and persist to storage
  Future<void> changeLocale(Locale newLocale) async {
    emit(newLocale);
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, newLocale.toString());
  }

  /// Parse locale from string (e.g., "en_US" -> Locale('en', 'US'))
  Locale _localeFromString(String localeStr) {
    final parts = localeStr.split('_');
    if (parts.length == 1) return Locale(parts[0]);
    if (parts.length == 2) return Locale(parts[0], parts[1]);
    return Locale(parts[0], parts[1]);
  }
}
```

#### 2. Provide Cubit in App Root

```dart
// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'core/locale/locale_cubit.dart';
import 'generated/modular_l10n/l10n.dart';

void main() {
  runApp(
    BlocProvider(
      create: (context) => LocaleCubit(),
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<LocaleCubit, Locale>(
      builder: (context, locale) {
        return MaterialApp(
          locale: locale,
          localizationsDelegates: const [
            ML.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: ML.supportedLocales,
          home: const MyHomePage(),
        );
      },
    );
  }
}
```

#### 3. Create Language Switcher Widget

```dart
// lib/widgets/language_switcher.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../core/locale/locale_cubit.dart';
import '../generated/modular_l10n/l10n.dart';

class LanguageSwitcher extends StatelessWidget {
  const LanguageSwitcher({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<LocaleCubit, Locale>(
      builder: (context, currentLocale) {
        return DropdownButton<Locale>(
          value: currentLocale,
          items: ML.supportedLocales.map((locale) {
            return DropdownMenuItem(
              value: locale,
              child: Text(_getLocaleName(locale)),
            );
          }).toList(),
          onChanged: (newLocale) {
            if (newLocale != null) {
              context.read<LocaleCubit>().changeLocale(newLocale);
            }
          },
        );
      },
    );
  }

  String _getLocaleName(Locale locale) {
    switch (locale.languageCode) {
      case 'en': return 'English';
      case 'ar': return 'العربية';
      case 'fr': return 'Français';
      case 'de': return 'Deutsch';
      default: return locale.toString();
    }
  }
}
```

#### 4. Use in Your App

```dart
// In any screen
import '../widgets/language_switcher.dart';

AppBar(
  title: Text('Settings'),
  actions: [
    Padding(
      padding: EdgeInsets.symmetric(horizontal: 16),
      child: LanguageSwitcher(),
    ),
  ],
)
```

#### Alternative: Using Provider

If you prefer **Provider**, replace the Cubit with a `ChangeNotifier`:

```dart
// lib/core/locale/locale_provider.dart
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocaleProvider extends ChangeNotifier {
  static const _localeKey = 'app_locale';
  Locale _locale = const Locale('en');

  Locale get locale => _locale;

  LocaleProvider() {
    _loadSavedLocale();
  }

  Future<void> _loadSavedLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final savedLocale = prefs.getString(_localeKey);
    if (savedLocale != null) {
      _locale = _localeFromString(savedLocale);
      notifyListeners();
    }
  }

  Future<void> changeLocale(Locale newLocale) async {
    _locale = newLocale;
    notifyListeners();
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, newLocale.toString());
  }

  Locale _localeFromString(String localeStr) {
    final parts = localeStr.split('_');
    if (parts.length == 1) return Locale(parts[0]);
    if (parts.length == 2) return Locale(parts[0], parts[1]);
    return Locale(parts[0], parts[1]);
  }
}

// main.dart
void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => LocaleProvider(),
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: context.watch<LocaleProvider>().locale,
      // ... rest of config
    );
  }
}

// In language switcher
context.read<LocaleProvider>().changeLocale(newLocale);
```

#### Alternative: Using Riverpod

For **Riverpod** users:

```dart
// lib/core/locale/locale_provider.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

final localeProvider = StateNotifierProvider<LocaleNotifier, Locale>((ref) {
  return LocaleNotifier();
});

class LocaleNotifier extends StateNotifier<Locale> {
  static const _localeKey = 'app_locale';

  LocaleNotifier() : super(const Locale('en')) {
    _loadSavedLocale();
  }

  Future<void> _loadSavedLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final savedLocale = prefs.getString(_localeKey);
    if (savedLocale != null) {
      state = _localeFromString(savedLocale);
    }
  }

  Future<void> changeLocale(Locale newLocale) async {
    state = newLocale;
    
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, newLocale.toString());
  }

  Locale _localeFromString(String localeStr) {
    final parts = localeStr.split('_');
    if (parts.length == 1) return Locale(parts[0]);
    if (parts.length == 2) return Locale(parts[0], parts[1]);
    return Locale(parts[0], parts[1]);
  }
}

// main.dart
void main() {
  runApp(
    ProviderScope(
      child: const MyApp(),
    ),
  );
}

class MyApp extends ConsumerWidget {
  const MyApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider);
    
    return MaterialApp(
      locale: locale,
      // ... rest of config
    );
  }
}

// In language switcher
ref.read(localeProvider.notifier).changeLocale(newLocale);
```

---

## 🌍 Advanced ARB Features

### 1. Placeholders

```json
{
  "@@locale": "en",
  "@@context": "auth",
  
  "welcomeMessage": "Welcome, {name}!",
  
  "@welcomeMessage": {
    "placeholders": {
      "name": {
        "type": "String"
      }
    }
  }
}
```

Usage:
```dart
ML.of(context).auth.welcomeMessage('Alice')
// Output: "Welcome, Alice!"
```

### 2. ICU Plural Messages

```json
{
  "messageCount": "{count, plural, =0{No messages} =1{1 message} other{{count} messages}}",
  
  "@messageCount": {
    "placeholders": {
      "count": {
        "type": "int"
      }
    }
  }
}
```

Usage:
```dart
ML.of(context).home.messageCount(0)   // "No messages"
ML.of(context).home.messageCount(1)   // "1 message"
ML.of(context).home.messageCount(5)   // "5 messages"
```

### 3. ICU Select Messages

```json
{
  "greeting": "{gender, select, male{Hello, sir!} female{Hello, ma'am!} other{Hello!}}",
  
  "@greeting": {
    "placeholders": {
      "gender": {
        "type": "String"
      }
    }
  }
}
```

Usage:
```dart
ML.of(context).profile.greeting('male')    // "Hello, sir!"
ML.of(context).profile.greeting('female')  // "Hello, ma'am!"
ML.of(context).profile.greeting('other')   // "Hello!"
```

### 4. Number Formatting

```json
{
  "totalAmount": "Total: {amount}",
  
  "@totalAmount": {
    "placeholders": {
      "amount": {
        "type": "double",
        "format": "currency",
        "optionalParameters": {
          "symbol": "$",
          "decimalDigits": 2
        }
      }
    }
  }
}
```

Usage:
```dart
ML.of(context).payments.totalAmount(125.5)
// Output: "Total: $125.50"
```

### 5. Date/Time Formatting

```json
{
  "orderDate": "Order placed on {date}",
  
  "@orderDate": {
    "placeholders": {
      "date": {
        "type": "DateTime",
        "format": "yMd"
      }
    }
  }
}
```

Usage:
```dart
ML.of(context).orders.orderDate(DateTime(2024, 1, 15))
// Output: "Order placed on 1/15/2024"
```

**Available date formats:** `yMd`, `yMMMMd`, `jm`, `Hm`, and [more from Intl](https://api.flutter.dev/flutter/intl/DateFormat-class.html).

### 6. Compound ICU Messages

Multiple ICU expressions in one string:

```json
{
  "orderSummary": "{gender, select, male{He} female{She} other{They}} ordered {count, plural, =0{nothing} one{1 item} other{{count} items}}",
  
  "@orderSummary": {
    "placeholders": {
      "gender": {"type": "String"},
      "count": {"type": "int"}
    }
  }
}
```

Usage:
```dart
ML.of(context).orders.orderSummary('female', 3)
// Output: "She ordered 3 items"
```

---

## ⚙️ Configuration

### Zero-Config Default Behavior

The extension works **out-of-the-box** with these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `className` | `ML` | Generated class name (keep as `ML` to avoid Flutter Intl conflicts) |
| `outputPath` | `lib/generated/modular_l10n` | Where generated Dart files go |
| `defaultLocale` | `en` | Fallback locale if a translation is missing |
| `arbFilePattern` | `**/l10n/*.arb` | Where to find ARB files (excludes `intl_*.arb`) |
| `watchMode` | `true` | Auto-regenerate on ARB file changes |
| `generateCombinedArb` | `true` | Create combined ARB files in output directory |
| `useDeferredLoading` | `false` | Enable lazy-loading for web optimization |

### When to Configure

| Scenario | Method |
|----------|--------|
| **Team project** (recommended) | Edit `pubspec.yaml` → version-controlled, consistent |
| **Personal preferences** | VS Code Settings (`settings.json`) |
| **Never** | Most apps don't need custom configuration |

### Option 1: pubspec.yaml (Recommended)

```yaml
# pubspec.yaml
modular_l10n:
  enabled: true
  class_name: ML
  default_locale: en
  output_dir: lib/generated/modular_l10n
  arb_dir_pattern: "**/l10n/*.arb"
  generate_combined_arb: true
  use_deferred_loading: false
  watch_mode: true
```

### Option 2: VS Code Settings

```json
// .vscode/settings.json
{
  "modularL10n.className": "ML",
  "modularL10n.outputPath": "lib/generated/modular_l10n",
  "modularL10n.defaultLocale": "en",
  "modularL10n.arbFilePattern": "**/l10n/*.arb",
  "modularL10n.generateCombinedArb": true,
  "modularL10n.useDeferredLoading": false,
  "modularL10n.watchMode": true
}
```

**Priority:** `pubspec.yaml` > VS Code settings > defaults

---

## 🔄 Extension Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description | When to Use |
|---------|-------------|-------------|
| **Initialize** | One-click setup for new projects | First time setup |
| **Generate Translations** | Regenerate Dart files from ARB | After editing ARB files (auto-runs in watch mode) |
| **Add Key** | Add new translation key to existing module | Interactive key creation |
| **Create Module** | Create new feature module with ARB files | Starting a new feature |
| **Add Locale** | Add new locale to all existing modules | Supporting new language |
| **Remove Locale** | Remove locale from all modules | Dropping language support |
| **Add L10n Folder** (right-click) | Add l10n folder to directory | Organizing existing features |
| **Migrate from Flutter Intl** | Convert Flutter Intl ARB files to modular | Migrating existing projects |
| **Extract to ARB** (code action) | Extract string literal to ARB file | While coding in Dart files |
| **Check Missing Translations** | Show warnings for missing/empty translations | After adding keys to default locale |
| **Scan Hardcoded Strings** | Find user-facing strings that should be localized | Auditing existing code |
| **Sort ARB Keys** | Sort keys alphabetically in ARB files | Keeping ARB files tidy |
| **Find Unused Keys** | Find translation keys not referenced in Dart code | Cleaning up unused translations |
| **Rename Translation Key** | Rename a key across all ARB files and Dart code | Refactoring key names |
| **Export Translations (CSV/XLIFF)** | Export translations for external translators | Sending to translation team |
| **Import Translations (CSV/XLIFF)** | Import translated files back into ARB | Receiving translations |
| **Generate Pseudo-Locale** | Create accented/expanded strings for UI testing | Testing layout with different text lengths |

### Code Action: Extract to ARB

Place your **cursor inside any string literal** in Dart code → the lightbulb appears → choose **"Modular L10n: Extract to ARB"**. No need to select the full string — the extension auto-detects the string boundaries.

```dart
// Before — just place your cursor anywhere inside the string
Text('Log In')
        ^ cursor here is enough!

// After extraction
Text(ML.of(context).auth.loginButton)

// ARB file updated
{
  "loginButton": "Log In"
}
```

**Supported string types:**
- Single-quoted: `'hello'`
- Double-quoted: `"hello"`
- Triple-quoted: `'''multi\nline'''` and `"""multi\nline"""`
- Raw strings: `r'no escapes'` and `r"no escapes"`
- Escaped characters: `'it\'s working'` → properly unescaped in ARB
- Dart interpolation: `'Hello $name'` → auto-converted to `"Hello {name}"` with placeholder metadata

You can also still select the full string manually — both workflows are supported.

---

## 🔍 Editor Features

### Inline Translation Hover

Hover over any translation key usage in Dart to see all locale values in a tooltip:

```dart
Text(ML.of(context).auth.loginButton)
//   ^ hover here to see:
//   | Locale | Translation |
//   |--------|-------------|
//   | **en** | Log In      |
//   | ar     | تسجيل الدخول |
//   | fr     | Connexion   |
```

### Go to ARB Definition

**Ctrl+Click** (or **Cmd+Click** on macOS) on any translation key to jump directly to the corresponding entry in the default locale's ARB file.

```dart
Text(ML.of(context).auth.loginButton)
//                       ^ Ctrl+Click → opens auth_en.arb at "loginButton"
```

### Missing Translation Diagnostics

Warnings appear automatically in the **Problems panel** when:
- A key exists in the default locale but is **missing** in other locales
- A key exists but has an **empty value** in a locale

Diagnostics run automatically when you save any ARB file.

You can also trigger them manually: `Modular L10n: Check Missing Translations`

---

## 🛠️ Maintenance Tools

### Scan Hardcoded Strings

Find hardcoded user-facing strings that should be localized:

```
Modular L10n: Scan Hardcoded Strings
```

Scans `lib/` for strings in UI contexts like `Text()`, `label:`, `title:`, `hintText:`, etc. Automatically filters out non-user-facing strings (imports, routes, asset paths, keys, URLs).

Results appear in both the **Output panel** and **Problems panel** as hints.

### Find Unused Keys

Find translation keys in ARB files that are never referenced in Dart code:

```
Modular L10n: Find Unused Keys
```

Reports unused keys per module and optionally **bulk-removes** them from all ARB files.

### Sort ARB Keys

Sort keys alphabetically in ARB files for cleaner diffs and easier navigation:

```
Modular L10n: Sort ARB Keys
```

- `@@` meta keys stay at the top (`@@locale`, `@@context`)
- Each key's `@key` metadata stays immediately after its key
- Sort a single module or all modules at once

### Rename Translation Key

Rename a key across **all locale ARB files** and **all Dart code references** in one action:

```
Modular L10n: Rename Translation Key
```

1. Select the module
2. Pick the key to rename
3. Enter the new name
4. All ARB files and Dart files are updated, then code is regenerated

---

## 🌐 Export & Import for Translators

### Export to CSV

```
Modular L10n: Export Translations (CSV/XLIFF)
```

Creates a CSV file with columns: `Module`, `Key`, `Description`, then one column per locale. Opens in Excel/Google Sheets for translators.

### Export to XLIFF

Same command, choose **XLIFF 1.2** format — the industry standard for translation tools (memoQ, SDL Trados, Crowdin, etc.).

### Import Translations

```
Modular L10n: Import Translations (CSV/XLIFF)
```

Import a translated CSV or XLIFF file back. The extension matches keys to the correct ARB files and updates them.

---

## 🧪 Pseudo-Localization

Test your UI layout with pseudo-translated strings:

```
Modular L10n: Generate Pseudo-Locale
```

Generates a special locale (default: `en_XA`) that transforms your default translations:

| Original | Pseudo-localized |
|----------|-----------------|
| `Log In` | `[Ĺöğ Ïñ ~~~~~~]` |
| `Welcome, {name}!` | `[Ŵëĺçöɱë, {name}! ~~~~~~~~~~~]` |

This helps catch:
- **Truncation** — expanded text (~30-50% longer) reveals overflow
- **Hardcoded strings** — anything not in brackets `[...]` was missed
- **Concatenation bugs** — brackets show if strings are incorrectly split
- **Character encoding** — accented characters reveal rendering issues

Placeholders (`{name}`) and ICU syntax are preserved.

---

## 🤝 Coexistence with Flutter Intl

✅ **Both extensions can work together!** This is intentional.

### Recommended Hybrid Setup

| Scope | Extension | Location |
|-------|-----------|----------|
| **Global strings** (app name, shared actions) | Flutter Intl | `lib/l10n/intl_*.arb` |
| **Feature strings** (auth flows, settings) | Modular L10n | `lib/features/**/l10n/*.arb` |

### Critical Rules to Avoid Conflicts

1. **Class Name**  
   - ✅ Modular L10n: `ML` (default)
   - ✅ Flutter Intl: `S` (default)
   - ❌ Never use same name for both!

2. **ARB File Naming**  
   - ✅ Modular: `{module}_{locale}.arb` (e.g., `auth_en.arb`)
   - ✅ Flutter Intl: `intl_{locale}.arb` (e.g., `intl_en.arb`)
   - ❌ Never name modular files `intl_*.arb` (auto-skipped)

3. **Required Properties**  
   - ✅ Modular: Must have `@@context` property
   - ✅ Flutter Intl: No `@@context` property
   - This is how the extension distinguishes them

4. **Output Directories**  
   - ✅ Modular: `lib/generated/modular_l10n/`
   - ✅ Flutter Intl: `lib/generated/`
   - Keep separate to avoid file overwrites

### Using Both in Code

```dart
// Modular translations (feature-specific)
Text(ML.of(context).auth.loginButton)

// Flutter Intl translations (global)
Text(S.of(context).appName)

// Both work with same delegates
MaterialApp(
  localizationsDelegates: [
    ML.delegate,    // ← Modular
    S.delegate,     // ← Flutter Intl
    GlobalMaterialLocalizations.delegate,
    // ...
  ],
)
```

---

## 🚨 Troubleshooting

### Build Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `The argument type 'ML' can't be assigned` | Missing delegate in MaterialApp | Add `ML.delegate` to `localizationsDelegates` |
| `No instance of ML present` | Delegate not registered | Ensure `ML.delegate` is in `localizationsDelegates` list |
| `Undefined class 'ML'` | Generated files not imported | Import `package:your_app/generated/modular_l10n/l10n.dart` |
| `The getter 'auth' isn't defined` | Module not generated | Run `Modular L10n: Generate Translations` |

### ARB Files Not Detected

| Issue | Cause | Solution |
|-------|-------|----------|
| Files ignored during scan | Missing `@@context` or `@@locale` | Add both properties to ARB file |
| Wrong file pattern | Custom directory structure | Update `arbFilePattern` in config |
| Conflicting with Flutter Intl | File named `intl_*.arb` | Rename to `{module}_{locale}.arb` |

### In-App Language Switching

| Problem | Cause | Fix |
|---------|-------|-----|
| App restarts on Android | Missing `configChanges` | Add `android:configChanges="locale\|layoutDirection"` to AndroidManifest |
| Locale ignored on iOS | Locale not declared | Add all locales to `CFBundleLocalizations` in Info.plist |
| RTL not working | Missing RTL support | Add `android:supportsRtl="true"` (delegates handle direction automatically) |
| UI doesn't update | State not rebuilt | Call `setState()` or use state management after locale change |

### Validation Errors

Check Output panel (`View` → `Output` → Select "Modular L10n"):

```
❌ lib/features/auth/l10n/auth_en.arb: Missing required property "@@context"
❌ lib/features/home/l10n/home_ar.arb: Invalid locale "ara" (should be "ar")
```

---

## 💡 Best Practices

### 1. Module Granularity

**Good** (feature-level):
```
lib/features/
├── auth/l10n/          ← Login, signup, password reset
├── profile/l10n/       ← User profile, settings
├── payments/l10n/      ← Checkout, payment methods
```

**Too fine-grained** (avoid):
```
lib/features/
├── login/l10n/         ← Too specific
├── signup/l10n/        ← Group under 'auth' instead
├── forgot_password/l10n/
```

### 2. Key Naming

**Good** (simple, module provides namespace):
```json
{
  "@@context": "auth",
  "loginButton": "Log In",
  "emailLabel": "Email"
}
```
Access: `ML.of(context).auth.loginButton`

**Avoid** (redundant prefix):
```json
{
  "@@context": "auth",
  "authLoginButton": "Log In",  ← 'auth' prefix redundant
  "authEmailLabel": "Email"
}
```

### 3. Locale Organization

- Add new locales to **all modules simultaneously** using `Add Locale` command
- Use same locale codes across all modules (e.g., all use `en_US` or all use `en`)
- Keep default locale (`en`) as most complete; other locales can have empty strings initially

### 4. Version Control

**Commit generated files:**
```gitignore
# DON'T ignore these
# lib/generated/modular_l10n/
```

**Why?** CI/CD builds need them. The extension doesn't run in CI.

**Do ignore:**
```gitignore
# Generated ARB files (optional)
lib/generated/modular_l10n/arb/
```

### 5. Migration Strategy

When migrating existing Flutter Intl projects:

1. Keep Flutter Intl for global strings (low churn)
2. Migrate high-churn features first (auth, settings)
3. Use `Migrate from Flutter Intl` command to split by prefix
4. Gradually move remaining translations module by module

---

## ❓ Support & Feedback

- **Bug report** → [GitHub Issues](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/issues)
- **Feature request** → [GitHub Issues (enhancement)](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/issues/new?labels=enhancement)
- **Questions** → [GitHub Discussions](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/discussions)

---

## 📜 License

MIT License – See [LICENSE](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/blob/main/LICENSE)

---

## 🙏 Acknowledgments

Built with:
- [Intl](https://pub.dev/packages/intl) – Flutter's internationalization library
- [glob](https://www.npmjs.com/package/glob) – File pattern matching
- [chokidar](https://www.npmjs.com/package/chokidar) – File watching
- [yaml](https://www.npmjs.com/package/yaml) – YAML parsing

Inspired by Flutter Intl's developer experience while solving modular architecture needs.

---

## 🤝 About the Author

<div align="center">
  <a href="https://github.com/IbrahimElmourchidi">
    <img src="https://github.com/IbrahimElmourchidi.png" width="80" alt="Ibrahim El Mourchidi" style="border-radius: 50%;">
  </a>
  <h3>Ibrahim El Mourchidi</h3>
  <p>Flutter & Backend Engineer • Cairo, Egypt</p>
  <p>
    <a href="https://github.com/IbrahimElmourchidi">
      <img src="https://img.shields.io/github/followers/IbrahimElmourchidi?label=Follow&style=social" alt="GitHub">
    </a>
    <a href="mailto:ibrahimelmourchidi@gmail.com">
      <img src="https://img.shields.io/badge/Email-D14836?logo=gmail&logoColor=white" alt="Email">
    </a>
    <a href="https://www.linkedin.com/in/ibrahimelmourchidi">
      <img src="https://img.shields.io/badge/LinkedIn-0077B5?logo=linkedin&logoColor=white" alt="LinkedIn">
    </a>
  </p>
</div>

---

## 👥 Contributors

<a href="https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=IbrahimElmourchidi/Modular_Flutter_Localization" />
</a>

---

> ✨ **Built with ❤️ for Flutter developers scaling international apps**  
> Star us on [GitHub](https://github.com/IbrahimElmourchidi/Modular_Flutter_Localization) if this helps you!