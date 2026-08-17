import 'jasmine';
import { immerable } from 'immer';
import { cloneEncoded } from './snapshot_plugin.js';

class Point {
    [immerable] = true;
    constructor(readonly x: number, readonly y: number) { }
    length() {
        return Math.hypot(this.x, this.y);
    }
}

class Tagged {
    get [Symbol.toStringTag]() {
        return 'Tagged';
    }
    value = 1;
}

describe('cloneEncoded', () => {
    const cases: [string, unknown][] = [
        ['undefined', undefined],
        ['null', null],
        ['number', 3.5],
        ['negative zero', -0],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
        ['string', 'hello'],
        ['boolean', true],
        ['bigint', 12345678901234567890n],
        ['empty object', {}],
        ['flat object', { a: 1, b: 'two', c: null, d: undefined }],
        ['nested object', { a: { b: { c: [1, { d: NaN }] } }, e: Infinity }],
        ['integer keys reorder', { b: 1, 2: 'two', a: 3, 1: 'one' }],
        ['null prototype', Object.assign(Object.create(null), { x: 1 })],
        ['class instance', new Point(1, 2)],
        ['class instances nested (MovementState-like)', {
            position: new Point(1, 2),
            velocity: new Point(0, -1),
            rotation: { angle: 0.5 },
            accelerating: 0,
            turning: 0,
            turnBack: false,
            turnTo: null,
        }],
        ['empty array', []],
        ['array of primitives', [1, 'a', null, undefined, NaN]],
        ['array of arrays', [[1, 2], [3, [4, 5]]]],
        ['array of objects', [{ a: 1 }, { b: [2] }]],
        ['sparse array', [1, , 3]], // eslint-disable-line no-sparse-arrays
        ['array with extra property', Object.assign([1, 2], { extra: 'x' })],
        ['Map', new Map<unknown, unknown>([['a', 1], [{ k: 1 }, [2]]])],
        ['Set', new Set([1, 'two', { three: 3 }])],
        ['Date', new Date(1234567890)],
        ['RegExp', /ab+c/gi],
        ['typed array', new Uint8Array([1, 2, 3])],
        ['ArrayBuffer', new Uint8Array([9, 8]).buffer],
        ['boxed number', new Number(4)],
        ['boxed string', new String('s')],
        ['tagged class instance', new Tagged()],
        ['object containing a Map', { m: new Map([['k', new Point(3, 4)]]) }],
        ['object with accessor', Object.defineProperty({ a: 1 }, 'b', {
            get: () => 2, enumerable: true,
        })],
        ['object with non-enumerable', Object.defineProperty({ a: 1 }, 'hidden', {
            value: 2, enumerable: false,
        })],
    ];

    // Jasmine's toEqual trips over Maps/Sets from node's structuredClone
    // (a different realm), so compare structure by hand.
    function describeValue(value: unknown): unknown {
        if (typeof value === 'bigint') {
            return `bigint:${value}`;
        }
        if (typeof value === 'number') {
            return Object.is(value, -0) ? '-0' : Number.isNaN(value) ? 'NaN' : value;
        }
        if (typeof value !== 'object' || value === null) {
            return value;
        }
        const tag = Object.prototype.toString.call(value);
        const proto = Object.getPrototypeOf(value);
        const protoName = proto === null ? 'null'
            : proto === Object.prototype ? 'Object' : proto.constructor?.name;
        if (value instanceof Map) {
            return { tag, protoName, entries: [...value].map(([k, v]) => [describeValue(k), describeValue(v)]) };
        }
        if (value instanceof Set) {
            return { tag, protoName, values: [...value].map(describeValue) };
        }
        if (value instanceof Date) {
            return { tag, protoName, time: value.getTime() };
        }
        if (value instanceof RegExp) {
            return { tag, protoName, source: value.source, flags: value.flags };
        }
        if (ArrayBuffer.isView(value)) {
            return { tag, protoName, bytes: [...new Uint8Array(value.buffer)] };
        }
        if (value instanceof ArrayBuffer) {
            return { tag, protoName, bytes: [...new Uint8Array(value)] };
        }
        if (Array.isArray(value)) {
            const holes: number[] = [];
            for (let i = 0; i < value.length; i++) {
                if (!(i in value)) {
                    holes.push(i);
                }
            }
            return {
                tag, protoName, length: value.length, holes,
                items: value.map(describeValue),
                extra: Object.keys(value).filter(k => !/^\d+$/.test(k))
                    .map(k => [k, describeValue((value as unknown as Record<string, unknown>)[k])]),
            };
        }
        return {
            tag, protoName,
            keys: Object.keys(value),
            props: Object.entries(value).map(([k, v]) => [k, describeValue(v)]),
            valueOf: (value instanceof Number || value instanceof String
                || value instanceof Boolean) ? value.valueOf() : undefined,
        };
    }

    for (const [name, value] of cases) {
        it(`matches structuredClone for ${name}`, () => {
            const expected = structuredClone(value);
            const actual = cloneEncoded(value);
            expect(describeValue(actual)).toEqual(describeValue(expected));
            if (typeof value === 'object' && value !== null) {
                expect(actual).not.toBe(value);
            }
        });
    }

    it('produces a detached deep copy', () => {
        const source = { a: { b: [1, { c: 2 }] }, p: new Point(1, 1) };
        const copy = cloneEncoded(source);
        copy.a.b.push(3);
        (copy.a.b[1] as { c: number }).c = 99;
        (copy.p as unknown as { x: number }).x = 42;
        expect(source.a.b).toEqual([1, { c: 2 }]);
        expect(source.p.x).toBe(1);
    });

    it('preserves array holes and extra properties like structuredClone', () => {
        const sparse = cloneEncoded([1, , 3]); // eslint-disable-line no-sparse-arrays
        expect(1 in sparse).toBeFalse();
        const extra = cloneEncoded(Object.assign([1], { tag: 't' })) as number[] & { tag: string };
        expect(extra.tag).toBe('t');
    });

    it('preserves shared references and cycles like structuredClone', () => {
        const shared = { n: 1 };
        const source: { a: typeof shared, b: typeof shared, self?: unknown } =
            { a: shared, b: shared };
        source.self = source;
        const copy = cloneEncoded(source);
        // One shared object in, one shared object out.
        expect(copy.a).toBe(copy.b);
        expect(copy.a).not.toBe(shared);
        expect(copy.self).toBe(copy);
        // Same as the reference implementation.
        const ref = structuredClone(source);
        expect(ref.a).toBe(ref.b);
        expect(ref.self).toBe(ref);
        // Deep nesting stays linear (no exponential re-cloning of shared
        // subtrees).
        const leaf = { v: [1, 2, 3] };
        const wide = Array.from({ length: 200 }, () => leaf);
        const wideCopy = cloneEncoded(wide);
        expect(new Set(wideCopy).size).toBe(1);
    });

    it('rejects what structuredClone rejects', () => {
        expect(() => cloneEncoded(() => 1)).toThrowError(/could not be cloned|DataCloneError/i);
        expect(() => cloneEncoded({ f: () => 1 })).toThrowError(/could not be cloned|DataCloneError/i);
        expect(() => cloneEncoded(Symbol('s') as unknown))
            .toThrowError(/could not be cloned|DataCloneError/i);
    });
});
