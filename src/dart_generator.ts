import * as fs from 'fs';
import * as path from 'path';
import { ParsedModule, TranslationKey, PlaceholderInfo } from './arb_parser';
import { ArbParser } from './arb_parser';
import {
    parseIcu,
    IcuArg,
    IcuNode,
    IcuPlural,
    IcuSelect,
} from './icu_parser';
import {
    buildCanonicalArgs,
    CanonicalArg,
    checkRoleCompatibility,
    firstIncompatibleArg,
    resolvePlaceholderDartType,
} from './icu_types';

/**
 * What the renderer needs to know about the call site while walking a message.
 */
interface RenderContext {
    /** Names the generated method actually accepts. Anything else stays literal. */
    names: Set<string>;
    /**
     * Placeholder name -> the local holding its formatted value. A
     * `DateTime` rendered through `DateFormat` is interpolated as that string,
     * not as the `DateTime`.
     */
    alias: Map<string, string>;
    /**
     * Rendered Dart expression standing for the enclosing plural's `#`.
     * A string rather than an identifier because `offset:n` makes it `n - 1`.
     * `undefined` outside a plural, where `#` is ordinary text.
     */
    hashExpr?: string;
    /**
     * The locale of the text being rendered, as a Dart string literal.
     *
     * Ordinal rules are locale-specific, and the text's own locale is the one
     * that has to supply them. `Intl.getCurrentLocale()` is the *runtime* locale,
     * which is not the same thing whenever a locale falls back to another
     * locale's text: English text rendered under a `de` device locale was
     //  selecting its category with German rules, so 1 came back as "1th".
     */
    ordinalLocale: string;
}
import { ModuleAccess } from './pubspec_config';
import { compileOrdinals } from './ordinal_codegen';

export interface GeneratorConfig {
    outputPath: string;
    className: string;
    defaultLocale: string;
    supportedLocales: string[];
    generateCombinedArb: boolean;
    useDeferredLoading: boolean;
    /**
     * Whether module files are `part of` the entry-point library or standalone
     * libraries of their own. See {@link ModuleAccess}.
     */
    moduleAccess: ModuleAccess;
    /**
     * Sink for non-fatal generation warnings (bad ICU syntax, etc.).
     * Routed through the extension's level-aware logger; defaults to a no-op
     * so the generator stays usable outside VS Code.
     */
    onWarning?: (message: string) => void;
}

/** One key/locale pair on its way into a generated message lookup table. */
interface MessageEntry {
    /** Fully qualified lookup name, e.g. `home_itemCount`. */
    key: string;
    /** The translation for this locale (falling back to the default locale). */
    value: string;
    /**
     * The locale `value` actually belongs to, which is not always this entry's
     * locale: a locale with no translation is served the template text, and
     * anything locale-specific — ordinal rules above all — has to follow the
     * text rather than the request.
     */
    textLocale: string;
    /**
     * Canonical parameter names, derived once from the default locale so every
     * locale's closure declares the same positional signature.
     */
    params: string[];
    locale: string;
    translationKey: TranslationKey;
}

/**
 * Lints suppressed in generated output. `implementation_imports` covers the
 * required `package:intl/src/intl_helpers.dart`; `library_prefixes` covers
 * script-coded import aliases like `modular_messages_zh_Hans_CN`.
 */
const GENERATED_IGNORES =
    '// ignore_for_file: non_constant_identifier_names, unnecessary_string_interpolations,\n' +
    '// ignore_for_file: unnecessary_string_escapes, unnecessary_brace_in_string_interps,\n' +
    '// ignore_for_file: implementation_imports, library_prefixes, unused_import, prefer_single_quotes';

/**
 * File-name form of a class or module name: `MyModule` → `my_module`.
 *
 * Exported because consumers outside the generator — the direct-import
 * scanner has to locate the entry point — need to agree with it on where the
 * generated files land.
 */
export function toSnakeCaseName(str: string): string {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[-\s]/g, '_')
        .toLowerCase();
}

export class DartGenerator {
    /**
     * Warnings already emitted, so a message rendered for several locales — or
     * re-rendered as a fallback — is reported once rather than per locale.
     */
    private readonly warned = new Set<string>();

    constructor(private config: GeneratorConfig) {}

    /** Report a non-fatal problem at most once per generation run. */
    private warnOnce(id: string, message: string): void {
        if (this.warned.has(id)) return;
        this.warned.add(id);
        this.config.onWarning?.(message);
    }

    async generate(modules: ParsedModule[]): Promise<void> {
        // Ensure output directory exists
        fs.mkdirSync(this.config.outputPath, { recursive: true });

        // Generate main ML class
        await this.generateMainClass(modules);

        // Generate module classes
        for (const module of modules) {
            await this.generateModuleClass(module);
        }

        // Generate delegate
        await this.generateDelegate(modules);

        // Generate messages files for each locale
        await this.generateMessagesFiles(modules);

        // The ordinal resolver is only written when a message needs it, and the
        // entry point and module files import it conditionally to match.
        await this.generateOrdinalHelper(modules);

        // Generate combined ARB files if enabled
        if (this.config.generateCombinedArb) {
            await this.generateCombinedArbFiles(modules);
        }

        // Generate barrel file
        await this.generateBarrelFile(modules);
    }

