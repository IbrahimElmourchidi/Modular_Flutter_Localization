# Modular Flutter Localization

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/UtaniumOrg.modular-flutter-l10n?label=VS%20Code%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/UtaniumOrg.modular-flutter-l10n?color=green)](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)
[![GitHub](https://img.shields.io/github/stars/IbrahimElmourchidi/modular_l10n?style=social)](https://github.com/IbrahimElmourchidi/modular_l10n)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A VS Code extension for **feature-based, modular localization** in Flutter projects. Keep your translations organized by feature modules instead of one massive ARB file.

```
lib/
├── features/
│   ├── auth/
│   │   └── l10n/           ← Auth translations
│   │       ├── auth_en.arb
│   │       └── auth_ar.arb
│   └── home/
│       └── l10n/           ← Home translations
│           ├── home_en.arb
│           └── home_ar.arb
└── generated/l10n/         ← Auto-generated code
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📁 **Modular Architecture** | Organize translations by feature/module |
| 🔍 **Auto-Detect Locales** | Automatically detects locales from ARB files |
| 🖱️ **Context Menu** | Right-click folder → "New L10n Module" |
| 👁️ **Watch Mode** | Auto-regenerate on ARB file changes |
| 🌍 **170+ Locales** | Comprehensive locale validation |
| 📝 **ICU Syntax** | Full support for plurals, select, etc. |
| 🔄 **RTL Support** | Arabic, Hebrew, Persian, Urdu, and more |
| ⚡ **Zero Config** | Works out of the box |

---

## 📦 Installation

### Step 1: Install the Extension

**Option A: VS Code Marketplace**
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **"Modular Flutter Localization"**
4. Click **Install**

Or install directly: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=UtaniumOrg.modular-flutter-l10n)

**Option B: Command Line**
```bash
code --install-extension UtaniumOrg.modular-flutter-l10n
```

### Step 2: Add Dependency to Flutter Project

Add `intl` to your `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  intl: ^0.19.0
```

Then run:
```bash
flutter pub get
```

> **Note:** This extension works **standalone** - no companion package required!

---

## 🚀 Quick Start

### 1. Create Your First Module

**Option A: Context Menu (Recommended)**
1. Right-click on any folder (e.g., `lib/features/auth`)
2. Select **"New L10n Module"**
3. Enter module name → Done!

**Option B: Manual**
1. Create folder: `lib/features/auth/l10n/`
2. Create ARB file: `auth_en.arb`

### 2. Add Translations

```json
{
  "@@locale": "en",
  "@@context": "auth",

  "email": "Email",
  "password": "Password",
  "login": "Login",
  "welcomeBack": "Welcome back, {name}!"
}
```

> ⚠️ **Required:** Every ARB file must have `@@locale` and `@@context` properties!

### 3. Generate Code

- **Automatic:** Save any ARB file (watch mode is on by default)
- **Manual:** `Ctrl+Shift+P` → "Modular L10n: Generate Translations"

### 4. Use in Flutter

```dart
import 'package:your_app/generated/l10n/l10n.dart';

// Simple usage
Text(S.auth.email)           // "Email"
Text(S.auth.login)           // "Login"

// With parameters
Text(S.auth.welcomeBack('Ahmed'))  // "Welcome back, Ahmed!"
```

---

## 📖 Complete Usage Guide (Without Companion Package)

This section shows you how to use the extension with **only** the `intl` package - no additional dependencies needed.

### Project Structure

```
lib/
├── features/
│   ├── auth/
│   │   ├── l10n/
│   │   │   ├── auth_en.arb
│   │   │   └── auth_ar.arb
│   │   ├── cubit/
│   │   │   └── auth_cubit.dart
│   │   └── screens/
│   │       └── login_screen.dart
│   └── home/
│       ├── l10n/
│       │   ├── home_en.arb
│       │   └── home_ar.arb
│       └── screens/
│           └── home_screen.dart
├── generated/
│   └── l10n/                    ← Auto-generated
│       ├── s.dart
│       ├── auth_l10n.dart
│       ├── home_l10n.dart
│       ├── app_localization_delegate.dart
│       └── l10n.dart
└── main.dart
```

### ARB File Format

**lib/features/auth/l10n/auth_en.arb**
```json
{
  "@@locale": "en",
  "@@context": "auth",

  "email": "Email",
  "@email": {
    "description": "Email field label"
  },

  "password": "Password",
  "login": "Login",
  "signup": "Sign Up",
  "forgotPassword": "Forgot Password?",

  "welcomeBack": "Welcome back, {name}!",
  "@welcomeBack": {
    "placeholders": {
      "name": {
        "type": "String",
        "example": "Ahmed"
      }
    }
  },

  "loginError": "Invalid email or password"
}
```

**lib/features/auth/l10n/auth_ar.arb**
```json
{
  "@@locale": "ar",
  "@@context": "auth",

  "email": "البريد الإلكتروني",
  "password": "كلمة المرور",
  "login": "تسجيل الدخول",
  "signup": "إنشاء حساب",
  "forgotPassword": "نسيت كلمة المرور؟",
  "welcomeBack": "مرحباً بعودتك، {name}!",
  "loginError": "البريد الإلكتروني أو كلمة المرور غير صحيحة"
}
```

### Basic Setup (StatefulWidget)

**lib/main.dart**
```dart
import 'package:flutter/material.dart';
import 'generated/l10n/l10n.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  Locale _locale = const Locale('en');

  void changeLocale(Locale locale) {
    setState(() => _locale = locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      
      // Localization setup
      locale: _locale,
      supportedLocales: S.supportedLocales,
      localizationsDelegates: [
        S.delegate,
      ],
      
      home: HomeScreen(
        onLocaleChanged: changeLocale,
        currentLocale: _locale,
      ),
    );
  }
}
```

### Using Cubit for Locale Management

This example shows how to manage locale state using `flutter_bloc`.

**Step 1: Add flutter_bloc**
```yaml
dependencies:
  flutter:
    sdk: flutter
  intl: ^0.19.0
  flutter_bloc: ^8.1.0
```

**Step 2: Create LocaleCubit**

**lib/cubit/locale_cubit.dart**
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocaleCubit extends Cubit<Locale> {
  static const String _localeKey = 'app_locale';
  
  LocaleCubit() : super(const Locale('en'));

  /// Load saved locale from SharedPreferences
  Future<void> loadSavedLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final languageCode = prefs.getString(_localeKey);
    
    if (languageCode != null) {
      emit(Locale(languageCode));
    }
  }

  /// Change and persist locale
  Future<void> changeLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_localeKey, locale.languageCode);
    emit(locale);
  }

  /// Check if current locale is RTL
  bool get isRtl {
    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ps', 'sd'];
    return rtlLanguages.contains(state.languageCode);
  }

  /// Get text direction
  TextDirection get textDirection {
    return isRtl ? TextDirection.rtl : TextDirection.ltr;
  }
}
```

**Step 3: Setup in main.dart**

**lib/main.dart**
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'cubit/locale_cubit.dart';
import 'generated/l10n/l10n.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LocaleCubit()..loadSavedLocale(),
      child: const AppView(),
    );
  }
}

