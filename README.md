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
│       ├── ml.dart              ← Main entry point — import this
│       ├── l10n.dart            ← Barrel that re-exports the entry point
│       ├── auth_l10n.dart       ← Auth module class (part of ml.dart)
│       ├── home_l10n.dart
│       ├── settings_l10n.dart
│       ├── app_localization_delegate.dart
│       └── intl/                ← Message lookup tables
│           ├── modular_messages_all.dart
│           ├── modular_messages_en.dart
│           └── modular_messages_ar.dart
└── main.dart
```

> ⚠️ **Only `l10n.dart` / `ml.dart` may be imported.** Every
> `<module>_l10n.dart` is a `part of` `ml.dart`, so importing one is a compile
> error. See [One entry point](#one-entry-point).

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

> 💡 `@@locale` may be written with hyphens (`zh-Hans`) or underscores (`zh_Hans`);
> both are accepted and normalised to the underscore form. Using `zh_Hans`
> everywhere avoids the mismatch with the `defaultLocale` setting.

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

### One entry point

Everything goes through one generated file. Import the barrel (or `ml.dart` if
you prefer the shorter path) and reach strings via `ML`:

```dart
import 'package:your_app/generated/modular_l10n/l10n.dart';

Text(ML.of(context).auth.loginButton)
```

**Never import a `<module>_l10n.dart` file.** Those are `part of` `ml.dart`, so
`import '…/auth_l10n.dart'` does not compile. The module classes stay public, so
you can still use them as *types* — which is what makes passing translations down
to a child widget work with a single import:

```dart
import 'package:your_app/generated/modular_l10n/l10n.dart';

class CartItems extends StatelessWidget {
  const CartItems({super.key});

  @override
  Widget build(BuildContext context) {
    // Read once from context — this subscribes the widget to locale changes.
    final l10n = ML.of(context).cart;
    return CartItemsList(l10n: l10n);
  }
}

class CartItemsList extends StatelessWidget {
  const CartItemsList({required this.l10n, super.key});

  final CartL10n l10n; // ← type from the same single import

  @override
  Widget build(BuildContext context) => Text(l10n.emptyCartTitle);
}
```

Two reasons this matters beyond tidiness: reading through `ML.of(context)`
registers a dependency on the locale, so the widget rebuilds when the user
switches language, whereas `XxxL10n.instance` reads whatever the last
`ML.load` left in a static.

If you are upgrading from a version that allowed direct module imports, set
`modular_l10n.module_access: library` in `pubspec.yaml` to keep the old layout
while you migrate. Then, per file: **replace** `import '…/<module>_l10n.dart';`
with `import '…/l10n.dart';` — or just delete it if the file already imports the
barrel. The type names still resolve either way, because the barrel re-exports
the module classes. The extension flags anything you miss with a quick fix that
does the replacement for you. See [moduleAccess](#moduleaccess).

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

> `#` renders the number — `{count, plural, one{# item} other{# items}}` gives
> `1 item` / `5 items`. `=N` matches an exact value, and `offset:n` shifts the
> number the categories are chosen from.
>
> `#` substitutes the raw value, so `1234` renders as `1234` rather than `1,234`.
> A `format:` on a placeholder that is also a plural operand is ignored for the
> same reason. This matches Flutter's own `gen_l10n`.

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

### 3b. Ordinal Messages

`selectordinal` picks a category from CLDR's *ordinal* rules, which is what makes
`2nd` come out as `2nd`:

```json
{
  "position": "You are {n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}} in the queue"
}
```

```dart
ML.of(context).queue.position(1)  // "You are 1st in the queue"
ML.of(context).queue.position(2)  // "You are 2nd in the queue"
ML.of(context).queue.position(3)  // "You are 3rd in the queue"
ML.of(context).queue.position(11) // "You are 11th in the queue"
```

Only the rule sets your project's locales actually use are generated, into
`intl/modular_ordinal.dart`. A locale with no ordinal data in CLDR falls back to
`other`, and the Output panel says so. (`intl` resolves `selectordinal` with
cardinal rules, which is why the rules are compiled in rather than delegated.)

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

