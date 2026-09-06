import 'jasmine';
import { Plugin } from 'nova_ecs/plugin';
import { World } from 'nova_ecs/world';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { DOMAINS } from './domains.js';
import { makeSystem } from './make_system.js';
import { SYSTEM_ORDER_SNAPSHOT } from './system_order_snapshot.js';
import { SYSTEM_PLUGIN_ORDER } from './system_plugin.js';

/**
 * SystemPlugin's registration list and the domains' `plugins` lists
 * describe the same composition from two sides (see Domain in
 * core/domain.ts): the domain owns membership and relative order, the
 * composition root owns the interleaving. These specs keep the two
 * sides — and the resulting system order — pinned.
 */
describe('SystemPlugin composition', () => {
    it('registers every domain plugin exactly once and nothing else', () => {
        const owners = new Map<Plugin, string[]>();
        for (const domain of DOMAINS) {
            for (const plugin of domain.plugins) {
                owners.set(plugin, [...(owners.get(plugin) ?? []), domain.name]);
            }
        }
        for (const [plugin, names] of owners) {
            expect(names).withContext(`${plugin.name} claimed by`).toHaveSize(1);
        }
        const registered = new Set(SYSTEM_PLUGIN_ORDER);
        expect(registered.size).withContext('a plugin registered twice')
            .toBe(SYSTEM_PLUGIN_ORDER.length);
        for (const plugin of SYSTEM_PLUGIN_ORDER) {
            expect(owners.has(plugin))
                .withContext(`${plugin.name} belongs to no domain`).toBeTrue();
        }
        for (const [plugin, names] of owners) {
            expect(registered.has(plugin))
                .withContext(`${names[0]}'s ${plugin.name} is not registered`)
                .toBeTrue();
        }
    });

    it('registers each domain\'s plugins in the domain\'s own order', () => {
        for (const domain of DOMAINS) {
            const inRegistration = SYSTEM_PLUGIN_ORDER
                .filter(plugin => domain.plugins.includes(plugin))
                .map(plugin => plugin.name);
            expect(inRegistration).withContext(domain.name)
                .toEqual(domain.plugins.map(plugin => plugin.name));
        }
    });

    it('lists the domains lowest first', () => {
        const seen = new Set<string>();
        for (const domain of DOMAINS) {
            for (const dependency of domain.dependsOn) {
                expect(seen.has(dependency))
                    .withContext(`${domain.name} depends on ${dependency}, listed later`)
                    .toBeTrue();
            }
            seen.add(domain.name);
        }
    });

    for (const platform of ['worker', 'node'] as const) {
        it(`produces the frozen system order on the ${platform} platform`,
            async () => {
                const gameData = await getSyntheticGameData();
                const ids = await gameData.ids;
                const systemId = [...ids.System].sort()[0]!;
                const world: World = await makeSystem(
                    systemId, gameData, platform, { npcs: false });
                // toEqual on the whole list: a failure prints both
                // orders, which is what a reviewer of a reshuffle needs.
                expect(world.systemNames).toEqual([...SYSTEM_ORDER_SNAPSHOT]);
            });
    }
});
