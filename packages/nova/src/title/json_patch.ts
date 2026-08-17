/**
 * A small, exact JSON diff/apply in RFC 6902 (JSON Patch) form.
 *
 * Written for the pilot history (pilot_history.ts), where each checkpoint
 * stores the difference between one save envelope and the next. The
 * requirements are exactness (apply(diff(a, b)) deep-equals b, always) and
 * small patches for the shapes a save has — objects, arrays of tuples,
 * primitives, a few nested escort entity blobs — not generality: only the
 * `add`, `remove` and `replace` operations are ever produced, and only
 * those three plus `test` are applied. Values are plain JSON: no
 * `undefined`, no functions, no Dates (the save envelope comes from
 * JSON.parse, so this holds by construction).
 *
 * Arrays are diffed positionally: elements at shared indices are recursed
 * into, a longer `b` gets its extra tail `add`ed, a longer `a` gets its
 * extra tail `remove`d from the end down (so indices stay valid while the
 * patch is applied in order). Recursing into same-index elements is what
 * keeps a save's big escort blobs cheap: a lift-off changes a few leaf
 * numbers inside them, not the blob.
 *
 * Determinism: object keys are visited in the order `Object.keys` gives
 * them (insertion order), which is stable for a given input, so the same
 * pair of documents always yields the same patch.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonPatchOp =
    | { op: 'add', path: string, value: JsonValue }
    | { op: 'remove', path: string }
    | { op: 'replace', path: string, value: JsonValue }
    | { op: 'test', path: string, value: JsonValue };

function isObject(v: JsonValue): v is { [key: string]: JsonValue } {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** RFC 6901 escaping of one path segment. */
export function escapePointerSegment(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** RFC 6901 unescaping of one path segment. */
export function unescapePointerSegment(segment: string): string {
    return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Splits a JSON pointer into unescaped segments ('' -> []). */
export function parsePointer(pointer: string): string[] {
    if (pointer === '') {
        return [];
    }
    if (!pointer.startsWith('/')) {
        throw new Error(`Invalid JSON pointer: ${JSON.stringify(pointer)}`);
    }
    return pointer.slice(1).split('/').map(unescapePointerSegment);
}

/** Deep structural equality over JSON values. */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
    if (a === b) {
        return true;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!jsonEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    if (isObject(a) && isObject(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) {
            return false;
        }
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)
                || !jsonEqual(a[key], b[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

/** Deep copy of a JSON value (never aliases the input). */
export function cloneJson<T extends JsonValue>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(cloneJson) as T;
    }
    if (isObject(value)) {
        const out: { [key: string]: JsonValue } = {};
        for (const key of Object.keys(value)) {
            out[key] = cloneJson(value[key]);
        }
        return out as T;
    }
    return value;
}

/**
 * The patch that turns `a` into `b`. Empty when they are deep-equal.
 * Neither input is mutated; values in the patch are copies.
 */
export function diffJson(a: JsonValue, b: JsonValue): JsonPatchOp[] {
    const ops: JsonPatchOp[] = [];
    diffInto(a, b, '', ops);
    return ops;
}

function diffInto(a: JsonValue, b: JsonValue, path: string,
    ops: JsonPatchOp[]): void {
    if (a === b) {
        return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        const shared = Math.min(a.length, b.length);
        for (let i = 0; i < shared; i++) {
            diffInto(a[i], b[i], `${path}/${i}`, ops);
        }
        // Extra tail of `b`: appended in order.
        for (let i = shared; i < b.length; i++) {
            ops.push({ op: 'add', path: `${path}/${i}`, value: cloneJson(b[i]) });
        }
        // Extra tail of `a`: removed from the end down so every earlier
        // index in the patch stays valid.
        for (let i = a.length - 1; i >= shared; i--) {
            ops.push({ op: 'remove', path: `${path}/${i}` });
        }
        return;
    }
    if (isObject(a) && isObject(b)) {
        for (const key of Object.keys(a)) {
            const sub = `${path}/${escapePointerSegment(key)}`;
            if (Object.prototype.hasOwnProperty.call(b, key)) {
                diffInto(a[key], b[key], sub, ops);
            } else {
                ops.push({ op: 'remove', path: sub });
            }
        }
        for (const key of Object.keys(b)) {
            if (!Object.prototype.hasOwnProperty.call(a, key)) {
                ops.push({
                    op: 'add', path: `${path}/${escapePointerSegment(key)}`,
                    value: cloneJson(b[key]),
                });
            }
        }
        return;
    }
    // Different primitive values, or a container swapped for another
    // kind (array <-> object <-> primitive): replace wholesale.
    if (!jsonEqual(a, b)) {
        ops.push({ op: 'replace', path, value: cloneJson(b) });
    }
}

/**
 * Applies `ops` to `doc` in order and returns the resulting document.
 * `doc` itself is never mutated (the path to each change is copied on
 * write, so untouched subtrees are shared with the input — treat the
 * result as immutable, or clone it, if you plan to mutate it).
 *
 * Throws on a malformed pointer, a missing container, or a failed `test`.
 */
export function applyPatch(doc: JsonValue, ops: readonly JsonPatchOp[]):
    JsonValue {
    let current = doc;
    for (const op of ops) {
        current = applyOne(current, op);
    }
    return current;
}

function applyOne(doc: JsonValue, op: JsonPatchOp): JsonValue {
    const segments = parsePointer(op.path);
    if (op.op === 'test') {
        const found = getAt(doc, segments);
        if (found === undefined || !jsonEqual(found, op.value)) {
            throw new Error(`JSON patch test failed at ${op.path}`);
        }
        return doc;
    }
    if (segments.length === 0) {
        if (op.op === 'remove') {
            throw new Error('Cannot remove the whole document');
        }
        return cloneJson(op.value);
    }
    return setAt(doc, segments, 0, op);
}

function getAt(doc: JsonValue, segments: string[]): JsonValue | undefined {
    let current: JsonValue = doc;
    for (const segment of segments) {
        if (Array.isArray(current)) {
            const index = arrayIndex(segment, current.length, false);
            current = current[index];
        } else if (isObject(current)) {
            if (!Object.prototype.hasOwnProperty.call(current, segment)) {
                return undefined;
            }
            current = current[segment];
        } else {
            return undefined;
        }
        if (current === undefined) {
            return undefined;
        }
    }
    return current;
}

function arrayIndex(segment: string, length: number, allowEnd: boolean):
    number {
    if (segment === '-') {
        if (!allowEnd) {
            throw new Error('"-" is only valid as an add target');
        }
        return length;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(segment)) {
        throw new Error(`Invalid array index ${JSON.stringify(segment)}`);
    }
    const index = Number(segment);
    if (index > length || (index === length && !allowEnd)) {
        throw new Error(`Array index ${index} out of range (length ${length})`);
    }
    return index;
}

/** Copy-on-write descent: returns the new node for this level. */
function setAt(node: JsonValue, segments: string[], depth: number,
    op: Exclude<JsonPatchOp, { op: 'test' }>): JsonValue {
    const segment = segments[depth];
    const last = depth === segments.length - 1;
    if (Array.isArray(node)) {
        const copy = node.slice();
        if (last) {
            if (op.op === 'add') {
                const index = arrayIndex(segment, copy.length, true);
                copy.splice(index, 0, cloneJson(op.value));
            } else {
                const index = arrayIndex(segment, copy.length, false);
                if (op.op === 'remove') {
                    copy.splice(index, 1);
                } else {
                    copy[index] = cloneJson(op.value);
                }
            }
            return copy;
        }
        const index = arrayIndex(segment, copy.length, false);
        copy[index] = setAt(copy[index], segments, depth + 1, op);
        return copy;
    }
    if (isObject(node)) {
        const copy: { [key: string]: JsonValue } = { ...node };
        if (last) {
            if (op.op === 'remove') {
                if (!Object.prototype.hasOwnProperty.call(copy, segment)) {
                    throw new Error(`Cannot remove missing key at ${op.path}`);
                }
                delete copy[segment];
            } else if (op.op === 'replace'
                && !Object.prototype.hasOwnProperty.call(copy, segment)) {
                throw new Error(`Cannot replace missing key at ${op.path}`);
            } else {
                copy[segment] = cloneJson(op.value);
            }
            return copy;
        }
        if (!Object.prototype.hasOwnProperty.call(copy, segment)) {
            throw new Error(`Missing container at ${op.path}`);
        }
        copy[segment] = setAt(copy[segment], segments, depth + 1, op);
        return copy;
    }
    throw new Error(`Cannot descend into a primitive at ${op.path}`);
}
