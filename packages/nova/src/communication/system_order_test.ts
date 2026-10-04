import 'jasmine';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { makeSystem } from '../nova_plugin/make_system.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import { systemOrderHash } from './system_order.js';

describe('systemOrderHash (#155)', () => {
    function system(name: string, edges: { before?: System[] } = {}) {
        return new System({
            name, args: [] as const, step: () => { }, before: edges.before,
        });
    }

    /** A world running `first` then `second` (pinned by an edge),
     * registered in that order or, with `reversed`, the other. */
    function world(first: string, second: string, reversed = false) {
        const w = new World('system-order');
        const after = system(second);
        const before = system(first, { before: [after] });
        for (const s of reversed ? [after, before] : [before, after]) {
            w.addSystem(s);
        }
        return w;
    }

    it('is a 16-hex-digit digest', () => {
        expect(systemOrderHash(world('Alpha', 'Beta').systemNames)).toMatch(/^[0-9a-f]{16}$/);
    });

    it('equal worlds declare equal hashes, whatever their registration order', () => {
        const a = world('Alpha', 'Beta');
        const b = world('Alpha', 'Beta', true);
        expect(b.systemNames).toEqual(a.systemNames);
        expect(systemOrderHash(b.systemNames)).toBe(systemOrderHash(a.systemNames));
    });

    it('a world with two systems swapped declares a different hash', () => {
        const a = world('Alpha', 'Beta');
        const swapped = world('Beta', 'Alpha');
        // The same SET of systems, in a different order.
        expect([...swapped.systemNames].sort()).toEqual([...a.systemNames].sort());
        expect(swapped.systemNames).not.toEqual(a.systemNames);
        expect(systemOrderHash(swapped.systemNames))
            .not.toBe(systemOrderHash(a.systemNames));
    });

    it('cannot alias two lists through a separator in a name', () => {
        expect(systemOrderHash(['a,b'])).not.toBe(systemOrderHash(['a', 'b']));
        expect(systemOrderHash(['a\nb'])).not.toBe(systemOrderHash(['a', 'b']));
    });

    it('is pinned: the CRC-64-AVRO of the JSON-encoded list', () => {
        // A change here changes what every peer declares, so peers on
        // two builds would warn spuriously. Move it deliberately.
        expect(systemOrderHash(['Alpha', 'Beta'])).toBe('fc15924dd85430a2');
    });

    it('two simulation worlds for one system declare the same hash (worker and node)',
        async () => {
            const gameData = await getSyntheticGameData();
            const systemId = [...(await gameData.ids).System].sort()[0]!;
            const [worker, node] = await Promise.all((['worker', 'node'] as const)
                .map(platform => makeSystem(systemId, gameData, platform, { npcs: false })));
            expect(worker.systemNames.length).toBeGreaterThan(10);
            expect(systemOrderHash(worker.systemNames))
                .toBe(systemOrderHash(node.systemNames));
        });
});
