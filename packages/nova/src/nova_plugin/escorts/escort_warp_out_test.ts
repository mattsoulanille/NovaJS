import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { World } from 'nova_ecs/world';
import { carriedBatchSettled } from '../../spaceport/landed_escorts.js';
import { DisabledComponent } from '../ship/disabled_component.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { EscortCommandComponent } from '../player/escort_command.js';
import { FiringGroupComponent } from '../ship/firing_group.js';
import { ArmorComponent, FuelComponent } from '../ship/health_plugin.js';
import {
    FinishJumpEvent, JumpComponent, JumpState, JUMP_DEPART_DELAY_MS,
    JUMP_SPINUP_DELAY_MS,
} from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { FormationComponent } from '../npc/npc_ai_plugin.js';
import { PlayerEscortComponent } from '../player/player_escort.js';
import { EscortJump, EscortJumpEvent } from './player_escort_plugin.js';
import { ControlledByComponent } from '../player/ship_control.js';
import { Stat } from '../core/stat.js';

/**
 * ============================================================================
 * Escorts warp out with the player
 * ============================================================================
 *
 * The behavior these specs pin, in Matthew's terms:
 *
 *  - an escort that will follow starts its OWN jump sequence when the
 *    player's jump begins, and is seen to run it;
 *  - one whose burn finishes FIRST warps out on its own, and its carry
 *    reaches the client ahead of the player's FinishJumpEvent;
 *  - one still turning when the player goes is swept on the spot — the
 *    fallback that is the reason no escort is ever left behind by slow
 *    turning;
 *  - "if the parent ship is disabled mid-jump, escorts should not jump":
 *    cancelling the player's jump cancels the whole flock's;
 *  - an escort disabled during its OWN sequence is stopped dead and left
 *    behind, like any other ship that cannot run a hyperdrive.
 *
 * The player's jump is driven by SETTING ITS JumpComponent rather than by
 * pressing the key. That is exactly what beginJump writes, and it is the
 * only way to run these in a MockGameData world: PlayerJumpControl resolves
 * its heading from two real systems' map positions, which a mock universe
 * with one system does not have. Everything under test reads the component,
 * not the key.
 */

const PEER = 'test peer';
const PLAYER = 'player';
const DESTINATION = 'test:destination';
const SHIP_ID = 'test:ship';
/** Skips 'stopping' (shïp Flags2 0x0020): the escort that gets away first. */
const FAST_SHIP_ID = 'test:fastship';
/** Radians per second; the stock default is 3. Still aligning long after
 * the player has gone. */
const SLOW_TURN_RATE = 0.06;
const SLOW_SHIP_ID = 'test:slowship';
/** A hull with no energy capacity at all: no hyperdrive, cannot follow. */
const NO_ENERGY_SHIP_ID = 'test:noEnergy';

function ticksFor(delayMs: number) {
    return Math.ceil(delayMs / SIMULATION_STEP_MS);
}

