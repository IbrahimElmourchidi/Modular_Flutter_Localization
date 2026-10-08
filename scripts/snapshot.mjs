#!/usr/bin/env node
/**
 * Phase 0 snapshot: run the generator over the fixture corpus and record what it
 * produces today.
 *
 *   npx tsc -p . --outDir <tmp>/out --sourceMap false
 *   node scripts/snapshot.mjs <outDir> <snapshotDir>
 *
 * The snapshot is three files per module_access mode:
 *   <snapshotDir>/part/<generated files>
 *   <snapshotDir>/library/<generated files>
 *   <snapshotDir>/report.txt   compile errors + bucket summary
 *
 * This is deliberately a throwaway harness, not a test suite. It exists so that
 * every later change to the generator can be diffed against a recorded
 * baseline and classified as (a) a fix for code that did not compile, (b) a
 * signature change that breaks callers, or (c) a change in rendered text.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
const snapshotDir = process.argv[3];

if (!outDir || !snapshotDir) {
    console.error('usage: node scripts/snapshot.mjs <compiledOutDir> <snapshotDir>');
    process.exit(1);
}

const { DartGenerator } = await import(join(outDir, 'dart_generator.js'));
const { FIXTURES, FIXTURE_LOCALES, FIXTURE_DEFAULT_LOCALE } = await import(
    join(outDir, 'fixtures/icu_corpus.js')
);

// The scanner canonicalises `@@locale` before the generator ever sees it, and
// this harness builds translation keys directly instead of going through the
// scanner. Reproducing that step keeps the corpus on the same footing as a real
// run: a hyphen reaching `supportedLocales` is a bug in the caller, not
// something the generator is expected to absorb — and without this the harness
// generated `Locale('zh-Hans')`, which is not a valid Dart Locale.
//
// Mirrors `normalizeLocale` in src/pubspec_config.ts rather than importing it:
// that module pulls in `yaml`, which this harness cannot resolve from the
// temporary compile directory it runs against.
const normalizeLocale = (locale) => locale.trim().replace(/-/g, '_');
const LOCALES = FIXTURE_LOCALES.map(normalizeLocale);

/** Turn a fixture into the shape ArbParser.parseModules would produce. */
function toTranslationKey(f) {
    const translations = {};
    for (const locale of LOCALES) {
        const value = locale === 'en' ? f.en : f[locale];
        if (value !== undefined) translations[locale] = value;
    }
    return {
        key: f.key,
        translations,
        description: undefined,
        placeholders: f.placeholders
            ? Object.fromEntries(
                  Object.entries(f.placeholders).map(([name, info]) => [
                      name,
                      {
                          type: info.type,
                          example: info.example,
                          format: info.format,
                          isCustomDateFormat: info.isCustomDateFormat,
                          optionalParameters: info.optionalParameters,
                      },
                  ])
              )
            : undefined,
    };
}

const keys = FIXTURES.map(toTranslationKey);
const modules = [{ name: 'fixture', path: '/fixtures', keys }];

for (const moduleAccess of ['part', 'library']) {
    const target = join(snapshotDir, moduleAccess);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    const warnings = [];
    const generator = new DartGenerator({
        outputPath: target,
        className: 'ML',
        defaultLocale: FIXTURE_DEFAULT_LOCALE,
        supportedLocales: LOCALES,
        generateCombinedArb: true,
        useDeferredLoading: false,
        moduleAccess,
        onWarning: (m) => warnings.push(m),
    });
    await generator.generate(modules);

    writeFileSync(join(target, '_warnings.txt'), warnings.join('\n') + '\n');
}

// A single representative corpus file per locale, to keep the report readable.
const fixtureModule = readFileSync(
    join(snapshotDir, 'part', 'fixture_l10n.dart'),
    'utf-8'
);
writeFileSync(join(snapshotDir, 'fixture_l10n.part.dart'), fixtureModule);

const buckets = FIXTURES.reduce((acc, f) => {
    (acc[f.bucket] ??= []).push(f.key);
    return acc;
}, {});
writeFileSync(
    join(snapshotDir, 'buckets.json'),
    JSON.stringify(buckets, null, 2) + '\n'
);

console.log(`snapshot written to ${snapshotDir}`);
console.log(
    Object.entries(buckets)
        .map(([b, keys]) => `  ${b}: ${keys.length} keys`)
        .join('\n')
);
