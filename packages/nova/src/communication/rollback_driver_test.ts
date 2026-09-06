import "jasmine";
import { Random } from "nova_ecs/plugins/random_plugin";
import { RollbackSimulation } from "nova_ecs/plugins/rollback_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { World } from "nova_ecs/world";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { deriveEntityComponents } from "../nova_plugin/entity_factory.js";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { completeEntity } from "../nova_plugin/entity_data_loader.js";
import { makeShip } from "../nova_plugin/make_ship.js";
import { ControlledByComponent } from "../nova_plugin/ship_control.js";
import { applyInputRecords, InputRecord } from "./simulation_input.js";
import { makeDeterminismWorld as makeHarnessWorld } from "./determinism_harness.js";
import { getSyntheticGameData } from "./simulation_test_fixture.js";

type Inputs = InputRecord[];

const PEER = 'test peer';

/**
 * On the synthetic data set: the rollback contract is about the engine,
 * not the scenario, and Thessaly Reach's traders and patrol give it a
 * populated world to converge over.
 */
const makeDeterminismWorld = (npcCount: number) =>
    makeHarnessWorld(npcCount, 'worker', getSyntheticGameData());

function makeRecord(tick: number, events: ControlEvent[],
    peerId: string = PEER): InputRecord {
    return { peerId, tick, inputs: [{ kind: 'control', events }] };
}

function applyInputs(world: World, records: Inputs) {
    applyInputRecords(world, records);
}

/**
 * A deterministic pseudo-random input schedule: occasionally presses
 * or releases a control. Edge-triggered, like real keyboard input.
 */
function makeInputSchedule(seed: number, ticks: number,
    peerId: string = PEER): Map<number, InputRecord> {
    const rng = new Random(seed);
    const actions = ['accelerate', 'turnLeft', 'turnRight', 'firePrimary'] as const;
    const held = new Map<string, boolean>();
    const schedule = new Map<number, InputRecord>();
    for (let tick = 1; tick <= ticks; tick++) {
        if (rng.next() < 0.15) {
            const action = actions[rng.below(actions.length)]!;
            const start = !held.get(action);
            held.set(action, start);
            schedule.set(tick,
                makeRecord(tick, [{ action, state: start ? 'start' : false }], peerId));
        }
    }
    return schedule;
}

/** Straight-line run: the ground truth the rollback runs must match. */
async function referenceRun(npcCount: number, schedule: Map<number, InputRecord>,
    ticks: number): Promise<string> {
    const world = await makeDeterminismWorld(npcCount);
    for (let tick = 1; tick <= ticks; tick++) {
        const record = schedule.get(tick);
        if (record) {
            applyInputs(world, [record]);
        }
        world.step();
    }
    return hashWorld(world).hash;
}

/** A world with two controlled ships: 'test peer' and 'peer b'. */
async function makeTwoPeerWorld(): Promise<World> {
    const world = await makeDeterminismWorld(2);
    const gameData = await getSyntheticGameData();
    const ids = await gameData.ids;
    const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
    const ship = makeShip(shipData);
    ship.components.set(ControlledByComponent, { peerId: 'peer b' });
    const movement = ship.components.get(MovementStateComponent)!;
    movement.position = new Position(-200, 80);
    movement.rotation = new Angle(2);
    movement.velocity = new Vector(0, 0);
    await completeEntity(world, ship);
    world.entities.set('peer b ship', ship);
    return world;
}

function makeRollback(world: World) {
    return new RollbackSimulation<Inputs>(world, {
        applyInputs,
        complete: deriveEntityComponents,
    });
}