> A placeholder that is **also** a `plural` or `selectordinal` operand is rendered
> unformatted, in the module method and in every locale's message alike. The
> value has to reach `Intl.plural` as a `num`, and `#` substitutes that same raw
> value, so formatting one of the two would make them disagree. The Output panel
> says so when it drops a `format:`. Use a separate placeholder if a message needs
> both a formatted and a raw reading of the same number.

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

> **`DateFormat` needs locale data loaded.** `GlobalMaterialLocalizations.delegate`
> loads it for you, so date placeholders work out of the box in any app that
> follows the [Flutter Setup](#-flutter-setup) above. Outside that — a pure Dart
> script, a unit test, or an app without the global delegates — call
> `initializeDateFormatting(localeName)` from
> `package:intl/date_symbol_data_local.dart` first, or `DateFormat` throws
> `LocaleDataException`. Number placeholders have no such requirement.

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

### 7. ICU Support Matrix

| Feature | Status | Notes |
|---|---|---|
| `{name}` placeholders | ✅ | Type comes from `@key.placeholders` |
| `plural` with `zero`…`other` | ✅ | Full CLDR category set |
| `select` with arbitrary keywords | ✅ | `other` required |
| `selectordinal` | ✅ | CLDR ordinal rules, compiled per project |
| Exact selectors `=0`, `=5`, … | ✅ | Match the raw value, not the offset |
| `offset:n` | ✅ | Categories and `#` use `value - offset` |
| `#` inside a plural body | ✅ | The offset-shifted value |
| Nested `plural` / `select` / `selectordinal` | ✅ | Arbitrarily deep |
| ICU quoting (`''`, `'{'`) | ✅ | `It''s` → `It's`; `'{x}'` is literal |
| `#` outside a plural | ✅ | Literal text, as in gen_l10n |
| `format:` on a plural operand | ⚠️ | Ignored; the value is raw, like `#` |
| A key or placeholder that is a Dart keyword | ⚠️ | Reported; the generated Dart would not compile |
| A literal `{` or `}` | ⚠️ | Allowed, but reported as a diagnostic |
| `date` / `number` / `time` argument types | ❌ | Rendered as literal text, reported |
| Plural `offset` with `selectordinal` | ⚠️ | Accepted; CLDR does not define it |

Text around a `plural` or `select` is preserved, and the placeholders in it become
parameters:

```json
{
  "greeting": "{name} has {count, plural, one{1 item} other{{count} items}}"
}
```

```dart
ML.of(context).cart.greeting('Ada', 3)  // "Ada has 3 items"
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
| `moduleAccess` | `part` | Module files are parts of the entry point; only `l10n.dart`/`ml.dart` may be imported (see [One entry point](#one-entry-point)) |
| `logLevel` | `warning` | How chatty the extension is (see [Log Verbosity](#-log-verbosity)) |

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
  # silent | error | warning | verbose
  log_level: warning
  # part | library
  module_access: part
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
  "modularL10n.watchMode": true,
  "modularL10n.logLevel": "warning",
  "modularL10n.moduleAccess": "part"
}
```

**Priority:** `pubspec.yaml` > VS Code settings > defaults — applied **per key**.
A key you leave out of the `modular_l10n:` block falls through to your VS Code
setting, and only then to the built-in default. So a team can pin just
`class_name` in version control without disturbing anyone's personal settings.

### moduleAccess

`moduleAccess` (`module_access` in `pubspec.yaml`) decides how the module files
relate to the generated entry point:

| Value | Layout | Direct module imports |
|-------|--------|-----------------------|
| `part` (default) | `<module>_l10n.dart` is `part of '<class>.dart'` | Compile error — flagged by the extension with a quick fix |
| `library` | Each `<module>_l10n.dart` is its own library | Allowed |

`part` is the default because a single entry point is what keeps locale changes
and test overrides honest — there is exactly one way to get a module, and it
goes through `ML`. Set `library` only while migrating an existing project; it is
kept as an escape hatch, not as a supported style.

### Turning it off

`enabled: false` stands the extension down for that project: no generation, no
watching, no diagnostics, no hover or go-to-definition, no extract code action.
**Initialize** and **Check Compatibility** still run, so you can switch it back
on without hand-editing YAML.

```yaml
modular_l10n:
  enabled: false
```

---

## 🔊 Log Verbosity

Watch mode regenerates on every ARB save, so the extension can get loud. Dial it
down with `modularL10n.logLevel` (VS Code) or `modular_l10n.log_level`
(`pubspec.yaml`):

| Level | Output panel | Panel auto-reveals | Notifications |
|-------|--------------|--------------------|---------------|
| `silent` | nothing | never | none |
| `error` | failures only | on failure | errors only |
| `warning` **(default)** | failures, warnings, one-line result summaries | on warning or failure | errors, warnings, successes |
| `verbose` | everything — every file written, every module scanned | on any run | all |

```yaml
# pubspec.yaml — quiet down a noisy watch-mode project
modular_l10n:
  log_level: error
```

```json
// .vscode/settings.json — turn everything on while debugging a generation issue
{ "modularL10n.logLevel": "verbose" }
```

**What is never suppressed:** prompts that require an answer — overwrite
confirmations, the `Delete` confirmation on *Remove Locale*, and Flutter Intl
conflict resolution. Silencing those would change behaviour, not just verbosity.

**On-save diagnostics** (the automatic run triggered by saving an `.arb` file) no
longer steal focus or raise notifications at any level. Findings still land in
the Problems panel; run **Check Missing Translations** for the interactive report.

Changing `log_level` in `pubspec.yaml` takes effect on the next command — no
window reload required.

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

### Translation and ICU Diagnostics

Problems appear automatically in the **Problems panel**. Diagnostics run when you
save any ARB file; `Modular L10n: Check Missing Translations` runs them on demand.

**Translations**
- A key exists in the default locale but is **missing** in another locale (error)
- A key exists but has an **empty value** (warning)

**ICU** — the generator repairs what it can so a broken file still produces
compilable Dart, which means a wrong message could otherwise reach users quietly.
These put it back in front of you:

| Diagnostic | Meaning |
|---|---|
| `icu-syntax` | The message is not well-formed ICU — unbalanced braces, an unknown type, a repeated `=N`, or an apostrophe that quoted a `{name}` into literal text |
| `icu-dart-keyword` | The key or a placeholder is a Dart reserved word (`default`, `class`, `new`, …), so the generated file would not compile |
| `icu-argument-mismatch` | This translation needs an argument the template does not declare, or uses one in a role its type cannot serve. The template is used for this locale instead |
| `icu-missing-other` | A `plural`/`select` block has no `other` case, which is required |
| `icu-hash-literal` | A `#` outside a plural is literal text — did you mean a plural? (`Order #{id}` is left alone) |
| `icu-ordinal-exact` | An exact `=0` selector in an ordinal block wins before CLDR rules, which is worth knowing |
| `icu-control-difference` | This locale adds or drops ICU blocks the template does not have (hint — both render) |

Each is anchored on the offending value's own range, so a key whose name is a
prefix of another's is still pointed at correctly. One problem is reported once:
a parse error suppresses the consequence it causes, so an unclosed block does not
also say "no `other`".

### Direct Module Import Diagnostics

A warning appears on any `import '…/<module>_l10n.dart'` in your own code, on
open and on save. The analyzer's own message for this
(`can't have a part-of directive`) doesn't say what to do next, so the
extension names the fix and offers a quick fix that repoints the import at
`ml.dart`.

Repointing is enough when the module class was imported only to *type* a
parameter. Code that called `XxxL10n.instance` or `.load` still has to move to
`ML.of(context)` / `ML.current` — no import rewrite can do that for you.

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
| `The imported library '…_l10n.dart' can't have a part-of directive` | A module file was imported directly | Replace that `import` with one of `l10n.dart` (or delete it if the barrel is already imported) — see [One entry point](#one-entry-point). Regenerate first if you have not upgraded, or set `module_access: library` while you migrate |
| `Undefined name 'AuthL10n'` right after fixing an import | The class is reachable, but the file no longer is | Import `l10n.dart`/`ml.dart`; it re-exports every module class |

### ARB Files Not Detected

| Issue | Cause | Solution |
|-------|-------|----------|
| Files ignored during scan | Missing `@@context` or `@@locale` | Add both properties to ARB file |
| Wrong file pattern | Custom directory structure | Update `arbFilePattern` in config |
| Conflicting with Flutter Intl | File named `intl_*.arb` | Rename to `{module}_{locale}.arb` |
| Nothing happens at all | `enabled: false` in `pubspec.yaml` | Set `modular_l10n.enabled: true` |
| Module inside a folder named `build`, `generated`, `dist`, `output`, or `tmp` | Those directory names are excluded | Rename the folder — the exclusion is by exact directory name, so `build_order` and `generated_reports` are fine |

### Placeholders and Parameters

| Problem | Cause | Fix |
|---------|-------|-----|
| Parameters typed `Object` instead of `String`/`int` | `@key` metadata lives only in the **default locale** file | Add `placeholders` metadata to the default-locale ARB |
| Translation shows the wrong value in one parameter | A translation uses a placeholder the default locale doesn't declare | The Output panel names the key and locale; add the placeholder to the default-locale ARB |
| `LocaleDataException` from a date placeholder | Date symbols not loaded | Register `GlobalMaterialLocalizations.delegate`, or call `initializeDateFormatting()` — see [Date/Time Formatting](#5-datetime-formatting) |
| Argument count changed after upgrading to 4.2.0 | Text around a `plural`/`select` is now preserved, so its placeholders became parameters | Pass the new arguments — see the [4.2.0 changelog](CHANGELOG.md); the message used to render without that text |
| `NoSuchMethodError: Closure call with mismatched arguments` | A locale's ICU structure differs from the template's | Align the structure, or leave the locale untranslated; the template is used either way and a diagnostic names the key |
| A locale shows the template's text and the wrong number suffixes | The locale has no translation of its own — an **empty** `""` value counts as none, which is what `Create Module` writes | Fill the value in; the Output panel names the key |
| A `format:` on a plural operand is ignored | The value has to reach `Intl.plural` as a `num`, and `#` substitutes it raw | Expected. Use a second placeholder if the message needs both a formatted and a raw reading |
| Generated Dart will not compile: `Expected a identifier` | A placeholder or message key is a Dart reserved word | `icu-dart-keyword` names it; rename it in the message and in `@key.placeholders` |
| A French/Italian/Catalan message lost a parameter | `l'{place}` is valid ICU — the apostrophe quotes the `{` and the run ends at the next apostrophe | Write `l''{place}`, or quote the whole placeholder as `l'{place}'` |

### ICU Messages

| Problem | Cause | Fix |
|---------|-------|-----|
| `#` renders literally inside a plural | Regenerate — pre-4.2.0 output left it untouched | Run `Modular L10n: Generate Translations` |
| `2nd` renders as `4th` | Ordinals were resolved with cardinal rules | Regenerate; `selectordinal` now uses CLDR ordinal rules |
| Text around a plural is missing | Pre-4.2.0 output dropped it | Regenerate, then update the call sites — the message needs its placeholders now |
| `Undefined name 'd'` from a nested plural | Pre-4.2.0 read the inner block's cases as the outer one's | Regenerate |
| A locale's translations never load | `@@locale` used hyphens, so it did not match the message table | Regenerate; `@@locale` is normalised on the way in |
| An exact selector like `=5` is ignored | Pre-4.2.0 only knew `=0`, `=1`, `=2` | Regenerate |
| `#` renders literally where it should not | It is not inside a `plural`/`selectordinal` block | Use `{count, plural, other{#}}` |

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

### 5. One Entry Point

Read translations through `ML.of(context)` (widgets) or `ML.current` (everything
else), and import only `l10n.dart` / `ml.dart`. Module classes are fine as
parameter *types* — that's how you pass a module down to a child widget — but the
file itself is not an import target.

```dart
// ✅ One import, read through ML, type flows down
import 'package:your_app/generated/modular_l10n/l10n.dart';

final l10n = ML.of(context).cart;
return CartItemsList(l10n: l10n);

// ❌ Bypasses context, so no rebuild when the locale changes
import 'package:your_app/generated/modular_l10n/cart_l10n.dart';

Text(CartL10n.instance.emptyCartTitle)
```

### 6. Migration Strategy

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