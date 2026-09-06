import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { DisabledComponent } from '../nova_plugin/disabled_component.js';
import { SimulationGameDataResource } from '../nova_plugin/game_data_resource.js';
import { FuelComponent, FUEL_PER_JUMP } from '../nova_plugin/health_plugin.js';
import {
    JumpComponent, JumpRouteComponent, JUMP_DISTANCE,
} from '../nova_plugin/jump_plugin.js';
import {
    PlanetDataComponent, PlanetTargetComponent,
} from '../nova_plugin/planet_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import { ShipPhysicsComponent } from '../nova_plugin/ship_plugin.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../nova_plugin/discovery.js';
import {
    DiscoveryLevelResource, DrawStatusBarNavigation,
} from './status_bar_navigation.js';
import { StatusBarResource } from './status_bar_resource.js';
import { NavReadout, UNEXPLORED_SYSTEM } from './status_bar_content.js';

/**
 * The status bar's Hyperspace readout: WHICH destination it names, and
 * whether it is drawn dim. Both were playtest complaints — the readout
 * advanced to the next hop the instant a jump started, and it never dimmed
 * to show the player they could not jump yet.
 *
 * ...and WHETHER it names it at all: a system the pilot has never entered
 * is a dim, unlabeled dot on the star map, so the readout must not print
 * its name (see UNEXPLORED_SYSTEM).
 */

/** System names keyed by uuid, as the real System.getCached provides. */
function fakeGameData(names: Record<string, string>):
    SimulationGameDataInterface {
    return {
        data: {
            System: {
                getCached: (id: string) =>
                    names[id] === undefined ? undefined : { name: names[id] },
            },
        },
    } as unknown as SimulationGameDataInterface;
}

/**
 * A world with the readout's system in it. `discovery` is the pilot's
 * per-system record; the default marks every named system entered, which is
 * the state the pre-discovery expectations below were written against.
 */
function makeWorld(names: Record<string, string> = { 'nova:129': 'Sanddown' },
    discovery?: Map<string, DiscoveryLevel>) {
    const world = new World('status bar navigation test');
    const drawn: NavReadout[] = [];
    world.resources.set(StatusBarResource, {
        navigation: {
            drawNavigation: (readout: NavReadout) => { drawn.push(readout); },
        },
    } as never);
    world.resources.set(SimulationGameDataResource, fakeGameData(names));
    const levels = discovery ?? new Map<string, DiscoveryLevel>(
        Object.keys(names).map(id => [id, DISCOVERY_ENTERED]));
    world.resources.set(DiscoveryLevelResource,
        (id: string) => levels.get(id) ?? DISCOVERY_UNKNOWN);
    world.addSystem(DrawStatusBarNavigation);

    const player = new Entity('player');
    player.components.set(PlayerShipSelector, undefined);
    player.components.set(MovementStateComponent,
        { position: new Position(JUMP_DISTANCE + 500, 0) } as never);
    player.components.set(ShipPhysicsComponent, { jumpDistanceMod: 0 } as never);
    player.components.set(FuelComponent,
        { current: FUEL_PER_JUMP, max: FUEL_PER_JUMP } as never);
    player.components.set(JumpRouteComponent, { route: ['nova:129'] });
    world.entities.set('player', player);

    const last = () => drawn[drawn.length - 1];
    return { world, player, drawn, last, levels };
}