describe("RollbackSimulation", () => {
    // Rolling back and resimulating with unchanged inputs must be a
    // semantic no-op, no matter when or how deep the rollbacks are.
    it("converges to the reference run under random rollbacks", async () => {
        const TICKS = 150;
        const schedule = makeInputSchedule(12345, TICKS);
        const reference = await referenceRun(2, schedule, TICKS);

        const world = await makeDeterminismWorld(2);
        const rollback = makeRollback(world);
        const chaos = new Random(999);
        for (let tick = 1; tick <= TICKS; tick++) {
            const record = schedule.get(tick);
            if (record) {
                rollback.setInputs(tick, [record]);
            }
            rollback.step();
            if (chaos.next() < 0.1) {
                const depth = 1 + chaos.below(20);
                const target = Math.max(rollback.earliestTick, rollback.tick - depth);
                expect(rollback.rollbackTo(target)).toBeTrue();
                expect(rollback.tick).toBe(tick);
            }
        }
        expect(hashWorld(world).hash).toEqual(reference);
    }, 120_000);

    // The netcode scenario: inputs arrive d ticks late; the sim
    // predicts no-new-input, then rolls back and corrects when the
    // real inputs arrive. Must converge to the undelayed run.
    it("converges when inputs arrive late and are corrected by rollback", async () => {
        const TICKS = 120;
        const DELAY = 8;
        const schedule = makeInputSchedule(777, TICKS);
        const reference = await referenceRun(2, schedule, TICKS);

        const world = await makeDeterminismWorld(2);
        const rollback = makeRollback(world);
        for (let tick = 1; tick <= TICKS; tick++) {
            // The inputs for tick - DELAY arrive now. Prediction was
            // "no new inputs", so any real inputs are a misprediction.
            const arrived = tick - DELAY;
            const record = schedule.get(arrived);
            if (arrived >= 1 && record) {
                rollback.setInputs(arrived, [record]);
                expect(rollback.rollbackTo(arrived - 1)).toBeTrue();
            }
            rollback.step();
        }
        // Deliver the tail still in flight, then one final rollback.
        let earliestCorrection: number | undefined;
        for (let tick = TICKS - DELAY + 1; tick <= TICKS; tick++) {
            const record = schedule.get(tick);
            if (record) {
                rollback.setInputs(tick, [record]);
                earliestCorrection = earliestCorrection ?? tick;
            }
        }
        if (earliestCorrection !== undefined) {
            expect(rollback.rollbackTo(earliestCorrection - 1)).toBeTrue();
        }

        expect(rollback.tick).toBe(TICKS);
        expect(hashWorld(world).hash).toEqual(reference);
    }, 120_000);

    // The full two-peer steady state, no sockets: each peer applies
    // its own inputs immediately and the other's after a delay, via
    // rollback. Both worlds must converge to identical state.
    it("two peers converge exchanging delayed inputs", async () => {
        const TICKS = 100;
        const DELAY = 6;
        const scheduleA = makeInputSchedule(101, TICKS, 'test peer');
        const scheduleB = makeInputSchedule(202, TICKS, 'peer b');

        const worldA = await makeTwoPeerWorld();
        const worldB = await makeTwoPeerWorld();
        const simA = makeRollback(worldA);
        const simB = makeRollback(worldB);

        const deliver = (sim: RollbackSimulation<Inputs>, record: InputRecord) => {
            const existing = sim.getInputs(record.tick) ?? [];
            sim.setInputs(record.tick, [...existing, record]);
            if (record.tick <= sim.tick) {
                expect(sim.rollbackTo(record.tick - 1)).toBeTrue();
            }
        };

        for (let tick = 1; tick <= TICKS; tick++) {
            // Own inputs apply at their tick, locally.
            const ownA = scheduleA.get(tick);
            if (ownA) {
                deliver(simA, ownA);
            }
            const ownB = scheduleB.get(tick);
            if (ownB) {
                deliver(simB, ownB);
            }
            // The other peer's inputs arrive DELAY ticks late.
            const arrived = tick - DELAY;
            if (arrived >= 1) {
                const remoteB = scheduleB.get(arrived);
                if (remoteB) {
                    deliver(simA, remoteB);
                }
                const remoteA = scheduleA.get(arrived);
                if (remoteA) {
                    deliver(simB, remoteA);
                }
            }
            simA.step();
            simB.step();
        }
        // Deliver the tails still in flight.
        for (let tick = TICKS - DELAY + 1; tick <= TICKS; tick++) {
            const remoteB = scheduleB.get(tick);
            if (remoteB) {
                deliver(simA, remoteB);
            }
            const remoteA = scheduleA.get(tick);
            if (remoteA) {
                deliver(simB, remoteA);
            }
        }

        expect(simA.tick).toBe(simB.tick);
        expect(hashWorld(worldA).hash).toEqual(hashWorld(worldB).hash);
    }, 180_000);

    it("refuses to roll back past the snapshot buffer", async () => {
        const world = await makeDeterminismWorld(0);
        const rollback = new RollbackSimulation<Inputs>(world, {
            applyInputs,
            complete: deriveEntityComponents,
            capacity: 10,
        });
        for (let i = 0; i < 30; i++) {
            rollback.step();
        }
        expect(rollback.rollbackTo(rollback.earliestTick - 1)).toBeFalse();
        expect(rollback.rollbackTo(rollback.earliestTick)).toBeTrue();
    }, 60_000);
});
