export class DefaultMap<K, V> extends Map<K, V> {
    constructor(private factory: () => V) {
        super();
    }

    get(key: K): V {
        if (!super.has(key)) {
            super.set(key, this.factory());
        }
        return super.get(key)!;
    }
}
