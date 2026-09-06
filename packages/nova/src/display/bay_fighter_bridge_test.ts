import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { UnknownComponent } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { makeSimulationBridgeHarness } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { BayFighterComponent } from '../nova_plugin/escorts/bay_plugin.js';
import {
    OwnerComponent, SourceComponent,
} from '../nova_plugin/combat/fire_weapon_plugin.js';
import { countDeployedFighters, mergeDeployedCounts } from '../spaceport/deployed_outfits.js';

/**
 * BayFighterComponent — which bay launched a fighter — is read by a
 * DISPLAY-world consumer: the outfitter counts the docked player's
 * still-flying fighters against what they may buy
 * (spaceport/deployed_outfits.ts, wired in display/spaceport_plugin.ts).
 *
 * Display entities are MIRRORED from the simulation world, and only
 * serializer-registered components survive that trip —
 * SimulationBridgeHost.snapshot() silently skips the rest. A component
 * registered with a bare `world.addComponent` would leave the count
 * permanently zero in the real game while unit tests that set it by
 * hand passed. That is exactly how SourceComponent broke; see
 * source_component_bridge_test.ts.
 *
 * These tests pin the wiring, not the counting logic.
 */
describe('BayFighterComponent sim -> display wiring', () => {
    let simWorld: World;
    let serializer: Serializer;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const harness = await makeSimulationBridgeHarness();
        simWorld = harness.world;
        serializer = simWorld.resources.get(SerializerResource)!;
    });

    it('registers BayFighterComponent with the simulation serializer', () => {
        expect(serializer).toBeDefined();
        expect(serializer.hasComponent(
            BayFighterComponent as UnknownComponent)).toBeTrue();
    });

    it('carries the bay link in a frame from a live simulation world',
        async () => {
            // A fresh harness so this is the bridge's FIRST snapshot and
            // every entity arrives in `added` with its full component list.
            const { client, world } = await makeSimulationBridgeHarness();
            world.entities.set('bay-fighter-uuid', new Entity('bay fighter')
                .addComponent(SourceComponent, 'carrier-uuid')
                .addComponent(BayFighterComponent,
                    { bayWeaponId: 'nova:149' }));

            const frame = client.snapshot();
            const added = frame.added
                .find(([uuid]) => uuid === 'bay-fighter-uuid');
            expect(added).toBeDefined();
            const names = added![1].components.map(([name]) => name);
            expect(names).toContain('BayFighterComponent');
            expect(added![1].components
                .find(([name]) => name === 'BayFighterComponent')![1])
                .toEqual({ bayWeaponId: 'nova:149' });
        });

    /** Encodes and decodes exactly as browser.ts's syncEntityToDisplay
     * does; anything the serializer drops is simply absent. */
    function mirror(entity: Entity): Entity {
        const decoded = serializer.decode(serializer.encode(entity));
        if (isLeft(decoded)) {
            throw new Error(serializer.describeDecodeFailure(
                serializer.encode(entity), decoded.left));
        }
        return decoded.right;
    }

    it('counts a MIRRORED fighter against the player\'s fighter outfit',
        () => {
            const CARRIER = 'player-uuid';
            const fighterOutfit: OutfitData = {
                ...getDefaultOutfitData(),
                id: 'nova:158',
                ammoFor: 'nova:149',
            };

            // A bay fighter as bay_plugin builds it, round-tripped
            // through the serializer the way the display world gets it.
            const simFighter = new Entity('fighter')
                .addComponent(SourceComponent, CARRIER)
                .addComponent(OwnerComponent, { owner: CARRIER })
                .addComponent(BayFighterComponent,
                    { bayWeaponId: 'nova:149' });

            const displayEntities = new Map([
                ['fighter-uuid', mirror(simFighter)],
            ]);

            const counts = countDeployedFighters(displayEntities, CARRIER,
                id => id === 'nova:158' ? fighterOutfit : undefined);
            expect([...counts(['nova:158'])]).toEqual([['nova:158', 1]]);
        });
});