    private async generateMainClass(modules: ParsedModule[]): Promise<void> {
        const asParts = this.config.moduleAccess === 'part';

        // Relative imports, sorted, after the package: block — the analyzer's
        // directives_ordering lint flags any other arrangement.
        //
        // In part mode the module files are omitted here entirely: a `part`
        // directive replaces their import, and keeping both is a compile error.
        const relativeImports = [
            `import 'app_localization_delegate.dart';`,
            `import 'intl/modular_messages_all.dart';`,
            // A part file cannot have imports of its own, so in part mode the
            // entry point supplies this one for every module.
            ...(this.needsOrdinalHelper(modules)
                ? [`import 'intl/modular_ordinal.dart';`]
                : []),
            ...(asParts
                ? []
                : modules.map((m) => `import '${this.toSnakeCase(m.name)}_l10n.dart';`)),
        ]
            .sort()
            .join('\n');

        // Each part directive has to follow the import block, separated by a
        // blank line so the directive groups stay visually distinct.
        const moduleDirectives = asParts
            ? [
                  '',
                  '',
                  ...modules
                      .map((m) => `part '${this.toSnakeCase(m.name)}_l10n.dart';`)
                      .sort(),
              ].join('\n')
            : '';

        const moduleGetters = modules
            .map((m) => {
                const className = this.toPascalCase(m.name) + 'L10n';
                const fieldName = this.toCamelCase(m.name);
                return `  ${className} get ${fieldName} => _${fieldName}!;
  static ${className}? _${fieldName};`;
            })
            .join('\n');

        const moduleLoaders = modules
            .map((m) => {
                const className = this.toPascalCase(m.name) + 'L10n';
                const fieldName = this.toCamelCase(m.name);
                return `    _${fieldName} = ${className}.load(localeName);`;
            })
            .join('\n');

        const content = `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
${GENERATED_IGNORES}
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

${relativeImports}${moduleDirectives}

/// Main Modular Localization class providing access to all module translations.
///
/// In widgets (registers dependency — auto-rebuilds on locale change):
/// \`\`\`dart
/// Text(${this.config.className}.of(context).auth.email)
/// Text(${this.config.className}.of(context).home.welcomeMessage)
/// \`\`\`
///
/// In non-widget code (services, cubits, etc.):
/// \`\`\`dart
/// final title = ${this.config.className}.current.auth.email;
/// \`\`\`
///
/// ## One active locale at a time
///
/// Module accessors resolve against static state set by the most recent
/// [load], and message lookup goes through \`Intl.defaultLocale\`, which is
/// global. That is the right model for an app that switches locale wholesale.
///
/// It does **not** support rendering two locales simultaneously — a
/// side-by-side comparison view, or an RTL preview pane inside an LTR app.
/// Nested \`Localizations\` scopes with different locales will all read the
/// locale that loaded last.
class ${this.config.className} {
  ${this.config.className}._();

  static ${this.config.className}? _current;

  static ${this.config.className} get current {
    assert(
      _current != null,
      'No instance of ${this.config.className} was loaded. '
      'Try to initialize the ${this.config.className} delegate before accessing ${this.config.className}.current.',
    );
    return _current!;
  }

${moduleGetters}

  static const AppLocalizationDelegate delegate = AppLocalizationDelegate();

  static Future<${this.config.className}> load(Locale locale) async {
    final name = (locale.countryCode?.isEmpty ?? false)
        ? locale.languageCode
        : locale.toString();
    final localeName = Intl.canonicalizedLocale(name);
    Intl.defaultLocale = localeName;

    // Register message lookup tables for the locale
    await initializeModularMessages(localeName);

    final instance = ${this.config.className}._();
    ${this.config.className}._current = instance;

    // Load all module translations
${moduleLoaders}

    return instance;
  }

  static ${this.config.className} of(BuildContext context) {
    final instance = ${this.config.className}.maybeOf(context);
    assert(
      instance != null,
      'No instance of ${this.config.className} present in the widget tree. '
      'Did you add ${this.config.className}.delegate in localizationsDelegates?',
    );
    return instance!;
  }

  static ${this.config.className}? maybeOf(BuildContext context) {
    return Localizations.of<${this.config.className}>(context, ${this.config.className});
  }

  /// List of all supported locales
  static const List<Locale> supportedLocales = [
${this.config.supportedLocales.map((l) => this.generateLocaleConstructor(l)).join(',\n')}
  ];
}
`;

        const filePath = path.join(
            this.config.outputPath,
            `${this.toSnakeCase(this.config.className)}.dart`
        );
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    /**
     * Generate proper Locale constructor for complex locales.
     * Handles: en, en_US, zh_Hans, zh_Hans_CN
     *
     * The scanner normalises `@@locale` before it reaches here, so the parts are
     * always underscore-separated. The defensive branch below covers a locale
     * that arrives from configuration before normalisation.
     */
    private generateLocaleConstructor(locale: string): string {
        const parts = locale.replace(/-/g, '_').split('_');

        if (parts.length === 1) {
            return `    Locale('${parts[0]}')`;
        } else if (parts.length === 2) {
            const [lang, second] = parts;
            if (/^[A-Z][a-z]{3}$/.test(second)) {
                return `    Locale.fromSubtags(languageCode: '${lang}', scriptCode: '${second}')`;
            } else {
                return `    Locale('${lang}', '${second}')`;
            }
        } else if (parts.length === 3) {
            const [lang, script, region] = parts;
            return `    Locale.fromSubtags(languageCode: '${lang}', scriptCode: '${script}', countryCode: '${region}')`;
        }

        this.warnOnce(
            `locale-shape:${locale}`,
            `Locale "${locale}" is not in language[_Script][_REGION] form; ` +
            `falling back to Locale('${locale}')`
        );
        return `    Locale('${locale}')`;
    }

    private async generateModuleClass(module: ParsedModule): Promise<void> {
        const className = this.toPascalCase(module.name) + 'L10n';

        const methods = module.keys
            .map((key) => this.generateMethod(key, module.name))
            .join('\n\n');

        // A part file cannot have its own imports: it shares the entry point's,
        // which already brings in `package:intl/intl.dart` for `Intl.message`
        // and, when needed, the ordinal resolver. A standalone library has to
        // import both itself.
        const needsOrdinal = module.keys.some((key) =>
            this.keyUsesOrdinal(key)
        );
        const directives =
            this.config.moduleAccess === 'part'
                ? `part of '${this.toSnakeCase(this.config.className)}.dart';`
                : [
                      `import 'package:intl/intl.dart';`,
                      ...(needsOrdinal ? [`import 'intl/modular_ordinal.dart';`] : []),
                  ].join('\n');

        const content = `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
// Module: ${module.name}
${GENERATED_IGNORES}
${directives}

/// Localization class for the ${module.name} module.
class ${className} {
  ${className}._();

  static ${className}? _instance;

  static ${className} load(String localeName) {
    _instance = ${className}._();
    return _instance!;
  }

  static ${className} get instance {
    assert(_instance != null, '${className} not loaded');
    return _instance!;
  }

${methods}
}
`;

        const filePath = path.join(
            this.config.outputPath,
            `${this.toSnakeCase(module.name)}_l10n.dart`
        );
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    /**
     * Render one ARB message as a Dart method.
     *
     * There is deliberately no branching on message kind here. The parse tree
     * says what the message contains, and one renderer handles every shape:
     * plain text, a `plural`, a `select`, or any nesting of them.
     */
    private generateMethod(key: TranslationKey, moduleName: string): string {
        const translation = key.translations[this.config.defaultLocale] || '';
        const { nodes, errors } = parseIcu(translation);
        const lookupName = `${moduleName}_${key.key}`;

        for (const [i, error] of errors.entries()) {
            this.warnOnce(
                `${lookupName}:parse:${error.start}:${i}`,
                `${moduleName}.${key.key}: ${error.message}`
            );
        }

        // The parameter list is derived once, from the template locale, and
        // reused by every locale's lookup entry. intl dispatches through
        // Function.apply, which binds positionally, so a per-locale ordering
        // would silently swap arguments.
        const args = ArbParser.getArguments(translation);
        const orderedParams = this.orderParams(args, key.placeholders);

        const description = key.description || translation;
        const escapedDescription = this.escapeForDartDoc(description);
        const desc = this.escapeDartString(key.description || '');

        // Nothing to substitute: keep the getter form. A method with an empty
        // parameter list would be a gratuitous API change.
        if (orderedParams.length === 0 && !nodes.some((n) => n.kind === 'plural' || n.kind === 'select')) {
            return `  /// ${escapedDescription}
  String get ${key.key} {
    return Intl.message(
      ${this.toDartLiteral(nodes, {
          names: new Set(),
          alias: new Map(),
          ordinalLocale: this.defaultLocaleLiteral(),
      })},
      name: '${lookupName}',
      desc: '${desc}',
      args: [],
    );
  }`;
        }

        // Placeholders carrying NumberFormat / DateFormat metadata are formatted
        // into a local first; the message then interpolates the formatted value.
        // Resolved here rather than by rewriting the ARB text, which used to
        // also rewrite `{p}` occurrences inside quoted ICU literals.
        const formattingLines = this.generateFormattingLines(key, orderedParams, args);
        const alias = new Map(formattingLines.map((f) => [f.placeholder, f.formattedVar]));
        // The parameter keeps the ARB name — callers pass `{when: …}` — while
        // the formatted local is a distinct identifier the body reads. Aliasing
        // the parameter itself would make the declaration and the format call
        // name the same variable.
        const params = orderedParams
            .map((p) => `${this.getPlaceholderDartType(key, p, args)} ${p}`)
            .join(', ');
        const formattedVars =
            formattingLines.length > 0
                ? formattingLines.map((f) => f.varDeclaration).join('\n    ') + '\n    '
                : '';

        const names = new Set(orderedParams);
        // The string handed to Intl.message is the runtime fallback — used
        // whenever the lookup misses (unsupported locale, or a call before
        // initializeModularMessages resolves). It has to be real Dart
        // interpolation, not the raw ARB text, or the user sees "Hello {name}".
        const message = this.toDartLiteral(nodes, {
            names,
            alias,
            // The module method holds the template text, so the template locale
            // supplies the ordinal rules when it is what gets rendered.
            ordinalLocale: this.defaultLocaleLiteral(),
        });

        // `args:` is not decoration: intl forwards it to the per-locale lookup
        // function, so it decides what the closure is actually called with. An
        // operand position therefore has to arrive raw — the closure passes it
        // to `Intl.plural`, which takes a `num` — while a plain placeholder
        // still arrives formatted, which is what that closure interpolates.
        const lookupArgs = orderedParams.map((p) =>
            this.isOperand(args, p) ? p : alias.get(p) ?? p
        );

        return `  /// ${escapedDescription}
  String ${key.key}(${params}) {
    ${formattedVars}return Intl.message(
      ${message},
      name: '${lookupName}',
      desc: '${desc}',
      args: [${lookupArgs.join(', ')}],
    );
  }`;
    }

    /** Whether `name` is used as a plural or ordinal operand anywhere in the message. */
    private isOperand(args: IcuArg[], name: string): boolean {
        const role = args.find((a) => a.name === name)?.role;
        return role === 'pluralOperand' || role === 'ordinalOperand';
    }

    /**
     * Order the message's arguments, letting `@key.placeholders` declare the
     * intent. A metadata entry naming a placeholder the message does not use is
     * dropped, and a placeholder the message uses but metadata omits is kept —
     * otherwise the signature would either gain a parameter nothing supplies or
     * lose one the message interpolates.
     *
     * Delegates to {@link ArbParser.getOrderedPlaceholders}, which is the same
     * rule the per-locale lookup entries use to derive their parameter list.
     * Two copies of this drifted: they agreed on every fixture in the corpus and
     * would have disagreed on any message where a locale reorders placeholders,
     * which is precisely the case positional dispatch depends on.
     */
    private orderParams(
        args: IcuArg[],
        metadata?: Record<string, PlaceholderInfo>
    ): string[] {
        // `getOrderedPlaceholders` takes text because its other caller has text.
        // Here the names are all the ordering rule needs, and a brace-joined
        // reconstruction satisfies the parser's arg collection exactly — no
        // literal text survives it.
        const text = args.map((a) => `{${a.name}}`).join(' ');
        return ArbParser.getOrderedPlaceholders(text, metadata);
    }

    /**
     * Render a parsed message as a single-quoted Dart string literal.
     *
     * Literal runs are escaped individually and the substitutions are emitted
     * raw, because escaping a string that already contains `$name` would turn
     * the interpolation into the literal characters `\$name`.
     */
    private toDartLiteral(nodes: IcuNode[], ctx: RenderContext): string {
        return `'${this.renderNodes(nodes, ctx)}'`;
    }

    /**
     * Render a parsed message into the *body* of a Dart string literal.
     *
     * Everything that is not literal text becomes an interpolation:
     *   {name}                      -> $name
     *   {count, plural, …}          -> ${Intl.plural(count, …)}
     *   {gender, select, …}         -> ${Intl.select(gender, {…})}
     *   # inside a plural body      -> ${<the plural's operand>}
     */
    private renderNodes(nodes: IcuNode[], ctx: RenderContext): string {
        let out = '';

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            switch (node.kind) {
                case 'text':
                    out += this.escapeDartString(node.value);
                    break;

                case 'arg': {
                    // Only names the caller actually supplies become
                    // interpolations; anything else stays literal text, so a
                    // rogue placeholder in one locale cannot reference an
                    // undeclared variable.
                    if (!ctx.names.has(node.name)) {
                        out += `{${node.name}}`;
                        break;
                    }
                    const target = ctx.alias.get(node.name) ?? node.name;
                    out += this.interpolate(target, this.followingChar(nodes, i));
                    break;
                }

                case 'hash':
                    // `#` stands for the enclosing plural's value. With an
                    // offset that is an expression, not a name, which is why
                    // the context carries a rendered string rather than an
                    // identifier.
                    out += ctx.hashExpr === undefined ? '#' : `\${${ctx.hashExpr}}`;
                    break;

                case 'select':
                    out += `\${${this.renderSelect(node, ctx)}}`;
                    break;

                case 'plural':
                    out += `\${${this.renderPlural(node, ctx)}}`;
                    break;

                case 'invalid':
                    // Malformed input: keep the original text rather than
                    // dropping it, and never invent an interpolation from it.
                    out += this.escapeDartString(node.raw);
                    break;
            }
        }

        return out;
    }

    /**
     * The character that will follow an interpolation, if any.
     *
     * `{n}items` must become `${n}items`: without the braces, `$nitems` is one
     * (undefined) identifier rather than the value of `n` followed by text.
     */
    private followingChar(nodes: IcuNode[], index: number): string {
        const next = nodes[index + 1];
        return next?.kind === 'text' ? next.value.charAt(0) : '';
    }

    /**
     * `$name` when the next character cannot extend the identifier, `${name}`
     * when it can.
     */
    private interpolate(name: string, following: string): string {
        return /[A-Za-z0-9_]/.test(following) ? `\${${name}}` : `$${name}`;
    }

    /** The identifier a placeholder is read as, honouring a formatting alias. */
    private resolvedName(ctx: RenderContext, name: string): string {
        return ctx.alias.get(name) ?? name;
    }

    private renderSelect(node: IcuSelect, ctx: RenderContext): string {
        const cases = new Map(node.cases);
        this.synthesizeOther(cases, node.name, ctx);

        const entries = [...cases.entries()].map(([key, body]) => {
            const rendered = this.renderNodes(body, ctx);
            return `'${this.escapeDartString(key)}': '${rendered}'`;
        });

        return `Intl.select(${this.resolvedName(ctx, node.name)}, {${entries.join(', ')}})`;
    }

    private renderPlural(node: IcuPlural, ctx: RenderContext): string {
        // The raw parameter name, never the formatting alias. `count` carrying
        // `@count: {format: compact}` also produces a `countString` local, and
        // using that as the operand emitted `Intl.plural(countString, …)` — a
        // `String` where `num` is required, which does not compile. The
        // formatted local stays for plain `{count}` interpolations, where it
        // is the value the caller asked to see.
        const operand = node.name;
        const shifted = node.offset ? `${operand} - ${node.offset}` : operand;

        // Inside this plural's bodies, `#` is the offset-shifted value, and a
        // nested `select` keeps that binding — which is what ICU does.
        const inner: RenderContext = { ...ctx, hashExpr: shifted };


        // Exact selectors (`=N`) are equality tests on the *raw* value, so they
        // cannot go through Intl.plural's category parameters. Folding `=1`
        // into `one:` instead would be wrong wherever the locale's `one`
        // category covers more than 1 — Russian 21 would read "exactly one".
        // An ordinal has to consult the CLDR data compiled into
        // intl/modular_ordinal.dart — intl's own `selectordinal` handling uses
        // cardinal rules, which turns "2nd" into "4th". `Intl.plural` cannot be
        // used because it selects the case itself from the named parameters;
        // here the category is already a string, so the branch is chosen here.
        const branches = this.ordinalOrPluralBranches(node, inner, node.ordinal);
        let expr = node.ordinal
            ? `modularOrdinalBranch(modularOrdinalCategory(${ctx.ordinalLocale}, ${shifted}), {${branches}})`
            : `Intl.plural(${shifted}, ${branches})`;

        for (const selector of node.exactSelectors) {
            const body = node.cases.get(selector);
            if (body === undefined) continue;
            const rendered = this.renderNodes(body, inner);
            expr = `${operand} == ${selector.slice(1)} ? '${rendered}' : ${expr}`;
        }

        return expr;
    }

    /**
     * A Dart string literal for the locale of the text being rendered.
     *
     * Baked in rather than read from `Intl.getCurrentLocale()`. The two agree
     * only when the device locale is the locale whose text is on screen; when a
     * locale has no translation and intl serves another locale's message table,
     * the runtime locale is the one that was *asked for* and the ordinal rules
     * it supplies are for text nobody is reading. The result was the English
     * "1st" coming back as "1th" under a German device locale.
     *
     * The literal is the locale's canonical underscore form, which is also the
     * key the generated rule map is built from.
     */
    private ordinalLocaleLiteral(locale: string): string {
        return `'${this.escapeDartString(locale.replace(/-/g, '_'))}'`;
    }

    /** The same, for the template-locale text in a module method. */
    private defaultLocaleLiteral(): string {
        return this.ordinalLocaleLiteral(this.config.defaultLocale);
    }

    /**
     * The case list for a plural or ordinal block.
     *
     * `Intl.plural` reads it as named parameters; the ordinal path reads the
     * same map by the category string the CLDR resolver returned. Declared
     * order, so the emitted call reads like the source.
     */
    private ordinalOrPluralBranches(
        node: IcuPlural,
        ctx: RenderContext,
        asMapKeys: boolean
    ): string {
        const categories = new Map<string, IcuNode[]>();
        for (const [key, body] of node.cases) {
            if (!key.startsWith('=')) categories.set(key, body);
        }
        this.synthesizeOther(categories, node.name, ctx);

        return ['zero', 'one', 'two', 'few', 'many', 'other']
            .filter((key) => categories.has(key))
            .map((key) => {
                // Intl.plural takes named parameters; the ordinal path takes a
                // map, which needs its keys quoted.
                const name = asMapKeys ? `'${key}'` : key;
                return `${name}: '${this.renderNodes(categories.get(key)!, ctx)}'`;
            })
            .join(', ');
    }

    /**
     * Guarantee an `other` branch.
     *
     * `other` is a *required* named parameter of `Intl.plural` and
     * `Intl.select`, so a message without one does not compile. Copying the
     * first available branch keeps the generated code buildable even when the
     * diagnostic is ignored.
     */
    private synthesizeOther(
        cases: Map<string, IcuNode[]>,
        name: string,
        ctx: RenderContext
    ): void {
        if (cases.has('other')) return;

        const first = [...cases.keys()][0];
        const fallback = cases.values().next();
        this.warnOnce(
            `synthesize-other:${name}:${first ?? ''}`,
            `Missing "other" case for "${name}"; falling back to ${
                first === undefined ? 'an empty message' : `"${first}"`
            }`
        );

        cases.set('other', fallback.done ? [] : fallback.value);
        void ctx;
    }

    /**
     * Generate formatting lines for placeholders with format metadata.
     * Supports NumberFormat and DateFormat.
     */
    private generateFormattingLines(
        key: TranslationKey,
        placeholders: string[],
        args: IcuArg[]
    ): { placeholder: string; varDeclaration: string; formattedVar: string }[] {
        const lines: { placeholder: string; varDeclaration: string; formattedVar: string }[] = [];

        if (!key.placeholders) return lines;

        for (const pName of placeholders) {
            const meta = key.placeholders[pName];
            if (!meta || !meta.format) continue;

            // An operand gets no formatted local at all.
            //
            // It used to get one, and that produced two different renderings of
            // the same message: the module method interpolated `$countString`,
            // while the per-locale lookup closure — which receives only the
            // canonical parameters and has no formatting of its own —
            // interpolated the raw `$count`. `intl` dispatches through the
            // lookup table, so the unformatted reading was the one users saw,
            // and the warning below described behaviour that never happened.
            //
            // Skipping it also makes this consistent with `#`, which stands for
            // the raw operand and so has never been number-formatted: `1234`
            // renders as `1234`, not `1,234`. That matches Flutter's own
            // `gen_l10n`, so the deviation is deliberate and documented rather
            // than a gap.
            if (this.isOperand(args, pName)) {
                this.warnOnce(
                    `operand-format:${key.key}:${pName}`,
                    `${key.key}: "{${pName}}" is a plural operand, so its ` +
                    `"${meta.format}" format is ignored — the value is passed to ` +
                    `\`Intl.plural\` raw, and \`#\` substitutes it unformatted.`
                );
                continue;
            }

            // `String` suffix, not a rename: the ARB name stays the parameter
            // name so the public signature does not change.
            const formattedVar = `${pName}String`;

            if (meta.type === 'DateTime') {
                if (meta.isCustomDateFormat === 'true') {
                    // Custom date format
                    lines.push({
                        placeholder: pName,
                        varDeclaration: `final ${formattedVar} = DateFormat('${this.escapeDartString(meta.format)}').format(${pName});`,
                        formattedVar,
                    });
                } else {
                    // Named date format (e.g., yMd, Hm)
                    lines.push({
                        placeholder: pName,
                        varDeclaration: `final ${formattedVar} = DateFormat.${meta.format}().format(${pName});`,
                        formattedVar,
                    });
                }
            } else if (meta.type === 'int' || meta.type === 'double' || meta.type === 'num') {
                // Number formatting
                const optParams = meta.optionalParameters;
                if (optParams) {
                    const paramEntries = Object.entries(optParams)
                        .map(([k, v]) => {
                            if (typeof v === 'number') return `${k}: ${v}`;
                            return `${k}: '${this.escapeDartString(String(v))}'`;
                        })
                        .join(', ');
                    lines.push({
                        placeholder: pName,
                        varDeclaration: `final ${formattedVar} = NumberFormat.${meta.format}(${paramEntries ? paramEntries : ''}).format(${pName});`,
                        formattedVar,
                    });
                } else {
                    lines.push({
                        placeholder: pName,
                        varDeclaration: `final ${formattedVar} = NumberFormat.${meta.format}().format(${pName});`,
                        formattedVar,
                    });
                }
            }
        }

        return lines;
    }

/**
 * Get the Dart type for a placeholder.
 *
 * The role decides the type and `@key.placeholders` may only narrow it — see
 * {@link resolvePlaceholderDartType}. Pure: the warning about a declared type
 * the role had to overrule is raised once per key from
 * {@link canonicalArgs}, so deriving a signature does not report it again.
 */
    private getPlaceholderDartType(
        key: TranslationKey,
        placeholderName: string,
        args?: IcuArg[]
    ): string {
        return resolvePlaceholderDartType(
            key.placeholders,
            placeholderName,
            args ?? []
        );
    }

    /**
     * Record that `@placeholder`'s declared type cannot be used for the role it
     * turned out to play, and the type used instead.
     */
    private warnPlaceholderTypeOverride(
        placeholderName: string,
        declared: string,
        used: string
    ): void {
        this.warnOnce(
            `placeholder-type:${placeholderName}:${declared}:${used}`,
            `"@${placeholderName}" is declared as "${declared}" but is used as a ` +
            `plural operand, so it is typed "${used}"`
        );
    }

    private async generateDelegate(modules: ParsedModule[]): Promise<void> {
        const content = `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
${GENERATED_IGNORES}
import 'package:flutter/material.dart';
import '${this.toSnakeCase(this.config.className)}.dart';

class AppLocalizationDelegate extends LocalizationsDelegate<${this.config.className}> {
  const AppLocalizationDelegate();

  @override
  bool isSupported(Locale locale) => _resolve(locale) != null;

  @override
  Future<${this.config.className}> load(Locale locale) =>
      ${this.config.className}.load(_resolve(locale) ?? locale);

  /// Narrow [locale] to the closest supported locale.
  ///
  /// Matching a device locale on language alone (so \`en_GB\` satisfies a project
  /// that only ships \`en_US\`) is right, but the *device* locale must not then be
  /// handed to load() — no message table is registered under it. Resolve to the
  /// supported locale first: exact match, then language+country, then language.
  static Locale? _resolve(Locale locale) {
    for (final supported in ${this.config.className}.supportedLocales) {
      if (supported == locale) return supported;
    }
    for (final supported in ${this.config.className}.supportedLocales) {
      if (supported.languageCode == locale.languageCode &&
          supported.countryCode == locale.countryCode) {
        return supported;
      }
    }
    for (final supported in ${this.config.className}.supportedLocales) {
      if (supported.languageCode == locale.languageCode) return supported;
    }
    return null;
  }

  @override
  bool shouldReload(AppLocalizationDelegate old) => false;
}
`;

        const filePath = path.join(this.config.outputPath, 'app_localization_delegate.dart');
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    /**
     * Whether a locale carries text of its own for a key.
     *
     * The empty string does not count. `extension.ts` writes `""` as the
     * placeholder for every non-default locale it creates, so an ARB file the
     * extension itself produced is full of keys that are present-but-empty —
     * and a key with text of its own is the only thing that makes the value
     * *and* the locale that owns it agree. Judging the value with `||` and
     * `textLocale` with `!== undefined` sent the empty locale's ordinal rules
     * over the template's text, which is where "1st" came back as "1th" in
     * German. One predicate, so the two can never disagree again.
     */
    private hasOwnTranslation(key: TranslationKey, locale: string): boolean {
        const value = key.translations[locale];
        return typeof value === 'string' && value !== '';
    }

    /** The text a locale renders for a key, falling back to the template. */
    private translationText(key: TranslationKey, locale: string): string {
        return this.hasOwnTranslation(key, locale)
            ? (key.translations[locale] as string)
            : key.translations[this.config.defaultLocale] ?? '';
    }

    private async generateMessagesFiles(modules: ParsedModule[]): Promise<void> {
        const messagesDir = path.join(this.config.outputPath, 'intl');
        fs.mkdirSync(messagesDir, { recursive: true });

        for (const locale of this.config.supportedLocales) {
            const messages: MessageEntry[] = [];
            for (const module of modules) {
                for (const key of module.keys) {
                    const translation = this.translationText(key, locale);

                    // The parameter list is derived once, from the default
                    // locale, and reused for every locale. intl dispatches
                    // through Function.apply, which binds positionally — so if
                    // each locale declared its own order, a translation that
                    // reorders placeholders (often required by grammar) would
                    // silently receive the arguments swapped.
                    const canonical = key.translations[this.config.defaultLocale] ?? '';
                    const params = ArbParser.getOrderedPlaceholders(canonical, key.placeholders);

                    messages.push({
                        key: `${module.name}_${key.key}`,
                        value: translation,
                        textLocale: this.hasOwnTranslation(key, locale)
                            ? locale
                            : this.config.defaultLocale,
                        params,
                        locale,
                        translationKey: key,
                    });
                }
            }

            const content = this.generateMessagesFileContent(locale, messages);
            // FIXED: Namespaced file to avoid Flutter Intl conflict
            const filePath = path.join(messagesDir, `modular_messages_${locale}.dart`);
            fs.writeFileSync(filePath, content, 'utf-8');
        }

        // Generate modular_messages_all.dart
        await this.generateMessagesAll(modules);
    }

    /**
     * Generate the per-locale message lookup table.
     *
     * Entries in this map are the *resolution* of a message, so none of them may
     * pass `name:` / `args:` to `Intl.plural` / `Intl.select`. Supplying `name`
     * is what makes intl perform a lookup, and the lookup for that name resolves
     * back to this same closure — an unbounded recursion that ends in
     * StackOverflowError on the first call. Without `name`, `Intl.plural`
     * simply selects a branch and returns.
     */
    private generateMessagesFileContent(locale: string, messages: MessageEntry[]): string {
        // Imports are decided from the text actually rendered, which is not
        // always `entry.value`: an entry whose arguments cannot satisfy the
        // canonical signature renders the template instead. Deciding from
        // `entry.value` therefore both imported `modular_ordinal.dart` for a
        // locale whose rendered text uses no ordinals, and missed the `intl`
        // import for one whose rendered text does.
        const rendered = messages.map((entry) => ({
            entry,
            ...this.renderedLookupEntry(entry),
        }));

        const messageEntries = rendered
            .map((r) => this.renderLookupEntry(r.entry, r.text, r.locale))
            .join('\n');

        // Only import what the entries actually call, so a project without ICU
        // messages gets no unused_import warning. directives_ordering wants the
        // package: block before relative imports, so the relative one goes last.
        const usesIntl = rendered.some((r) => this.needsIntl(r.text));
        const usesOrdinal = rendered.some((r) => this.textUsesOrdinal(r.text));

        const imports = [
            'package:intl/intl.dart',
            'package:intl/message_lookup_by_library.dart',
        ].filter((uri) => uri !== 'package:intl/intl.dart' || usesIntl);
        const relativeImports = usesOrdinal ? ['modular_ordinal.dart'] : [];

        const importBlock = [...imports, ...relativeImports]
            .map((uri) => `import '${uri}';`)
            .join('\n');

        return `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
${GENERATED_IGNORES}
${importBlock}

final messages = ModularMessageLookup();

class ModularMessageLookup extends MessageLookupByLibrary {
  @override
  String get localeName => '${locale}';

  @override
  final messages = <String, Function>{
${messageEntries}
  };
}
`;
    }

    /**
     * Whether a node list contains a block of the given kind, at any depth.
     *
     * Recursive because the construct can be nested: `{g, select, male{He
     * finished {n, selectordinal, …}}}` puts the ordinal inside a select, where
     * a top-level `some` does not see it. Judging only the top level left those
     * call sites emitting `modularOrdinalBranch(modularOrdinalCategory(…))`
     * into a file that was never written and never imported — a compile error.
     */
    private static containsNode(nodes: readonly IcuNode[], predicate: (n: IcuNode) => boolean): boolean {
        for (const node of nodes) {
            if (predicate(node)) return true;
            if (node.kind === 'select' || node.kind === 'plural') {
                for (const body of node.cases.values()) {
                    if (DartGenerator.containsNode(body, predicate)) return true;
                }
            }
        }
        return false;
    }

    /**
     * Whether a message's rendering calls into `package:intl`.
     *
     * Every `plural` and `select` renders as an `Intl.plural` / `Intl.select`
     * call at whatever depth it sits, so the presence of one anywhere in the
     * message is what decides.
     */
    private needsIntl(text: string): boolean {
        return DartGenerator.containsNode(
            parseIcu(text).nodes,
            (n) => n.kind === 'plural' || n.kind === 'select'
        );
    }

    /** Whether a message's text contains a `selectordinal` block. */
    private textUsesOrdinal(text: string): boolean {
        return DartGenerator.containsNode(
            parseIcu(text).nodes,
            (n) => n.kind === 'plural' && n.ordinal
        );
    }

    /** Whether a key's template translation is ordinal. */
    private keyUsesOrdinal(key: TranslationKey): boolean {
        return this.textUsesOrdinal(key.translations[this.config.defaultLocale] ?? '');
    }

    /**
     * Whether any module needs the generated ordinal resolver.
     *
     * Every locale's translation counts, not just the template's. A locale may
     * legitimately add a `selectordinal` the template does not have — its
     * arguments still match, so it renders — and judging from the template alone
     * left those generated call sites importing `modular_ordinal.dart` from a
     * file that was never written.
     *
     * Deliberately an over-approximation: a locale whose text falls back to the
     * template can make this true unnecessarily, which only costs an unused
     * helper. Missing one is a compile error, so the safe direction to err is
     * here.
     */
    private needsOrdinalHelper(modules: ParsedModule[]): boolean {
        return modules.some((module) =>
            module.keys.some((key) =>
                Object.values(key.translations).some((text) => this.textUsesOrdinal(text))
            )
        );
    }

    /**
     * One locale's resolution of a message.
     *
     * The closure always takes the *canonical* parameter list — derived from the
     * template locale — because intl dispatches through `Function.apply`, which
     * binds positionally. A closure shaped by the translation's own arguments
     * throws `NoSuchMethodError` the moment the two disagree, which is what a
     * plural added in only one locale used to do.
     *
     * These entries must not pass `name:` / `args:` to `Intl.plural` /
     * `Intl.select`: supplying `name` makes intl look the message up, the lookup
     * resolves back to this closure, and the recursion ends in
     * StackOverflowError on the first call.
     */
    private renderLookupEntry(
        entry: MessageEntry,
        renderedText: string,
        renderedLocale: string
    ): string {
        const canonical = entry.params;

        // Fall back to the template translation only when this locale's message
        // cannot be satisfied by the canonical arguments — an argument the
        // template does not declare, or one used in a role its type cannot
        // serve. Either would fail to compile.
        const fallback = this.lookupFallbackReason(entry);
        if (fallback) {
            this.warnOnce(
                `lookup-fallback:${entry.locale}:${entry.key}`,
                `[${entry.locale}] ${entry.key}: ${fallback}; using the ` +
                `${this.config.defaultLocale} translation instead`
            );
            return this.renderStaticLookupEntry(entry, renderedText);
        }

        const { nodes } = parseIcu(renderedText);
        const ctx: RenderContext = {
            names: new Set(canonical),
            // No formatting in a lookup entry: the formatted value is what the
            // caller passes, having been produced in the module method.
            alias: new Map(),
            ordinalLocale: this.ordinalLocaleLiteral(renderedLocale),
        };
        const body = this.renderNodes(nodes, ctx);

        if (canonical.length === 0 && !this.needsIntl(renderedText)) {
            return `    '${entry.key}': MessageLookupByLibrary.simpleMessage('${body}'),`;
        }
        return `    '${entry.key}': (${canonical.join(', ')}) => '${body}',`;
    }

    /**
 * The text a lookup entry will render, and the locale that text belongs to.
 *
 * The two have to travel together. `value` is already the template text when a
 * locale has no translation of its own, so a locale read off the file being
 * written names rules for text that is not there — an English message selecting
 * its ordinals with German rules, which is where "1st" became "1th".
 */
private renderedLookupEntry(entry: MessageEntry): { text: string; locale: string } {
    // A translation that cannot be satisfied by the canonical arguments renders
    // the template instead, so the template locale's rules apply to it.
    if (this.lookupFallbackReason(entry)) {
        return {
            text: entry.translationKey.translations[this.config.defaultLocale] ?? '',
            locale: this.config.defaultLocale,
        };
    }
    return { text: entry.value, locale: entry.textLocale };
}

    private renderStaticLookupEntry(entry: MessageEntry, text: string): string {
        const { nodes } = parseIcu(text);
        // This entry renders the template text, whichever locale asked for it.
        const ctx: RenderContext = {
            names: new Set(entry.params),
            alias: new Map(),
            ordinalLocale: this.defaultLocaleLiteral(),
        };
        return `    '${entry.key}': (${entry.params.join(', ')}) => '${this.renderNodes(nodes, ctx)}',`;
    }

    /**
 * The template locale's arguments, each paired with the Dart type the module
 * method gives it.
 *
 * Computed from the template and its `@key` metadata, which is exactly what
 * `generateMethod` builds the signature from — so this is the type a locale's
 * closure will actually be called with.
 */
    private canonicalArgs(key: TranslationKey): CanonicalArg[] {
        const template = key.translations[this.config.defaultLocale] ?? '';
        const args = ArbParser.getArguments(template);
        const canonical = buildCanonicalArgs(args, key.placeholders);

        // One warning per declaration the role overruled, not one per message
        // that happens to use it. Keyed on the ARB name, which is what the
        // author has to edit.
        for (const arg of canonical) {
            const declared = key.placeholders?.[arg.name]?.type;
            if (!declared || declared === arg.dartType) continue;
            const role = args.find((a) => a.name === arg.name)?.role;
            if (role && !checkRoleCompatibility(declared, role).ok) {
                this.warnPlaceholderTypeOverride(arg.name, declared, arg.dartType);
            }
        }
        return canonical;
    }

/**
 * Decide whether this locale's translation can be rendered with the canonical
 * arguments, returning the reason when it cannot.
 *
 * The only reasons are the two that make the generated Dart fail to compile: an
 * argument the template does not declare, and an argument used in a role its
 * canonical type cannot serve. See {@link firstIncompatibleArg}.
 *
 * Earlier this also compared a description of the two messages' ICU shape, and
 * that description included literal text and plain `{name}` positions. It
 * therefore disagreed over a translated comma, a moved word, or any sentence
 * split differently — and every one of those translations was silently replaced
 * by the English text, in every language, for the ordinary act of translating.
 */
private lookupFallbackReason(entry: MessageEntry): string | null {
    const incompatible = firstIncompatibleArg(
        this.canonicalArgs(entry.translationKey),
        ArbParser.getArguments(entry.value)
    );
    return incompatible ? incompatible.reason : null;
}

    private async generateMessagesAll(modules: ParsedModule[]): Promise<void> {
        // FIXED: Namespaced imports and function to avoid Flutter Intl conflict
        // Sorted so the emitted file satisfies directives_ordering, which the
        // Flutter projects we generate into usually enable.
        const localeImports = this.config.supportedLocales
            .map((l) => `import 'modular_messages_${l}.dart' as modular_messages_${l.replace(/-/g, '_')};`)
            .sort()
            .join('\n');

        const deferredImports = this.config.useDeferredLoading
            ? this.config.supportedLocales
                .map((l) => `import 'modular_messages_${l}.dart' deferred as modular_messages_${l.replace(/-/g, '_')};`)
                .sort()
                .join('\n')
            : '';

        const actualImports = this.config.useDeferredLoading ? deferredImports : localeImports;

        const localeKey = (l: string) => l.replace(/-/g, '_');

        const deferredLibraries = this.config.useDeferredLoading
            ? this.config.supportedLocales
                .map((l) => `  '${l}': () => modular_messages_${localeKey(l)}.loadLibrary(),`)
                .join('\n')
            : this.config.supportedLocales
                .map((l) => `  '${l}': () => Future.value(null),`)
                .join('\n');

        const content = `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
${GENERATED_IGNORES}
import 'package:intl/intl.dart';
import 'package:intl/message_lookup_by_library.dart';
import 'package:intl/src/intl_helpers.dart';

${actualImports}

typedef LibraryLoader = Future<dynamic> Function();

Map<String, LibraryLoader> _deferredLibraries = {
${deferredLibraries}
};

MessageLookupByLibrary? _findExact(String localeName) {
  switch (localeName) {
${this.config.supportedLocales.map((l) => `    case '${l}':\n      return modular_messages_${localeKey(l)}.messages;`).join('\n')}
    default:
      return null;
  }
}

MessageLookupByLibrary? _findGeneratedMessagesFor(String locale) {
  final actualLocale = Intl.verifiedLocale(
    locale,
    (locale) => _deferredLibraries[locale] != null,
    onFailure: (_) => null,
  );
  if (actualLocale == null) return null;
  return _findExact(actualLocale);
}

/// Initialize modular localization messages.
/// Named differently from Flutter Intl's initializeMessages to avoid conflicts.
Future<bool> initializeModularMessages(String localeName) async {
  final availableLocale = Intl.verifiedLocale(
    localeName,
    (locale) => _deferredLibraries[locale] != null,
    onFailure: (_) => null,
  );
  if (availableLocale == null) {
    return false;
  }
  final lib = _deferredLibraries[availableLocale];
  await lib?.call();
  initializeInternalMessageLookup(CompositeMessageLookup.new);
  messageLookup.addLocale(availableLocale, _findGeneratedMessagesFor);
  return true;
}
`;

        // FIXED: Namespaced filename to avoid conflicts
        const filePath = path.join(this.config.outputPath, 'intl', 'modular_messages_all.dart');
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    private async generateCombinedArbFiles(modules: ParsedModule[]): Promise<void> {
        const arbDir = path.join(this.config.outputPath, 'arb');
        fs.mkdirSync(arbDir, { recursive: true });

        for (const locale of this.config.supportedLocales) {
            // Date only, no clock time: a full ISO timestamp changes on every
            // run, so watch mode would mark these files dirty on every save.
            const combinedArb: Record<string, unknown> = {
                '@@locale': locale,
                '@@last_modified': new Date().toISOString().split('T')[0],
            };

            for (const module of modules) {
                for (const key of module.keys) {
                    const fullKey = `${module.name}_${key.key}`;
                    combinedArb[fullKey] = this.translationText(key, locale);

                    if (key.description || key.placeholders) {
                        combinedArb[`@${fullKey}`] = {
                            description: key.description,
                            placeholders: key.placeholders,
                        };
                    }
                }
            }

            const filePath = path.join(arbDir, `modular_l10n_${locale}.arb`);
            this.writeIfChanged(filePath, JSON.stringify(combinedArb, null, 2));
        }
    }

    private async generateBarrelFile(modules: ParsedModule[]): Promise<void> {
        // A part file cannot be exported, but the entry point it belongs to
        // re-exposes every module class, so the barrel's surface is unchanged.
        const exports = [
            `export '${this.toSnakeCase(this.config.className)}.dart';`,
            `export 'app_localization_delegate.dart';`,
            ...(this.config.moduleAccess === 'part'
                ? []
                : modules.map((m) => `export '${this.toSnakeCase(m.name)}_l10n.dart';`)),
        ].sort();

        const content = `// GENERATED CODE - DO NOT MODIFY BY HAND
// Generated by Modular Flutter L10n Extension
${GENERATED_IGNORES}
${exports.join('\n')}
`;

        const filePath = path.join(this.config.outputPath, 'l10n.dart');
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    /**
     * Write `intl/modular_ordinal.dart` when any message uses `selectordinal`.
     *
     * intl resolves `selectordinal` with cardinal rules, so the ordinal category
     * has to come from the CLDR data compiled into this file. Only the rule sets
     * the project's locales reference are emitted.
     */
    private async generateOrdinalHelper(modules: ParsedModule[]): Promise<void> {
        const locales = this.localesWithOrdinals(modules);
        if (locales.length === 0) return;

        const { content, unmapped } = compileOrdinals(locales);
        for (const locale of unmapped) {
            this.warnOnce(
                `ordinal-unmapped:${locale}`,
                `No CLDR ordinal rules for "${locale}"; ordinal messages will fall back to "other"`
            );
        }

        const filePath = path.join(this.config.outputPath, 'intl', 'modular_ordinal.dart');
        this.writeIfChanged(filePath, content);
    }

    /**
     * Locales that need an ordinal rule set, from `selectordinal` usage.
     *
     * Every locale is judged on its own translation. Restricting this to the
     * locales whose *template* carries the construct was sound only while a
     * locale that added one fell back to the template; now it renders, so a
     * locale-only `selectordinal` needs a rule set and the generated file that
     * `modularOrdinalCategory` lives in.
     *
     * An over-approximation is safe in the other direction too: a locale whose
     * text falls back to an ordinal template is listed even though its own text
     * has no ordinal, and an unused entry in the rule map costs nothing.
     */
    private localesWithOrdinals(modules: ParsedModule[]): string[] {
        const locales = new Set<string>();

        for (const module of modules) {
            for (const key of module.keys) {
                for (const locale of this.config.supportedLocales) {
                    if (this.textUsesOrdinal(key.translations[locale] ?? '')) locales.add(locale);
                }
            }
        }

        return [...locales].sort();
    }

    /**
     * Write only when the content differs from what's on disk.
     *
     * Generated output is regenerated on every ARB save in watch mode; rewriting
     * byte-identical files churns mtimes, and for the combined ARBs it puts them
     * in every `git status` for no reason.
     */
    private writeIfChanged(filePath: string, content: string): void {
        try {
            if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === content) {
                return;
            }
        } catch {
            // Unreadable: fall through and overwrite.
        }
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    // ─── String utilities ────────────────────────────────────────────────

    private toPascalCase(str: string): string {
        return str
            .split(/[_-]/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    private toCamelCase(str: string): string {
        const pascal = this.toPascalCase(str);
        return pascal.charAt(0).toLowerCase() + pascal.slice(1);
    }

    private toSnakeCase(str: string): string {
        return toSnakeCaseName(str);
    }

    /**
     * Escape a run of **literal** text for a single-quoted Dart string.
     *
     * `$` becomes `\$` here, which is correct for text that must render
     * verbatim — but it also means this must never be applied to interpolation
     * that the generator has synthesised. Use {@link toDartLiteralBody} to build
     * a literal that mixes both.
     */
    private escapeDartString(str: string): string {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t')
            .replace(/\$/g, '\\$');
    }

    /**
     * Build the body of a single-quoted Dart string from ARB text, turning
     * `{name}` placeholders into live interpolations and escaping everything
     * around them.
     *
     * The ordering matters and is the whole point of this helper: escaping a
     * string that already contains `$name` turns the interpolation into the
     * literal characters `\$name`, so the user sees `$name` on screen. Literal
     * runs are escaped individually and the interpolations are emitted raw.
     *
     * `{name}` is written as `$name` when the following character can't extend
     * the identifier, and `${name}` when it can — so `{n}items` yields
     * `${n}items`, not the undefined identifier `$nitems`.
     *
     * `interpolate` limits which names become interpolations; anything outside
     * it is left as literal `{name}` text. Locale files pass the canonical
     * parameter list here so a rogue placeholder in one translation can't
     * reference an undeclared variable and break the build.
     */
    private toDartLiteralBody(text: string, interpolate?: Set<string>): string {
        let out = '';
        let literalStart = 0;
        let i = 0;

        const flushLiteral = (end: number) => {
            if (end > literalStart) {
                out += this.escapeDartString(text.substring(literalStart, end));
            }
        };

        while (i < text.length) {
            if (text[i] !== '{') {
                i++;
                continue;
            }

            const match = text.substring(i).match(/^\{(\w+)\}/);
            if (!match || (interpolate && !interpolate.has(match[1]))) {
                i++;
                continue;
            }

            flushLiteral(i);

            const name = match[1];
            const after = text[i + match[0].length];
            const needsBraces = after !== undefined && /[A-Za-z0-9_]/.test(after);
            out += needsBraces ? `\${${name}}` : `$${name}`;

            i += match[0].length;
            literalStart = i;
        }

        flushLiteral(text.length);
        return out;
    }

    /**
     * Escape string for Dart doc comments.
     */
    private escapeForDartDoc(str: string): string {
        return str
            .replace(/`/g, "'")
            .replace(/\n/g, ' ')
            .replace(/\r/g, ' ')
            .substring(0, 200);
    }
}