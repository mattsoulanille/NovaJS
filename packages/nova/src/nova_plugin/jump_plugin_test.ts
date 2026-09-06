import "jasmine";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import { getIntegrationGameData, getSyntheticGameData } from "../communication/simulation_test_fixture.js";
import { GameDataAggregator } from "../server/parsing/game_data_aggregator.js";
import { completeEntity } from "./entity_data_loader.js";
import { FinishJump, FinishJumpEvent, JumpComponent, JumpRouteComponent, MultiJumpContinueComponent, hopIsUnflyableFromHere, reconcileRouteOnArrival, JUMP_ARRIVAL_MARGIN_S, JUMP_DEPART_DELAY_MS, JUMP_DISTANCE, JUMP_SPINUP_DELAY_MS, WARP_OUT_SOUND, WARP_UP_FAST_SOUND, WARP_UP_SOUND } from "./jump_plugin.js";
import { makeShip } from "./make_ship.js";
import { makeSystem, SIMULATION_STEP_MS } from "./make_system.js";
import { applyControlEvents } from "./ship_control.js";
import { PlayerShipSelector } from "./player_ship_plugin.js";
import { ShipPhysicsComponent } from "./ship_plugin.js";
import { ArmorComponent, FuelComponent, FUEL_PER_JUMP } from "./health_plugin.js";
import { LandEvent } from "./planet_plugin.js";
import { PlayerSoundEvent } from "./sound_plugin.js";
import { Entity } from "nova_ecs/entity";
import { DisabledComponent } from "./disabled_component.js";

const SHIP_UUID = 'jump test ship';

/**
 * The jump sequence itself runs on the SYNTHETIC data set: it needs a
 * linked pair of systems and an inertial hull that has to slow down to
 * jump, and Thessaly Reach -> Kestrel Drift in the Wren Skiff is exactly
 * that. Only the stacked-Sol specs at the end, which pin stock content,
 * stay on the integration set.
 */
async function findLinkedSystems(gameData: GameDataAggregator) {
    const ids = await gameData.ids;
    for (const systemId of [...ids.System].sort()) {
        const system = await gameData.data.System.get(systemId);
        if (system.links.length > 0) {
            return {
                originId: systemId,
                destinationId: [...system.links].sort()[0]!,
            };
        }
    }
    throw new Error('Expected a system with hyperspace links');
}

async function makeJumpHarness() {
    const gameData = await getSyntheticGameData();
    const ids = await gameData.ids;
    const { originId, destinationId } = await findLinkedSystems(gameData);
    const world = await makeSystem(originId, gameData, undefined, { npcs: false });

    // Pick a ship with default jump behavior (inertial, must slow
    // down to jump) so the full sequence is exercised.
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

    const origin = await gameData.data.System.get(originId);
    const destination = await gameData.data.System.get(destinationId);
    const expectedDirection = new Vector(
        destination.position[0] - origin.position[0],
        destination.position[1] - origin.position[1]).angle.angle;

    return { gameData, world, ship, originId, destinationId, expectedDirection };
}

function pressHyperjump(world: World) {
    applyControlEvents(world, undefined,
        [{ action: 'hyperjump', state: 'start' }]);
    world.step();
}

/** Steps the world until the predicate holds. Returns steps taken. */
function stepUntil(world: World, predicate: () => boolean,
    maxSteps = 3000): number {
    for (let i = 0; i < maxSteps; i++) {
        if (predicate()) {
            return i;
        }
        world.step();
    }
    throw new Error(`Condition not met within ${maxSteps} steps`);
}

function ticksFor(delayMs: number) {
    return Math.ceil(delayMs / SIMULATION_STEP_MS);
}