class AppView extends StatelessWidget {
  const AppView({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<LocaleCubit, Locale>(
      builder: (context, locale) {
        final localeCubit = context.read<LocaleCubit>();
        
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          
          // Localization setup
          locale: locale,
          supportedLocales: S.supportedLocales,
          localizationsDelegates: [
            S.delegate,
          ],
          
          // RTL support
          builder: (context, child) {
            return Directionality(
              textDirection: localeCubit.textDirection,
              child: child!,
            );
          },
          
          home: const HomeScreen(),
        );
      },
    );
  }
}
```

**Step 4: Use in Screens**

**lib/features/home/screens/home_screen.dart**
```dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../cubit/locale_cubit.dart';
import '../../../generated/l10n/l10n.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final localeCubit = context.read<LocaleCubit>();
    
    return Scaffold(
      appBar: AppBar(
        title: Text(S.home.title),
        actions: [
          // Language Switcher
          PopupMenuButton<Locale>(
            icon: const Icon(Icons.language),
            onSelected: (locale) => localeCubit.changeLocale(locale),
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: Locale('en'),
                child: Row(
                  children: [
                    Text('🇺🇸'),
                    SizedBox(width: 8),
                    Text('English'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: Locale('ar'),
                child: Row(
                  children: [
                    Text('🇸🇦'),
                    SizedBox(width: 8),
                    Text('العربية'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Welcome message with parameter
            Text(
              S.home.welcomeMessage('Ahmed'),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 16),
            
            // Simple text
            Text(S.home.description),
            const SizedBox(height: 24),
            
            // Pluralization example
            Text(S.home.itemCount(0)),  // "No items"
            Text(S.home.itemCount(1)),  // "1 item"
            Text(S.home.itemCount(5)),  // "5 items"
          ],
        ),
      ),
    );
  }
}
```

**Step 5: Using in Auth Module**

**lib/features/auth/screens/login_screen.dart**
```dart
import 'package:flutter/material.dart';
import '../../../generated/l10n/l10n.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(S.auth.login),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              decoration: InputDecoration(
                labelText: S.auth.email,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              obscureText: true,
              decoration: InputDecoration(
                labelText: S.auth.password,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                onPressed: () {},
                child: Text(S.auth.forgotPassword),
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {},
                child: Text(S.auth.login),
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () {},
              child: Text(S.auth.signup),
            ),
          ],
        ),
      ),
    );
  }
}
```

---

## 🔧 Commands & Features

### Command Palette Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Modular L10n: Generate Translations` | - | Manually regenerate all translation files |
| `Modular L10n: Add Translation Key` | - | Add a new key to a module with translations for all locales |
| `Modular L10n: Create New Module` | - | Create a new module with l10n folder and ARB files |

