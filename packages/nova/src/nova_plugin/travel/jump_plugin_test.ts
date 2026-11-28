import "jasmine";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { World } from "nova_ecs/world";
import { getIntegrationGameData, getSyntheticGameData } from "../../communication/simulation_test_fixture.js";
import { GameDataAggregator } from "../../server/parsing/game_data_aggregator.js";
import { completeEntity } from "../spawn/index.js";
import { FinishJump, FinishJumpEvent, JumpComponent, JumpRouteComponent, hopIsUnflyableFromHere, reconcileRouteOnArrival, PLAYER_JUMP_ARRIVAL_MARGIN_S, JUMP_DEPART_DELAY_MS, JUMP_DISTANCE, JUMP_SPINUP_DELAY_MS, WARP_OUT_SOUND, WARP_UP_FAST_SOUND, WARP_UP_SOUND } from "./jump_plugin.js";
import { makeShip } from "../ship/index.js";
import { makeSystem, SIMULATION_STEP_MS } from "../make_system.js";
import { applyControlEvents } from "../player/index.js";
import { PlayerShipSelector } from "../player/index.js";
import { ShipPhysicsComponent } from "../ship/index.js";
import { ArmorComponent, FuelComponent, FUEL_PER_JUMP } from "../ship/index.js";
import { LandEvent } from "./planet_plugin.js";
import { PlayerSoundEvent } from "../core/index.js";
import { Entity } from "nova_ecs/entity";
import { DisabledComponent } from "../ship/index.js";
import { Angle } from "nova_ecs/datatypes/angle";
import { HyperspaceArrivalComponent, jumpStageDelays, JUMP_BRAKE_MS, JUMP_BURN_ANGLE, JUMP_CLOCK_MS, JUMP_MIN_BURN_MS, NPC_DEPARTURE_DEPART_DELAY_MS, NPC_DEPARTURE_SPINUP_DELAY_MS } from "./jump_plugin.js";
import { ShipPhysics } from "novadatainterface/ship_data";
import { PlanetTargetComponent } from "./planet_plugin.js";
import { ControlledByComponent } from "../player/index.js";
import { ShipDisabled, ShipDisabledEvent } from "../encounters/index.js";

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