describe('jump sequence', () => {
    it('refuses to jump inside the no-jump zone', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE / 2));
        world.step();

        pressHyperjump(world);
        expect(ship.components.get(JumpComponent)).toBeUndefined();
        // The route is not consumed by a refused jump.
        expect(ship.components.get(JumpRouteComponent)!.route.length)
            .toEqual(1);
    }, 30_000);

    it('stops, aligns, spins up, and accelerates out', async () => {
        const { world, ship, destinationId, expectedDirection } =
            await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        movement.velocity = new Vector(100, 0);
        world.step();

        const physics = ship.components.get(ShipPhysicsComponent)!;

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });

        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        expect(jump).toBeDefined();
        expect(jump.stage).toEqual('stopping');
        expect(jump.to).toEqual(destinationId);
        expect(jump.direction).toBeCloseTo(expectedDirection, 6);
        // The route was consumed.
        expect(ship.components.get(JumpRouteComponent)!.route.length)
            .toEqual(0);

        // Control is taken away: holding accelerate must not prevent
        // the ship from stopping.
        applyControlEvents(world, undefined,
            [{ action: 'accelerate', state: 'start' }]);

        stepUntil(world, () => jump.stage !== 'stopping');
        expect(jump.stage).toEqual('aligning');
        expect(movement.velocity.length).toEqual(0);

        stepUntil(world, () => jump.stage !== 'aligning');
        expect(jump.stage).toEqual('spinup');
        expect(movement.rotation.angle).toBeCloseTo(expectedDirection, 6);
        // The ship holds still while the hyperdrive spins up.
        const spinupTicks = stepUntil(world, () => jump.stage !== 'spinup');
        expect(spinupTicks).toBeGreaterThanOrEqual(
            ticksFor(JUMP_SPINUP_DELAY_MS) - 1);
        expect(spinupTicks).toBeLessThanOrEqual(
            ticksFor(JUMP_SPINUP_DELAY_MS) + 1);
        expect(movement.velocity.length).toEqual(0);

        expect(jump.stage).toEqual('accelerating');
        // Partway through departure the ship exceeds its normal
        // maximum speed.
        for (let i = 0; i < ticksFor(JUMP_DEPART_DELAY_MS * 0.75); i++) {
            world.step();
        }
        expect(movement.velocity.length).toBeGreaterThan(physics.speed);

        stepUntil(world, () => finishJump !== undefined);
        expect(world.entities.has(SHIP_UUID)).toBeFalse();
        expect(finishJump!.to).toEqual(destinationId);
        expect(finishJump!.uuid).toEqual(SHIP_UUID);

        // The departing entity carries its arrival state: outside the
        // no-jump zone (with the reaction margin) on the inbound side,
        // coasting at its regular top speed along the travel direction.
        const jumpedShip = finishJump!.entity;
        const arrivalJump = jumpedShip.components.get(JumpComponent)!;
        expect(arrivalJump.stage).toEqual('arriving');
        const arrivalMovement =
            jumpedShip.components.get(MovementStateComponent)!;
        const arrivalDistance = JUMP_DISTANCE
            + physics.speed * JUMP_ARRIVAL_MARGIN_S;
        // The ship may have coasted inward for a tick or two before
        // the event was published.
        expect(arrivalMovement.position.length)
            .toBeLessThanOrEqual(arrivalDistance);
        expect(arrivalMovement.position.length)
            .toBeGreaterThan(arrivalDistance
                - 2 * physics.speed * SIMULATION_STEP_MS / 1000);
        expect(arrivalMovement.velocity.length)
            .toBeCloseTo(physics.speed, 3);
        expect(arrivalMovement.velocity.angle.angle)
            .toBeCloseTo(expectedDirection, 6);
        expect(arrivalMovement.rotation.angle)
            .toBeCloseTo(expectedDirection, 6);
    }, 30_000);

    it('skips stopping for ships that can jump without slowing', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        movement.velocity = new Vector(100, 0);
        const physics = ship.components.get(ShipPhysicsComponent)!;
        ship.components.set(ShipPhysicsComponent,
            { ...physics, canJumpWithoutSlowing: true });
        world.step();

        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        expect(jump.stage).toEqual('aligning');
        // Still moving: the ship never comes to a stop.
        expect(movement.velocity.length).toBeGreaterThan(0);
    }, 30_000);

    it('refuses to jump without enough fuel', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        const fuel = ship.components.get(FuelComponent)!;
        fuel.recharge = 0;
        fuel.current = FUEL_PER_JUMP - 1;

        pressHyperjump(world);
        expect(ship.components.get(JumpComponent)).toBeUndefined();
        // The route is not consumed by a refused jump.
        expect(ship.components.get(JumpRouteComponent)!.route.length)
            .toEqual(1);

        // With enough fuel, the same press starts the jump.
        fuel.current = FUEL_PER_JUMP;
        pressHyperjump(world);
        expect(ship.components.get(JumpComponent)).toBeDefined();
    }, 30_000);

    it('deducts fuel at departure, consistently through arrival', async () => {
        const { gameData, world, ship, destinationId } =
            await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        const fuel = ship.components.get(FuelComponent)!;
        fuel.recharge = 0;
        const initialFuel = Math.max(fuel.current, FUEL_PER_JUMP * 2);
        fuel.current = initialFuel;

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });
        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        // No charge while the sequence plays out in the origin system.
        stepUntil(world, () => jump.stage === 'accelerating');
        expect(ship.components.get(FuelComponent)!.current)
            .toEqual(initialFuel);

        stepUntil(world, () => finishJump !== undefined);
        // The charge lands at departure and crosses with the entity.
        const jumpedFuel = finishJump!.entity.components.get(FuelComponent)!;
        expect(jumpedFuel.current).toEqual(initialFuel - FUEL_PER_JUMP);

        // Arrival doesn't charge again.
        const destWorld = await makeSystem(destinationId, gameData, undefined, { npcs: false });
        const jumpedShip = finishJump!.entity;
        await completeEntity(destWorld, jumpedShip);
        destWorld.entities.set(SHIP_UUID, jumpedShip);
        // Keep the recharge out of the arithmetic (some ships have
        // built-in fuel regeneration).
        jumpedShip.components.get(FuelComponent)!.recharge = 0;
        stepUntil(destWorld,
            () => !jumpedShip.components.has(JumpComponent));
        expect(jumpedShip.components.get(FuelComponent)!.current)
            .toEqual(initialFuel - FUEL_PER_JUMP);
    }, 30_000);

    it('plays the warp-up sound when the ship is ready to jump', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        const sounds: string[] = [];
        const targets: (string | undefined)[] = [];
        world.events.get(PlayerSoundEvent).subscribe(({ data, entities }) => {
            sounds.push(data.id);
            targets.push(...(entities ?? []).map(
                e => typeof e === 'string' ? e : e.uuid));
        });

        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        // Silent while stopping and turning...
        stepUntil(world, () => jump.stage !== 'stopping');
        expect(sounds).toEqual([]);
        // ...and starts the moment the ship is stopped and aligned
        // (entering spinup), not when the burn begins.
        stepUntil(world, () => jump.stage === 'spinup');
        expect(sounds).toContain(WARP_UP_SOUND);
        expect(sounds).not.toContain(WARP_UP_FAST_SOUND);
        // Warp sounds are player-only: emitted targeted at the jumping
        // ship, and the display plays them only for the local player's
        // ship (see the display sound plugin's PlayerSoundSystem).
        expect(targets).toEqual([SHIP_UUID]);
    }, 30_000);

    it('plays the double-speed warp-up for fast-jumping ships', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        const physics = ship.components.get(ShipPhysicsComponent)!;
        ship.components.set(ShipPhysicsComponent,
            { ...physics, jumpSpeedMult: 1.5 });
        world.step();

        const sounds: string[] = [];
        world.events.get(PlayerSoundEvent).subscribe(({ data }) => {
            sounds.push(data.id);
        });

        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        stepUntil(world, () => jump.stage === 'spinup');
        expect(sounds).toContain(WARP_UP_FAST_SOUND);
        expect(sounds).not.toContain(WARP_UP_SOUND);
    }, 30_000);

    it('respects the jump distance modifier from outfits', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE / 2));
        const physics = ship.components.get(ShipPhysicsComponent)!;
        // An outfit shrank the no-jump zone below the ship's distance.
        ship.components.set(ShipPhysicsComponent,
            { ...physics, jumpDistanceMod: -(JUMP_DISTANCE * 0.75) });
        world.step();

        pressHyperjump(world);
        expect(ship.components.get(JumpComponent)).toBeDefined();
    }, 30_000);

    it('arrives at regular speed, clips the warp-up, and returns control',
        async () => {
        const { gameData, world, ship, destinationId } =
            await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });
        pressHyperjump(world);
        stepUntil(world, () => finishJump !== undefined);

        // Insert the ship into the destination system, as the
        // simulation bridge does after the room join completes.
        const destWorld = await makeSystem(destinationId, gameData, undefined, { npcs: false });
        const jumpedShip = finishJump!.entity;
        await completeEntity(destWorld, jumpedShip);
        destWorld.entities.set(SHIP_UUID, jumpedShip);

        const arrivalMovement =
            jumpedShip.components.get(MovementStateComponent)!;
        const physics = jumpedShip.components.get(ShipPhysicsComponent)!;
        // Arrives at its regular top speed, not hyperspace speed.
        expect(arrivalMovement.velocity.length)
            .toBeCloseTo(physics.speed, 3);

        const sounds: { id: string, stop?: boolean }[] = [];
        destWorld.events.get(PlayerSoundEvent).subscribe(({ data }) => {
            sounds.push({ id: data.id, stop: data.stop });
        });

        applyControlEvents(destWorld, undefined,
            [{ action: 'turnLeft', state: 'start' }]);
        // The first destination tick finishes the jump outright:
        destWorld.step();
        // ...the warp-up is clipped so it doesn't ring out over the
        // new system, and the warp-out plays...
        expect(sounds).toContain(
            jasmine.objectContaining({ id: WARP_UP_SOUND, stop: true }));
        expect(sounds).toContain(
            jasmine.objectContaining({ id: WARP_OUT_SOUND }));
        // ...the sequence is over...
        expect(jumpedShip.components.has(JumpComponent)).toBeFalse();
        // ...and the ship is far enough outside the no-jump zone to
        // jump again immediately, despite coasting inward.
        expect(arrivalMovement.position.length)
            .toBeGreaterThan(JUMP_DISTANCE);
        // Control is back on the very next tick.
        destWorld.step();
        expect(arrivalMovement.turning).not.toEqual(0);
        expect(arrivalMovement.velocity.length)
            .toBeLessThanOrEqual(physics.speed + 1e-6);
    }, 30_000);

    it('starts a held jump the moment it becomes possible', async () => {
        const { world, ship } = await makeJumpHarness();
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE / 2));
        world.step();

        // Hold the jump key inside the no-jump zone: nothing happens.
        pressHyperjump(world);
        world.step();
        world.step();
        expect(ship.components.get(JumpComponent)).toBeUndefined();

        // The moment the ship is outside the zone (key still held),
        // the jump starts without another press.
        movement.position = new Position(0, -(JUMP_DISTANCE + 10));
        world.step();
        expect(ship.components.get(JumpComponent)).toBeDefined();
    }, 30_000);

    it('chain-jumps across systems while the jump key is held', async () => {
        const { gameData, world, ship, destinationId } =
            await makeJumpHarness();
        // Plan a two-hop route.
        const destination = await gameData.data.System.get(destinationId);
        const nextId = [...destination.links].sort()[0];
        if (!nextId) {
            throw new Error('Expected the destination to have links');
        }
        await gameData.data.System.get(nextId);
        ship.components.set(JumpRouteComponent,
            { route: [destinationId, nextId] });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });
        pressHyperjump(world);
        stepUntil(world, () => finishJump !== undefined);

        const destWorld = await makeSystem(destinationId, gameData, undefined, { npcs: false });
        const jumpedShip = finishJump!.entity;
        await completeEntity(destWorld, jumpedShip);
        destWorld.entities.set(SHIP_UUID, jumpedShip);
        // The held key keeps producing control records (browser key
        // repeat), rebuilding the per-ship control state on arrival.
        applyControlEvents(destWorld, undefined,
            [{ action: 'hyperjump', state: 'repeat' }]);
        // First tick finishes the arrival; the held key starts the
        // route's next jump right away — the arrival margin guarantees
        // the ship is still outside the no-jump zone.
        destWorld.step();
        destWorld.step();
        const nextJump = jumpedShip.components.get(JumpComponent);
        expect(nextJump).toBeDefined();
        expect(nextJump!.to).toEqual(nextId);
        expect(jumpedShip.components.get(JumpRouteComponent)!.route)
            .toEqual([]);
    }, 30_000);

    it('multi-jump budgets extra jumps from a single initiation (ModType 32)', async () => {
        const { gameData, world, ship, destinationId } =
            await makeJumpHarness();
        const destination = await gameData.data.System.get(destinationId);
        const nextId = [...destination.links].sort()[0];
        if (!nextId) {
            throw new Error('Expected the destination to have links');
        }
        await gameData.data.System.get(nextId);
        ship.components.set(JumpRouteComponent,
            { route: [destinationId, nextId] });
        // The re-derived ShipPhysicsComponent is frozen; replace it with a
        // copy carrying multiJump (what an outfit's multiJump folds in).
        const physics = ship.components.get(ShipPhysicsComponent)!;
        ship.components.set(ShipPhysicsComponent, { ...physics, multiJump: 5 });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        pressHyperjump(world);
        // The first jump is initiated; its budget is capped to the one
        // remaining route hop, not the full multiJump of 5.
        const jump = ship.components.get(JumpComponent)!;
        expect(jump).toBeDefined();
        expect(jump.autoJumpsLeft).toEqual(1);
    }, 30_000);

    it('auto-continues a multi-jump on arrival without a key press', async () => {
        const { gameData, world, ship, destinationId } =
            await makeJumpHarness();
        const destination = await gameData.data.System.get(destinationId);
        const nextId = [...destination.links].sort()[0];
        if (!nextId) {
            throw new Error('Expected the destination to have links');
        }
        await gameData.data.System.get(nextId);
        ship.components.set(JumpRouteComponent,
            { route: [destinationId, nextId] });
        const physics = ship.components.get(ShipPhysicsComponent)!;
        ship.components.set(ShipPhysicsComponent, { ...physics, multiJump: 5 });
        const movement = ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        world.step();

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });
        pressHyperjump(world);
        stepUntil(world, () => finishJump !== undefined);

        const destWorld = await makeSystem(destinationId, gameData);
        const jumpedShip = finishJump!.entity;
        await completeEntity(destWorld, jumpedShip);
        destWorld.entities.set(SHIP_UUID, jumpedShip);
        // No held key this time: the multi-jump budget alone continues the
        // route. First tick finishes arrival (dropping JumpComponent and
        // leaving the continuation marker); the second starts the next jump.
        destWorld.step();
        destWorld.step();
        const nextJump = jumpedShip.components.get(JumpComponent);
        expect(nextJump).toBeDefined();
        expect(nextJump!.to).toEqual(nextId);
        expect(jumpedShip.components.get(JumpRouteComponent)!.route)
            .toEqual([]);
    }, 30_000);

    it('does not refuel on landing (refueling is paid, via the spaceport)', async () => {
        const { world, ship } = await makeJumpHarness();
        world.step();

        const fuel = ship.components.get(FuelComponent)!;
        fuel.recharge = 0;
        fuel.current = 10;

        // Landing must NOT refill fuel: the spaceport's Refuel button
        // (spaceport.ts) is the only refuel path, and it charges
        // credits.
        world.emit(LandEvent,
            { id: 'nova:128', uuid: 'planet nova:128' }, [SHIP_UUID]);
        world.step();
        expect(ship.components.get(FuelComponent)!.current)
            .toEqual(10);
    }, 30_000);
});