describe('status bar navigation: dim until jump-ready', () => {
    it('draws the destination bright when the ship can jump', () => {
        const { world, last } = makeWorld();
        world.step();
        expect(last()).toEqual({
            header: 'Hyperspace', value: 'Sanddown', dim: false,
        });
    });

    it('dims the destination inside the no-jump zone', () => {
        const { world, player, last } = makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(JUMP_DISTANCE - 1, 0) } as never);
        world.step();
        expect(last().value).toBe('Sanddown');
        expect(last().dim).toBeTrue();
    });

    it('dims the destination without a jump\'s worth of fuel', () => {
        const { world, player, last } = makeWorld();
        player.components.set(FuelComponent,
            { current: FUEL_PER_JUMP - 1, max: FUEL_PER_JUMP } as never);
        world.step();
        expect(last().dim).toBeTrue();
    });

    it('dims the destination for a disabled ship', () => {
        const { world, player, last } = makeWorld();
        player.components.set(DisabledComponent, { repairAt: null });
        world.step();
        expect(last().dim).toBeTrue();
    });

    it('respects the ship\'s hyperspace dist mod', () => {
        const { world, player, last } = makeWorld();
        // A +1000 mod pushes the no-jump zone out past the ship.
        player.components.set(ShipPhysicsComponent,
            { jumpDistanceMod: 1000 } as never);
        world.step();
        expect(last().dim).toBeTrue();
    });

    it('brightens as soon as the ship leaves the no-jump zone', () => {
        const { world, player, last } = makeWorld();
        player.components.set(MovementStateComponent,
            { position: new Position(JUMP_DISTANCE - 1, 0) } as never);
        world.step();
        expect(last().dim).toBeTrue();
        player.components.set(MovementStateComponent,
            { position: new Position(JUMP_DISTANCE + 1, 0) } as never);
        world.step();
        expect(last().dim).toBeFalse();
    });
});

describe('status bar navigation: the destination being jumped to', () => {
    it('keeps showing the in-flight destination after the route advances',
        () => {
            // beginJump shifts the hop off the route the instant the jump
            // starts, so mid-jump route[0] is the NEXT system. The readout
            // must still name where the ship is actually going.
            const { world, player, last } = makeWorld({
                'nova:129': 'Sanddown', 'nova:130': 'Kania',
            });
            world.step();
            expect(last().value).toBe('Sanddown');

            // A jump to Sanddown starts: route head advances to Kania.
            player.components.set(JumpRouteComponent, { route: ['nova:130'] });
            player.components.set(JumpComponent,
                { stage: 'stopping', direction: 0, to: 'nova:129' });
            world.step();
            expect(last().value).toBe('Sanddown');

            // On arrival the jump ends and the route head takes over.
            player.components.delete(JumpComponent);
            world.step();
            expect(last().value).toBe('Kania');
        });

    it('draws an in-flight destination bright even inside the no-jump zone',
        () => {
            // Mid-jump the ship cannot START a jump, but it is already on its
            // way to this destination: dimming it would be the opposite lie.
            const { world, player, last } = makeWorld();
            player.components.set(MovementStateComponent,
                { position: new Position(0, 0) } as never);
            player.components.set(JumpRouteComponent, { route: [] });
            player.components.set(JumpComponent,
                { stage: 'accelerating', direction: 0, to: 'nova:129' });
            world.step();
            expect(last()).toEqual({
                header: 'Hyperspace', value: 'Sanddown', dim: false,
            });
        });

    it('falls back to the route head for a vanishing jump\'s empty '
        + 'destination', () => {
            // VANISH_DESTINATION is the empty string; an NPC-style vanishing
            // jump names no system, so the route head is what to show.
            const { world, player, last } = makeWorld();
            player.components.set(JumpComponent,
                { stage: 'stopping', direction: 0, to: '', vanish: true });
            world.step();
            expect(last().value).toBe('Sanddown');
        });

    it('shows the "No Destination" placeholder with no route and no jump',
        () => {
            const { world, player, last } = makeWorld();
            player.components.set(JumpRouteComponent, { route: [] });
            world.step();
            expect(last()).toEqual({
                header: 'Stellar Navigation', value: 'No Destination',
                dim: true,
            });
        });
});

