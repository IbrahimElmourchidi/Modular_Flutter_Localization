// Fixture corpus for ARB/ICU correctness work.
//
// Plain data, no assertions. Used to snapshot generator output (Phase 0) and to
// diff it while the ICU parser lands. Every entry is one ARB message.
//
// `expect` records what the *fixed* generator should do. It is documentation for
// the diff review, not an assertion — Phase 0's job is to record today's
// behaviour so that a change can be classified, not to pass or fail.
//
// bucket:
//   a = does not compile today (undefined identifier, or a missing required
//       `other` on Intl.plural/Intl.select); fix is invisible to callers
//   b = compiles today; signature changes -> BREAKING
//   c = compiles today; rendered text changes
//   - = unchanged by this work

export interface Fixture {
    key: string;
    /** Template (default-locale) message. Absent only for locale-only fixtures. */
    en?: string;
    bucket: '-' | 'a' | 'b' | 'c';
    note?: string;
    ar?: string;
    ru?: string;
    placeholders?: Record<string, Record<string, unknown>>;
    /**
     * Whether `parseIcu` is expected to report at least one error. Set it for
     * deliberately malformed input or a construct the parser rejects; the
     * parser must still return a usable tree.
     */
    expectParseError?: boolean;
}

export const FIXTURES: Fixture[] = [
    // ---- plain placeholders (expect unchanged) ----
    { key: 'simple', en: 'Hello {name}', bucket: '-', note: 'single placeholder' },
    { key: 'twoArgs', en: '{greeting}, {name}!', bucket: '-', note: 'two placeholders' },
    { key: 'adjacent', en: '{n} items left', bucket: '-', note: 'must render ${n}items, not $nitems' },
    { key: 'noArgs', en: 'Static text', bucket: '-', note: 'must keep the getter form' },
    { key: 'multiline', en: 'Line one\nLine two\twith tab', bucket: '-', note: 'escapes' },
    {
        key: 'dollarSign',
        en: 'Costs {price} USD',
        bucket: '-',
        note: '$ must survive as a literal',
    },

    // ---- typing (expect unchanged) ----
    { key: 'typedInt', en: 'You have {count} items', bucket: '-', placeholders: { count: { type: 'int', example: '1' } } },
    { key: 'typedDouble', en: 'Total {amount}', bucket: '-', placeholders: { amount: { type: 'double', example: '1.5' } } },
    { key: 'typedNum', en: 'Total {amount}', bucket: '-', placeholders: { amount: { type: 'num', example: '1.5' } } },
    { key: 'typedBool', en: 'Flag is {on}', bucket: 'c', note: 'bool missing from the type switch', placeholders: { on: { type: 'bool', example: 'true' } } },
    { key: 'typedDate', en: 'On {when}', bucket: '-', placeholders: { when: { type: 'DateTime', example: '2000-01-30' } } },
    { key: 'untyped', en: 'Total {amount}', bucket: '-', note: 'no type -> Object; example is not used for typing', placeholders: { amount: { example: '10.50' } } },
    {
        key: 'numericExample',
        en: 'Total {amount}',
        bucket: '-',
        note: 'example as a bare JSON number',
        placeholders: { amount: { type: 'num', example: 10.5 } },
    },

    // ---- formatting (expect unchanged; verified working) ----
    {
        key: 'namedDate',
        en: 'On {when}',
        ar: 'يوم {when}',
        bucket: '-',
        placeholders: { when: { type: 'DateTime', format: 'yMMMd', example: '2000-01-30' } },
    },
    {
        key: 'customDate',
        en: 'Born {when}',
        bucket: '-',
        placeholders: {
            when: { type: 'DateTime', format: 'yyyy-MM-dd', isCustomDateFormat: 'true', example: '2000-01-30' },
        },
    },
    {
        key: 'currency',
        en: 'Total {amount}',
        ar: 'المجموع {amount}',
        bucket: '-',
        placeholders: {
            // `decimalDigits` as a bare JSON number: valid ARB, and the
            // generator must emit `decimalDigits: 2` rather than `'2'`.
            amount: {
                type: 'num',
                format: 'currency',
                example: '10.5',
                optionalParameters: { symbol: '$', decimalDigits: 2 },
            },
        },
    },
    {
        key: 'compact',
        en: 'Views {count}',
        bucket: '-',
        placeholders: { count: { type: 'int', format: 'compact', example: '1000' } },
    },

    // ---- plural: baseline and the =N family ----
    { key: 'pluralBasic', en: '{count, plural, =0{no items} =1{one item} other{{count} items}}', bucket: '-' },
    { key: 'pluralNamed', en: '{c, plural, one{one thing} other{{c} things}}', bucket: '-' },
    {
        key: 'pluralEq5',
        en: '{c, plural, =5{five} other{{c} things}}',
        bucket: 'c',
        note: '=5 is silently dropped today; caseNames only knows =0/=1/=2',
    },
    {
        key: 'pluralRuExact',
        en: '{c, plural, =1{exactly one} other{{c} items}}',
        ru: '{c, plural, =1{ровно один} =5{пять} other{{c} предметов}}',
        bucket: 'c',
        note: '=1 must NOT alias to the one category; ru 21 would show the exact text',
    },
    {
        key: 'pluralOffset',
        en: '{c, plural, offset:1 =0{nobody} =1{just you} other{you and {c} others}}',
        bucket: 'c',
        note: 'offset:1 dropped today; =N matches raw value, categories use value-offset',
    },
    {
        key: 'pluralOffsetHash',
        en: '{c, plural, offset:1 other{you and # others}}',
        bucket: 'c',
        note: '# must be the shifted value',
    },
    {
        key: 'pluralRtl',
        en: '{count, plural, zero{none} one{message} few{messages} many{messages} other{messages}}',
        ar: '{count, plural, zero{لا رسائل} one{رسالة} two{رسالتان} few{{count} رسائل} many{{count} رسالة} other{{count} رسالة}}',
        bucket: '-',
        note: 'full CLDR category set; verified working',
    },

    // ---- # shorthand ----
    { key: 'hashPlural', en: '{count, plural, one{# item} other{# items}}', bucket: 'c', note: '# never substituted today' },
    { key: 'hashMid', en: '{count, plural, other{You have # left}}', bucket: 'c' },
    {
        key: 'hashLiteral',
        en: 'Order #{id}',
        bucket: 'c',
        note: '# outside a plural stays literal; text around a placeholder must survive',
    },

    // ---- select ----
    { key: 'selectBasic', en: '{gender, select, male{He} female{She} other{They}} replied', bucket: '-' },
    { key: 'selectSpaced', en: '{g, select, male {He} other {They}}', bucket: '-' },
    {
        key: 'selectNoOther',
        en: '{gender, select, male{He} female{She}} replied',
        bucket: 'a',
        note:
            "Intl.select's `other` is a required named param -> compile error. " +
            'Well-formed ICU, so the parser is silent; icu_diagnostics reports it.',
    },
    {
        key: 'pluralNoOther',
        en: '{c, plural, one{thing}}',
        bucket: 'a',
        note: 'same, for plural',
    },

    // ---- compound ----
    {
        key: 'compound',
        en: '{gender, select, male{He} other{They}} has {count, plural, one{1 item} other{{count} items}}',
        bucket: '-',
    },
    {
        key: 'textAroundPlural',
        en: '{name} has {count, plural, one{1 item} other{{count} items}}',
        bucket: 'b',
        note: 'BREAKING: compiles today, drops "name" and the word "has"; gains a required param',
    },
    {
        key: 'textAfterPlural',
        en: '{count, plural, one{one item} other{{count} items}} remaining',
        bucket: 'b',
        note: 'BREAKING: trailing text dropped today',
    },

    // ---- nesting ----
    {
        key: 'nestedSelectInPlural',
        en: '{c, plural, other{{g, select, male{he has {c} items} other{they have {c} items}}}}',
        bucket: 'a',
        note: 'well-formed ICU; the bug is that the renderer ships it as literal text',
    },
    {
        key: 'nestedPluralInPlural',
        en: '{c, plural, other{{d, plural, one{{c} of {d}} other{{c} of many}}}}',
        bucket: 'a',
        note: 'compiles to "Undefined name d"',
    },
    {
        key: 'nestedSelectInSelect',
        en: '{a, select, x{{b, select, p{deep} other{shallow}}} other{flat}}',
        bucket: 'a',
    },
    {
        key: 'hashInNestedSelect',
        en: '{c, plural, other{{g, select, male{he has #} other{they have #}}}}',
        bucket: 'c',
        note: '# stays bound to the enclosing plural through the nested select',
    },

    // ---- escaping ----
    { key: 'escapedApostrophe', en: "It''s here, don''t touch {n}", bucket: 'c', note: "renders It''s today" },
    { key: 'quotedBrace', en: "Press '{' to open, {n} left", bucket: 'c', note: "'{' must become a literal brace" },
    { key: 'quotedArg', en: "The '{'literal'}' key", bucket: 'c', note: 'must NOT become an interpolation' },
        {
        key: 'bareBrace',
        en: 'Press { to open',
        bucket: '-',
        note: 'gen_l10n rejects this; we are lenient and report it',
        expectParseError: true,
    },

    // ---- ordinals ----
    {
        key: 'ordinalEn',
        en: '{n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}}',
        bucket: 'c',
        note: 'renders #th for 2 today; needs real CLDR ordinal rules',
    },
    {
        key: 'ordinalRu',
        en: '{n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}}',
        ru: '{n, selectordinal, one{#-й} few{#-й} many{#-й} other{#-й}}',
        bucket: 'c',
        note: 'ru ordinals are other-only; the en template carries the categories',
    },
    {
        key: 'ordinalExact',
        en: '{n, selectordinal, =1{first} =2{second} other{#th}}',
        bucket: 'c',
        note: 'exact selectors stay exact; CLDR rules only pick among categories',
    },
    {
        key: 'ordinalNoOther',
        en: '{n, selectordinal, one{#st} two{#nd}}',
        bucket: 'a',
        note: 'no other case, so the generated call has no fallback',
    },

    // ---- malformed ----
    {
        key: 'wordBoundaryCase',
        en: '{n, plural, other{Someone{ commented} one{one}}',
        bucket: 'a',
        expectParseError: true,
        note: 'indexOf("one{") matches inside "Someone{"; compiles to "Undefined name one"',
    },
    {
        key: 'unbalanced',
        en: '{c, plural, one{unclosed}',
        bucket: 'a',
        expectParseError: true,
    },
    {
        key: 'unknownType',
        en: '{d, date, short{short}}',
        bucket: 'c',
        expectParseError: true,
        note: 'unknown ICU type; pass through + warn',
    },

    // ---- cross-locale shape ----
    {
        key: 'staticDefaultIcuLocale',
        en: 'Static text',
        ar: '{count, plural, zero{صفر} one{واحد} two{اثنان} few{قليل} many{كثير} other{كثير}}',
        bucket: 'c',
        note: 'NoSuchMethodError on ar today; fall back to the default text',
    },
    {
        key: 'icuDefaultStaticLocale',
        en: '{count, plural, one{one} other{{count} many}}',
        ar: 'نص ثابت',
        bucket: 'c',
        note: 'the mirror case; renders its own text, since no argument is incompatible',
    },

    // ---- translations that must not be discarded ----
    //
    // Every fixture above is about the template. These are about a locale being
    // thrown away for being a translation: reordered words, different
    // punctuation, a shorter sentence. The shape check that did this counted
    // literal text and plain `{name}` positions, so all of them matched the
    // English and were replaced by it.
    {
        key: 'translationReorder',
        en: 'Hello {name}',
        ar: 'مرحبا، {name}',
        bucket: 'c',
        note: 'word order and an added comma; the locale text must render',
    },
    {
        key: 'translationTrailingPunctuation',
        en: 'Hello {name}',
        ru: 'Привет, {name}!',
        bucket: 'c',
        note: 'trailing punctuation; the locale text must render',
    },
    {
        key: 'translationNameFirst',
        en: 'Hello {name}',
        ru: '{name}, привет',
        bucket: 'c',
        note: 'the placeholder moves to the front; the locale text must render',
    },
    {
        key: 'translationDropsArgument',
        en: 'Hello {name}',
        ar: 'أهلا',
        bucket: 'c',
        note: 'a translation may legitimately use fewer arguments than the template',
    },
    {
        key: 'localeAddsPlural',
        en: '{count} items',
        ar: '{count, plural, zero{لا عناصر} one{عنصر واحد} two{عنصران} few{قليل} many{كثير} other{كثير عنصر}}',
        bucket: 'c',
        note: 'adding a plural is allowed when the operand type allows it',
        placeholders: { count: { type: 'int', example: '1' } },
    },

    // ---- typing that would not compile ----
    {
        key: 'formattedOperand',
        en: '{count, plural, one{# item} other{# items}}',
        bucket: 'a',
        note: 'Intl.plural takes a num; the formatted String must not reach it',
        placeholders: { count: { type: 'int', format: 'compact', example: '1' } },
    },
    {
        key: 'plainAndOperand',
        en: 'You have {count}. {count, plural, one{# item} other{# items}}',
        bucket: 'a',
        note: 'the operand role decides the type; a plain-first reading gives Object',
    },
    {
        key: 'operandDeclaredString',
        en: '{n, plural, one{# item} other{# items}}',
        bucket: 'a',
        note: 'a plural operand declared String is typed num instead',
        placeholders: { n: { type: 'String', example: '1' } },
    },
    {
        key: 'ordinalOperandDeclaredDouble',
        en: '{n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}}',
        bucket: 'a',
        note: 'the generated resolver takes a num, so double is accepted',
        placeholders: { n: { type: 'double', example: '1' } },
    },
    {
        key: 'localeReusesObjectOperand',
        en: 'Value {a}',
        ru: 'Значение {a, plural, one{одна вещь} other{несколько вещей}}',
        bucket: 'c',
        note: 'Object cannot go to Intl.plural, so this locale still falls back',
    },

    // ---- ordinals ----
    {
        key: 'ordinalOffset',
        en: '{n, selectordinal, offset:1 =0{th} =1{st} other{#th}}',
        bucket: 'c',
        note: 'the category comes from n - 1, the same value # renders',
    },
    {
        key: 'ordinalUntranslatedLocale',
        en: '{n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}}',
        bucket: 'c',
        note: 'zh_Hans renders the English text, so it needs the English rules',
    },

    // ---- quoting ----
    {
        key: 'quotedHashInsidePlural',
        en: "{c, plural, other{Press '#' then # more}}",
        bucket: 'c',
        note: "a quoted '#' is deliberate; it must not be advised to become a plural",
    },
    {
        key: 'quotedHashOutsidePlural',
        en: "Press '#' to go",
        bucket: 'c',
        note: 'ICU only quotes # inside a plural, so the apostrophes are literal text',
    },

    // ---- regressions found in review ----
    //
    // Each of these is a case that was generated wrongly and had no fixture, so
    // a fix could have been made without anything noticing.

    {
        key: 'nestedOrdinal',
        en: '{g, select, male{He finished {n, selectordinal, one{#st} other{#th}}} other{They finished}}',
        bucket: 'a',
        note: 'ordinal detection was top-level only, so modular_ordinal.dart was never written',
    },
    {
        key: 'nestedOrdinalInPlural',
        en: '{c, plural, other{{g, select, male{he took {n, selectordinal, one{#st} other{#th}}} other{they took}}}}',
        bucket: 'a',
        note: 'same, nested the other way round',
    },
    {
        key: 'localeEmptyValue',
        en: '{n, selectordinal, one{#st} two{#nd} few{#rd} other{#th}}',
        ar: '',
        bucket: 'c',
        note: 'the extension writes "" for new locales; the value falls back to the template so the ordinal locale must too',
    },
    {
        key: 'apostropheEatsPlaceholder',
        en: "Bienvenue à l'{place} aujourd'hui",
        bucket: 'c',
        note: 'valid ICU, and it silently drops "place"; must be reported',
        expectParseError: true,
    },
    {
        key: 'apostropheUnclosed',
        en: "unclosed '{place} and the rest",
        bucket: 'c',
        note: 'a quoted run that never closes swallows the rest of the message',
        expectParseError: true,
    },
    {
        key: 'quotedPipe',
        en: "x '|' y",
        bucket: 'c',
        note: "'|' is syntax only inside a select case list, which this parser never reads as text",
    },
    {
        key: 'plainPlusPluralPlusFormat',
        en: '{count} items: {count, plural, one{one left} other{# left}}',
        placeholders: { count: { type: 'int', format: 'decimalPattern' } },
        bucket: 'c',
        note: 'a format on an operand is dropped, so the module method and the lookup entry must both read it raw',
    },
    {
        key: 'pluralAndSelectSameName',
        en: '{n, plural, other{{n, select, one{a} other{b}}}}',
        bucket: 'c',
        note: 'Intl.select on a num always selects other; the typed role is pluralOperand',
    },
    {
        key: 'reservedWordPlaceholder',
        en: 'Hello {default}',
        bucket: 'a',
        note: 'a Dart reserved word as a parameter name does not compile',
    },
    {
        key: 'hashWithLargeValue',
        en: '{c, plural, other{1000 #}}',
        bucket: 'c',
        note: '# substitutes the raw operand, so this is 1000 and not 1,000 — as in gen_l10n',
    },
    {
        key: 'duplicateExactSelector',
        en: '{n, plural, =1{first} =1{again} other{#th}}',
        bucket: 'c',
        note: 'was silently accepted and emitted two equality tests',
        expectParseError: true,
    },
    {
        key: 'missingOtherWithSyntaxError',
        en: '{n, plural, one{a}',
        bucket: 'c',
        note: 'one root cause, one diagnostic: icu-syntax and icu-missing-other used to both fire',
        expectParseError: true,
    },
    {
        key: 'nonDefaultOnlyKey',
        ar: 'مفتاح فقط بالعربية',
        bucket: 'c',
        note: 'no template at all, so the module method has nothing to fall back to',
    },
];

/**
 * Locales the corpus is generated for.
 *
 * `zh-Hans` is hyphenated on purpose (bug 10): the scanner accepts either
 * separator and canonicalises to underscores before the generator sees it, and
 * the harness reproduces that step, so this stands for what the scanner hands
 * over rather than for raw file content.
 *
 * `zh_Hans_CN` is already canonical and carries three subtags. It exists so a
 * locale that has to fall back through `zh_Hans` to `zh` is actually generated —
 * the CLDR ordinal lookup used to stop after one subtag, and no locale here had
 * more than two, so nothing exercised it.
 */
export const FIXTURE_LOCALES = ['en', 'ar', 'ru', 'zh-Hans', 'zh_Hans_CN'];

export const FIXTURE_DEFAULT_LOCALE = 'en';