async function makeWorld() {
    const gameData = new MockGameData();
    const base = getDefaultShipData();
    gameData.data.Ship.map.set(SHIP_ID, { ...base, id: SHIP_ID });
    gameData.data.Ship.map.set(FAST_SHIP_ID, {
        ...base, id: FAST_SHIP_ID,
        physics: { ...base.physics, canJumpWithoutSlowing: true },
    });
    gameData.data.Ship.map.set(SLOW_SHIP_ID, {
        ...base, id: SLOW_SHIP_ID,
        physics: { ...base.physics, turnRate: SLOW_TURN_RATE },
    });
    gameData.data.Ship.map.set(NO_ENERGY_SHIP_ID, {
        ...base, id: NO_ENERGY_SHIP_ID,
        physics: { ...base.physics, energy: 0 },
    });

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: Entity) => void = () => { }, shipId = SHIP_ID) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    const player = await addShip(PLAYER, 0, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
    });

    async function addEscort(uuid: string, shipId = SHIP_ID, y = 200) {
        return addShip(uuid, 0, y, ship => {
            ship.components.set(FormationComponent,
                { leader: PLAYER, slot: 0 });
            ship.components.set(EscortCommandComponent,
                { command: 'formation' });
            ship.components.set(FiringGroupComponent, { group: PLAYER });
        }, shipId);
    }

    /**
     * Really disables a ship. DisabledComponent is re-derived from armor
     * every tick (ShipDisableSystem), so it only sticks on a ship that is
     * actually below its disable threshold.
     */
    function disable(ship: Entity, shipId = SHIP_ID) {
        let armor = ship.components.get(ArmorComponent);
        if (!armor) {
            const physics = gameData.data.Ship.map.get(shipId)!.physics;
            armor = new Stat({
                current: physics.armor, max: physics.armor,
                min: 0, recharge: 0,
            });
            ship.components.set(ArmorComponent, armor);
        }
        armor.current = armor.max * 0.05;
        armor.recharge = 0;
        ship.components.set(DisabledComponent, { repairAt: null });
    }

    function repair(ship: Entity) {
        const armor = ship.components.get(ArmorComponent)!;
        armor.current = armor.max;
        ship.components.delete(DisabledComponent);
    }

    /** Puts the player into the jump beginJump would have written. */
    function beginPlayerJump(velocity = new Vector(0, 0)) {
        const movement = player.components.get(MovementStateComponent)!;
        movement.velocity = velocity;
        player.components.set(JumpComponent, {
            to: DESTINATION,
            stage: 'stopping',
            direction: 0,
        });
    }

    return {
        world, gameData, addShip, addEscort, player, disable, repair,
        beginPlayerJump,
    };
}

function jumpOf(world: World, uuid: string): JumpState | undefined {
    return world.entities.get(uuid)?.components.get(JumpComponent);
}

function movementOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components
        .get(MovementStateComponent)!;
}

/** Steps until the predicate holds; returns the steps taken. */
function stepUntil(world: World, predicate: () => boolean, maxSteps = 4000) {
    for (let i = 0; i < maxSteps; i++) {
        if (predicate()) {
            return i;
        }
        world.step();
    }
    throw new Error(`Condition not met within ${maxSteps} steps`);
}

/**
 * Records the ORDER the two carry-relevant events reach a subscriber. This
 * is the client's frame event list: the simulation bridge records events on
 * the same synchronous subscription, in emit order.
 */
function recordCarryOrder(world: World) {
    const order: string[] = [];
    const escortJumps: EscortJump[] = [];
    world.events.get(EscortJumpEvent).subscribe(({ data }) => {
        order.push(`escort:${data.uuid}`);
        escortJumps.push(data);
    });
    world.events.get(FinishJumpEvent).subscribe(({ data }) => {
        order.push(`player:${data.uuid}`);
    });
    return { order, escortJumps };
}

