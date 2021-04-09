export class MapEvent<V> {
    private wrappedCancelled = false;
    constructor(public value: V) { }

    get cancelled() {
        return this.wrappedCancelled;
    }

    cancel() {
        this.wrappedCancelled = true;
    }
}

interface SyncSubscription {
    unsubscribe: () => void;
}

type Callback<V> = (val: V) => void;
export class SyncSubject<V> {
    private subscriptions = new Map<SyncSubscription, Callback<V>>();
    subscribe(callback: Callback<V>) {
        const subscription: SyncSubscription = {
            unsubscribe: () => {
                this.subscriptions.delete(subscription);
            }
        };

        this.subscriptions.set(subscription, callback);
        return subscription;
    }

    next(val: V) {
        for (const callback of this.subscriptions.values()) {
            callback(val);
        }
    }
}

/**
 * A map that emits events when its contents are changed.
 */
export class EventMap<K, V> extends Map<K, V> {
    // TODO(mattsoulanille): Add more events.
    readonly events = {
        delete: new SyncSubject<Set<[K, V]>>(),
        set: new SyncSubject<[K, V]>(),
        // Add only triggers when it's a key not in the map
        add: new SyncSubject<[K, V]>(),
    }

    clear(): void {
        const toDelete = new Set([...this.entries()]);
        super.clear();
        this.events.delete.next(toDelete);
    }
    set(key: K, value: V): this {
        // When constructing with entries, events may
        // not yet be defined, hence the `?`.
        this.events?.set.next([key, value]);
        if (!this.has(key)) {
            this.events?.add.next([key, value]);
        }
        super.set(key, value);
        return this;
    }
    delete(key: K) {
        let toDelete: Set<[K, V]> | undefined;
        if (this.has(key)) {
            const val = this.get(key)!;
            toDelete = new Set([[key, val]]);
        }
        const result = super.delete(key);
        if (toDelete) {
            this.events.delete.next(toDelete);
        }
        return result;
    }
}
