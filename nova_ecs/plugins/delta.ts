import { setIntersection } from "../utils";


export function getObjectDelta<T extends Object>(a: T, b: T): Partial<T> | undefined {
    const out: Partial<T> = {};
    const aKeys = new Set(Object.keys(a));
    const bKeys = new Set(Object.keys(b));
    const keys = setIntersection(aKeys, bKeys) as Set<keyof T>;

    for (const key of keys) {
        if (a[key] !== b[key]) {
            out[key] = b[key];
        }
    }

    if (Object.keys(out).length > 0) {
        return out;
    }
    return;
}

export function applyObjectDelta<T extends Object>(data: T, delta: Partial<T>) {
    for (const [key, val] of Object.entries(delta)) {
        data[key as keyof T] = val;
    }
}