describe('escorts begin a jump sequence with the player', () => {
    it('starts a sequence on each following escort when the jump begins',
        async () => {
            const { world, addEscort, beginPlayerJump } = await makeWorld();
            await addEscort('escort a', SHIP_ID, 200);
            await addEscort('escort b', SHIP_ID, -200);
            world.step();
            expect(jumpOf(world, 'escort a')).toBeUndefined();

            beginPlayerJump();
            world.step();

            for (const uuid of ['escort a', 'escort b']) {
                const jump = jumpOf(world, uuid);
                expect(jump).withContext(uuid).toBeDefined();
                // It follows the player, on the player's own heading, to
                // the player's destination.
                expect(jump!.follows).toEqual(PLAYER);
                expect(jump!.direction).toEqual(0);
                expect(jump!.to).toEqual(DESTINATION);
            }
        });

    it('runs the visible stages in order, not just a flag', async () => {
        const { world, addEscort, beginPlayerJump } = await makeWorld();
        // Moving, and pointing away from the jump heading, so 'stopping'
        // and 'aligning' both have real work to do.
        const escort = await addEscort('escort');
        const movement = escort.components.get(MovementStateComponent)!;
        movement.velocity = new Vector(0, 120);
        movement.rotation = new Angle(Math.PI);
        beginPlayerJump();

        const stages: string[] = [];
        for (let i = 0; i < 600 && world.entities.has('escort'); i++) {
            const stage = jumpOf(world, 'escort')?.stage;
            if (stage && stage !== stages[stages.length - 1]) {
                stages.push(stage);
            }
            world.step();
        }
        expect(stages).toEqual(
            ['stopping', 'aligning', 'spinup', 'accelerating']);
    });

    it('never sequences a zero-energy escort, and never carries it',
        async () => {
            const { world, addEscort, beginPlayerJump } = await makeWorld();
            const stranded = await addEscort('stranded', NO_ENERGY_SHIP_ID);
            const { escortJumps } = recordCarryOrder(world);
            world.step();
            expect(stranded.components.get(FuelComponent)?.max).toEqual(0);

            beginPlayerJump();
            // Right through the player's own departure.
            for (let i = 0; i < 400 && world.entities.has(PLAYER); i++) {
                expect(jumpOf(world, 'stranded')).toBeUndefined();
                world.step();
            }
            expect(world.entities.has(PLAYER)).toBeFalse();
            expect(escortJumps.length).toEqual(0);
            expect(world.entities.has('stranded')).toBeTrue();
            expect(stranded.components.get(PlayerEscortComponent)?.player)
                .toEqual(PLAYER);
        });

    it('adds no randomness to the jump path', async () => {
        const { world, addEscort, beginPlayerJump } = await makeWorld();
        await addEscort('escort a', SHIP_ID, 200);
        await addEscort('escort b', FAST_SHIP_ID, -200);
        world.step();

        const random = world.resources.get(RandomResource)!;
        const realNext = random.next.bind(random);
        let draws = 0;
        spyOn(random, 'next').and.callFake(() => {
            draws++;
            return realNext();
        });

        beginPlayerJump();
        stepUntil(world, () => !world.entities.has(PLAYER));
        // Starting, running, and sweeping a whole flock's sequences draws
        // nothing, so no other ship's rolls shift.
        expect(draws).toEqual(0);
    });
});

describe('an escort that warps out first', () => {
    it('leaves on its own burn, before the player departs', async () => {
        const { world, addEscort, beginPlayerJump } = await makeWorld();
        await addEscort('quick', FAST_SHIP_ID);
        const { order, escortJumps } = recordCarryOrder(world);
        // The player must come to a stop first (the fast escort skips
        // that), so it is comfortably the slower of the two.
        beginPlayerJump(new Vector(0, 300));

        stepUntil(world, () => escortJumps.length > 0);
        // Gone on its own account, while the player is still mid-sequence.
        expect(world.entities.has('quick')).toBeFalse();
        expect(world.entities.has(PLAYER)).toBeTrue();
        expect(jumpOf(world, PLAYER)).toBeDefined();
        expect(escortJumps[0].to).toEqual(DESTINATION);
        expect(escortJumps[0].player).toEqual(PLAYER);
        // The sequence does not ride to the destination: it would resume
        // there against a leader and a heading that no longer exist.
        expect(escortJumps[0].entity.components.has(JumpComponent))
            .toBeFalse();
        // Following is free.
        expect(escortJumps[0].entity.components.get(FuelComponent)?.current)
            .toEqual(escortJumps[0].entity.components
                .get(FuelComponent)?.max);

        // And its carry still reaches the client before the jump the
        // client follows out of this system.
        stepUntil(world, () => !world.entities.has(PLAYER));
        expect(order).toEqual([`escort:quick`, `player:${PLAYER}`]);
    });

    it('does not emit a FinishJumpEvent of its own', async () => {
        // A follower departs through its owner, never through
        // JumpFromSystem: a second FinishJumpEvent would send the client
        // out of the system twice.
        const { world, addEscort, beginPlayerJump } = await makeWorld();
        await addEscort('quick', FAST_SHIP_ID);
        const finishes: string[] = [];
        world.events.get(FinishJumpEvent).subscribe(
            ({ data }) => finishes.push(data.uuid));
        beginPlayerJump(new Vector(0, 300));

        stepUntil(world, () => !world.entities.has(PLAYER));
        expect(finishes).toEqual([PLAYER]);
    });
});