### Context Menu

| Action | Location | Description |
|--------|----------|-------------|
| **New L10n Module** | Right-click folder | Create l10n folder with ARB files for all detected locales |

### Features

| Feature | Description |
|---------|-------------|
| **Auto-Detect Locales** | Scans ARB files for `@@locale` property - no configuration needed |
| **Content-Based Detection** | Uses `@@locale` and `@@context` from file content, not filename |
| **Watch Mode** | Automatically regenerates when ARB files change (enabled by default) |
| **Locale Validation** | Validates against 170+ known locales with helpful error messages |
| **ICU Message Syntax** | Full support for `plural`, `select`, `selectordinal` |
| **Placeholder Support** | Type-safe placeholders with `String`, `int`, `double`, `DateTime` |
| **RTL Support** | Automatic detection for Arabic, Hebrew, Persian, Urdu, and more |
| **Combined ARB Export** | Optionally generates combined ARB files for translation services |

### Configuration Options

| Setting | Default | Description |
|---------|---------|-------------|
| `modularL10n.outputPath` | `lib/generated/l10n` | Output path for generated Dart files |
| `modularL10n.defaultLocale` | `en` | Default/fallback locale |
| `modularL10n.arbFilePattern` | `**/l10n/*.arb` | Glob pattern to find ARB files |
| `modularL10n.watchMode` | `true` | Watch for ARB file changes and regenerate |
| `modularL10n.generateCombinedArb` | `true` | Generate combined ARB files |
| `modularL10n.className` | `S` | Name of the generated localization class |

### Configure in `.vscode/settings.json`

```json
{
  "modularL10n.outputPath": "lib/generated/l10n",
  "modularL10n.defaultLocale": "en",
  "modularL10n.watchMode": true,
  "modularL10n.className": "S"
}
```

---

## 📱 Platform Configuration (Important!)

To fully support localization on Android and iOS, you need additional platform-specific configuration.

### Android Configuration

**android/app/src/main/AndroidManifest.xml**

Add `android:localeConfig` to the `<application>` tag (Android 13+):

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="your_app"
        android:name="${applicationName}"
        android:icon="@mipmap/ic_launcher"
        android:localeConfig="@xml/locales_config">
        
        <!-- ... rest of your manifest -->
        
    </application>
</manifest>
```

**android/app/src/main/res/xml/locales_config.xml**

Create this file with your supported locales:

```xml
<?xml version="1.0" encoding="utf-8"?>
<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
    <locale android:name="en"/>
    <locale android:name="ar"/>
    <locale android:name="de"/>
    <locale android:name="es"/>
    <locale android:name="fr"/>
    <!-- Add all your supported locales -->
</locale-config>
```

**android/app/build.gradle**

Add `resConfigs` to limit included locales (reduces APK size):

```gradle
android {
    defaultConfig {
        // ... other config
        
        // Specify the locales your app supports
        resConfigs "en", "ar", "de", "es", "fr"
    }
}
```

### iOS Configuration

**ios/Runner/Info.plist**

Add supported localizations:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- ... other entries -->
    
    <!-- Supported Localizations -->
    <key>CFBundleLocalizations</key>
    <array>
        <string>en</string>
        <string>ar</string>
        <string>de</string>
        <string>es</string>
        <string>fr</string>
        <!-- Add all your supported locales -->
    </array>
    
    <!-- Development Language -->
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    
    <!-- ... other entries -->
</dict>
</plist>
```

### macOS Configuration

**macos/Runner/Info.plist**

Same as iOS:

```xml
<key>CFBundleLocalizations</key>
<array>
    <string>en</string>
    <string>ar</string>
    <string>de</string>
    <string>es</string>
    <string>fr</string>
</array>

<key>CFBundleDevelopmentRegion</key>
<string>en</string>
```

### Web Configuration

**web/index.html**

Set the `lang` attribute dynamically or statically:

```html
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- ... -->
</head>
<body>
    <!-- ... -->
</body>
</html>
```

For dynamic RTL support, update `dir` attribute in your Flutter code:

```dart
import 'dart:html' as html;

void updateHtmlDirection(bool isRtl) {
  html.document.documentElement?.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  html.document.documentElement?.setAttribute('lang', isRtl ? 'ar' : 'en');
}
```

