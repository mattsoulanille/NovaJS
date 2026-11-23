import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { makeSystem } from '../make_system.js';
import { makeShip } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { JumpComponent } from '../travel/index.js';
import {
    NpcComponent, NPC_DEPART_MAX_MS, NPC_DEPART_MIN_MS,
    PASS_THROUGH_DEPART_MAX_MS, PASS_THROUGH_DEPART_MIN_MS,
    rollDepartureTime,
} from './npc_ai_plugin.js';
import { SystemHoldComponent } from './system_hold.js';

/**
 * Reference A-series wave 4 (docs/reference_experiments.md): a mïsn
 * special ship with ShipGoal -1, ShipBehav -1 and AI 1 leaves by jumping
 * out 30-40 s after it appears (nine of nine ships), never landing.
 * Ordinary sÿst traffic was not measured and keeps the 120-300 s dwell
 * loop.
 */

/** A PRNG that hands out a fixed sequence and counts its draws. */
function countingRandom(values: number[]) {
    let draws = 0;
    const random = {
        next: () => values[draws++ % values.length],
        get draws() { return draws; },
    };
    return random as unknown as Random & { draws: number };
}

describe('rollDepartureTime', () => {
    it('rolls a passing-through ship into the 30-40 s window', () => {
        for (const value of [0, 0.5, 0.999]) {
            const at = rollDepartureTime(1000, countingRandom([value]), true);
            expect(at).toBeGreaterThanOrEqual(1000 + PASS_THROUGH_DEPART_MIN_MS);
            expect(at).toBeLessThan(1000 + PASS_THROUGH_DEPART_MAX_MS);
        }
        expect(PASS_THROUGH_DEPART_MIN_MS).toBe(30_000);
        expect(PASS_THROUGH_DEPART_MAX_MS).toBe(40_000);
    });

    it('keeps ordinary traffic on the 120-300 s roll', () => {
        const at = rollDepartureTime(0, countingRandom([0.5]));
        expect(at).toBeGreaterThanOrEqual(NPC_DEPART_MIN_MS);
        expect(at).toBeLessThan(NPC_DEPART_MAX_MS);
    });

    it('costs exactly one draw either way, so no other ship\'s rolls '
        + 'shift', () => {
            const plain = countingRandom([0.25]);
            const passing = countingRandom([0.25]);
            rollDepartureTime(0, plain);
            rollDepartureTime(0, passing, true);
            expect(plain.draws).toBe(1);
            expect(passing.draws).toBe(1);
        });
});

describe('a passing-through mission ship in a live system', () => {
    const THESSALY = SYNTHETIC.systems.thessaly;
    const SKIFF = SYNTHETIC.ships.skiff;

    async function world(): Promise<World> {
        const gameData = await getSyntheticGameData();
        const built = await makeSystem(THESSALY, gameData, undefined,
            { npcs: false });
        const shipData = await gameData.data.Ship.get(SKIFF);
        async function add(uuid: string, x: number, passingThrough: boolean,
            held = false) {
            const ship = makeShip(shipData);
            ship.components.set(MovementStateComponent, {
                accelerating: 0,
                position: new Position(x, 0),
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, 0),
            });
            ship.components.set(NpcComponent, {
                aiType: 1, ...(passingThrough ? { passingThrough } : {}),
            });
            if (held) {
                ship.components.set(SystemHoldComponent,
                    { reason: 'missionGoal' });
            }
            await completeEntity(built, ship);
            built.entities.set(uuid, ship);
        }
        await add('passing', 200, true);
        await add('ordinary', -200, false);
        await add('held', 0, true, true);
        return built;
    }

    function now(w: World) {
        return w.resources.get(TimeResource)!.time;
    }

    it('decides to leave 30-40 s after it appears, goes straight to the '
        + 'jump, and is gone; ordinary traffic stays', async () => {
            const w = await world();
            const start = now(w);
            const modes = new Set<string | undefined>();
            let departedAt: number | undefined;
            let jumped = false;
            while (now(w) - start < 90_000) {
                const passing = w.entities.get('passing');
                const npc = passing?.components.get(NpcComponent);
                if (npc) {
                    if (departedAt === undefined && npc.mode === 'depart') {
                        departedAt = now(w) - start;
                    } else if (departedAt === undefined) {
                        modes.add(npc.mode);
                    }
                    jumped ||= passing!.components.has(JumpComponent);
                }
                w.step();
            }
            expect(departedAt).toBeDefined();
            expect(departedAt!).toBeGreaterThanOrEqual(
                PASS_THROUGH_DEPART_MIN_MS);
            // The decision lands on a think (at most one interval late).
            expect(departedAt!).toBeLessThan(PASS_THROUGH_DEPART_MAX_MS + 1100);
            // It went about trader business until then...
            expect(modes).toContain('travel');
            // ...and left by the hyperspace sequence.
            expect(jumped).toBeTrue();
            expect(w.entities.has('passing')).toBeFalse();

            // Ordinary traffic: 120 s at the earliest.
            const ordinary = w.entities.get('ordinary')!
                .components.get(NpcComponent)!;
            expect(ordinary.departAt).toBeGreaterThanOrEqual(
                start + NPC_DEPART_MIN_MS);
            expect(ordinary.mode).not.toBe('depart');
            // A HELD ship never leaves, short window or not.
            expect(w.entities.get('held')!.components.get(NpcComponent)!
                .mode).not.toBe('depart');
        }, 120_000);

    it('does not wait out a dwell: it departs mid-dwell when its time '
        + 'comes', async () => {
            const w = await world();
            const npc = w.entities.get('passing')!.components
                .get(NpcComponent)!;
            w.step();
            // Parked at a planet with a long dwell still to run, and the
            // window already due.
            npc.mode = 'dwell';
            npc.until = now(w) + 60_000;
            npc.departAt = now(w);
            npc.nextDecision = 0;
            w.step();
            expect(w.entities.get('passing')!.components
                .get(NpcComponent)!.mode).toBe('depart');
        }, 120_000);
});