describe('an escort that is too slow to get away in time', () => {
    it('is swept at the player\'s departure, still ahead of the player\'s '
        + 'own carry', async () => {
            const { world, addEscort, beginPlayerJump } = await makeWorld();
            const slow = await addEscort('slow', SLOW_SHIP_ID);
            // Pointing the wrong way on a ship that needs the better part
            // of a minute to come about: it cannot possibly finish.
            slow.components.get(MovementStateComponent)!.rotation =
                new Angle(Math.PI);
            const { order, escortJumps } = recordCarryOrder(world);
            beginPlayerJump();

            stepUntil(world, () => !world.entities.has(PLAYER));
            // It got its visible stop and turn, and was still turning.
            expect(escortJumps.length).toEqual(1);
            expect(escortJumps[0].uuid).toEqual('slow');
            expect(world.entities.has('slow')).toBeFalse();
            // The guarantee: no escort is left behind by slow turning, and
            // its carry precedes the player's FinishJumpEvent even when
            // the two happen on the same tick.
            expect(order).toEqual([`escort:slow`, `player:${PLAYER}`]);
        });
});

describe('the player\'s jump is cancelled mid-sequence', () => {
    /** Runs the player into spinup with a flock of escorts behind them. */
    async function intoSpinup() {
        const made = await makeWorld();
        const { world, addEscort, beginPlayerJump } = made;
        await addEscort('escort a', SHIP_ID, 200);
        await addEscort('escort b', SHIP_ID, -200);
        beginPlayerJump();
        stepUntil(world, () => jumpOf(world, PLAYER)?.stage === 'spinup');
        expect(jumpOf(world, 'escort a')).toBeDefined();
        expect(jumpOf(world, 'escort b')).toBeDefined();
        return made;
    }

    it('stops the player dead and takes the jump away', async () => {
        const { world, player, disable } = await intoSpinup();
        // Give it some speed to lose, so "stopped dead" is a real claim
        // rather than a ship that was already at rest.
        movementOf(world, PLAYER).velocity = new Vector(400, 0);

        disable(player);
        world.step();

        expect(jumpOf(world, PLAYER)).toBeUndefined();
        expect(movementOf(world, PLAYER).velocity.length).toEqual(0);
        // Still here — a cancelled jump is not a departure.
        expect(world.entities.has(PLAYER)).toBeTrue();
    });

    it('cancels every escort\'s sequence on the same tick', async () => {
        const { world, player, disable } = await intoSpinup();
        disable(player);
        world.step();

        // "If the parent ship is disabled mid-jump, escorts should not
        // jump."
        expect(jumpOf(world, 'escort a')).toBeUndefined();
        expect(jumpOf(world, 'escort b')).toBeUndefined();
        expect(world.entities.has('escort a')).toBeTrue();
        expect(world.entities.has('escort b')).toBeTrue();
    });

    it('leaves the escorts flying, not stopped dead', async () => {
        // Nothing happened to THEM: they are released back to their own
        // steering with their velocity intact and fall back into
        // formation. Only a ship that is itself disabled stops dead.
        const { world, player, disable } = await intoSpinup();
        const escort = world.entities.get('escort a')!;
        escort.components.get(MovementStateComponent)!.velocity =
            new Vector(0, 90);

        disable(player);
        world.step();

        expect(movementOf(world, 'escort a').velocity.length)
            .toBeGreaterThan(0);
        expect(escort.components.get(FormationComponent)?.leader)
            .toEqual(PLAYER);
    });

    it('never lets an escort warp out after the cancel', async () => {
        const { world, player, disable } = await intoSpinup();
        const { escortJumps } = recordCarryOrder(world);
        disable(player);

        for (let i = 0; i < 400; i++) {
            world.step();
        }
        expect(escortJumps.length).toEqual(0);
        expect(world.entities.has('escort a')).toBeTrue();
        expect(world.entities.has('escort b')).toBeTrue();
    });

    it('releases a client batch that had already warped out', async () => {
        // The never-drop machinery doing the cancel case for free: an
        // escort that got away early is held by the client only while the
        // player is mid-jump, and carriedBatchSettled — which
        // flushCarriedJumpEscorts asks every frame — goes true the moment
        // the jump is cancelled, putting the batch back beside the player
        // who never left.
        const { world, addEscort, beginPlayerJump, player, disable } =
            await makeWorld();
        await addEscort('quick', FAST_SHIP_ID);
        const { escortJumps } = recordCarryOrder(world);
        beginPlayerJump(new Vector(0, 300));

        stepUntil(world, () => escortJumps.length > 0);
        // Held: the player is still on their way out.
        expect(carriedBatchSettled(player)).toBeFalse();

        disable(player);
        world.step();
        expect(jumpOf(world, PLAYER)).toBeUndefined();
        expect(carriedBatchSettled(player)).toBeTrue();
    });
});