### Platform Configuration Summary

| Platform | File | What to Add |
|----------|------|-------------|
| **Android** | `AndroidManifest.xml` | `android:localeConfig` attribute |
| **Android** | `res/xml/locales_config.xml` | List of supported locales |
| **Android** | `build.gradle` | `resConfigs` for APK optimization |
| **iOS** | `Info.plist` | `CFBundleLocalizations` array |
| **macOS** | `Info.plist` | `CFBundleLocalizations` array |
| **Web** | `index.html` | `lang` and `dir` attributes |

---

## 📝 ARB File Reference

### Required Properties

Every ARB file **must** have these properties:

```json
{
  "@@locale": "en",
  "@@context": "module_name"
}
```

| Property | Format | Example | Description |
|----------|--------|---------|-------------|
| `@@locale` | ISO 639-1 | `en`, `ar`, `de` | Language code |
| `@@context` | snake_case | `auth`, `user_profile` | Module name |

### Simple Strings

```json
{
  "title": "Home",
  "subtitle": "Welcome to our app"
}
```

### With Descriptions

```json
{
  "deleteButton": "Delete",
  "@deleteButton": {
    "description": "Button to permanently delete an item"
  }
}
```

### With Placeholders

```json
{
  "greeting": "Hello, {name}!",
  "@greeting": {
    "placeholders": {
      "name": {
        "type": "String",
        "example": "Ahmed"
      }
    }
  }
}
```

### With Pluralization

```json
{
  "itemCount": "{count, plural, =0{No items} =1{1 item} other{{count} items}}",
  "@itemCount": {
    "placeholders": {
      "count": {
        "type": "int"
      }
    }
  }
}
```

### With Select

```json
{
  "pronoun": "{gender, select, male{He} female{She} other{They}}",
  "@pronoun": {
    "placeholders": {
      "gender": {
        "type": "String"
      }
    }
  }
}
```

---

## 📦 Companion Package (Optional)

For additional convenience features, consider using the companion Dart package:

### [modular_l10n](https://pub.dev/packages/modular_l10n)

```yaml
dependencies:
  modular_l10n: ^1.0.0
```

### Benefits

| Feature | Description |
|---------|-------------|
| **LocaleProvider Widget** | Built-in widget for locale management |
| **Context Extensions** | `context.setLocale()`, `context.currentLocale` |
| **RTL Utilities** | `LocaleUtils.isRtl()`, `locale.isRtl` |
| **Locale Parsing** | `LocaleUtils.parse('en_US')` |
| **Display Names** | `locale.displayName`, `locale.nativeName` |
| **Text Direction** | `LocaleUtils.getTextDirection()` |

### Example with Package

```dart
import 'package:modular_l10n/modular_l10n.dart';

// Check RTL
if (context.currentLocale.isRtl) {
  // Handle RTL layout
}

// Change locale
context.setLocale(const Locale('ar'));

// Get display name
print(const Locale('ar').nativeName);  // "العربية"
print(const Locale('ar').displayName); // "Arabic"
```

### When to Use

| Use Case | Extension Only | With Package |
|----------|----------------|--------------|
| Basic localization | ✅ | ✅ |
| Custom state management (Cubit, Riverpod) | ✅ | ✅ |
| Built-in locale provider | ❌ | ✅ |
| RTL helper utilities | Manual | ✅ Built-in |
| Locale display names | Manual | ✅ Built-in |

---

## ❓ FAQ

### Why use modular localization?

- **Scalability**: Large apps with 1000+ keys become unmanageable in a single file
- **Team Collaboration**: Different teams can work on different modules
- **Feature Isolation**: Delete a feature = delete its translations
- **Code Review**: Smaller, focused changes are easier to review

### Can I use this with flutter_localizations?

Yes! Add it for Material/Cupertino widget translations:

```dart
import 'package:flutter_localizations/flutter_localizations.dart';

MaterialApp(
  localizationsDelegates: [
    S.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
)
```

### How do I add a new locale?

1. Create ARB file with `@@locale` set to the new locale
2. The extension auto-detects it on next generation

### How do I add a new module?

1. Right-click folder → "New L10n Module", OR
2. Command Palette → "Modular L10n: Create New Module"

### Files not generating?

1. Check ARB files have `@@locale` AND `@@context`
2. Check Output panel: View → Output → "Modular L10n"
3. Try manual generation via Command Palette

---

## 🤝 Contributing

Contributions are welcome! Please visit our [GitHub repository](https://github.com/IbrahimElmourchidi/modular_l10n).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with ❤️ by <a href="https://utanium.org">Utanium</a>
</p>