/**
 * Matthew's rule, for the player: "if a ship is disabled during any part of
 * its jump, including accelerating out of the system, it immediately stops
 * (zero velocity) and the jump is cancelled."
 *
 * A disabled player used to STALL instead — the sequence sat waiting for an
 * alignment DisabledMovementSystem erased every tick, forever.
 */
describe('a disabled player\'s jump is cancelled', () => {
    /** Really disables the ship: DisabledComponent only sticks while armor
     * is below the threshold, since ShipDisableSystem re-derives it. */
    function disable(ship: Entity) {
        const armor = ship.components.get(ArmorComponent)!;
        armor.current = armor.max * 0.05;
        armor.recharge = 0;
        ship.components.set(DisabledComponent, { repairAt: null });
    }

    function repair(ship: Entity) {
        const armor = ship.components.get(ArmorComponent)!;
        armor.current = armor.max;
        ship.components.delete(DisabledComponent);
    }

    async function harnessOutsideNoJumpZone() {
        const harness = await makeJumpHarness();
        harness.ship.components.get(MovementStateComponent)!.position =
            new Position(0, -(JUMP_DISTANCE * 2));
        harness.world.step();
        return harness;
    }

    /** Re-read each time rather than held: MovementState is replaced as
     * the world steps. */
    function speedOf(ship: Entity) {
        return ship.components.get(MovementStateComponent)!.velocity.length;
    }

    it('takes the jump away and stops the ship dead mid-spinup',
        async () => {
            const { world, ship } = await harnessOutsideNoJumpZone();
            pressHyperjump(world);
            stepUntil(world, () =>
                ship.components.get(JumpComponent)?.stage === 'spinup');
            // Something to lose, so "stopped dead" is a real claim.
            ship.components.get(MovementStateComponent)!.velocity =
                new Vector(250, 0);

            disable(ship);
            world.step();

            expect(ship.components.get(JumpComponent)).toBeUndefined();
            expect(speedOf(ship)).toEqual(0);
        }, 30_000);

    it('cancels the departure burn too, so the ship cannot still warp out',
        async () => {
            // The ordering claim: JumpDisableCancelSystem runs before
            // JumpSequenceSystem, so a ship disabled on the very tick its
            // burn would have ended does not leave.
            const { world, ship } = await harnessOutsideNoJumpZone();
            let finished = false;
            world.events.get(FinishJumpEvent).subscribe(
                () => { finished = true; });
            pressHyperjump(world);
            stepUntil(world, () =>
                ship.components.get(JumpComponent)?.stage === 'accelerating');
            stepUntil(world, () => speedOf(ship) > 200);

            disable(ship);
            for (let i = 0; i < ticksFor(JUMP_DEPART_DELAY_MS) * 3; i++) {
                world.step();
            }

            expect(finished).toBeFalse();
            expect(ship.components.get(JumpComponent)).toBeUndefined();
            expect(speedOf(ship)).toEqual(0);
            expect(world.entities.has(SHIP_UUID)).toBeTrue();
        }, 30_000);

    it('gives the route hop back, so a repaired pilot jumps where they '
        + 'chose', async () => {
            // beginJump SHIFTS the destination off the route when it
            // starts. A cancelled jump that kept the shift would silently
            // skip a hop.
            const { world, ship, destinationId } =
                await harnessOutsideNoJumpZone();
            expect(ship.components.get(JumpRouteComponent)!.route)
                .toEqual([destinationId]);

            pressHyperjump(world);
            expect(ship.components.get(JumpRouteComponent)!.route)
                .toEqual([]);
            stepUntil(world, () =>
                ship.components.get(JumpComponent)?.stage === 'spinup');

            disable(ship);
            world.step();
            expect(ship.components.get(JumpRouteComponent)!.route)
                .toEqual([destinationId]);
        }, 30_000);

    it('lets the pilot jump again once repaired', async () => {
        const { world, ship, destinationId } =
            await harnessOutsideNoJumpZone();
        pressHyperjump(world);
        stepUntil(world, () =>
            ship.components.get(JumpComponent)?.stage === 'spinup');
        disable(ship);
        world.step();
        expect(ship.components.get(JumpComponent)).toBeUndefined();

        // A held key must not restart it while the ship is still a hulk.
        for (let i = 0; i < 30; i++) {
            pressHyperjump(world);
            expect(ship.components.get(JumpComponent)).toBeUndefined();
        }

        repair(ship);
        pressHyperjump(world);
        const restarted = ship.components.get(JumpComponent);
        expect(restarted).toBeDefined();
        // A fresh sequence to the destination the pilot originally chose,
        // not the hop after it.
        expect(restarted!.to).toEqual(destinationId);

        let finishJump: FinishJump | undefined;
        world.events.get(FinishJumpEvent).subscribe(({ data }) => {
            finishJump = data;
        });
        stepUntil(world, () => finishJump !== undefined);
        expect(finishJump!.to).toEqual(destinationId);
    }, 30_000);

    it('clips the warp-up sound instead of leaving it ringing', async () => {
        const { world, ship } = await harnessOutsideNoJumpZone();
        pressHyperjump(world);
        stepUntil(world, () =>
            ship.components.get(JumpComponent)?.stage === 'spinup');

        // The warp-up starts when the ship finishes aligning and is only
        // ever stopped by the arrival that now will not happen.
        const sounds: Array<{ id: string, stop?: boolean }> = [];
        world.events.get(PlayerSoundEvent).subscribe(
            ({ data }) => sounds.push(data));
        disable(ship);
        world.step();

        const physics = ship.components.get(ShipPhysicsComponent)!;
        const warpUp = physics.jumpSpeedMult > 1
            ? WARP_UP_FAST_SOUND : WARP_UP_SOUND;
        expect(sounds).toContain(
            jasmine.objectContaining({ id: warpUp, stop: true }));
        // And the arrival sound is emphatically NOT played: nothing
        // arrived anywhere.
        expect(sounds.map(sound => sound.id)).not.toContain(WARP_OUT_SOUND);
    }, 30_000);

    it('does not start a jump for a ship disabled before it presses',
        async () => {
            // The pre-existing refusal, pinned alongside the new rule so
            // the two cannot drift.
            const { world, ship } = await harnessOutsideNoJumpZone();
            disable(ship);
            world.step();
            pressHyperjump(world);
            expect(ship.components.get(JumpComponent)).toBeUndefined();
            expect(ship.components.get(JumpRouteComponent)!.route.length)
                .toEqual(1);
        }, 30_000);
});

