import 'jasmine';
import { Sortable } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeSystem } from './make_system.js';

/**
 * Load-bearing system orderings must be graph edges, not addSystem
 * insertion luck (#113). Each pair below is checked twice: in the real
 * simulation world's order, and as REACHABILITY in the declared
 * constraint graph — `after` must be a (transitive) successor of
 * `before`, so no registration order could ever flip them.
 *
 * On the synthetic data set: the system set is a property of the
 * platform, not of the scenario the world is built from.
 */
describe('load-bearing system orderings are declared', () => {
    const pairs: Array<[before: string, after: string, why: string]> = [
        ['PlayerJumpControl', 'JumpSequenceSystem',
            'a held jump key must not begin the next hop on the arrival tick, '
            + 'before JumpRouteReconcileSystem has dropped an unflyable head'],
        ['MultiJumpContinueSystem', 'JumpSequenceSystem',
            'the multi-jump marker must not begin the next hop on the arrival tick'],
        ['UpdateHurtboxHullSystem', 'CollisionSystem',
            'projectiles must not collide with one-tick-stale hurtboxes'],
        ['UpdateHitboxHullSystem', 'CollisionSystem',
            'projectiles must not collide with one-tick-stale hitboxes'],
        ['BeamSystem', 'UpdateHurtboxHullSystem',
            'a beam\'s hurtbox hull must follow the movement BeamSystem wrote this tick'],
    ];

    /** Names of every sortable that must run before `node`, transitively. */
    function predecessors(registered: Sortable[], node: Sortable): Set<string> {
        const present = new Set(registered);
        const incoming = new Map<Sortable, Set<Sortable>>(
            registered.map(s => [s, new Set<Sortable>()]));
        for (const s of registered) {
            for (const before of s.before) {
                if (present.has(before)) {
                    incoming.get(before)!.add(s);
                }
            }
            for (const after of s.after) {
                if (present.has(after)) {
                    incoming.get(s)!.add(after);
                }
            }
        }
        const seen = new Set<Sortable>();
        const stack = [node];
        while (stack.length > 0) {
            for (const edge of incoming.get(stack.pop()!)!) {
                if (!seen.has(edge)) {
                    seen.add(edge);
                    stack.push(edge);
                }
            }
        }
        return new Set([...seen].map(s => s.name!));
    }

    async function makeSimWorld(platform: 'worker' | 'node') {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        const world: World = await makeSystem(systemId, gameData, platform, { npcs: false });
        const registered = [...world.registeredSortables];
        return { world, registered };
    }

    for (const platform of ['worker', 'node'] as const) {
        it(`hold on the ${platform} platform, by declared edges`, async () => {
            const { world, registered } = await makeSimWorld(platform);
            const names = world.systemNames;
            const byName = new Map(registered.map(s => [s.name, s]));
            for (const [before, after, why] of pairs) {
                const context = `${before} before ${after} (${why})`;
                expect(names.indexOf(before)).withContext(`${context}: live order`)
                    .toBeLessThan(names.indexOf(after));
                expect(names.indexOf(before)).withContext(`${before} registered`)
                    .toBeGreaterThanOrEqual(0);
                expect(predecessors(registered, byName.get(after)!).has(before))
                    .withContext(`${context}: reachable in the constraint graph`)
                    .toBeTrue();
            }
        });
    }

    it('the simulation world registers only named sortables', async () => {
        // Unnamed markers would fall back to registration-position
        // tie-breaks even under a name-canonical sort (see
        // sortableNameOrder); none exist today, keep it that way.
        const { registered } = await makeSimWorld('worker');
        expect(registered.length).toBeGreaterThan(100);
        expect(registered.filter(s => s.name === undefined)).toEqual([]);
    });
});
