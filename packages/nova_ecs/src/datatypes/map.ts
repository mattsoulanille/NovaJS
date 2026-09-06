import { isLeft, right } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';

/**
 * A Map codec, encoded as an array of [key, value] tuples. Tracker
 * issue: string- and number-keyed maps could encode as plain objects
 * instead (a wire-format change, so it needs a PROTOCOL_VERSION bump).
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
