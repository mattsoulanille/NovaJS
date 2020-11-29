export class DefaultMap<K, V> extends Map<K, V> {
    constructor(private factory: () => V) {
        super();
    }

    get(key: K): V {
        if (super.has(key)) {
            return super.get(key)!;
        }
        return this.factory();
    }
}
