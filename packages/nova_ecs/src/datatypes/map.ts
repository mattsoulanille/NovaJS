import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';

/**
 * A Map codec, encoded as an array of [key, value] tuples — in the Map's
 * insertion order, which is simulation state (the weapons map is fired
 * in it; missions run in acceptance order).
 *
 * Deliberately NOT a plain object for string/number keys (#188, closed
 * on measurement): a JS object lists integer-like keys first and
 * ascending, so it cannot carry that order (and an object built by
 * assignment, as the Avro map reader builds one, turns a `__proto__`
 * key into a prototype); hashWorld sorts object keys, so it would stop
 * seeing the order too; and this encoded form is what saves persist (a
 * mission's `live` map). Nor would it save anything on the binary wire
 * for the string keys every map in the game uses: nova's io_ts_to_avro
 * derives an array of {_0, _1} entry records, which Avro writes as
 * exactly the bytes of an Avro `map` (blocks of string key + value) —
 * measured byte-identical on every frame of a 600-tick, 100-entity
 * combat run. map_test, world_hash_test and io_ts_to_avro_test pin it.
 *
 * A subclass rather than a bare `new t.Type` so schema reflection
 * (nova's io_ts_to_avro) can see the key and value codecs — see
 * SetType for why the `_tag` is harmless to io-ts itself.
 */
export class MapType<Key, KeyEncode, Value, ValueEncode>
    extends t.Type<Map<Key, Value>, [KeyEncode, ValueEncode][], unknown> {
    readonly _tag = 'NovaMapType' as const;
    constructor(readonly domain: t.Type<Key, KeyEncode>,
        readonly codomain: t.Type<Value, ValueEncode>) {
        super(`Map<${domain.name}, ${codomain.name}>`,
            // `every`, not an initial-value-less `reduce`: reduce throws on
            // an empty array, so an empty Map failed the guard (#84).
            (u): u is Map<Key, Value> => u instanceof Map
                && [...u.entries()].every(([k, v]) => domain.is(k) && codomain.is(v)),
            (i, context) => {
                const decoded = t.array(t.tuple([domain, codomain])).validate(i, context);
                if (isLeft(decoded)) {
                    return decoded;
                }
                return right(new Map(decoded.right));
            },
            (a) => [...a].map(([k, v]) =>
                [domain.encode(k), codomain.encode(v)] as [KeyEncode, ValueEncode])
        );
    }
}

export function map<Key, KeyEncode, Value, ValueEncode>(key: t.Type<Key, KeyEncode>,
    value: t.Type<Value, ValueEncode>) {
    return new MapType(key, value);
}
