import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { navReadout } from '../../display/status_bar_content.js';
import {
    initialJumpReadyState, jumpReadyEdge,
} from '../../display/ui_sound_logic.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { FuelComponent, FUEL_PER_JUMP } from '../ship/health_plugin.js';
import {
    JumpComponent, JumpRouteComponent, JUMP_DISTANCE,
} from './jump_plugin.js';
import { canJump, jumpRadiusFor } from './jump_readiness.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { PlayerShipSelector } from '../player/player_ship_plugin.js';
import { applyControlEvents } from '../player/ship_control.js';
import { ShipPhysicsComponent } from '../ship/ship_plugin.js';

const SHIP_UUID = 'readiness agreement ship';

/**
 * The three consumers of "can I jump?" must never disagree: the simulation
 * gate (PlayerJumpControl) is the authority, and the nova:154/153 beeps and
 * the status bar's dim destination only REPORT on it. This drives the real
 * gate over a fuel/distance/route grid and asserts the shared predicate —
 * and both display consumers built on it — give the gate's own answer in
 * every cell. A copy of the arithmetic drifting from the gate would show up
 * here as a beep or a bright readout promising a jump that doesn't happen.
 */
async function makeHarness() {
    const gameData = await getIntegrationGameData();
    const ids = await gameData.ids;
    let originId: string | undefined;
    let destinationId: string | undefined;
    for (const systemId of [...ids.System].sort()) {
        const system = await gameData.data.System.get(systemId);
        if (system.links.length > 0) {
            originId = systemId;
            destinationId = [...system.links].sort()[0]!;
            break;
        }
    }
    if (!originId || !destinationId) {
        throw new Error('Expected a system with hyperspace links');
    }
    const world = await makeSystem(originId, gameData, undefined,
        { npcs: false });

    let shipData;
    for (const shipId of [...ids.Ship].sort()) {
        const candidate = await gameData.data.Ship.get(shipId);
        if (!candidate.physics.inertialess
            && !candidate.physics.canJumpWithoutSlowing) {
            shipData = candidate;
            break;
        }
    }
    if (!shipData) {
        throw new Error('Expected a ship with default jump behavior');
    }
    const ship = makeShip(shipData);
    ship.components.set(PlayerShipSelector, undefined);
    ship.components.set(JumpRouteComponent, { route: [destinationId] });
    await completeEntity(world, ship);
    world.entities.set(SHIP_UUID, ship);
    // One step so the provided components (fuel among them) exist. Fuel
    // recharge is switched off so each grid cell keeps the fuel it is given.
    world.step();
    ship.components.get(FuelComponent)!.recharge = 0;
    return { world, ship, destinationId };
}

describe('jump readiness: gate / beep / readout agreement', () => {
    it('gives the simulation gate\'s own answer in every cell of a '
        + 'fuel x distance x route grid', async () => {
            const { world, ship, destinationId } = await makeHarness();
            const physics = ship.components.get(ShipPhysicsComponent)!;
            const jumpRadius = jumpRadiusFor(JUMP_DISTANCE,
                physics.jumpDistanceMod);

            const distances = [0, jumpRadius - 1, jumpRadius, jumpRadius + 500];
            const fuels = [0, FUEL_PER_JUMP - 1, FUEL_PER_JUMP,
                FUEL_PER_JUMP * 2];
            const routes = [[destinationId], []];
            let allowedCells = 0;
            let refusedCells = 0;

            for (const route of routes) {
                for (const distance of distances) {
                    for (const fuel of fuels) {
                        // Reset the ship into this cell's state.
                        ship.components.delete(JumpComponent);
                        ship.components.set(JumpRouteComponent,
                            { route: [...route] });
                        const movement =
                            ship.components.get(MovementStateComponent)!;
                        movement.position = new Position(distance, 0);
                        movement.velocity = new Vector(0, 0);
                        ship.components.get(FuelComponent)!.current = fuel;

                        // THE GATE: press hyperjump and see whether the
                        // simulation actually started a jump sequence.
                        applyControlEvents(world, undefined,
                            [{ action: 'hyperjump', state: 'start' }]);
                        world.step();
                        const gateAllowed =
                            ship.components.has(JumpComponent);
                        if (gateAllowed) {
                            allowedCells++;
                        } else {
                            refusedCells++;
                        }

                        // THE PREDICATE, over the same state.
                        const inputs = {
                            hasRoute: route.length > 0,
                            distance,
                            jumpRadius,
                            fuel,
                            fuelPerJump: FUEL_PER_JUMP,
                            disabled: false,
                            jumping: false,
                        };
                        const cell = `route=${route.length} `
                            + `distance=${distance} fuel=${fuel}`;
                        expect(canJump(inputs))
                            .withContext(`predicate vs gate: ${cell}`)
                            .toBe(gateAllowed);

                        // THE CUE: a fresh edge fires exactly when eligible.
                        const { beep } = jumpReadyEdge(initialJumpReadyState(),
                            { ...inputs, routeHead: route[0] });
                        expect(beep)
                            .withContext(`jump-ready beep vs gate: ${cell}`)
                            .toBe(gateAllowed);

                        // THE READOUT: the destination is bright exactly when
                        // the gate would let the player go.
                        const readout = navReadout(
                            route.length > 0 ? 'Somewhere' : null, null,
                            canJump(inputs));
                        if (route.length > 0) {
                            expect(readout.dim)
                                .withContext(`readout dim vs gate: ${cell}`)
                                .toBe(!gateAllowed);
                        }

                        // Release the key so the next cell is a fresh press.
                        applyControlEvents(world, undefined,
                            [{ action: 'hyperjump', state: false }]);
                        world.step();
                    }
                }
            }

            // The grid must actually straddle the gate: an all-refusing grid
            // would agree with anything.
            expect(allowedCells).toBeGreaterThan(0);
            expect(refusedCells).toBeGreaterThan(0);
        });

    it('refuses, and reports refusing, for a disabled ship that is otherwise '
        + 'ready', async () => {
            const { world, ship, destinationId } = await makeHarness();
            const physics = ship.components.get(ShipPhysicsComponent)!;
            const jumpRadius = jumpRadiusFor(JUMP_DISTANCE,
                physics.jumpDistanceMod);
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(jumpRadius + 500, 0);
            movement.velocity = new Vector(0, 0);
            ship.components.get(FuelComponent)!.current = FUEL_PER_JUMP * 2;
            ship.components.set(JumpRouteComponent, { route: [destinationId] });

            const { DisabledComponent } =
                await import('../ship/disabled_component.js');
            ship.components.set(DisabledComponent, { repairAt: null });
            applyControlEvents(world, undefined,
                [{ action: 'hyperjump', state: 'start' }]);
            world.step();

            expect(ship.components.has(JumpComponent)).toBeFalse();
            expect(canJump({
                hasRoute: true,
                distance: jumpRadius + 500,
                jumpRadius,
                fuel: FUEL_PER_JUMP * 2,
                fuelPerJump: FUEL_PER_JUMP,
                disabled: true,
                jumping: false,
            })).toBeFalse();
        });
});
