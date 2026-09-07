import "jasmine";
import { getDefaultGovtData } from "novadatainterface/govt_data";
import { Position } from "nova_ecs/datatypes/position";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { Subject } from "rxjs";
import {
    ControlEvent, ControlsSubject, DisplayAssetDataResource, SimulationGameDataResource, Stat,
    GovtComponent,
} from '../nova_plugin/core/index.js';
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import {
    DisabledComponent, DeathEvent, ZeroArmorEvent, ArmorComponent, FuelComponent, ShipComponent,
    ShipPhysicsComponent, TargetComponent, WeaponsStateComponent,
} from '../nova_plugin/ship/index.js';
import {
    JumpComponent, JumpRouteComponent, PlanetTargetComponent,
} from '../nova_plugin/travel/index.js';
import { PlayerShipSelector } from "../nova_plugin/player/index.js";
import { ExplosionPlugin } from "./explosion_plugin.js";
import { SoundPlugin } from "./sound_plugin.js";
import { UiSoundTriggersPlugin } from "./ui_sound_triggers_plugin.js";

const PLAYER = 'player';

// A spy audio layer: one memoized fake Sound per id records play()/stop().
function makeSpyAssets(played: string[], stopped: string[]) {
    const cache = new Map<string, unknown>();
    const Sound = {
        getCached(id: string) {
            if (!cache.has(id)) {
                cache.set(id, {
                    volume: 0,
                    play() { played.push(id); },
                    stop() { stopped.push(id); },
                });
            }
            return cache.get(id);
        },
        get(id: string) { return Promise.resolve(Sound.getCached(id)); },
    };
    return { data: { Sound } } as unknown as DisplayAssetDataInterface;
}

// A minimal game-data stub whose only hostile govt always attacks the player.
function makeGameData() {
    const hostileGovt = {
        ...getDefaultGovtData(),
        id: 'nova:hostile',
        flags: { ...getDefaultGovtData().flags, alwaysAttacksPlayer: true },
    };
    return {
        data: {
            Govt: { getCached: (_id: string) => hostileGovt },
        },
    } as unknown as SimulationGameDataInterface;
}

async function makeWorld() {
    const world = new World('ui sound triggers test');
    const played: string[] = [];
    const stopped: string[] = [];
    const controls = new Subject<ControlEvent>();
    world.resources.set(DisplayAssetDataResource, makeSpyAssets(played, stopped));
    world.resources.set(SimulationGameDataResource, makeGameData());
    world.resources.set(ControlsSubject, controls);
    world.resources.set(TimeResource,
        { time: 0, delta_ms: 0, delta_s: 0 } as never);
    await world.addPlugin(SoundPlugin);
    await world.addPlugin(ExplosionPlugin);
    await world.addPlugin(UiSoundTriggersPlugin);

    const player = new Entity('player');
    player.components.set(PlayerShipSelector, undefined);
    player.components.set(TargetComponent, { target: undefined });
    player.components.set(PlanetTargetComponent, { target: undefined });
    world.entities.set(PLAYER, player);
    // Clear the pre-warm plays so assertions see only trigger-driven audio.
    world.step();
    played.length = 0;
    stopped.length = 0;
    return { world, played, stopped, controls, player };
}

