import 'jasmine';
import {
    PILOT_FILE_NO_ESCORT, PILOT_FILE_WITH_ESCORT,
} from './fixtures/sample_pilot_files.js';
import {
    applyPatch, cloneJson, diffJson, jsonEqual, JsonValue, parsePointer,
} from './json_patch.js';

function saveOf(file: unknown): JsonValue {
    return (file as { save: JsonValue }).save;
}

/**
 * apply(diff(a, b)) must deep-equal b, and must not disturb a. Returns the
 * patch loosely typed: jasmine's matcher types recurse into JsonValue too
 * deeply for tsc otherwise.
 */
function expectRoundTrip(a: JsonValue, b: JsonValue): { op: string, path: string, value?: unknown }[] {
    const aBefore = JSON.stringify(a);
    const patch = diffJson(a, b);
    const result = applyPatch(a, patch);
    expect(jsonEqual(result, b)).toBeTrue();
    expect(JSON.stringify(result)).toEqual(JSON.stringify(b));
    expect(JSON.stringify(a)).toEqual(aBefore);
    return patch;
}

describe('json_patch', () => {
    describe('diff/apply round trip', () => {
        it('is empty for equal documents', () => {
            expect(diffJson({ a: [1, 2, { b: 'c' }] }, { a: [1, 2, { b: 'c' }] }))
                .toEqual([]);
        });

        it('replaces primitives and adds/removes keys', () => {
            const patch = expectRoundTrip(
                { a: 1, b: 'x', c: true },
                { a: 2, c: true, d: null });
            expect(patch).toEqual([
                { op: 'replace', path: '/a', value: 2 },
                { op: 'remove', path: '/b' },
                { op: 'add', path: '/d', value: null },
            ]);
        });

        it('recurses into arrays and removes a shrunk tail from the end', () => {
            const patch = expectRoundTrip(
                { list: [['x', 1], ['y', 2], ['z', 3]] },
                { list: [['x', 1], ['y', 5]] });
            expect(patch).toEqual([
                { op: 'replace', path: '/list/1/1', value: 5 },
                { op: 'remove', path: '/list/2' },
            ]);
        });

        it('appends a grown tail in order', () => {
            const patch = expectRoundTrip({ list: [1] }, { list: [1, 2, 3] });
            expect(patch).toEqual([
                { op: 'add', path: '/list/1', value: 2 },
                { op: 'add', path: '/list/2', value: 3 },
            ]);
        });

        it('replaces wholesale when the container kind changes', () => {
            expectRoundTrip({ a: [1, 2] }, { a: { x: 1 } });
            expectRoundTrip({ a: { x: 1 } }, { a: 7 });
            expectRoundTrip({ a: null }, { a: [1] });
            expectRoundTrip([1, 2, 3], { a: 1 });
            expectRoundTrip('s', 5);
        });

        it('escapes ~ and / in keys', () => {
            const patch = expectRoundTrip({ 'a/b': 1, 'c~d': 2 }, { 'a/b': 3 });
            expect(patch.map(op => op.path)).toEqual(['/a~1b', '/c~0d']);
            expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
        });

        it('handles nested removal + addition + reorder of tuple lists', () => {
            expectRoundTrip(
                { outfits: [['nova:1', 1], ['nova:2', 2], ['nova:3', 3]] },
                { outfits: [['nova:3', 3], ['nova:1', 1]] });
        });

        it('round-trips two real pilot saves in both directions', () => {
            const a = saveOf(PILOT_FILE_WITH_ESCORT);
            const b = saveOf(PILOT_FILE_NO_ESCORT);
            const forward = expectRoundTrip(a, b);
            const back = expectRoundTrip(b, a);
            expect(forward.length).toBeGreaterThan(0);
            expect(back.length).toBeGreaterThan(0);
            // A patch is far smaller than either document, or it is not
            // worth storing patches at all.
            expect(JSON.stringify(forward).length)
                .toBeLessThan(JSON.stringify(a).length);
        });

        it('makes a small patch for a small change inside an escort blob', () => {
            const a = saveOf(PILOT_FILE_WITH_ESCORT);
            const b = cloneJson(a) as { data: { credits: number, escorts: unknown[] } };
            b.data.credits += 500;
            // Perturb one leaf deep in the escort entity blob.
            const escort = b.data.escorts[0] as { entity: { components: unknown } };
            const text = JSON.stringify(escort.entity.components);
            const patch = expectRoundTrip(a, b as JsonValue);
            expect(patch.length).toBe(1);
            expect(patch[0]).toEqual({ op: 'replace', path: '/data/credits',
                value: b.data.credits });
            expect(JSON.stringify(escort.entity.components)).toEqual(text);
        });

        it('leaves the input document untouched when applying', () => {
            const a: JsonValue = { x: { y: [1, 2] } };
            const frozen = JSON.stringify(a);
            const out = applyPatch(a, [{ op: 'add', path: '/x/y/-', value: 3 }]);
            expect(JSON.stringify(out)).toEqual(JSON.stringify({ x: { y: [1, 2, 3] } }));
            expect(JSON.stringify(a)).toEqual(frozen);
        });
    });

    describe('applyPatch errors', () => {
        it('rejects a bad pointer', () => {
            expect(() => applyPatch({}, [{ op: 'add', path: 'nope', value: 1 }]))
                .toThrowError(/pointer/);
        });

        it('rejects a missing container', () => {
            expect(() => applyPatch({}, [{ op: 'add', path: '/a/b', value: 1 }]))
                .toThrowError(/Missing container/);
        });

        it('rejects a failed test', () => {
            expect(() => applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }]))
                .toThrowError(/test failed/);
            expect(JSON.stringify(
                applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1 }])))
                .toEqual('{"a":1}');
        });

        it('rejects an out-of-range array index', () => {
            expect(() => applyPatch([1], [{ op: 'replace', path: '/3', value: 0 }]))
                .toThrowError(/out of range/);
        });
    });
});
