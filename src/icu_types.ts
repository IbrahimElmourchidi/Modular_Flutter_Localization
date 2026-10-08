import { ArgRole, IcuArg } from './icu_parser';

/**
 * The Dart type vocabulary the generator emits, and how an ICU role constrains
 * it.
 *
 * This lives apart from both the parser and the generator because two very
 * different places need the same judgement and must not drift:
 *
 *   - the generator, deciding whether a locale's translation can be rendered
 *     with the canonical signature or has to fall back to the template;
 *   - the diagnostics, telling the translator which of the two will happen.
 *
 * The rule it encodes is the one that makes generated Dart compile. Every
 * `plural` or `selectordinal` renders as a call into `package:intl` whose
 * parameter type is fixed by that library:
 *
 *     static String plural(num howMany, {String? zero, String? one, …})
 *     static String select(Object choice, Map<Object, String> cases)
 *
 * `plural` is strict — `num`, not `Object` — so a name the canonical signature
 * types as anything else is a compile error the moment the locale uses it as an
 * operand. `select` takes an `Object`, so it constrains nothing. A plain `{name}`
 * interpolation calls `toString`, which every type has.
 */

/** Declared placeholder types that satisfy `Intl.plural`'s `num howMany`. */
export const NUMERIC_DART_TYPES: ReadonlySet<string> = new Set(['int', 'num', 'double']);

/** A named placeholder and the Dart type the generated method gives it. */
export interface CanonicalArg {
    name: string;
    /** Dart type the generated method's parameter has. */
    dartType: string;
}

/**
 * The subset of `@key.placeholders` that affects typing.
 *
 * Structural rather than `PlaceholderInfo` so this module stays independent of
 * the ARB reader and can be imported by the diagnostics.
 */
export interface PlaceholderMetadata {
    type?: string;
}

/**
 * The Dart type a placeholder's parameter should have.
 *
 * `@key.placeholders` may only *narrow* the type, never contradict it: a name
 * that plays a plural operand has to be numeric, because `Intl.plural` declares
 * `num howMany`. Declaring such a name `String` produced
 * `Intl.plural(n, …)` on a `String n`, which does not compile.
 *
 * A declared numeric type is kept as-is. Narrowing `num` to `int` would change
 * the generated method's public signature for no gain, and the value came from
 * the caller.
 */
export function resolvePlaceholderDartType(
    placeholders: Record<string, PlaceholderMetadata> | undefined,
    name: string,
    args: readonly IcuArg[]
): string {
    const declared = placeholders?.[name]?.type;
    const role = args.find((a) => a.name === name)?.role;

    switch (role) {
        case 'pluralOperand':
        case 'ordinalOperand':
            return declared && NUMERIC_DART_TYPES.has(declared) ? declared : role === 'ordinalOperand' ? 'int' : 'num';

        case 'selectOperand':
            // `Intl.select` takes an `Object`, so a select operand constrains
            // nothing and the declared type stands. `String` is what a keyword is.
            return declared ?? 'String';

        default:
            return declared ?? 'Object';
    }
}

/**
 * The canonical argument list for a message: every name the message uses,
 * paired with the Dart type its parameter should have.
 *
 * Shared because two places need this and must not disagree — the generator,
 * building the signature every locale's closure is called with, and the
 * diagnostics, telling the translator whether their message can be rendered with
 * it. When they resolved types differently the editor reported a translation as
 * broken while the generator rendered it, because one of them was handed the
 * `@key` object where the other was handed `@key.placeholders`.
 *
 * @param args         the message's arguments, from `collectArgs`
 * @param placeholders `@key.placeholders`, or undefined when the ARB declares none
 */
export function buildCanonicalArgs(
    args: readonly IcuArg[],
    placeholders: Record<string, PlaceholderMetadata> | undefined
): CanonicalArg[] {
    return args.map((arg) => ({
        name: arg.name,
        dartType: resolvePlaceholderDartType(placeholders, arg.name, args),
    }));
}

/** The result of checking a canonical type against an ICU role. */
export type RoleCompatibility =
    | { ok: true }
    | {
          ok: false;
          /** Human-readable role, for a diagnostic. */
          role: string;
          /** What the `intl` entry point requires, for a diagnostic. */
          needs: string;
      };

/** Human-readable role names, matching the wording used in ARB documentation. */
const ROLE_LABEL: Record<ArgRole, string> = {
    pluralOperand: 'a plural operand',
    ordinalOperand: 'an ordinal operand',
    selectOperand: 'a select operand',
    plain: 'plain text',
};

/**
 * Whether a parameter typed `dartType` can be rendered in `role` and still
 * compile.
 *
 * The generated ordinal resolver takes a `num` as well, since ordinal categories
 * are defined over integers and a fractional operand is truncated — so
 * `ordinalOperand` and `pluralOperand` have the same requirement here.
 */
export function checkRoleCompatibility(dartType: string, role: ArgRole): RoleCompatibility {
    switch (role) {
        case 'pluralOperand':
        case 'ordinalOperand':
            return NUMERIC_DART_TYPES.has(dartType)
                ? { ok: true }
                : { ok: false, role: ROLE_LABEL[role], needs: 'num' };
        case 'selectOperand':
        case 'plain':
            return { ok: true };
    }
}

/**
 * The first argument a translation cannot be rendered with, or `null` when it
 * can.
 *
 * Two things make a translation unrenderable, and both are compile errors
 * rather than cosmetic ones:
 *
 *  1. It names an argument the canonical signature does not have. intl invokes
 *     the lookup closure through `Function.apply`, so there is nothing for the
 *     name to resolve to.
 *  2. It uses a name the canonical signature does have, but in a role that
 *     parameter's type cannot serve — `{a}` typed `Object` handed to
 *     `Intl.plural`.
 *
 * Deliberately *not* a check: whether the two messages differ in wording,
 * punctuation, word order, or how many blocks they contain. Those are the
 * ordinary results of translating, and every one of them renders correctly.
 *
 * @param canonicalArgs the template locale's arguments and their Dart types
 * @param usedArgs      the arguments of the translation being checked
 */
export function firstIncompatibleArg(
    canonicalArgs: readonly CanonicalArg[],
    usedArgs: readonly { name: string; role: ArgRole }[]
): { name: string; reason: string } | null {
    const canonical = new Map(canonicalArgs.map((a) => [a.name, a]));

    for (const used of usedArgs) {
        const declared = canonical.get(used.name);
        if (!declared) {
            return {
                name: used.name,
                reason: `"${used.name}" is not an argument of the template translation`,
            };
        }

        const compatibility = checkRoleCompatibility(declared.dartType, used.role);
        if (!compatibility.ok) {
            return {
                name: used.name,
                reason:
                    `"${used.name}" is \`${declared.dartType}\` but the translation uses ` +
                    `it as ${compatibility.role}, which needs a \`${compatibility.needs}\``,
            };
        }
    }

    return null;
}