describe('countDeployedFighters', () => {
    const BAY = 'nova:149';
    const OTHER_BAY = 'nova:150';
    const CARRIER = 'carrier-uuid';

    function outfits(...entries: [string, string][]) {
        const map = new Map(entries.map(([id, ammoFor]) => [id, {
            ...getDefaultOutfitData(), id, ammoFor,
        }]));
        return (id: string) => map.get(id);
    }

    function fighter(bayWeaponId: string, source: string) {
        return new Entity()
            .addComponent(SourceComponent, source)
            .addComponent(BayFighterComponent, { bayWeaponId });
    }

    it('counts one per deployed fighter, keyed by its ammo outfit', () => {
        const entities = new Map([
            ['f1', fighter(BAY, CARRIER)],
            ['f2', fighter(BAY, CARRIER)],
            ['f3', fighter(OTHER_BAY, CARRIER)],
        ]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:158', BAY], ['nova:160', OTHER_BAY]));
        expect(counts(['nova:158', 'nova:160']))
            .toEqual(new Map([['nova:158', 2], ['nova:160', 1]]));
    });

    it('ignores fighters belonging to another ship', () => {
        const entities = new Map([
            ['mine', fighter(BAY, CARRIER)],
            ['theirs', fighter(BAY, 'someone-else')],
        ]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:158', BAY]));
        expect(counts(['nova:158'])).toEqual(new Map([['nova:158', 1]]));
    });

    it('attributes to the lowest-sorted supplying outfit, matching the '
        + 'consume and refund policy', () => {
            const entities = new Map([['f1', fighter(BAY, CARRIER)]]);
            const counts = countDeployedFighters(entities, CARRIER,
                outfits(['nova:900', BAY], ['nova:158', BAY]));
            // Given in the other order, still 'nova:158' — the sort, not
            // the iteration order, decides.
            expect(counts(['nova:900', 'nova:158']))
                .toEqual(new Map([['nova:158', 1]]));
        });

    it('follows the owner chain up to the carrier', () => {
        // A fighter whose Source is an intermediate escort that itself
        // belongs to the docked player.
        const escort = new Entity().addComponent(SourceComponent, CARRIER);
        const entities = new Map([
            ['escort', escort],
            ['f1', fighter(BAY, 'escort')],
        ]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:158', BAY]));
        expect(counts(['nova:158'])).toEqual(new Map([['nova:158', 1]]));
    });

    it('terminates on a cycle in the owner chain', () => {
        const a = new Entity().addComponent(SourceComponent, 'b');
        const b = new Entity().addComponent(SourceComponent, 'a');
        const entities = new Map([
            ['a', a], ['b', b], ['f1', fighter(BAY, 'a')],
        ]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:158', BAY]));
        // Never resolves to the carrier, so it goes uncounted — and,
        // crucially, does not hang.
        expect(counts(['nova:158']).size).toBe(0);
    });

    it('skips a fighter whose bay matches no owned outfit', () => {
        const entities = new Map([['f1', fighter(BAY, CARRIER)]]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:160', OTHER_BAY]));
        expect(counts(['nova:160']).size).toBe(0);
    });

    it('ignores entities that are not bay fighters', () => {
        const entities = new Map([
            ['ship', new Entity().addComponent(SourceComponent, CARRIER)],
        ]);
        const counts = countDeployedFighters(entities, CARRIER,
            outfits(['nova:158', BAY]));
        expect(counts(['nova:158']).size).toBe(0);
    });

    it('merges with other deployed-count sources, which is the seam a '
        + 'landed-escort roster plugs into', () => {
            const entities = new Map([['f1', fighter(BAY, CARRIER)]]);
            const fighters = countDeployedFighters(entities, CARRIER,
                outfits(['nova:158', BAY]));
            // A stand-in for a future source that also reports units
            // owned but not aboard, including one on the same outfit id.
            const other = () => new Map([['nova:158', 2], ['nova:400', 5]]);

            const merged = mergeDeployedCounts(fighters, other);
            expect(merged(['nova:158'])).toEqual(new Map([
                ['nova:158', 3], ['nova:400', 5],
            ]));
        });
});
