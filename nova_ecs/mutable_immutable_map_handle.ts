import { Draft } from "immer";

// Map keys are never drafted by immer
export type CallWithDraftedMap<K, V> =
    <R>(callback: (draft: Map<K, Draft<V>>) => R) => R;

export class MutableImmutableMapHandle<K, V> implements Map<K, V> {
    constructor(private callWithDraftedMap: CallWithDraftedMap<K, V>,
        private wrapImmutableVal: (val: Draft<V>) => V) {
    }

    private wrapValOrUndefined(val: Draft<V> | undefined): V | undefined {
        if (val === undefined) {
            // Not sure why this cast is needed.
            return val as undefined;
        }
        return this.wrapImmutableVal(val);
    }

    clear(): void {
        this.callWithDraftedMap(map => map.clear());
    }

    delete(key: K): boolean {
        return this.callWithDraftedMap(map => map.delete(key))
    }

    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void,
        thisArg?: any): void {
        for (const [key, val] of this) {
            callbackfn.call(thisArg, val, key, this);
        }
    }

    get(key: K): V | undefined {
        return this.callWithDraftedMap(
            map => this.wrapValOrUndefined(map.get(key)));
    }

    has(key: K): boolean {
        return this.callWithDraftedMap(map => map.has(key));
    }

    set(key: K, value: V): this {
        this.callWithDraftedMap(map => {
            map.set(key, value as Draft<V>);
        })
        return this;
    }

    get size() {
        return this.callWithDraftedMap(map => map.size);
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries();
    }

    *entries(): IterableIterator<[K, V]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)!];
        }
    }

    *keys(): IterableIterator<K> {
        yield* this.callWithDraftedMap(map => {
            return [...map.keys()];
        });
    }

    *values(): IterableIterator<V> {
        for (const key of this.keys()) {
            yield this.get(key)!;
        }
    }

    // TODO: Fix
    // @ts-ignore
    [Symbol.toStringTag]: string;
}