describe('reconcileRouteOnArrival', () => {
    function shipWithRoute(route: string[]): Entity {
        const ship = new Entity('ship');
        ship.components.set(JumpRouteComponent, { route });
        return ship;
    }
    const routeOf = (ship: Entity) =>
        ship.components.get(JumpRouteComponent)!.route;

    it('gate arrival: drops the arrived system from the head of the route',
        () => {
            // Jumped into nova:130 with it pinned, then left by gate and
            // came back: the pin must not stand.
            const ship = shipWithRoute(['nova:130', 'nova:131']);
            reconcileRouteOnArrival(ship, 'nova:130', 'gate');
            expect(routeOf(ship)).toEqual(['nova:131']);
        });

    it('gate arrival: CLEARS a route that did not lead here (a stale single '
        + 'hop after hypergating elsewhere)', () => {
        // Single-hop target nova:131 set, then the player hypergated to
        // nova:130: the old route would draw a line from nova:130 straight
        // to nova:131.
        const ship = shipWithRoute(['nova:131']);
        reconcileRouteOnArrival(ship, 'nova:130', 'gate');
        expect(routeOf(ship)).toEqual([]);
    });

    it('gate arrival: keeps the later hops of a route that ran THROUGH here',
        () => {
            const ship = shipWithRoute(['nova:130', 'nova:131', 'nova:132']);
            reconcileRouteOnArrival(ship, 'nova:130', 'gate');
            expect(routeOf(ship)).toEqual(['nova:131', 'nova:132']);
        });

    it('hyperspace arrival: leaves the route alone (beginJump already '
        + 'shifted it, so route[0] is the NEXT hop of a chain)', () => {
        const ship = shipWithRoute(['nova:131', 'nova:132']);
        reconcileRouteOnArrival(ship, 'nova:130', 'jump');
        expect(routeOf(ship)).toEqual(['nova:131', 'nova:132']);
    });

    it('hyperspace arrival: drops a head naming the system just arrived in',
        () => {
            // The map, opened during the jump sequence and closed before
            // departure, re-derives the route from the ORIGIN and writes it
            // back — putting the hop the ship is already committed to back
            // on the route. Arriving must not leave it there, or the next
            // jump would go straight back out and in again.
            const ship = shipWithRoute(['nova:130', 'nova:131']);
            reconcileRouteOnArrival(ship, 'nova:130', 'jump');
            expect(routeOf(ship)).toEqual(['nova:131']);
        });

    it('is a no-op without a route component', () => {
        const ship = new Entity('ship');
        expect(() => reconcileRouteOnArrival(ship, 'nova:130', 'gate'))
            .not.toThrow();
    });
});

