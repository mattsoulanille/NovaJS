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
 * type: the TypeScript type is the union of `members`, so writing a name
 * this build does not know is a compile error, while decoding accepts ANY
 * string and carries an unknown one through untouched — it is neither
 * rejected nor remapped, so a re-encode writes back the bytes it read.
 * Non-strings are rejected as `t.string` rejected them. The encoded form
 * is the member itself, byte-identical to the `t.string` it replaces.
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
    // `is` mirrors t.string too (any string passes), so a record holding an
    // unknown name behaves identically to before wherever a codec's guard
    // is consulted (union discrimination, validation before encode).
    const codec = new t.Type<M, string, unknown>(
        name,
        (u): u is M => typeof u === 'string',
        (u, c) => typeof u === 'string' ? t.success(u as M) : t.failure(u, c),
        m => m,
    );
    return Object.assign(codec, { members: [...members] as readonly M[] });
}

/** The codec `openEnum` builds, with its declared members for specs. */
export interface OpenEnum<M extends string> extends t.Type<M, string, unknown> {
    readonly members: readonly M[];
}