async function makeJumpHarness(physics: Partial<ShipPhysics> = {}) {
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
    // A hull variant for the clock specs: ShipPhysicsComponent is derived
    // once from the cached shïp (ShipPhysicsProvider) and kept until the
    // ship data or outfits change, so a fresh object here sticks.
    ship.components.set(ShipPhysicsComponent, {
        ...ship.components.get(ShipPhysicsComponent)!, ...physics,
    });
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
        // The ship holds still while the hyperdrive spins up: at least
        // the spin-up delay, then until the burn's slot on the fixed
        // clock (JUMP_DEPART_DELAY_MS before the departure).
        const spinupTicks = stepUntil(world, () => jump.stage !== 'spinup');
        expect(spinupTicks).toBeGreaterThanOrEqual(
            ticksFor(JUMP_SPINUP_DELAY_MS) - 1);
        expect(jump.departAt! - jump.stageStart!)
            .toBeLessThanOrEqual(JUMP_DEPART_DELAY_MS);
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
            + physics.speed * PLAYER_JUMP_ARRIVAL_MARGIN_S;
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

/**
 * Reference "Jump phases and fuel (U8), wave 38": `j` -> arrival 4.8 s
 * from rest (the turn, about 0.4 s still, about 3.5 s of acceleration;
 * facing the destination to the arrival 3.7-3.9 s), arrival at top speed
 * about 1,350 px out (1,000 + one second at Speed 800), a disable
 * collapses the jump with its own line, and nothing else the player does
 * stops it.
 */
describe('jump phases (U8, waves 38-39)', () => {
    async function restingFacingDestination(
        physics: Partial<ShipPhysics> = {}, offHeading = 0) {
        const harness = await makeJumpHarness(physics);
        const movement = harness.ship.components.get(MovementStateComponent)!;
        movement.position = new Position(0, -(JUMP_DISTANCE * 2));
        movement.velocity = new Vector(0, 0);
        movement.rotation =
            new Angle(harness.expectedDirection + offHeading);
        harness.world.step();
        return harness;
    }

    /** Ticks from the press to the departure (FinishJumpEvent), and the
     * stages seen on the way, in order. */
    function timeJump(world: World, ship: Entity) {
        let finished = false;
        world.events.get(FinishJumpEvent).subscribe(() => { finished = true; });
        pressHyperjump(world);
        const stages: string[] = [];
        let burnTicks = 0;
        const ticks = stepUntil(world, () => {
            const stage = ship.components.get(JumpComponent)?.stage;
            if (stage && stages[stages.length - 1] !== stage) {
                stages.push(stage);
            }
            if (stage === 'accelerating') {
                burnTicks++;
            }
            return finished;
        }) + 1;
        return { ticks, stages, burnTicks };
    }

    it('pins the measured clock: 4.8 s from rest, a 0.9 s brake from top '
        + 'speed, 0.4 s still at least, a 3.4 s burn, half a second at '
        + 'the latest', () => {
            expect(JUMP_CLOCK_MS).toBe(4800);
            expect(JUMP_BRAKE_MS).toBe(900);
            expect(JUMP_SPINUP_DELAY_MS).toBe(400);
            expect(JUMP_DEPART_DELAY_MS).toBe(3400);
            expect(JUMP_MIN_BURN_MS).toBe(500);
        });

    it('departs 4.8 s after the press for a ship already at rest and '
        + 'facing the destination: still, then a 3.4 s burn', async () => {
        const { world, ship } = await restingFacingDestination();
        const { ticks, stages, burnTicks } = timeJump(world, ship);
        const expected = ticksFor(JUMP_CLOCK_MS);
        expect(ticks).toBeGreaterThanOrEqual(expected - 2);
        expect(ticks).toBeLessThanOrEqual(expected + 3);
        expect(stages).toEqual(
            ['aligning', 'spinup', 'accelerating', 'arriving']);
        expect(Math.abs(burnTicks - ticksFor(JUMP_DEPART_DELAY_MS)))
            .toBeLessThanOrEqual(2);
    }, 30_000);

    it('a slow-turning hull departs on the SAME clock, burning only at the '
        + 'end while still turning (reference "Jump phases on a slow hull '
        + '(U8), wave 39")', async () => {
            // Turned right round, with a turn rate that cannot finish the
            // half turn inside the clock (about 29 deg/s, the Kit Jump
            // Slow's Turn 10).
            const slow = await restingFacingDestination(
                { turnRate: 0.5, acceleration: 1 }, Math.PI);
            const fast = await restingFacingDestination({}, Math.PI);
            const slowRun = timeJump(slow.world, slow.ship);
            const fastRun = timeJump(fast.world, fast.ship);
            expect(Math.abs(slowRun.ticks - fastRun.ticks))
                .toBeLessThanOrEqual(1);
            expect(Math.abs(slowRun.ticks - ticksFor(JUMP_CLOCK_MS)))
                .toBeLessThanOrEqual(3);
            // Never aligned: straight from the turn into the burn, the
            // last half second.
            expect(slowRun.stages)
                .toEqual(['aligning', 'accelerating', 'arriving']);
            expect(Math.abs(slowRun.burnTicks - ticksFor(JUMP_MIN_BURN_MS)))
                .toBeLessThanOrEqual(2);
        }, 30_000);

    it('a slow hull with a 100 deg turn burns within 45 deg of the heading '
        + 'with no hold, and is aligned before the flash (reference "Jump '
        + 'start angle on a slow hull (U8 leftover), wave 40")', async () => {
            // The Kit Jump Slow Ring: about 29 deg/s, about 100 deg to
            // turn (u8r2_a).
            const { world, ship, expectedDirection } =
                await restingFacingDestination(
                    { turnRate: 0.5, acceleration: 1 }, -100 / 180 * Math.PI);
            let finished = false;
            world.events.get(FinishJumpEvent)
                .subscribe(() => { finished = true; });
            pressHyperjump(world);
            const target = new Angle(expectedDirection);
            const stages: string[] = [];
            let offAtBurn: number | undefined;
            let alignedBeforeDeparture = false;
            const ticks = stepUntil(world, () => {
                const jump = ship.components.get(JumpComponent);
                const movement = ship.components.get(MovementStateComponent)!;
                const off = Math.abs(
                    movement.rotation.distanceTo(target).angle);
                if (jump && stages[stages.length - 1] !== jump.stage) {
                    stages.push(jump.stage);
                    if (jump.stage === 'accelerating') {
                        offAtBurn = off;
                    }
                }
                if (jump?.stage === 'accelerating' && off < 1e-6) {
                    alignedBeforeDeparture = true;
                }
                return finished;
            }) + 1;
            expect(Math.abs(ticks - ticksFor(JUMP_CLOCK_MS)))
                .toBeLessThanOrEqual(3);
            // No spin-up hold: straight from the turn into the burn.
            expect(stages).toEqual(['aligning', 'accelerating', 'arriving']);
            expect(offAtBurn).toBeGreaterThan(0);
            expect(offAtBurn!).toBeLessThanOrEqual(JUMP_BURN_ANGLE);
            // It finishes the turn under thrust, well before departing.
            expect(alignedBeforeDeparture).toBeTrue();
        }, 30_000);

    it('from top speed: the same clock after a 0.9 s brake, however weak '
        + 'the hull\'s own thrust', async () => {
            for (const acceleration of [1, 2000]) {
                const { world, ship, expectedDirection } =
                    await restingFacingDestination({ acceleration });
                const physics = ship.components.get(ShipPhysicsComponent)!;
                const movement = ship.components.get(MovementStateComponent)!;
                // Cruising straight away from the destination.
                movement.velocity = new Angle(expectedDirection + Math.PI)
                    .getUnitVector().scale(physics.speed);
                const { ticks, stages } = timeJump(world, ship);
                expect(stages[0]).toBe('stopping');
                const expected = ticksFor(JUMP_BRAKE_MS + JUMP_CLOCK_MS);
                expect(ticks).withContext(`acceleration ${acceleration}`)
                    .toBeGreaterThanOrEqual(expected - 3);
                expect(ticks).withContext(`acceleration ${acceleration}`)
                    .toBeLessThanOrEqual(expected + 3);
            }
        }, 30_000);

    it('arrives one second of top speed outside the no-jump radius',
        async () => {
            expect(PLAYER_JUMP_ARRIVAL_MARGIN_S).toBe(1);
            const { world, ship } = await restingFacingDestination();
            const speed = ship.components.get(ShipPhysicsComponent)!.speed;
            let finishJump: FinishJump | undefined;
            world.events.get(FinishJumpEvent).subscribe(({ data }) => {
                finishJump = data;
            });
            pressHyperjump(world);
            stepUntil(world, () => finishJump !== undefined);
            const arrived = finishJump!.entity
                .components.get(MovementStateComponent)!;
            expect(arrived.position.length).toBeCloseTo(
                JUMP_DISTANCE + speed, -1);
            expect(arrived.velocity.length).toBeCloseTo(speed, 3);
        }, 30_000);

    it('a hyperspace dist mod does not move the arrival: a +1000 hull '
        + 'arrives inside its 2,000 px zone, and a key held through the '
        + 'arrival waits until the ship has coasted out on the far side '
        + '(reference '
        + '"Jump chaining edge cases and an arrival inside the no-jump '
        + 'zone ...", wave 45, finding 4)', async () => {
            const { gameData, world, ship, destinationId } =
                await makeJumpHarness({ jumpDistanceMod: 1000 });
            const zone = JUMP_DISTANCE + 1000;
            const movement = ship.components.get(MovementStateComponent)!;
            // Outside the enlarged zone, so the departure is allowed.
            movement.position = new Position(0, -(zone + 500));
            movement.velocity = new Vector(0, 0);
            world.step();
            const speed = ship.components.get(ShipPhysicsComponent)!.speed;
            let finishJump: FinishJump | undefined;
            world.events.get(FinishJumpEvent).subscribe(({ data }) => {
                finishJump = data;
            });
            pressHyperjump(world);
            applyControlEvents(world, undefined,
                [{ action: 'hyperjump', state: false }]);
            stepUntil(world, () => finishJump !== undefined);
            const jumpedShip = finishJump!.entity;
            const arrived = jumpedShip.components.get(MovementStateComponent)!;
            // The STANDARD arrival (1,000 + one second), not 2,000 + one.
            expect(arrived.position.length).toBeCloseTo(
                JUMP_DISTANCE + speed, -1);
            expect(arrived.position.length).toBeLessThan(zone);

            // Into the destination with a next hop routed.
            const destWorld = await makeSystem(destinationId, gameData,
                undefined, { npcs: false });
            await completeEntity(destWorld, jumpedShip);
            destWorld.entities.set(SHIP_UUID, jumpedShip);
            const destination = await gameData.data.System.get(destinationId);
            jumpedShip.components.set(JumpRouteComponent,
                { route: [[...destination.links].sort()[0]!] });
            destWorld.step();
            expect(jumpedShip.components.has(JumpComponent)).toBeFalse();
            // Arrived inside its zone: no held-key decision to make.
            expect(jumpedShip.components.has(HyperspaceArrivalComponent))
                .toBeFalse();
            // The client's re-assert of a key held through the arrival.
            applyControlEvents(destWorld, undefined,
                [{ action: 'hyperjump', state: 'repeat' }]);
            destWorld.step();
            expect(jumpedShip.components.has(JumpComponent)).toBeFalse();
            // The held key waits while the ship is inside the zone and
            // starts the jump the tick it is out.
            stepUntil(destWorld,
                () => jumpedShip.components.has(JumpComponent));
            const tick = speed * SIMULATION_STEP_MS / 1000;
            expect(arrived.position.length)
                .toBeGreaterThan(zone - 2 * tick);
            expect(arrived.position.length).toBeLessThan(zone + 2 * tick);
        }, 30_000);

    it('no arrival grace: after the ship has coasted inside the zone, a '
        + 'key held through the arrival chains and a fresh press is refused '
        + '(reference "Jump chaining edge cases and an arrival inside the '
        + 'no-jump zone ...", wave 45, findings 2-3; ruling #385)',
        async () => {
            for (const first of ['repeat', 'start'] as const) {
                const { gameData, world, ship, destinationId } =
                    await makeJumpHarness();
                // Outside the zone, at rest.
                const start = ship.components.get(MovementStateComponent)!;
                start.position = new Position(0, -(JUMP_DISTANCE + 500));
                start.velocity = new Vector(0, 0);
                world.step();
                let finishJump: FinishJump | undefined;
                world.events.get(FinishJumpEvent).subscribe(({ data }) => {
                    finishJump = data;
                });
                pressHyperjump(world);
                applyControlEvents(world, undefined,
                    [{ action: 'hyperjump', state: false }]);
                stepUntil(world, () => finishJump !== undefined);
                const jumpedShip = finishJump!.entity;
                const destWorld = await makeSystem(destinationId, gameData,
                    undefined, { npcs: false });
                await completeEntity(destWorld, jumpedShip);
                destWorld.entities.set(SHIP_UUID, jumpedShip);
                const destination =
                    await gameData.data.System.get(destinationId);
                jumpedShip.components.set(JumpRouteComponent,
                    { route: [[...destination.links].sort()[0]!] });
                destWorld.step();
                // Out of hyperspace outside the zone: the decision waits
                // for the first press.
                expect(jumpedShip.components.has(HyperspaceArrivalComponent))
                    .withContext(first).toBeTrue();
                const movement =
                    jumpedShip.components.get(MovementStateComponent)!;
                // The client's answer lands late: the ship is inside now.
                stepUntil(destWorld,
                    () => movement.position.length < JUMP_DISTANCE - 100);
                applyControlEvents(destWorld, undefined,
                    [{ action: 'hyperjump', state: first }]);
                destWorld.step();
                expect(jumpedShip.components.has(HyperspaceArrivalComponent))
                    .withContext(first).toBeFalse();
                expect(jumpedShip.components.has(JumpComponent))
                    .withContext(first).toBe(first === 'repeat');
                if (first === 'start') {
                    // Used up: a later re-assert waits for the zone too.
                    applyControlEvents(destWorld, undefined,
                        [{ action: 'hyperjump', state: false }]);
                    destWorld.step();
                    applyControlEvents(destWorld, undefined,
                        [{ action: 'hyperjump', state: 'repeat' }]);
                    destWorld.step();
                    expect(jumpedShip.components.has(JumpComponent))
                        .toBeFalse();
                    expect(movement.position.length)
                        .toBeLessThan(JUMP_DISTANCE);
                }
            }
        }, 60_000);

    it('an NPC departure keeps the 1 s + 2 s it had; a follower takes the '
        + 'player\'s timing', () => {
        expect(jumpStageDelays({ vanish: true })).toEqual({
            spinupMs: NPC_DEPARTURE_SPINUP_DELAY_MS,
            departMs: NPC_DEPARTURE_DEPART_DELAY_MS,
        });
        expect(NPC_DEPARTURE_SPINUP_DELAY_MS).toBe(1000);
        expect(NPC_DEPARTURE_DEPART_DELAY_MS).toBe(2000);
        expect(jumpStageDelays({})).toEqual({
            spinupMs: JUMP_SPINUP_DELAY_MS,
            departMs: JUMP_DEPART_DELAY_MS,
        });
    });

    it('ignores the land key for the whole sequence', async () => {
        const { world, ship } = await restingFacingDestination();
        let finished = false;
        world.events.get(FinishJumpEvent).subscribe(() => { finished = true; });
        const landed: unknown[] = [];
        world.events.get(LandEvent).subscribe(e => landed.push(e));
        pressHyperjump(world);
        stepUntil(world, () =>
            ship.components.get(JumpComponent)?.stage === 'accelerating');
        applyControlEvents(world, undefined,
            [{ action: 'land', state: 'start' }]);
        world.step();
        // The press selected nothing (it would pick the nearest port).
        expect(ship.components.get(PlanetTargetComponent)?.target)
            .toBeUndefined();
        stepUntil(world, () => finished);
        expect(landed).toEqual([]);
    }, 30_000);

    it('the land key still selects a port when no jump is running',
        async () => {
            // The control for the spec above: the same press, no jump.
            const { world, ship } = await restingFacingDestination();
            applyControlEvents(world, undefined,
                [{ action: 'land', state: 'start' }]);
            world.step();
            expect(ship.components.get(PlanetTargetComponent)?.target)
                .toBeDefined();
        }, 30_000);

    it('a disable mid-jump says "hyperspace field collapsed" and costs no '
        + 'fuel', async () => {
            const { world, ship } = await restingFacingDestination();
            ship.components.set(ControlledByComponent, { peerId: 'pilot' });
            const fuel = ship.components.get(FuelComponent)!;
            fuel.recharge = 0;
            fuel.current = FUEL_PER_JUMP * 2;
            const told: ShipDisabled[] = [];
            world.events.get(ShipDisabledEvent).subscribe(
                ({ data }) => told.push(data));
            pressHyperjump(world);
            stepUntil(world, () =>
                ship.components.get(JumpComponent)?.stage === 'spinup');
            // The real disable path: armor under the threshold, so
            // ShipDisableSystem attaches the component (and tells).
            const armor = ship.components.get(ArmorComponent)!;
            armor.current = armor.max * 0.05;
            armor.recharge = 0;
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeTrue();
            expect(ship.components.get(JumpComponent)).toBeUndefined();
            expect(told).toEqual([{ jumpCollapsed: true }]);
            expect(ship.components.get(FuelComponent)!.current)
                .toEqual(FUEL_PER_JUMP * 2);
        }, 30_000);
});

/**
 * A "multi-jump" outfit (oütf ModType 32, "number of extra jumps to perform
 * when the user initiates a hyperspace jump"), as Matthew describes the
 * original (2026-11-27): "1 jump of fuel is used for any number of
 * multi-jumps. A multi jump looks just like a normal jump." One departure,
 * one fuel charge, one FinishJumpEvent (one system transition, so one
 * arrival, and nobody in the systems passed through ever sees the ship).
 */
describe('a multi-jump (ModType 32) is one jump', () => {
    // The synthetic map is a line: Ossory Shoal - Thessaly Reach - Kestrel
    // Drift - Vael Hollow.
    const OSSORY = 'nova:130';
    const THESSALY = 'nova:128';
    const KESTREL = 'nova:129';
    const VAEL = 'nova:131';

    async function multiJumper(systemId: string, route: string[],
        multiJump: number) {
        const gameData = await getSyntheticGameData();
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
        ship.components.set(JumpRouteComponent, { route: [...route] });
        await completeEntity(world, ship);
        // What an outfit's multiJump folds into the derived physics.
        ship.components.set(ShipPhysicsComponent, {
            ...ship.components.get(ShipPhysicsComponent)!, multiJump,
        });
        world.entities.set(SHIP_UUID, ship);
        ship.components.get(MovementStateComponent)!.position =
            new Position(0, -(JUMP_DISTANCE * 2));
        world.step();
        return { gameData, world, ship };
    }

    async function heading(gameData: GameDataAggregator, from: string,
        to: string) {
        const a = await gameData.data.System.get(from);
        const b = await gameData.data.System.get(to);
        return new Vector(b.position[0] - a.position[0],
            b.position[1] - a.position[1]).angle.angle;
    }

    it('flies its extra hops as ONE jump: one fuel charge, one departure, '
        + 'one arrival in the last system', async () => {
            const { gameData, world, ship } =
                await multiJumper(THESSALY, [KESTREL, VAEL], 5);
            const fuel = ship.components.get(FuelComponent)!;
            fuel.recharge = 0;
            const initialFuel = FUEL_PER_JUMP * 3;
            fuel.current = initialFuel;
            const finishes: FinishJump[] = [];
            world.events.get(FinishJumpEvent).subscribe(
                ({ data }) => finishes.push(data));

            pressHyperjump(world);
            const jump = ship.components.get(JumpComponent)!;
            expect(jump.to).toEqual(VAEL);
            expect(jump.via).toEqual([KESTREL]);
            expect(ship.components.get(JumpRouteComponent)!.route)
                .toEqual([]);
            // It turns onto its first hop, as a jump there would, and
            // ARRIVES on that same heading, not from the last system it
            // passed through (reference "The multi-jump outfit (the hub's
            // item 3, oütf ModType 32), wave 52", finding 2: leaving east,
            // it came out on the west side of the final system).
            const arrivalHeading = await heading(gameData, THESSALY, KESTREL);
            expect(jump.direction).toBeCloseTo(arrivalHeading, 6);
            const fromLastPassed = await heading(gameData, KESTREL, VAEL);
            expect(Math.abs(new Angle(arrivalHeading)
                .distanceTo(new Angle(fromLastPassed)).angle))
                .withContext('the synthetic route bends at Kestrel Drift')
                .toBeGreaterThan(0.5);

            stepUntil(world, () => finishes.length > 0);
            world.step();
            expect(finishes.map(finish => finish.to)).toEqual([VAEL]);
            const jumped = finishes[0]!.entity;
            // One jump's fuel, however many systems.
            expect(jumped.components.get(FuelComponent)!.current)
                .toEqual(initialFuel - FUEL_PER_JUMP);
            const movement = jumped.components.get(MovementStateComponent)!;
            expect(movement.velocity.angle.angle)
                .toBeCloseTo(arrivalHeading, 6);
            expect(movement.rotation.angle).toBeCloseTo(arrivalHeading, 6);
            // On the side of Vael Hollow opposite its departure heading.
            expect(movement.position.angle.angle)
                .toBeCloseTo(new Angle(arrivalHeading + Math.PI).angle, 4);

            // One arrival, in the last system, and nothing more: no
            // further jump begins without a key.
            const destWorld = await makeSystem(VAEL, gameData, undefined,
                { npcs: false });
            await completeEntity(destWorld, jumped);
            destWorld.entities.set(SHIP_UUID, jumped);
            jumped.components.get(FuelComponent)!.recharge = 0;
            destWorld.step();
            destWorld.step();
            expect(jumped.components.has(JumpComponent)).toBeFalse();
            expect(jumped.components.get(FuelComponent)!.current)
                .toEqual(initialFuel - FUEL_PER_JUMP);
        }, 60_000);

    it('needs only one jump of fuel to start', async () => {
        const { world, ship } =
            await multiJumper(OSSORY, [THESSALY, KESTREL, VAEL], 5);
        const fuel = ship.components.get(FuelComponent)!;
        fuel.recharge = 0;
        fuel.current = FUEL_PER_JUMP;
        pressHyperjump(world);
        expect(ship.components.get(JumpComponent)?.to).toEqual(VAEL);
    }, 60_000);

    it('caps the hops at the outfit\'s ModVal (the hops in all, wave 52\'s '
        + 'MJ finding 1: ModVal 2 went two systems, 3 three) and at the route',
        async () => {
            const cases: [number, string, string[] | undefined, string[]][] = [
                [0, THESSALY, undefined, [KESTREL, VAEL]],
                [1, THESSALY, undefined, [KESTREL, VAEL]],
                [2, KESTREL, [THESSALY], [VAEL]],
                [3, VAEL, [THESSALY, KESTREL], []],
                [10, VAEL, [THESSALY, KESTREL], []],
            ];
            for (const [multiJump, to, via, rest] of cases) {
                const { world, ship } = await multiJumper(OSSORY,
                    [THESSALY, KESTREL, VAEL], multiJump);
                pressHyperjump(world);
                const jump = ship.components.get(JumpComponent)!;
                expect(jump.to).withContext(`multiJump ${multiJump}`)
                    .toEqual(to);
                expect(jump.via).withContext(`multiJump ${multiJump}`)
                    .toEqual(via);
                expect(ship.components.get(JumpRouteComponent)!.route)
                    .withContext(`multiJump ${multiJump}`).toEqual(rest);
            }
        }, 120_000);

    it('stops at a hop it cannot fly from the one before', async () => {
        // Ossory Shoal is not a link of Kestrel Drift.
        const { world, ship } =
            await multiJumper(THESSALY, [KESTREL, OSSORY, THESSALY], 5);
        pressHyperjump(world);
        const jump = ship.components.get(JumpComponent)!;
        expect(jump.to).toEqual(KESTREL);
        expect(jump.via).toBeUndefined();
        expect(ship.components.get(JumpRouteComponent)!.route)
            .toEqual([OSSORY, THESSALY]);
    }, 60_000);

    it('lets a held key chain on from the arrival, as after any jump',
        async () => {
            const { gameData, world, ship } =
                await multiJumper(OSSORY, [THESSALY, KESTREL, VAEL], 2);
            let finish: FinishJump | undefined;
            world.events.get(FinishJumpEvent).subscribe(
                ({ data }) => { finish = data; });
            pressHyperjump(world);
            stepUntil(world, () => finish !== undefined);
            expect(finish!.to).toEqual(KESTREL);

            const destWorld = await makeSystem(KESTREL, gameData, undefined,
                { npcs: false });
            const jumped = finish!.entity;
            await completeEntity(destWorld, jumped);
            destWorld.entities.set(SHIP_UUID, jumped);
            applyControlEvents(destWorld, undefined,
                [{ action: 'hyperjump', state: 'repeat' }]);
            destWorld.step();
            destWorld.step();
            const next = jumped.components.get(JumpComponent);
            expect(next?.to).toEqual(VAEL);
            expect(next?.via).toBeUndefined();
            expect(jumped.components.get(JumpRouteComponent)!.route)
                .toEqual([]);
        }, 60_000);
});