describe('UI sound triggers (audio-layer spy)', () => {
    it('beeps 152 when a ship is targeted, once per change', async () => {
        const { world, played, player } = await makeWorld();
        player.components.set(TargetComponent, { target: 'ship-1' });
        world.step();
        expect(played).toContain('nova:152');

        // No re-beep while the target is unchanged.
        played.length = 0;
        world.step();
        expect(played).not.toContain('nova:152');

        // Retargeting beeps again.
        player.components.set(TargetComponent, { target: 'ship-2' });
        world.step();
        expect(played).toContain('nova:152');
    });

    it('beeps 150 when a planet is targeted', async () => {
        const { world, played, player } = await makeWorld();
        player.components.set(PlanetTargetComponent, { target: 'planet nova:128' });
        world.step();
        expect(played).toContain('nova:150');
    });

    it('beeps 151 the moment your own ship becomes disabled', async () => {
        const { world, played, player } = await makeWorld();
        world.step();
        expect(played).not.toContain('nova:151');
        player.components.set(DisabledComponent, { repairAt: null });
        world.step();
        expect(played).toContain('nova:151');
        // Edge, not level: no repeat while it stays disabled.
        played.length = 0;
        world.step();
        expect(played).not.toContain('nova:151');
    });

    it('beeps 154 when a jump becomes possible', async () => {
        const { world, played, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(1200, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 100, max: 100 } as never);
        // No route yet: not eligible.
        player.components.set(JumpRouteComponent, { route: [] });
        world.step();
        expect(played).not.toContain('nova:154');
        // Route selected while already far enough out: eligibility flips true.
        player.components.set(JumpRouteComponent, { route: ['nova:129'] });
        world.step();
        expect(played).toContain('nova:154');
    });

    it('beeps 154 on flying out of the no-jump zone, and only once',
        async () => {
            const { world, played, player } = await makeWorld();
            player.components.set(MovementStateComponent,
                { position: new Position(100, 0) } as never);
            player.components.set(ShipPhysicsComponent,
                { jumpDistanceMod: 0 } as never);
            player.components.set(FuelComponent,
                { current: 100, max: 100 } as never);
            player.components.set(JumpRouteComponent, { route: ['nova:129'] });
            world.step();
            expect(played).not.toContain('nova:154');

            player.components.set(MovementStateComponent,
                { position: new Position(1200, 0) } as never);
            world.step();
            expect(played).toContain('nova:154');

            // Level, not edge: staying eligible does not re-beep.
            played.length = 0;
            world.step();
            expect(played).not.toContain('nova:154');
        });

    it('does NOT beep 154 for a disabled ship, and beeps when it recovers',
        async () => {
            const { world, played, player } = await makeWorld();
            player.components.set(MovementStateComponent,
                { position: new Position(1200, 0) } as never);
            player.components.set(ShipPhysicsComponent,
                { jumpDistanceMod: 0 } as never);
            player.components.set(FuelComponent,
                { current: 100, max: 100 } as never);
            player.components.set(DisabledComponent, { repairAt: null });
            player.components.set(JumpRouteComponent, { route: ['nova:129'] });
            world.step();
            // A disabled ship cannot spin up its hyperdrive, so it is not
            // "ready to jump" — the gate would refuse.
            expect(played).not.toContain('nova:154');

            player.components.delete(DisabledComponent);
            world.step();
            expect(played).toContain('nova:154');
        });

    it('does NOT beep 154 mid-jump when the route head advances', async () => {
        // beginJump shifts the hop off the route the instant a jump starts,
        // which changes the route head and used to re-arm the edge — beeping
        // "you can jump!" at a ship that is already jumping.
        const { world, played, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(1200, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 200, max: 200 } as never);
        player.components.set(JumpRouteComponent,
            { route: ['nova:129', 'nova:130'] });
        world.step();
        expect(played).toContain('nova:154');

        // The jump starts: the route advances and a JumpComponent appears.
        played.length = 0;
        player.components.set(JumpRouteComponent, { route: ['nova:130'] });
        player.components.set(JumpComponent,
            { stage: 'stopping', direction: 0, to: 'nova:129' });
        world.step();
        expect(played).not.toContain('nova:154');

        // On arrival the sequence ends and the next hop is available again.
        player.components.delete(JumpComponent);
        world.step();
        expect(played).toContain('nova:154');
    });

    it('plays 370 on the first hostile ship, then stays quiet', async () => {
        const { world, played } = await makeWorld();
        world.step();
        expect(played).not.toContain('nova:370');

        const enemy = new Entity('enemy');
        enemy.components.set(ShipComponent, {} as never);
        enemy.components.set(GovtComponent, { id: 'nova:hostile' });
        world.entities.set('enemy-1', enemy);
        world.step();
        expect(played).toContain('nova:370');

        // A second hostile arriving does not re-fire (already non-empty).
        played.length = 0;
        const enemy2 = new Entity('enemy2');
        enemy2.components.set(ShipComponent, {} as never);
        enemy2.components.set(GovtComponent, { id: 'nova:hostile' });
        world.entities.set('enemy-2', enemy2);
        world.step();
        expect(played).not.toContain('nova:370');
    });

    it('loops 371 while your ship explodes and stops it on death', async () => {
        const { world, played, stopped } = await makeWorld();
        world.emit(ZeroArmorEvent, { time: 0, delta_ms: 0, delta_s: 0 } as never,
            [PLAYER]);
        world.step();
        expect(played).toContain('nova:371');

        world.emit(DeathEvent, { time: 0, delta_ms: 0, delta_s: 0 } as never,
            [PLAYER]);
        world.step();
        expect(stopped).toContain('nova:371');
    });

    it('does not restart 371 from a zero-armor event replayed after the '
        + 'respawn', async () => {
            // The bridge forwards simulation events in emit order, and a
            // hit landing in the tick a death sequence finishes emits its
            // ZeroArmorEvent behind the DeathEvent. Restarting the loop
            // after its own stop would leave the death sound howling for
            // the rest of the flight (see armorFullyRestored).
            const { world, played, player } = await makeWorld();
            player.components.set(ArmorComponent,
                new Stat({ current: 100, recharge: 0, max: 100 }));
            world.emit(DeathEvent,
                { time: 0, delta_ms: 0, delta_s: 0 } as never, [PLAYER]);
            world.emit(ZeroArmorEvent,
                { time: 0, delta_ms: 0, delta_s: 0 } as never, [PLAYER]);
            world.step();
            expect(played).not.toContain('nova:371');
        });

    it('beeps 153 when switching secondaries with none available', async () => {
        const { world, played, controls, player } = await makeWorld();
        player.components.set(WeaponsStateComponent, new Map());
        world.step();
        controls.next({ action: 'nextSecondary', state: 'start' });
        world.step();
        expect(played).toContain('nova:153');
    });

    it('does NOT beep 153 when a secondary weapon is available', async () => {
        const { world, played, controls, player } = await makeWorld();
        player.components.set(WeaponsStateComponent, new Map([
            ['nova:w', { fireGroup: 'secondary' } as never],
        ]));
        world.step();
        controls.next({ action: 'nextSecondary', state: 'start' });
        world.step();
        expect(played).not.toContain('nova:153');
    });

    it('beeps 153 when a jump is refused inside the no-jump zone', async () => {
        const { world, played, controls, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(100, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 100, max: 100 } as never);
        player.components.set(JumpRouteComponent, { route: ['nova:129'] });
        world.step();
        controls.next({ action: 'hyperjump', state: 'start' });
        world.step();
        expect(played).toContain('nova:153');
    });

    it('does NOT beep 153 on an eligible jump', async () => {
        const { world, played, controls, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(1200, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 100, max: 100 } as never);
        player.components.set(JumpRouteComponent, { route: ['nova:129'] });
        world.step();
        controls.next({ action: 'hyperjump', state: 'start' });
        world.step();
        expect(played).not.toContain('nova:153');
    });

    it('stays SILENT when jump is pressed with no route at all', async () => {
        // Matthew's ruling (2026-08-15): the can't-do beep is for a jump the
        // player is trying to make and can't — too close, no fuel — and
        // "doesn't include when you haven't selected a destination". (An
        // intermediate revision beeped here; this restores f2ef16e1's
        // original silence.)
        const { world, played, controls, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(1200, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 100, max: 100 } as never);
        player.components.set(JumpRouteComponent, { route: [] });
        world.step();
        controls.next({ action: 'hyperjump', state: 'start' });
        world.step();
        expect(played).not.toContain('nova:153');
    });

    it('beeps 153 when jump is pressed without a jump\'s worth of fuel',
        async () => {
            const { world, played, controls, player } = await makeWorld();
            player.components.set(MovementStateComponent,
                { position: new Position(1200, 0) } as never);
            player.components.set(ShipPhysicsComponent,
                { jumpDistanceMod: 0 } as never);
            player.components.set(FuelComponent,
                { current: 99, max: 100 } as never);
            player.components.set(JumpRouteComponent, { route: ['nova:129'] });
            world.step();
            controls.next({ action: 'hyperjump', state: 'start' });
            world.step();
            expect(played).toContain('nova:153');
        });

    it('beeps 153 ONCE per discrete press, not on key auto-repeat',
        async () => {
            const { world, played, controls, player } = await makeWorld();
            player.components.set(MovementStateComponent,
                { position: new Position(100, 0) } as never);
            player.components.set(ShipPhysicsComponent,
                { jumpDistanceMod: 0 } as never);
            player.components.set(FuelComponent,
                { current: 100, max: 100 } as never);
            player.components.set(JumpRouteComponent, { route: ['nova:129'] });
            world.step();

            controls.next({ action: 'hyperjump', state: 'start' });
            world.step();
            expect(played.filter(id => id === 'nova:153').length).toBe(1);

            // A held key repeats; only the discrete press beeps.
            controls.next({ action: 'hyperjump', state: 'repeat' });
            controls.next({ action: 'hyperjump', state: 'repeat' });
            world.step();
            expect(played.filter(id => id === 'nova:153').length).toBe(1);

            // Releasing and pressing again is a new refusal.
            controls.next({ action: 'hyperjump', state: false });
            controls.next({ action: 'hyperjump', state: 'start' });
            world.step();
            expect(played.filter(id => id === 'nova:153').length).toBe(2);
        });

    it('does NOT beep 153 while a jump is already under way', async () => {
        // The key is held through a whole jump sequence as a matter of
        // course (that is how a held key chain-jumps a route).
        const { world, played, controls, player } = await makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(100, 0) } as never);
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 0 } as never);
        player.components.set(FuelComponent, { current: 0, max: 100 } as never);
        player.components.set(JumpRouteComponent, { route: [] });
        player.components.set(JumpComponent,
            { stage: 'accelerating', direction: 0, to: 'nova:129' });
        world.step();
        controls.next({ action: 'hyperjump', state: 'start' });
        world.step();
        expect(played).not.toContain('nova:153');
    });
});
