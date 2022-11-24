export function* iterMaps<K, V>(a: Map<K, V>, b: Map<K, V>) {
    const visited = new Set<K>();
    for (const [k, va] of a) {
        visited.add(k);
        yield [k, va, b.get(k)] as const;
    }
    for (const [k, vb] of b) {
        if (visited.has(k)) {
            continue;
        }
        // a does not have k or it would be in `visited`
        yield [k, undefined, vb] as const;
    }
}
