import { immerable } from 'immer';
import { Subject } from 'rxjs';

/**
 * A map that emits events when its contents are changed.
 */
export class EventMap<K, V> implements Map<K, V> {
    [immerable] = true;
    // The wrapped map that stores the data. Don't extend
    // the map class because immer will replace it with a
    // generic 'map' object when running produce.
    private readonly wrappedMap = new Map<K, V>();

    // TODO(mattsoulanille): Add more events.
    readonly events = {
        delete: new Subject<Set<K>>(),
    }

    clear(): void {
        this.events.delete.next(new Set([...this.keys()]));
        this.wrappedMap.clear();
    }
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
        return this.wrappedMap.forEach(callbackfn, thisArg);
    }
    get(key: K): V | undefined {
        return this.wrappedMap.get(key);
    }
    has(key: K): boolean {
        return this.wrappedMap.has(key);
    }
    set(key: K, value: V): this {
        this.wrappedMap.set(key, value);
        return this;
    }
    delete(key: K) {
        if (this.wrappedMap.has(key)) {
            this.events.delete.next(new Set([key]));
        }
        return this.wrappedMap.delete(key);
    }
    get size() {
        return this.wrappedMap.size;
    }
    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.wrappedMap[Symbol.iterator]();
    }
    entries(): IterableIterator<[K, V]> {
        return this.wrappedMap.entries();
    }
    keys(): IterableIterator<K> {
        return this.wrappedMap.keys();
    }
    values(): IterableIterator<V> {
        return this.wrappedMap.values();
    }
    [Symbol.toStringTag]: string;
}
