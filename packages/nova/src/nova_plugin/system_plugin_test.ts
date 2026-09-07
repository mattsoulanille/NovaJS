import 'jasmine';
import { Plugin } from 'nova_ecs/plugin';
import { World } from 'nova_ecs/world';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { DOMAINS } from './domains.js';
import { makeSystem } from './make_system.js';

/**
 * SystemPlugin is the domains composed in DOMAINS order (see Domain in
 * core/domain.ts): each domain owns its plugins, the composition root
 * owns nothing but the list. The resulting system ORDER is not pinned
 * here: it is a function of the declared edges alone
 * (system_ambiguity_test guards that no unordered pair shares state;
 * the World tie-breaks the rest by name), so a registration reshuffle
 * cannot change it.
 */
describe('SystemPlugin composition', () => {
    it('gives every plugin exactly one domain', () => {
        const owners = new Map<Plugin, string[]>();
        for (const domain of DOMAINS) {
            for (const plugin of domain.plugins) {
                owners.set(plugin, [...(owners.get(plugin) ?? []), domain.name]);
            }
        }
        for (const [plugin, names] of owners) {
            expect(names).withContext(`${plugin.name} claimed by`).toHaveSize(1);
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

    it('registers every domain plugin in the simulation world', async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const world: World = await makeSystem(
            systemId, gameData, 'worker', { npcs: false });
        for (const domain of DOMAINS) {
            for (const plugin of domain.plugins) {
                expect(world.plugins.has(plugin))
                    .withContext(`${domain.name}'s ${plugin.name}`).toBeTrue();
            }
        }
    });
});
