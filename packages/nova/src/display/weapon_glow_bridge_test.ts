import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { UnknownComponent } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import {
    getSyntheticGameData, makeSimulationBridgeHarness,
} from '../communication/simulation_test_fixture.js';
import {
    WeaponsState, WeaponsStateComponent,
} from '../nova_plugin/ship/index.js';
import { latestRealFire } from './ship_animation_plugin.js';

/**
 * The weapon-glow overlay reads `WeaponState.lastFired` — the simulation
 * time of a shot that ACTUALLY left the ship — out of the DISPLAY world,
 * whose entities are mirrored from the simulation by
 * SimulationBridgeHost.snapshot(). That snapshot encodes only what the
 * serializer knows, and it encodes each component through its registered
 * io-ts codec, so a field missing from the codec is dropped just as
 * silently as an unregistered component is (the SourceComponent bug; see
 * source_component_bridge_test.ts).
 *
 * `lastFired` was added to an EXISTING registered component, so the
 * failure mode here is narrower and easier to miss: WeaponsStateComponent
 * keeps crossing, `firing` and `count` keep arriving, and only the new
 * field vanishes — leaving the glow permanently dark for projectile
 * weapons with no error anywhere. These pin the field's trip.
 */
describe('weapon-glow lastFired sim -> display wiring', () => {
    let simWorld: World;
    let serializer: Serializer;

    beforeAll(async () => {
        const harness = await makeSimulationBridgeHarness(getSyntheticGameData());
        simWorld = harness.world;
        serializer = simWorld.resources.get(SerializerResource)!;
    });

    it('registers WeaponsStateComponent with the simulation serializer', () => {
        expect(serializer.hasComponent(
            WeaponsStateComponent as UnknownComponent)).toBeTrue();
    });

    it('carries lastFired in a frame from a live simulation world',
        async () => {
            // A fresh harness so this snapshot is the bridge's FIRST and
            // the entity arrives in `added` with its full component list.
            const { client, world } = await makeSimulationBridgeHarness(getSyntheticGameData());
            const weapons: WeaponsState = new Map([
                ['nova:143', { count: 2, firing: false, lastFired: 4200 }],
            ]);
            world.entities.set('shooter-uuid', new Entity('shooter')
                .addComponent(WeaponsStateComponent, weapons));

            const frame = client.snapshot();
            const added = frame.added.find(([uuid]) => uuid === 'shooter-uuid');
            expect(added).toBeDefined();
            const encoded = added![1].components
                .find(([name]) => name === 'WeaponsStateComponent');
            expect(encoded).toBeDefined();
            // The whole point: a shot time of 4200 must be in the frame.
            expect(JSON.stringify(encoded![1])).toContain('4200');
        });

    it('decodes lastFired back out, where latestRealFire can read it', () => {
        // Mirror the entity exactly as browser.ts's syncEntityToDisplay
        // does, then run the real display-side helper over the result.
        const weapons: WeaponsState = new Map([
            ['nova:143', { count: 1, firing: false, lastFired: 4200 }],
        ]);
        const simShip = new Entity('shooter')
            .addComponent(WeaponsStateComponent, weapons);

        const decoded = serializer.decode(serializer.encode(simShip));
        if (isLeft(decoded)) {
            throw new Error(serializer.describeDecodeFailure(
                serializer.encode(simShip), decoded.left));
        }
        const mirrored = decoded.right.components.get(WeaponsStateComponent);
        expect(mirrored).toBeDefined();
        expect(mirrored!.get('nova:143')?.lastFired).toEqual(4200);
        expect(latestRealFire(mirrored!, () => true)).toEqual(4200);
    });

    it('leaves a weapon that never fired without a lastFired', () => {
        // The absent-field case must survive the trip too: it is what
        // keeps a held trigger that emitted nothing from glowing.
        const weapons: WeaponsState = new Map([
            ['nova:143', { count: 1, firing: true }],
        ]);
        const decoded = serializer.decode(serializer.encode(
            new Entity('holder').addComponent(WeaponsStateComponent, weapons)));
        if (isLeft(decoded)) {
            throw new Error('failed to decode a never-fired weapon state');
        }
        const mirrored = decoded.right.components
            .get(WeaponsStateComponent)!;
        expect(mirrored.get('nova:143')?.firing).toBeTrue();
        expect(mirrored.get('nova:143')?.lastFired).toBeUndefined();
        expect(latestRealFire(mirrored, () => true)).toBeUndefined();
    });
});