/**
 * A route hop naming the system the ship is ALREADY IN must never be flown.
 * Flying one jumps out of a system and straight back into it — the pilot
 * enters the same system twice along one route (Matthew's playtest,
 * 2026-08-17).
 *
 * Three ways a stale head gets onto the route, all repaired in the
 * SIMULATION (deterministically, off server-visible state: the route
 * component and the world's own SystemIdResource) rather than trusted to
 * whichever client wrote it:
 *
 *  - the starmap, opened DURING a jump sequence and closed before the ship
 *    departs, re-derives the route from the origin and writes back the hop
 *    the ship is already committed to (starmap_plugin's setJumpRoute path);
 *  - a jump cancelled after the ship has already arrived gives its
 *    destination back to the route (disabled_plugin, fixed there too);
 *  - the hop is a STACKED DUPLICATE of the current system — Nova swaps
 *    between copies of a system at the same map position with control bits
 *    (Sol is nova:130 under !(b147|b305) and nova:531 under (b147|b305)),
 *    so a route pinned under one set of bits can name the copy of the very
 *    system the player is standing in.
 */
describe('a route hop naming the system the ship is already in', () => {
    /** A player ship, outside the no-jump zone, in `systemId`'s world. */
    async function shipInSystem(systemId: string, route: string[],
        gameData: GameDataAggregator) {
        const ids = await gameData.ids;
        const world = await makeSystem(systemId, gameData, undefined,
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
        const ship = makeShip(shipData!);
        ship.components.set(PlayerShipSelector, undefined);
        ship.components.set(JumpRouteComponent, { route });
        await completeEntity(world, ship);
        world.entities.set(SHIP_UUID, ship);
        ship.components.get(MovementStateComponent)!.position =
            new Position(0, -(JUMP_DISTANCE * 2));
        return { gameData, world, ship };
    }

    it('is dropped on arrival, so a held key jumps one hop further along',
        async () => {
            const { gameData, world, ship, destinationId } =
                await makeJumpHarness();
            const destination = await gameData.data.System.get(destinationId);
            const nextId = [...destination.links].sort()[0];
            if (!nextId) {
                throw new Error('Expected the destination to have links');
            }
            await gameData.data.System.get(nextId);
            ship.components.set(JumpRouteComponent,
                { route: [destinationId, nextId] });
            const movement = ship.components.get(MovementStateComponent)!;
            movement.position = new Position(0, -(JUMP_DISTANCE * 2));
            world.step();

            let finishJump: FinishJump | undefined;
            world.events.get(FinishJumpEvent).subscribe(({ data }) => {
                finishJump = data;
            });
            pressHyperjump(world);
            // What the map does when it is closed mid-sequence: the route
            // is re-derived from the ORIGIN, so the destination this ship
            // is already flying to is back at its head.
            ship.components.get(JumpRouteComponent)!.route =
                [destinationId, nextId];
            stepUntil(world, () => finishJump !== undefined);
            expect(finishJump!.to).toEqual(destinationId);

            const destWorld = await makeSystem(destinationId, gameData,
                undefined, { npcs: false });
            const jumpedShip = finishJump!.entity;
            await completeEntity(destWorld, jumpedShip);
            destWorld.entities.set(SHIP_UUID, jumpedShip);
            applyControlEvents(destWorld, undefined,
                [{ action: 'hyperjump', state: 'repeat' }]);
            destWorld.step();
            destWorld.step();

            const nextJump = jumpedShip.components.get(JumpComponent);
            expect(nextJump).toBeDefined();
            // Never back out of and into the system it just arrived in.
            expect(nextJump!.to).not.toEqual(destinationId);
            expect(nextJump!.to).toEqual(nextId);
        }, 60_000);

    it('is dropped even when the hop is a stacked DUPLICATE of this system',
        async () => {
            const gameData = await getIntegrationGameData();
            // The two Sols: same name, same map position, swapped by
            // (b147 | b305). Both are linked from Tichel (nova:129), so a
            // route pinned under the other set of bits can name the copy.
            const sol = await gameData.data.System.get('nova:130');
            const otherSol = await gameData.data.System.get('nova:531');
            expect(otherSol.name).toEqual(sol.name);
            expect(otherSol.position).toEqual(sol.position);
            const onward = [...sol.links].sort()[0]!;
            await gameData.data.System.get(onward);

            const { world, ship } = await shipInSystem('nova:130',
                ['nova:531', onward], gameData);
            world.step();
            pressHyperjump(world);

            const jump = ship.components.get(JumpComponent);
            expect(jump).toBeDefined();
            expect(jump!.to).not.toEqual('nova:531');
            expect(jump!.to).toEqual(onward);
        }, 60_000);

    it('drops a stacked duplicate WITHOUT reading its record (archive parity)',
        async () => {
            // The server archive stages only this system and its links, so
            // the twin (never a link of its counterpart) is COLD there while
            // the browser worker's preload has warmed it. The verdict must
            // not depend on that (review r13 HIGH): only the current
            // system's own link list is consulted.
            const gameData = await getIntegrationGameData();
            const sol = await gameData.data.System.get('nova:130');
            expect(sol.links).not.toContain('nova:531');
            expect(hopIsUnflyableFromHere('nova:531', 'nova:130', gameData))
                .toBeTrue();
            const onward = [...sol.links].sort()[0]!;
            expect(hopIsUnflyableFromHere(onward, 'nova:130', gameData))
                .toBeFalse();
            expect(hopIsUnflyableFromHere('nova:130', 'nova:130', gameData))
                .toBeTrue();
        }, 60_000);

    it('drops a stale head that is not a link of this system', async () => {
        const gameData = await getSyntheticGameData();
        const { originId, destinationId } = await findLinkedSystems(gameData);
        const origin = await gameData.data.System.get(originId);
        // Some system that is neither here nor adjacent: a route planned
        // elsewhere and never re-planned would otherwise sit unflyable at
        // the head forever.
        const ids = [...(await gameData.ids).System].sort();
        const far = ids.find(id => id !== originId && !origin.links.includes(id))!;
        expect(far).toBeDefined();
        await gameData.data.System.get(destinationId);
        const { world, ship } = await shipInSystem(originId, [far, destinationId], gameData);
        world.step();
        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent);
        expect(jump).toBeDefined();
        expect(jump!.to).toEqual(destinationId);
    }, 60_000);

    it('is dropped before a multi-jump chain auto-continues', async () => {
        const gameData = await getSyntheticGameData();
        const { originId, destinationId } = await findLinkedSystems(gameData);
        await gameData.data.System.get(destinationId);
        // Arrived in `originId` with the multi-jump continuation marker
        // still set and a route whose head names this very system.
        const { world, ship } = await shipInSystem(originId,
            [originId, destinationId], gameData);
        ship.components.set(MultiJumpContinueComponent, { left: 1 });
        world.step();

        const jump = ship.components.get(JumpComponent);
        expect(jump).toBeDefined();
        expect(jump!.to).not.toEqual(originId);
        expect(jump!.to).toEqual(destinationId);
    }, 60_000);

    it('a jump cancelled AFTER arrival does not give the hop back',
        async () => {
            // JumpDisableCancelSystem hands the destination back to the
            // route so a repaired pilot still flies where they chose — but
            // a jump cancelled at stage 'arriving' has already REACHED its
            // destination, and handing that back points the route at the
            // system the ship is sitting in.
            const gameData = await getSyntheticGameData();
            const { destinationId } = await findLinkedSystems(gameData);
            const { world, ship } = await shipInSystem(destinationId, [], gameData);
            // One step to derive the ship's health/physics components.
            world.step();
            ship.components.set(JumpComponent, {
                stage: 'arriving', to: destinationId, direction: 0,
            });
            const armor = ship.components.get(ArmorComponent)!;
            armor.current = armor.max * 0.05;
            armor.recharge = 0;
            ship.components.set(DisabledComponent, { repairAt: null });
            world.step();

            expect(ship.components.get(JumpComponent)).toBeUndefined();
            expect(ship.components.get(JumpRouteComponent)!.route).toEqual([]);
        }, 60_000);
});
