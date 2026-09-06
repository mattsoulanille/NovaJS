import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import { deriveAvroSchema } from './io_ts_to_avro.js';
import {
    avroWireCodec, decodeWire, jsonWireCodec, makeWireCodec, msgpackWireCodec,
    WIRE_ENCODING, WireCodec,
} from './wire_codec.js';

const Message = t.exact(t.intersection([
    t.type({ id: t.string, values: t.array(t.number), nested: t.type({ flag: t.boolean }) }),
    t.partial({ note: t.string }),
]));
type Message = t.TypeOf<typeof Message>;

describe('WireCodec', () => {
    const sample: Message = { id: 'a', values: [1, 2.5, -3], nested: { flag: true } };
    const avro = avroWireCodec(deriveAvroSchema(Message, { name: 'Message' }).schema);
    const codecs: WireCodec[] = [jsonWireCodec, msgpackWireCodec, avro];

    it('json stays the active encoding', () => {
        expect(WIRE_ENCODING).toBe('json');
        expect(makeWireCodec(WIRE_ENCODING, () => 'null')).toBe(jsonWireCodec);
    });

    it('json encodes exactly what the socket sends today', () => {
        const bytes = jsonWireCodec.encode(sample);
        expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify(sample));
    });

    for (const codec of codecs) {
        describe(codec.encoding, () => {
            it('round-trips through the io-ts gate', () => {
                const decoded = decodeWire(codec, Message, codec.encode(sample));
                expect(isLeft(decoded)).toBeFalse();
                expect(!isLeft(decoded) && decoded.right).toEqual(sample);
            });

            it('round-trips an optional field present and absent', () => {
                const withNote = { ...sample, note: 'n' };
                expect(decodeWire(codec, Message, codec.encode(withNote)))
                    .toEqual(t.success(withNote));
                const back = decodeWire(codec, Message, codec.encode(sample));
                expect(!isLeft(back) && 'note' in back.right).toBeFalse();
            });

            it('reports unparseable bytes as a decode failure, not a throw', () => {
                const decoded = decodeWire(codec, Message, new Uint8Array([0xff, 0x00, 0xc1]));
                expect(isLeft(decoded)).toBeTrue();
            });

            it('rejects a well-formed message of the wrong shape at the gate', () => {
                const wrong = { id: 5, values: 'x', nested: {} };
                let bytes: Uint8Array;
                try {
                    bytes = codec.encode(wrong);
                } catch {
                    // avro refuses at encode time: the schema is real.
                    expect(codec.encoding).toBe('avro');
                    return;
                }
                expect(isLeft(decodeWire(codec, Message, bytes))).toBeTrue();
            });
        });
    }

    it('makeWireCodec derives the schema only for avro', () => {
        let derived = 0;
        const schema = () => { derived++; return deriveAvroSchema(Message).schema; };
        expect(makeWireCodec('json', schema).encoding).toBe('json');
        expect(makeWireCodec('msgpack', schema).encoding).toBe('msgpack');
        expect(derived).toBe(0);
        expect(makeWireCodec('avro', schema).encoding).toBe('avro');
        expect(derived).toBe(1);
    });

    describe('number fidelity', () => {
        const Doubles = t.type({ z: t.number, n: t.number });
        const avroDoubles = avroWireCodec(deriveAvroSchema(Doubles).schema);

        it('avro keeps −0 and NaN (they are IEEE doubles on the wire)', () => {
            const back = avroDoubles.decode(avroDoubles.encode({ z: -0, n: NaN })) as { z: number, n: number };
            expect(Object.is(back.z, -0)).toBeTrue();
            expect(Number.isNaN(back.n)).toBeTrue();
        });

        it('msgpack keeps NaN but not −0 (a safe integer goes as an int)', () => {
            // Documented limitation: @msgpack/msgpack encodes -0 as the
            // integer 0 unless every number is forced to float64. Should
            // a future version change this, the report's caveat goes.
            const back = msgpackWireCodec.decode(msgpackWireCodec.encode({ z: -0, n: NaN })) as { z: number, n: number };
            expect(Object.is(back.z, -0)).toBeFalse();
            expect(Number.isNaN(back.n)).toBeTrue();
        });

        it('json keeps neither', () => {
            const back = jsonWireCodec.decode(jsonWireCodec.encode({ z: -0, n: NaN })) as { z: number, n: unknown };
            expect(Object.is(back.z, -0)).toBeFalse();
            expect(back.n).toBeNull();
        });
    });

    it('avro exposes a schema fingerprint that changes with the shape', () => {
        const other = avroWireCodec(deriveAvroSchema(t.type({ id: t.string }), { name: 'Message' }).schema);
        expect(avro.fingerprint).toMatch(/^[0-9a-f]{32}$/);
        expect(other.fingerprint).not.toBe(avro.fingerprint);
        expect(avroWireCodec(deriveAvroSchema(Message, { name: 'Message' }).schema).fingerprint)
            .toBe(avro.fingerprint);
    });
});
