import * as t from 'io-ts';

/**
 * A string enumeration whose PERSISTED form is deliberately open.
 *
 * Several saved / wire-synced components carry a "reason" or "kind" that
 * is a fixed set of names in THIS build — a SystemHold's reason, a
 * pending mission notice's event type, a pilot-history checkpoint kind —
 * but whose codec has always been a plain `t.string`, so that adding a
 * member is an ADDITIVE change to the shape: a decoder that does not know
 * the new name still decodes the record (review r14 M4), and a save or
 * baseline written by a newer build still loads. Every reader of such a
 * value branches with a default arm, so an unknown name has always been
 * harmless once decoded.
 *
 * This codec keeps exactly that contract while giving producers a real
 * type: the TypeScript type is the union of `members`, while decoding
 * accepts ANY string and carries an unknown one through untouched — it
 * is neither rejected nor remapped, so a re-encode writes back the bytes
 * it read. Non-strings are rejected as `t.string` rejected them. The
 * encoded form is the member itself, byte-identical to the `t.string` it
 * replaces.
 *
 * What the union buys a producer is exactly what the SITE's annotation
 * enforces. A value declared or returned as the member type is checked;
 * so is a fresh literal handed to `ComponentMap.set` / `Entity.addComponent`,
 * whose data parameter is `NoInfer<Data>` precisely so the component's
 * declared type wins (without it TypeScript infers `Data` from both
 * arguments and quietly widens `{reason: 'typo'}` to `{reason: string}`;
 * system_hold_test pins the error). Any other generic sink that infers
 * from the literal as well as from a typed argument can still widen the
 * same way, so a name unknown to this build is a compile error at the
 * annotated and component-set sites, not unconditionally.
 *
 * The cost is honest and bounded: a value decoded from a newer build may
 * hold a name outside the union, so switches over it must keep a default
 * arm (an exhaustiveness check inside that arm is fine — it only guards
 * the members this build declares).
 *
 * Use a closed `t.keyof` / `t.union` of literals instead when the value
 * never leaves this build's memory, or when an unknown name should FAIL
 * the decode.
 */
export function openEnum<M extends string>(name: string,
    members: readonly M[]): OpenEnum<M> {
    // `is` mirrors t.string too: ANY string passes, not only the declared
    // members, so a record holding an unknown name behaves identically to
    // before wherever a codec's guard is consulted (io-ts union
    // discrimination, validation before encode). That is the same
    // additive contract as `validate`, stated once more for the guard.
    // Consequently `SomeEnum.is(x)` is NOT a membership test and must not
    // be used to validate a name against this build's members — use
    // `members.includes(x)` for that. Nothing in production calls `.is`
    // on these codecs today; this note is here for whoever is tempted.
    const codec = new t.Type<M, string, unknown>(
        name,
        (u): u is M => typeof u === 'string',
        (u, c) => typeof u === 'string' ? t.success(u as M) : t.failure(u, c),
        m => m,
    );
    // `_tag` lets reflective consumers of a codec tree (the io-ts → Avro
    // schema derivation in communication/io_ts_to_avro.ts) recognise an
    // open enum and put a plain string on the wire — an Avro enum of this
    // build's members would REJECT the unknown name the contract above
    // promises to carry through.
    return Object.assign(codec, {
        _tag: 'OpenEnumType' as const,
        members: [...members] as readonly M[],
    });
}

/** The codec `openEnum` builds, with its declared members for specs. */
export interface OpenEnum<M extends string> extends t.Type<M, string, unknown> {
    readonly _tag: 'OpenEnumType';
    readonly members: readonly M[];
}
