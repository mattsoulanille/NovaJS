import 'jasmine';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics } from 'novadatainterface/ship_data';
import { UnknownComponent } from 'nova_ecs/component';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { makeSimulationBridgeHarness } from '../communication/simulation_test_fixture.js';
import {
    ControlEvent, ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/index.js';
import {
    FuelComponent, FUEL_PER_JUMP, OutfitsStateComponent, ShipDataComponent, ShipPhysicsComponent,
} from '../nova_plugin/ship/index.js';
import { JumpRouteComponent, JUMP_DISTANCE } from '../nova_plugin/travel/index.js';
import { PlayerShipSelector, DISCOVERY_ENTERED } from '../nova_plugin/player/index.js';
import { ShipPhysicsDisplayPlugin } from './ship_physics_display_plugin.js';
import { SoundPlugin } from './sound_plugin.js';
import {
    DiscoveryLevelResource, DrawStatusBarNavigation,
} from './status_bar_navigation.js';
import { StatusBarResource } from './status_bar_resource.js';
import { NavReadout } from './status_bar_content.js';
import { BEEP_CANT_DO } from './ui_sound.js';
import { UiSoundTriggersPlugin } from './ui_sound_triggers_plugin.js';

const SHIP_ID = 'test:ship';
const DESTINATION = 'test:destination';
/** An outfit that widens the no-jump zone (oütf ModType 23). */
const DIST_MOD_OUTFIT = 'test:distMod';
const DIST_MOD = 2000;

/**
 * The refused-jump beep (nova:153) and the status bar's dim hyperspace
 * destination were both shipped, both unit-tested, and both dead in the
 * real game.
 *
 * Each reads ShipPhysicsComponent — it holds jumpDistanceMod, which sizes
 * the no-jump zone — and ShipPhysicsComponent is derived, not synced, so
 * it never crossed the simulation-to-display bridge. `playerJumpRefused`
 * fell through its `if (!physics) return false` and never beeped;
 * DrawStatusBarNavigation fell back to "a jump is possible" and drew the
 * destination bright always. Every existing spec for either feature sets
 * the component by hand, a state the bridge never produces, so all of
 * them passed.
 *
 * These specs never touch ShipPhysicsComponent. They build the player the
 * way the bridge does — ShipDataComponent and OutfitsStateComponent, both
 * genuinely serialized — and let the display world derive the rest.
 */
describe('jump readiness in the display world', () => {
    it('is not something the simulation syncs', async () => {
        // The premise: if this ever starts crossing the bridge, the
        // display-side derivation below is redundant rather than load-bearing.
        const { world } = await makeSimulationBridgeHarness();
        const serializer = world.resources.get(SerializerResource)!;
        expect(serializer.hasComponent(ShipDataComponent as UnknownComponent))
            .withContext('ship data crosses').toBeTrue();
        expect(serializer.hasComponent(
            OutfitsStateComponent as UnknownComponent))
            .withContext('outfits cross').toBeTrue();
        expect(serializer.hasComponent(
            ShipPhysicsComponent as UnknownComponent))
            .withContext('derived ship physics does not').toBeFalse();
    }, 120_000);

    function gameData(): SimulationGameDataInterface {
        const outfit = {
            ...getDefaultOutfitData(),
            id: DIST_MOD_OUTFIT,
            physics: { freeMass: 0, jumpDistanceMod: DIST_MOD },
        };
        return {
            data: {
                Outfit: {
                    getCached: (id: string) =>
                        id === DIST_MOD_OUTFIT ? outfit : undefined,
                },
                System: {
                    getCached: (id: string) =>
                        id === DESTINATION ? { name: 'Sanddown' } : undefined,
                },
                Govt: { getCached: () => undefined },
            },
        } as unknown as SimulationGameDataInterface;
    }

    function spyAssets(played: string[]): DisplayAssetDataInterface {
        const cache = new Map<string, unknown>();
        const Sound = {
            getCached(id: string) {
                if (!cache.has(id)) {
                    cache.set(id, {
                        volume: 0,
                        play() { played.push(id); },
                        stop() { },
                    });
                }
                return cache.get(id);
            },
            get(id: string) { return Promise.resolve(Sound.getCached(id)); },
        };
        return { data: { Sound } } as unknown as DisplayAssetDataInterface;
    }

    /**
     * A display world holding one player ship, mirrored exactly as
     * SimulationBridgeHost.snapshot() would deliver it: every component
     * here is serializer-registered, and ShipPhysicsComponent is not set.
     */
    async function makeDisplayWorld({ distance = JUMP_DISTANCE + 500,
        fuel = FUEL_PER_JUMP, route = [DESTINATION],
        distModOutfit = false } = {}) {
        const world = new World('jump readiness display test');
        const played: string[] = [];
        const drawn: NavReadout[] = [];
        const controls = new Subject<ControlEvent>();
        world.resources.set(DisplayAssetDataResource, spyAssets(played));
        world.resources.set(SimulationGameDataResource, gameData());
        world.resources.set(ControlsSubject, controls);
        world.resources.set(TimeResource,
            { time: 0, delta_ms: 0, delta_s: 0 } as never);
        world.resources.set(StatusBarResource, {
            navigation: {
                drawNavigation: (readout: NavReadout) => { drawn.push(readout); },
            },
        } as never);
        // The readout withholds an unexplored destination's name, so it
        // needs the pilot's record; this suite is about the DIM rule, so
        // the destination is a system the pilot has been to.
        world.resources.set(DiscoveryLevelResource, () => DISCOVERY_ENTERED);
        // The Display plugin adds this to the real display world for
        // exactly this reason (display/display_plugin.ts).
        await world.addPlugin(ShipPhysicsDisplayPlugin);
        await world.addPlugin(SoundPlugin);
        await world.addPlugin(UiSoundTriggersPlugin);
        world.addSystem(DrawStatusBarNavigation);

        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        player.components.set(ShipDataComponent, {
            ...getDefaultShipData(),
            id: SHIP_ID,
            physics: { ...getDefaultShipPhysics(), jumpDistanceMod: 0 },
        });
        player.components.set(OutfitsStateComponent, new Map(
            distModOutfit ? [[DIST_MOD_OUTFIT, { count: 1 }]] : []));
        player.components.set(MovementStateComponent,
            { position: new Position(distance, 0) } as never);
        player.components.set(FuelComponent,
            { current: fuel, max: FUEL_PER_JUMP * 4 } as never);
        player.components.set(JumpRouteComponent, { route });
        world.entities.set('player', player);

        // One step to let the provider attach and the beep systems arm.
        world.step();
        played.length = 0;

        return {
            world, player, played, controls,
            pressJump() {
                controls.next(
                    { action: 'hyperjump', state: 'start' } as ControlEvent);
                // playUiSound queues; UiSoundSystem plays on the next step.
                world.step();
            },
            nav: () => drawn[drawn.length - 1],
        };
    }

    it('derives ship physics from the components that do cross', async () => {
        const { player } = await makeDisplayWorld({ distModOutfit: true });
        const physics = player.components.get(ShipPhysicsComponent);
        expect(physics).withContext('derived in the display world').toBeDefined();
        // Summed across the hull and its outfits, which is the whole
        // reason this is derived rather than read off the ship data.
        expect(physics!.jumpDistanceMod).toBe(DIST_MOD);
    }, 120_000);

    it('beeps when the jump is refused for being too close', async () => {
        const { played, pressJump } = await makeDisplayWorld(
            { distance: JUMP_DISTANCE - 1 });
        pressJump();
        expect(played).toContain(BEEP_CANT_DO);
    }, 120_000);

    it('beeps when the jump is refused for want of fuel', async () => {
        const { played, pressJump } = await makeDisplayWorld(
            { fuel: FUEL_PER_JUMP - 1 });
        pressJump();
        expect(played).toContain(BEEP_CANT_DO);
    }, 120_000);

    it('stays silent when no destination is selected', async () => {
        // Matthew, 2026-08-15: the beep is for "not enough energy / not
        // far enough from system center", NOT for an unselected
        // destination.
        const { played, pressJump } = await makeDisplayWorld({ route: [] });
        pressJump();
        expect(played).not.toContain(BEEP_CANT_DO);
    }, 120_000);

    it('stays silent when the jump is possible', async () => {
        const { played, pressJump } = await makeDisplayWorld();
        pressJump();
        expect(played).not.toContain(BEEP_CANT_DO);
    }, 120_000);

    it('refuses inside a no-jump zone an outfit widened', async () => {
        // Outside the standard radius, inside the one the ship's
        // hyperspace dist mod outfit creates: only the DERIVED physics
        // knows the difference.
        const { played, pressJump } = await makeDisplayWorld({
            distance: JUMP_DISTANCE + 500, distModOutfit: true,
        });
        pressJump();
        expect(played).toContain(BEEP_CANT_DO);
    }, 120_000);

    it('dims the status bar destination until the jump is possible',
        async () => {
            const close = await makeDisplayWorld(
                { distance: JUMP_DISTANCE - 1 });
            expect(close.nav().value).toBe('Sanddown');
            expect(close.nav().dim)
                .withContext('dim inside the no-jump zone').toBeTrue();

            const dry = await makeDisplayWorld({ fuel: FUEL_PER_JUMP - 1 });
            expect(dry.nav().dim)
                .withContext('dim without a jump\'s worth of fuel').toBeTrue();

            const ready = await makeDisplayWorld();
            expect(ready.nav().dim)
                .withContext('bright once the jump is possible').toBeFalse();
        }, 120_000);
});
