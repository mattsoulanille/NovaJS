import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { getDefaultBeamWeaponData } from 'novadatainterface/weapon_data';
import { UnknownComponent } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { makeSimulationBridgeHarness } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { BeamDataComponent } from '../nova_plugin/beam_plugin.js';
import {
    OwnerComponent, SourceComponent,
} from '../nova_plugin/fire_weapon_plugin.js';
import { FormationComponent } from '../nova_plugin/npc_ai_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { TargetComponent } from '../nova_plugin/target_component.js';
import { computeContext } from './hail_dialog_plugin.js';
import {
    ActiveBeamsQuery, shouldShowFiringAnimation,
} from './ship_animation_plugin.js';

/**
 * SourceComponent — the uuid of the ship that fired a projectile/beam, and
 * the marker that tells a carrier-launched bay fighter apart from a hired
 * escort — is read by two DISPLAY-world consumers:
 *
 *   - hail_dialog_plugin: `components.has(SourceComponent)` decides
 *     "Fighter:" vs "Hired Escort:" (and whether the escort-management
 *     buttons appear).
 *   - ship_animation_plugin's ActiveBeamsQuery: keeps a ship's weapon glow
 *     on while a beam it fired is still being emitted.
 *
 * Display entities are MIRRORED from the simulation world, and only
 * serializer-registered components survive that trip —
 * SimulationBridgeHost.snapshot() skips the rest, silently. SourceComponent
 * was NOT registered (it only had `world.addComponent` plus rollback
 * snapshot policies, which govern a different path), so both consumers were
 * dead in the real game while their unit tests — which set the component by
 * hand — passed. Same failure mode CreateTime had; see create_time.ts.
 *
 * These tests pin the wiring rather than the logic.
 */
describe('SourceComponent sim -> display wiring', () => {
    let simWorld: World;
    let serializer: Serializer;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        // A real simulation world plus the bridge that mirrors it, built
        // the way the browser builds them.
        const harness = await makeSimulationBridgeHarness();
        simWorld = harness.world;
        serializer = simWorld.resources.get(SerializerResource)!;
    });

    it('registers SourceComponent with the simulation serializer', () => {
        // Without this, the component never enters a simulation frame.
        expect(serializer).toBeDefined();
        expect(serializer.hasComponent(SourceComponent as UnknownComponent))
            .toBeTrue();
    });

    it('registers ActiveBeamsQuery\'s other half, BeamDataComponent', () => {
        // Both halves must cross, or the query still matches nothing.
        expect(serializer.hasComponent(BeamDataComponent as UnknownComponent))
            .toBeTrue();
    });

    it('carries Source in a frame from a live simulation world', async () => {
        // A fresh harness so this snapshot is the bridge's FIRST — every
        // entity then arrives in `added` with its full component list.
        const { client, world } = await makeSimulationBridgeHarness();
        const fighter = new Entity('bay fighter')
            .addComponent(SourceComponent, 'carrier-uuid');
        world.entities.set('bay-fighter-uuid', fighter);

        const frame = client.snapshot();
        const added = frame.added.find(([uuid]) => uuid === 'bay-fighter-uuid');
        expect(added).toBeDefined();
        const names = added![1].components.map(([name]) => name);
        // 'Source' is SourceComponent's wire name.
        expect(names).toContain('Source');
        const encoded = added![1].components
            .find(([name]) => name === 'Source')![1];
        expect(encoded).toEqual('carrier-uuid');
    });

    /**
     * Encodes an entity in the simulation world and decodes it exactly as
     * browser.ts's syncEntityToDisplay does. Anything the serializer drops
     * is simply absent from the result, so a regression that unregisters
     * SourceComponent fails the tests below.
     */
    function mirror(entity: Entity): Entity {
        const decoded = serializer.decode(serializer.encode(entity));
        if (isLeft(decoded)) {
            throw new Error(serializer.describeDecodeFailure(
                serializer.encode(entity), decoded.left));
        }
        return decoded.right;
    }

    it('keeps a mirrored bay fighter labelled "Fighter:", not "Hired Escort:"',
        async () => {
            const PLAYER = 'player-uuid';
            const TARGET = 'fighter-uuid';
            const gameData = new MockGameData();
            gameData.data.Ship.map.set('nova:128', {
                ...getDefaultShipData(),
                id: 'nova:128', name: 'Fighter Class', pict: 'nova:3001',
            });

            // A carrier-bay fighter as bay_plugin builds it: formation and
            // owner links to the player, PLUS the SourceComponent that
            // discriminates it from a hired escort.
            const simFighter = new Entity('fighter')
                .addComponent(ShipDataComponent,
                    gameData.data.Ship.map.get('nova:128')!)
                .addComponent(FormationComponent, { leader: PLAYER, slot: 0 })
                .addComponent(OwnerComponent, { owner: PLAYER })
                .addComponent(SourceComponent, PLAYER);

            const displayWorld = new World('mirror-hail-test');
            displayWorld.entities.set(PLAYER, new Entity()
                .addComponent(PlayerShipSelector, undefined)
                .addComponent(TargetComponent, { target: TARGET }));
            displayWorld.entities.set(TARGET, mirror(simFighter));

            const result = await computeContext(displayWorld, gameData);
            // `heading` is the comm frame's LOWER-well identity block: the
            // label on its first line, the ship's class indented under it.
            expect(result?.context.heading.split('\n')[0]).toBe('Fighter:');
            expect(result?.isEscort).toBeFalse();
            expect(result?.context.escort).toBeFalsy();
        });

    it('matches a mirrored beam with ActiveBeamsQuery, keeping the firing '
        + 'animation on', () => {
            const SHIP = 'firing-ship-uuid';
            const simBeam = new Entity('beam')
                .addComponent(BeamDataComponent, getDefaultBeamWeaponData())
                .addComponent(SourceComponent, SHIP);

            // Run the REAL query the ship animation system uses, in a world
            // holding only mirrored entities.
            const displayWorld = new World('mirror-beam-test');
            displayWorld.entities.set('beam-uuid', mirror(simBeam));

            let activeBeams: readonly (readonly [string, unknown])[] = [];
            displayWorld.addSystem(new System({
                name: 'CaptureActiveBeams',
                args: [ActiveBeamsQuery, SingletonComponent] as const,
                step(beams) {
                    activeBeams = beams;
                },
            }));
            displayWorld.step();

            expect(activeBeams.length).toEqual(1);
            expect(activeBeams[0]![0]).toEqual(SHIP);
            // No weapon is being fired by input; the beam alone must hold
            // the animation on.
            expect(shouldShowFiringAnimation(
                SHIP, [], () => false, activeBeams)).toBeTrue();
            // ...and it must not hold it on for some other ship.
            expect(shouldShowFiringAnimation(
                'other-ship', [], () => false, activeBeams)).toBeFalse();
        });
});