describe('status bar navigation: an unexplored destination is not named',
    () => {
        const unknown = () => new Map<string, DiscoveryLevel>();

        it('shows the placeholder instead of the system\'s name', () => {
            const { world, last } = makeWorld(
                { 'nova:129': 'Sanddown' }, unknown());
            world.step();
            expect(last().value).toBe('Unexplored System');
            expect(last().value).toBe(UNEXPLORED_SYSTEM);
        });

        it('still reads "Hyperspace" and still obeys the dim rule', () => {
            // The route IS set and IS jumpable; only the name is withheld.
            const { world, player, last } = makeWorld(
                { 'nova:129': 'Sanddown' }, unknown());
            world.step();
            expect(last()).toEqual({
                header: 'Hyperspace', value: UNEXPLORED_SYSTEM, dim: false,
            });
            player.components.set(MovementStateComponent,
                { position: new Position(JUMP_DISTANCE - 1, 0) } as never);
            world.step();
            expect(last()).toEqual({
                header: 'Hyperspace', value: UNEXPLORED_SYSTEM, dim: true,
            });
        });

        it('names a system the pilot has merely entered (level 1)', () => {
            // "Explored" is level >= 1, the same threshold Exxx reads:
            // flying through is what teaches you the name.
            const { world, last } = makeWorld({ 'nova:129': 'Sanddown' },
                new Map([['nova:129', DISCOVERY_ENTERED]]));
            world.step();
            expect(last().value).toBe('Sanddown');
        });

        it('names a system the pilot has landed in (level 2)', () => {
            const { world, last } = makeWorld({ 'nova:129': 'Sanddown' },
                new Map([['nova:129', DISCOVERY_LANDED]]));
            world.step();
            expect(last().value).toBe('Sanddown');
        });

        it('swaps the placeholder for the name as soon as the pilot '
            + 'arrives', () => {
                // Live: entering the system calls markDiscovered, and the
                // next display step reads the raised level.
                const { world, levels, last } = makeWorld(
                    { 'nova:129': 'Sanddown' }, unknown());
                world.step();
                expect(last().value).toBe(UNEXPLORED_SYSTEM);
                levels.set('nova:129', DISCOVERY_ENTERED);
                world.step();
                expect(last().value).toBe('Sanddown');
            });

        it('withholds the name of the destination being jumped TO, not the '
            + 'route head behind it', () => {
                // Mid-jump the readout names the jump's own `to`; the gate
                // has to follow it, not route[0].
                const { world, player, last } = makeWorld(
                    { 'nova:129': 'Sanddown', 'nova:130': 'Kania' },
                    new Map([['nova:130', DISCOVERY_ENTERED]]));
                player.components.set(JumpRouteComponent, { route: ['nova:130'] });
                player.components.set(JumpComponent,
                    { stage: 'stopping', direction: 0, to: 'nova:129' });
                world.step();
                expect(last().value).toBe(UNEXPLORED_SYSTEM);

                // Arrival: the jump ends, the known route head takes over.
                player.components.delete(JumpComponent);
                world.step();
                expect(last().value).toBe('Kania');
            });

        it('leaves the selected stellar alone: it is in the system the '
            + 'pilot is standing in', () => {
                const { world, player, last } = makeWorld(
                    { 'nova:129': 'Sanddown' }, unknown());
                player.components.set(JumpRouteComponent, { route: [] });
                const planet = new Entity('planet');
                planet.components.set(PlanetDataComponent,
                    { name: 'Europa' } as never);
                world.entities.set('planet', planet);
                player.components.set(PlanetTargetComponent,
                    { target: 'planet' } as never);
                world.step();
                expect(last()).toEqual({
                    header: 'Stellar Navigation', value: 'Europa', dim: false,
                });
            });

        it('refuses to be installed at all without a discovery record', () => {
            // The gate is REQUIRED, not optional: a world that forgot the
            // resource must fail loudly rather than quietly name every
            // system in the galaxy again. The ECS enforces it at install
            // time, and refuses to remove the resource afterwards, so once
            // the readout is wired the gate cannot come off.
            const world = new World('no discovery record');
            world.resources.set(StatusBarResource,
                { navigation: { drawNavigation: () => { } } } as never);
            world.resources.set(SimulationGameDataResource,
                fakeGameData({ 'nova:129': 'Sanddown' }));
            expect(() => world.addSystem(DrawStatusBarNavigation))
                .toThrowError(/missing Resource\(DiscoveryLevel\)/);
        });

        it('will not let the gate be removed once installed', () => {
            const { world } = makeWorld({ 'nova:129': 'Sanddown' }, unknown());
            expect(() => world.resources.delete(DiscoveryLevelResource))
                .toThrowError(/Cannot remove resource DiscoveryLevel/);
        });
    });