describe('an escort disabled during its own sequence', () => {
    it('stops dead, loses the jump, and is left behind still owned',
        async () => {
            const { world, addEscort, beginPlayerJump, disable } =
                await makeWorld();
            const escort = await addEscort('escort');
            const { escortJumps } = recordCarryOrder(world);
            beginPlayerJump();
            // Into its departure burn, where it is genuinely moving.
            stepUntil(world,
                () => jumpOf(world, 'escort')?.stage === 'accelerating');
            stepUntil(world,
                () => movementOf(world, 'escort').velocity.length > 50);

            disable(escort);
            world.step();

            expect(jumpOf(world, 'escort')).toBeUndefined();
            expect(movementOf(world, 'escort').velocity.length).toEqual(0);

            // The player leaves without it: a disabled ship cannot run a
            // hyperdrive, so it is not swept either. Still owned, so it is
            // recovered if the player comes back.
            stepUntil(world, () => !world.entities.has(PLAYER));
            expect(escortJumps.length).toEqual(0);
            expect(world.entities.has('escort')).toBeTrue();
            expect(escort.components.get(PlayerEscortComponent)?.player)
                .toEqual(PLAYER);
        });

    it('does not start a fresh sequence while it stays disabled',
        async () => {
            const { world, addEscort, beginPlayerJump, disable } =
                await makeWorld();
            const escort = await addEscort('escort');
            beginPlayerJump();
            stepUntil(world,
                () => jumpOf(world, 'escort')?.stage === 'spinup');

            disable(escort);
            // The player is still jumping, so the standing "every follower
            // is jumping too" rule would re-arm it if it were not for the
            // disabled exclusion.
            for (let i = 0; i < 20; i++) {
                world.step();
                expect(jumpOf(world, 'escort')).toBeUndefined();
            }
        });
});

describe('sequence timing', () => {
    it('takes the full spinup and burn before an escort warps out',
        async () => {
            const { world, addEscort, beginPlayerJump } = await makeWorld();
            await addEscort('quick', FAST_SHIP_ID);
            const { escortJumps } = recordCarryOrder(world);
            beginPlayerJump(new Vector(0, 300));

            const steps = stepUntil(world, () => escortJumps.length > 0);
            expect(steps).toBeGreaterThanOrEqual(
                ticksFor(JUMP_SPINUP_DELAY_MS + JUMP_DEPART_DELAY_MS));
        });
});
