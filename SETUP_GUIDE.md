# Modular Flutter Localization - Complete Setup Guide

A comprehensive guide to setting up and using the Modular Flutter L10n VS Code extension for your Flutter projects.

---

## Table of Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Project Setup](#project-setup)
4. [Creating Translations](#creating-translations)
5. [Generating Code](#generating-code)
6. [Flutter Integration](#flutter-integration)
7. [Using Translations](#using-translations)
8. [RTL Support](#rtl-support)
9. [Adding New Keys](#adding-new-keys)
10. [Creating New Modules](#creating-new-modules)
11. [Configuration Options](#configuration-options)
12. [Best Practices](#best-practices)
13. [Troubleshooting](#troubleshooting)

---

## Requirements

- **VS Code** 1.74.0 or higher
- **Flutter** 3.10.0 or higher
- **Dart** 3.0.0 or higher

---

## Installation

### Step 1: Install the VS Code Extension

**Option A: From Marketplace**
1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "Modular Flutter Localization"
4. Click Install

**Option B: From VSIX file**
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions
4. Click `...` menu → "Install from VSIX..."
5. Select the downloaded file

### Step 2: Add Dependencies to Flutter Project

Open your `pubspec.yaml` and add:

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

> **Note:** `flutter_localizations` is optional. Only add it if you need localized Material widgets (DatePicker, TimePicker, etc.)

---

## Project Setup

### Step 1: Create Project Structure

Create `l10n` folders inside your feature directories:

```
lib/
├── features/
│   ├── auth/
│   │   ├── l10n/              ← Create this folder
│   │   ├── screens/
│   │   └── widgets/
│   ├── home/
│   │   ├── l10n/              ← Create this folder
│   │   ├── screens/
│   │   └── widgets/
│   └── settings/
│       ├── l10n/              ← Create this folder
│       └── ...
└── generated/                  ← Auto-created by extension
    └── l10n/
```

### Step 2: Configure the Extension (Optional)

Create `.vscode/settings.json` in your project root:

```json
{
  "modularL10n.outputPath": "lib/generated/l10n",
  "modularL10n.supportedLocales": ["en", "ar"],
  "modularL10n.defaultLocale": "en",
  "modularL10n.arbFilePattern": "**/l10n/*.arb",
  "modularL10n.watchMode": true,
  "modularL10n.className": "S"
}
```

---

## Creating Translations

### ARB File Naming Convention

Files must follow this pattern: `{moduleName}_{locale}.arb`

```
auth_en.arb    ✅ Correct
auth_ar.arb    ✅ Correct
en.arb         ❌ Wrong (missing module name)
auth.arb       ❌ Wrong (missing locale)
```

### Step 1: Create English ARB File

Create `lib/features/auth/l10n/auth_en.arb`:

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

  "welcomeBack": "Welcome back, {name}!",
  "@welcomeBack": {
    "placeholders": {
      "name": {
        "type": "String"
      }
    }
  }
}
```

### Step 2: Create Arabic ARB File

Create `lib/features/auth/l10n/auth_ar.arb`:

```json
{
  "@@locale": "ar",
  "@@context": "auth",

  "email": "البريد الإلكتروني",
  "password": "كلمة المرور",
  "login": "تسجيل الدخول",
  "welcomeBack": "مرحباً بعودتك، {name}!"
}
```

### ARB Syntax Reference

#### Simple String
```json
{
  "title": "Home"
}
```

#### With Description
```json
{
  "title": "Home",
  "@title": {
    "description": "Home screen title"
  }
}
```

#### With Placeholder
```json
{
  "greeting": "Hello, {name}!",
  "@greeting": {
    "placeholders": {
      "name": {
        "type": "String",
        "example": "John"
      }
    }
  }
}
```

#### With Multiple Placeholders
```json
{
  "welcome": "Good {timeOfDay}, {name}!",
  "@welcome": {
    "placeholders": {
      "timeOfDay": { "type": "String" },
      "name": { "type": "String" }
    }
  }
}
```

#### With Pluralization
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

---

## Generating Code

### Automatic Generation (Watch Mode)

If `watchMode` is enabled (default), code regenerates automatically when you save any `.arb` file.

### Manual Generation

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type: `Modular L10n: Generate Translations`
3. Press Enter

### Generated Files

After generation, you'll see:

```
lib/generated/l10n/
├── s.dart                      ← Main S class
├── app_localization_delegate.dart
├── auth_l10n.dart              ← Auth module class
├── home_l10n.dart              ← Home module class
├── l10n.dart                   ← Barrel file (exports all)
└── intl/
    ├── messages_all.dart
    ├── messages_en.dart
    └── messages_ar.dart
```

---

## Flutter Integration

### Basic Setup (Without flutter_localizations)

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

  void _changeLocale(Locale locale) {
    setState(() => _locale = locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: _locale,
      supportedLocales: S.supportedLocales,
      localizationsDelegates: [
        S.delegate,
      ],
      home: HomePage(onLocaleChange: _changeLocale),
    );
  }
}
```

### Full Setup (With flutter_localizations)

Add to `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter
  intl: ^0.19.0
```

```dart
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'generated/l10n/l10n.dart';

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  Locale _locale = const Locale('en');

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: _locale,
      supportedLocales: S.supportedLocales,
      localizationsDelegates: [
        S.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const HomePage(),
    );
  }
}
```

---

## Using Translations

### Simple Strings

```dart
// Access via module
Text(S.auth.email)          // "Email" or "البريد الإلكتروني"
Text(S.auth.password)       // "Password" or "كلمة المرور"
Text(S.home.title)          // "Home" or "الرئيسية"
```

### With Parameters

```dart
// Single parameter
Text(S.auth.welcomeBack('Ahmed'))
// "Welcome back, Ahmed!" or "مرحباً بعودتك، Ahmed!"

// Multiple parameters
Text(S.home.greeting('morning', 'Ahmed'))
// "Good morning, Ahmed!"
```

### With Pluralization

```dart
Text(S.home.itemCount(0))   // "No items"
Text(S.home.itemCount(1))   // "1 item"
Text(S.home.itemCount(5))   // "5 items"
```

### In Widgets

```dart
class LoginScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(S.auth.login),
      ),
      body: Column(
        children: [
          TextField(
            decoration: InputDecoration(
              labelText: S.auth.email,
            ),
          ),
          TextField(
            decoration: InputDecoration(
              labelText: S.auth.password,
            ),
            obscureText: true,
          ),
          ElevatedButton(
            onPressed: () {},
            child: Text(S.auth.login),
          ),
        ],
      ),
    );
  }
}
```

---

## RTL Support

### Manual RTL Handling

```dart
class _MyAppState extends State<MyApp> {
  Locale _locale = const Locale('en');

  bool get isRtl => _locale.languageCode == 'ar' || 
                    _locale.languageCode == 'he' ||
                    _locale.languageCode == 'fa';

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      locale: _locale,
      supportedLocales: S.supportedLocales,
      localizationsDelegates: [S.delegate],
      builder: (context, child) {
        return Directionality(
          textDirection: isRtl ? TextDirection.rtl : TextDirection.ltr,
          child: child!,
        );
      },
      home: const HomePage(),
    );
  }
}
```

### Using modular_l10n Package (Optional)

If you install the `modular_l10n` package:

```dart
import 'package:modular_l10n/modular_l10n.dart';

// Check RTL
if (LocaleUtils.isRtl(locale)) { ... }

// Get text direction
TextDirection dir = LocaleUtils.getTextDirection(locale);

// Using extension
bool isRtl = locale.isRtl;
TextDirection dir = locale.textDirection;
```

---

## Adding New Keys

### Method 1: Manual

1. Open the ARB file
2. Add the new key and translations
3. Save the file (auto-generates if watch mode is on)

### Method 2: Using Command

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `Modular L10n: Add Translation Key`
3. Select the module
4. Enter the key name (camelCase)
5. Enter translations for each locale

---

## Creating New Modules

### Method 1: Manual

1. Create folder: `lib/features/{module_name}/l10n/`
2. Create ARB files:
   - `{module_name}_en.arb`
   - `{module_name}_ar.arb`
3. Add translations
4. Run generate command

### Method 2: Using Command

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type: `Modular L10n: Create New Module`
3. Enter module name (snake_case)
4. Enter module path

---

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `modularL10n.outputPath` | `lib/generated/l10n` | Where generated files are placed |
| `modularL10n.supportedLocales` | `["en", "ar"]` | Locales to support |
| `modularL10n.defaultLocale` | `en` | Fallback locale |
| `modularL10n.arbFilePattern` | `**/l10n/*.arb` | Pattern to find ARB files |
| `modularL10n.watchMode` | `true` | Auto-regenerate on save |
| `modularL10n.generateCombinedArb` | `true` | Create combined ARB files |
| `modularL10n.className` | `S` | Main class name |

---

## Best Practices

### 1. Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Module names | snake_case | `auth`, `home`, `user_profile` |
| Key names | camelCase | `welcomeMessage`, `loginButton` |
| ARB files | `{module}_{locale}.arb` | `auth_en.arb`, `auth_ar.arb` |

### 2. Organize by Feature

```
✅ Good
lib/features/auth/l10n/auth_en.arb
lib/features/home/l10n/home_en.arb

❌ Bad
lib/l10n/auth_en.arb
lib/l10n/home_en.arb
```

### 3. Always Add Descriptions

```json
{
  "deleteAccount": "Delete Account",
  "@deleteAccount": {
    "description": "Button text for permanently deleting user account"
  }
}
```

### 4. Use Meaningful Key Names

```json
✅ "loginButtonText": "Login"
✅ "emailFieldLabel": "Email"
✅ "passwordValidationError": "Password must be 8 characters"

❌ "text1": "Login"
❌ "label": "Email"
❌ "error": "Password must be 8 characters"
```

### 5. Group Related Keys

```json
{
  "@@context": "auth",
  
  "loginTitle": "Login",
  "loginButton": "Sign In",
  "loginError": "Invalid credentials",
  
  "signupTitle": "Create Account",
  "signupButton": "Sign Up",
  "signupError": "Email already exists"
}
```

---

## Troubleshooting

### Extension not generating files

1. Check if ARB files follow naming convention: `{module}_{locale}.arb`
2. Ensure ARB files are valid JSON
3. Check Output panel: View → Output → Select "Modular L10n"
4. Try manual generation via Command Palette

### "No instance of S was loaded" error

Make sure `S.delegate` is in `localizationsDelegates`:

```dart
MaterialApp(
  localizationsDelegates: [
    S.delegate,  // ← Must be included
  ],
)
```

### Translations not updating

1. Check if `watchMode` is enabled
2. Hot restart the app (not just hot reload)
3. Run `flutter clean` then `flutter pub get`

### RTL not working

Add `Directionality` widget in MaterialApp builder:

```dart
MaterialApp(
  builder: (context, child) {
    return Directionality(
      textDirection: isRtl ? TextDirection.rtl : TextDirection.ltr,
      child: child!,
    );
  },
)
```

### Plural forms not working

Ensure the placeholder type is `int`:

```json
{
  "itemCount": "{count, plural, =0{No items} =1{1 item} other{{count} items}}",
  "@itemCount": {
    "placeholders": {
      "count": {
        "type": "int"  ← Must be int, not String
      }
    }
  }
}
```

---

## Quick Reference

### Commands

| Command | Description |
|---------|-------------|
| `Modular L10n: Generate Translations` | Regenerate all files |
| `Modular L10n: Add Translation Key` | Add new key to module |
| `Modular L10n: Create New Module` | Create new module with l10n |

### Minimum pubspec.yaml

```yaml
dependencies:
  flutter:
    sdk: flutter
  intl: ^0.19.0
```

### Minimum MaterialApp

```dart
MaterialApp(
  locale: _locale,
  supportedLocales: S.supportedLocales,
  localizationsDelegates: [S.delegate],
  home: HomePage(),
)
```

### Access Pattern

```dart
S.{moduleName}.{keyName}
S.{moduleName}.{keyName}(param1, param2)

// Examples
S.auth.email
S.auth.welcomeBack('Ahmed')
S.home.itemCount(5)
```

---

<p align="center">
  Made with ❤️ by <a href="https://utanium.org">Utanium</a>
</p>
