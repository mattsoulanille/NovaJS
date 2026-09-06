import 'jasmine';
import * as t from 'io-ts';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { World } from 'nova_ecs/world';
import { DisabledComponent } from '../ship/disabled_component.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { ArmorComponent } from '../ship/health_plugin.js';
import { Stat } from '../core/stat.js';
import { FinishJumpEvent, InitiateJumpEvent, JumpComponent, JumpState, JumpStateType, VANISH_DESTINATION, JUMP_DEPART_DELAY_MS, JUMP_DISTANCE, JUMP_SPINUP_DELAY_MS } from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { FLEE_JUMP_BLOCK_RANGE, NpcComponent, NPC_DEPART_RADIUS } from './npc_ai_plugin.js';

const SHIP_ID = 'test:ship';
/** A ship that turns very slowly: the case that motivated NPCs running
 * the real jump sequence (they used to pop out of existence mid-turn). */
const SLOW_SHIP_ID = 'test:slowship';
/** Radians per second. The stock default is 3. */
const SLOW_TURN_RATE = 0.25;

function ticksFor(delayMs: number) {
    return Math.ceil(delayMs / SIMULATION_STEP_MS);
}

/**
 * An NPC outside the no-jump radius, facing +x, with an optional
 * aggressor placed by each spec.
 */
async function makeFleeWorld(chaserOffset: { x: number, y: number } | null,
    npcDistance = JUMP_DISTANCE + 500, options: {
        mode?: 'flee' | 'depart',
        shipId?: string,
        /** Ship rotation; defaults to facing +x, already on its
         * outward jump heading. */
        rotation?: Angle,
        velocity?: Vector,
        disabled?: boolean,
    } = {}) {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP_ID, {
        ...getDefaultShipData(), id: SHIP_ID,
    });
    const slow = getDefaultShipData();
    gameData.data.Ship.map.set(SLOW_SHIP_ID, {
        ...slow, id: SLOW_SHIP_ID,
        physics: { ...slow.physics, turnRate: SLOW_TURN_RATE },
    });
    const world = await makeSystem('test:system', gameData);

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: ReturnType<typeof makeShip>) => void = () => { },
        shipId = SHIP_ID) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            rotation: options.rotation ?? new Angle(Math.PI / 2),
            turnBack: false,
            turning: 0,
            velocity: options.velocity ?? new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    /**
     * Really disables a ship. DisabledComponent is re-derived from armor
     * every tick (ShipDisableSystem), so it only sticks on a ship that
     * is actually shot below its disable threshold — the same state
     * npc_spawn_plugin builds its hulks in.
     */
    function disable(ship: ReturnType<typeof makeShip>,
        shipId = SHIP_ID) {
        let armor = ship.components.get(ArmorComponent);
        if (!armor) {
            // Armor is derived on the first step, so a ship that starts
            // out disabled needs it built here.
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

    function repair(ship: ReturnType<typeof makeShip>) {
        const armor = ship.components.get(ArmorComponent)!;
        armor.current = armor.max;
        ship.components.delete(DisabledComponent);
    }

    if (chaserOffset) {
        await addShip('chaser', npcDistance + chaserOffset.x,
            chaserOffset.y);
    }
    const npc = await addShip('npc', npcDistance, 0, ship => {
        ship.components.set(NpcComponent, {
            aiType: 1,
            mode: options.mode ?? 'flee',
            aggressor: chaserOffset ? 'chaser' : undefined,
        });
    }, options.shipId ?? SHIP_ID);
    if (options.disabled) {
        disable(npc, options.shipId ?? SHIP_ID);
    }
    return { world, npc, disable, repair };
}

function stillThere(world: World) {
    return world.entities.has('npc');
}

/** The NPC's CURRENT speed. Re-read every time: MovementState is replaced
 * as the world steps, so a captured reference goes stale. */
function speedOf(world: World) {
    return world.entities.get('npc')!.components
        .get(MovementStateComponent)!.velocity.length;
}

/** Steps until the sequence has reached its spin-up hold. */
function stepWhileAligning(world: World, maxSteps = 3000) {
    for (let i = 0; i < maxSteps && stillThere(world)
        && jumpOf(world)?.stage !== 'spinup'; i++) {
        world.step();
    }
}

function jumpOf(world: World): JumpState | undefined {
    return world.entities.get('npc')?.components.get(JumpComponent);
}

/**
 * Steps until the NPC leaves the world, recording the jump stage seen
 * at the top of each tick (deduplicated, so `stages` is the order the
 * sequence actually passed through).
 */
function runUntilGone(world: World, maxSteps = 3000) {
    const stages: string[] = [];
    /** Whether the ship was still in the world at the start of the
     * tick that ran the departure burn's final step. */
    let lastStage: string | undefined;
    let steps = 0;
    for (; steps < maxSteps && stillThere(world); steps++) {
        const jump = jumpOf(world);
        if (jump && jump.stage !== stages[stages.length - 1]) {
            stages.push(jump.stage);
        }
        if (jump) {
            lastStage = jump.stage;
        }
        world.step();
    }
    return { stages, steps, lastStage, gone: !stillThere(world) };
}

describe('NPCs jump out with the full sequence', () => {
    it('runs the jump stages in order and leaves only at the end',
        async () => {
            // Running at speed, as a fleeing ship actually is, so the
            // 'stopping' stage has something to do.
            const { world } = await makeFleeWorld(
                { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 },
                JUMP_DISTANCE + 500, { velocity: new Vector(200, 0) });
            // The ship used to be deleted outright within a tick or two.
            world.step();
            expect(stillThere(world)).toBeTrue();
            expect(jumpOf(world)).toBeDefined();

            const { stages, steps, lastStage, gone } = runUntilGone(world);
            expect(gone).toBeTrue();
            expect(stages).toEqual(
                ['stopping', 'aligning', 'spinup', 'accelerating']);
            // It vanishes out of the departure burn, not out of any
            // earlier stage.
            expect(lastStage).toEqual('accelerating');
            // And only after the timed stages have actually elapsed.
            expect(steps).toBeGreaterThanOrEqual(
                ticksFor(JUMP_SPINUP_DELAY_MS + JUMP_DEPART_DELAY_MS));
        });

    it('a slow-turning ship finishes its turn before the departure burn',
        async () => {
            // Pointing the wrong way (180 degrees off its outward jump
            // heading) on a ship that needs seconds to come about.
            const { world } = await makeFleeWorld(
                { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 },
                JUMP_DISTANCE + 500,
                {
                    shipId: SLOW_SHIP_ID,
                    rotation: new Angle(Math.PI / 2 + Math.PI),
                });
            world.step();
            const jump = jumpOf(world)!;
            expect(jump).toBeDefined();

            // Turn through half a revolution at SLOW_TURN_RATE: seconds
            // of visible turning, which is exactly what used to be
            // skipped by deleting the ship where it stood.
            let aligningTicks = 0;
            for (let i = 0; i < 3000 && stillThere(world)
                && jumpOf(world)?.stage !== 'accelerating'; i++) {
                if (jumpOf(world)?.stage === 'aligning') {
                    aligningTicks++;
                }
                world.step();
            }
            const minTurnTicks = ticksFor(
                Math.PI / SLOW_TURN_RATE * 1000) * 0.9;
            expect(aligningTicks).toBeGreaterThan(minTurnTicks);

            // It only starts the burn once actually pointed at its jump
            // heading.
            const movement = world.entities.get('npc')!
                .components.get(MovementStateComponent)!;
            const current = jumpOf(world)!;
            expect(current.stage).toEqual('accelerating');
            expect(Math.abs(Angle.fromAngleLike(movement.rotation)
                .distanceTo(new Angle(current.direction)).angle))
                .toBeLessThan(1e-6);

            expect(runUntilGone(world).gone).toBeTrue();
        });

    it('jumps outward along the radius from the system center',
        async () => {
            const { world } = await makeFleeWorld(null, JUMP_DISTANCE + 500,
                { mode: 'depart' });
            world.step();
            const jump = jumpOf(world)!;
            // The NPC sits on +x, so its jump heading is +x.
            expect(jump.direction).toBeCloseTo(
                new Vector(JUMP_DISTANCE + 500, 0).angle.angle, 9);
        });

    it('a departing NPC (not fleeing) uses the sequence too', async () => {
        const { world } = await makeFleeWorld(null, JUMP_DISTANCE + 500,
            { mode: 'depart', velocity: new Vector(200, 0) });
        world.step();
        expect(jumpOf(world)).toBeDefined();
        expect(runUntilGone(world).stages).toEqual(
            ['stopping', 'aligning', 'spinup', 'accelerating']);
    });

    it('a ship already stopped and aligned skips straight to spinup',
        async () => {
            const { world } = await makeFleeWorld(null, JUMP_DISTANCE + 500,
                { mode: 'depart' });
            world.step();
            // At rest and already on its outward heading, so 'stopping'
            // and 'aligning' each resolve on the tick they are entered
            // (one tick per transition) and no time is spent braking or
            // turning.
            expect(runUntilGone(world).stages)
                .toEqual(['aligning', 'spinup', 'accelerating']);
        });

    it('a departing NPC inside the no-jump zone flies out before jumping',
        async () => {
            const { world } = await makeFleeWorld(null, JUMP_DISTANCE * 0.5,
                { mode: 'depart' });
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            // Still flying outward under its own steering: no hyperdrive
            // inside the no-jump zone.
            expect(stillThere(world)).toBeTrue();
            expect(jumpOf(world)).toBeUndefined();
        });

    it('does not carry the ship to a destination or sweep escorts',
        async () => {
            const { world } = await makeFleeWorld(
                { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 });
            const initiates: unknown[] = [];
            const finishes: unknown[] = [];
            world.events.get(InitiateJumpEvent).subscribe(
                ({ data }) => initiates.push(data));
            world.events.get(FinishJumpEvent).subscribe(
                ({ data }) => finishes.push(data));

            expect(runUntilGone(world).gone).toBeTrue();
            // The vanish terminal skips InitiateJumpEvent entirely, which
            // is what keeps an NPC's departure clear of JumpFromSystem's
            // serialize-and-carry AND of EscortFollowJumpSystem — the
            // only listener that sweeps a player's escorts.
            expect(initiates).toEqual([]);
            expect(finishes).toEqual([]);
        });

    it('draws no randomness on the jump path', async () => {
        const { world } = await makeFleeWorld(
            { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 });
        // Let the sequence start (the NPC's one departure-time roll
        // happens on its first decision tick, before this).
        world.step();
        expect(jumpOf(world)).toBeDefined();

        const random = world.resources.get(RandomResource)!;
        const realNext = random.next.bind(random);
        let draws = 0;
        spyOn(random, 'next').and.callFake(() => {
            draws++;
            return realNext();
        });

        expect(runUntilGone(world).gone).toBeTrue();
        // Sequence neutrality: entering and running the jump adds no
        // draws, so no other NPC's decision rolls shift.
        expect(draws).toEqual(0);
    });
});

/**
 * The wire shape of a vanishing jump.
 *
 * JumpComponent is registered with the serializer, so its codec crosses to
 * other peers and feeds the shared desync hash. Peers can be running
 * different builds, so the shape may only ever change ADDITIVELY: an OLDER
 * peer must still decode a NEWER peer's state. A vanishing NPC departure
 * therefore keeps `to` present (the VANISH_DESTINATION sentinel) and marks
 * its terminal with an additive optional flag, rather than expressing
 * "vanishes" by dropping the required field — which an older decoder would
 * reject outright.
 */
describe('a vanishing jump keeps a wire-compatible shape', () => {
    /** The codec as it stood BEFORE the vanish flag existed: `to`
     * required, and no knowledge of `vanish` at all. Standing in for a
     * peer running an older build. */
    const OldJumpStateType = t.intersection([t.type({
        stage: t.union([
            t.literal('stopping'), t.literal('aligning'),
            t.literal('spinup'), t.literal('accelerating'),
            t.literal('arriving'),
        ]),
        direction: t.number,
        to: t.string,
    }), t.partial({
        follows: t.string,
        stageStart: t.number,
        autoJumpsLeft: t.number,
    })]);

    async function vanishingJump() {
        const { world } = await makeFleeWorld(null, JUMP_DISTANCE + 500,
            { mode: 'depart' });
        world.step();
        const jump = jumpOf(world);
        expect(jump).toBeDefined();
        return { world, jump: jump! };
    }

    it('marks the terminal with a flag and carries the sentinel `to`',
        async () => {
            const { jump } = await vanishingJump();
            expect(jump.vanish).toBeTrue();
            // Present, not omitted — and not a real system id.
            expect(jump.to).toEqual(VANISH_DESTINATION);
        });

    it('an OLDER peer still decodes it', async () => {
        const { jump } = await vanishingJump();
        const encoded = JumpStateType.encode(jump);
        // The current codec, obviously.
        expect(isRight(JumpStateType.decode(encoded))).toBeTrue();
        // And the one that predates the flag: the unknown `vanish` key is
        // ignored, and the required `to` it demands is there. This is the
        // property that makes the change additive.
        expect(isRight(OldJumpStateType.decode(encoded))).toBeTrue();
    });

    it('and would NOT have, had the terminal been an absent `to`',
        async () => {
            // The shape this fix replaced: `to` moved into t.partial and
            // omitted for a vanishing jump. Pinned as a regression so the
            // field is never optionalised again — an older peer rejects
            // the state outright, taking the desync hash with it.
            const { jump } = await vanishingJump();
            const withoutTo: Record<string, unknown> = {
                ...JumpStateType.encode(jump),
            };
            delete withoutTo['to'];
            expect(isLeft(OldJumpStateType.decode(withoutTo))).toBeTrue();
        });

    it('an older peer that treats the sentinel as a destination still ' +
        'ends the burn with the ship gone', async () => {
            // What an older peer's simulation does with a new vanishing
            // jump: not recognising the flag, it takes its ordinary depart
            // path and emits InitiateJumpEvent carrying the sentinel. Run
            // that event against this build to show where it lands — the
            // ship leaves the world, with no destination system named, so
            // the two builds agree on the outcome instead of desyncing.
            const { world } = await vanishingJump();
            const finishes: unknown[] = [];
            world.events.get(FinishJumpEvent).subscribe(
                ({ data }) => finishes.push(data));

            // The NPC is still early in its sequence (it has not reached
            // its own burn end), so the deletion below can only come from
            // the event.
            expect(jumpOf(world)!.stage).not.toEqual('accelerating');
            world.emit(InitiateJumpEvent, { to: VANISH_DESTINATION },
                ['npc']);
            world.step();

            expect(stillThere(world)).toBeFalse();
            // No carry to a destination world: there is no such system.
            expect(finishes).toEqual([]);
        });
});

describe('fleeing ships jump away', () => {
    it('a fleeing ship outside the no-jump radius jumps out when its ' +
        'chaser is far away', async () => {
            const { world } = await makeFleeWorld(
                { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 });
            world.step();
            expect(jumpOf(world)).toBeDefined();
            expect(runUntilGone(world).gone).toBeTrue();
        });

    it('a chaser right behind (close, in the rear cone) blocks the ' +
        'jump: the ship keeps running', async () => {
            const { world } = await makeFleeWorld(
                { x: -FLEE_JUMP_BLOCK_RANGE * 0.4, y: 0 });
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            expect(stillThere(world)).toBeTrue();
            expect(jumpOf(world)).toBeUndefined();
        });

    it('a close chaser AHEAD does not block the jump', async () => {
        const { world } = await makeFleeWorld(
            { x: FLEE_JUMP_BLOCK_RANGE * 0.4, y: 0 });
        world.step();
        expect(jumpOf(world)).toBeDefined();
        expect(runUntilGone(world).gone).toBeTrue();
    });

    it('inside the no-jump radius the ship cannot jump yet', async () => {
        const { world } = await makeFleeWorld(
            { x: -FLEE_JUMP_BLOCK_RANGE * 3, y: 0 }, JUMP_DISTANCE * 0.5);
        for (let i = 0; i < 30; i++) {
            world.step();
        }
        expect(stillThere(world)).toBeTrue();
        expect(jumpOf(world)).toBeUndefined();
    });
});

describe('a ship that cannot jump', () => {
    it('does not start the sequence while disabled', async () => {
        const { world } = await makeFleeWorld(null, JUMP_DISTANCE + 500,
            { mode: 'depart', disabled: true });
        for (let i = 0; i < 30; i++) {
            world.step();
        }
        expect(stillThere(world)).toBeTrue();
        expect(jumpOf(world)).toBeUndefined();
    });

    it('has its jump CANCELLED when disabled mid-sequence, and stops dead',
        async () => {
            // Matthew's rule, which applies to every ship in the game: "if
            // a ship is disabled during any part of its jump, including
            // accelerating out of the system, it immediately stops (zero
            // velocity) and the jump is cancelled." This replaces the old
            // break-off-and-resume: there is no suspended sequence to come
            // back to.
            const { world, npc, disable } = await makeFleeWorld(null,
                JUMP_DISTANCE + 500, { mode: 'depart' });
            world.step();
            expect(jumpOf(world)).toBeDefined();
            // Well into the departure burn, so the ship is genuinely
            // travelling when it is hit — the case the rule exists for.
            for (let i = 0; i < 3000 && speedOf(world) < 100; i++) {
                world.step();
            }
            expect(jumpOf(world)?.stage).toEqual('accelerating');
            expect(speedOf(world)).toBeGreaterThanOrEqual(100);

            disable(npc);
            world.step();

            expect(jumpOf(world)).toBeUndefined();
            expect(speedOf(world)).toEqual(0);
            // Cancelled, not departed: it is still sitting there as a
            // hulk to be boarded.
            expect(stillThere(world)).toBeTrue();
        });

    it('decides afresh once repaired, starting a whole new sequence',
        async () => {
            // Nothing is resumed. 'depart' re-runs departByJump on every
            // tick it owns the ship, so a repaired NPC simply arrives back
            // at the same decision and begins again from the first stage.
            const { world, npc, disable, repair } = await makeFleeWorld(null,
                JUMP_DISTANCE + 500, { mode: 'depart' });
            world.step();
            stepWhileAligning(world);
            expect(jumpOf(world)?.stage).toEqual('spinup');

            disable(npc);
            world.step();
            expect(jumpOf(world)).toBeUndefined();
            // It stays cancelled for as long as it stays disabled.
            for (let i = 0; i < 30; i++) {
                world.step();
                expect(jumpOf(world)).toBeUndefined();
            }

            repair(npc);
            world.step();
            const restarted = jumpOf(world);
            expect(restarted).toBeDefined();
            // From the top — at rest and already aligned, so 'aligning',
            // not the 'spinup' it was interrupted in.
            expect(restarted!.stage).toEqual('aligning');
            expect(runUntilGone(world).gone).toBeTrue();
        });

    it('is still removed at the depart radius as a fallback', async () => {
        // Disabled the whole way out, so it never manages a jump: the
        // old delete-at-the-edge exit is what finally removes it.
        const { world } = await makeFleeWorld(null, NPC_DEPART_RADIUS + 10,
            { mode: 'depart', disabled: true });
        world.step();
        expect(stillThere(world)).toBeFalse();
    });
});
