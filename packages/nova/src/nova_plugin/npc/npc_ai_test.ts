import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { ShipAccelerationConversionFactor, ShipSpeedConversionFactor } from 'novaparse/parsers/constants';
import { govtDisposition, effectiveStrength, oddsFavorable } from '../reputation/index.js';
import {
    chaserBlocksJump, chooseNearest, Formation, formationOffset,
    formationSlotPosition, FLEE_JUMP_BLOCK_RANGE,
    FORMATION_MIN_SPACING, formationSpacing,
    landingDestinations, nextFormationSlot, npcBoardArrived,
    npcPlunderEligible, npcPlundersHulks, NPC_BOARD_RADIUS, NPC_BOARD_SPEED,
    NPC_PLUNDER_TAKES_FROM_PLAYERS, PlanetEntry,
    RCS_ACCEL_FRACTION, RCS_DISENGAGE_SPEED, RCS_ENGAGE_SPEED,
    steerArrive, steerFormation,
} from './npc_ai_plugin.js';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';

function govt(overrides: Partial<ReturnType<typeof getDefaultGovtData>>) {
    return { ...getDefaultGovtData(), ...overrides };
}

describe('govtDisposition', () => {
    const federation = govt({
        id: 'nova:128', classes: [1], allies: [2], enemies: [3],
    });
    const auroran = govt({ id: 'nova:129', classes: [3], enemies: [1] });
    const friend = govt({ id: 'nova:131', classes: [2] });
    const bystander = govt({ id: 'nova:132', classes: [9] });
    const pirates = govt({
        id: 'nova:133', classes: [5], allies: [6],
        flags: { ...getDefaultGovtData().flags, xenophobic: true },
    });
    const pirateFriend = govt({ id: 'nova:134', classes: [6] });

    it('is hostile to govts whose classes intersect its enemies', () => {
        expect(govtDisposition(federation, auroran)).toBe('enemy');
    });

    it('is allied with govts whose classes intersect its allies', () => {
        expect(govtDisposition(federation, friend)).toBe('ally');
    });

    it('is allied with itself', () => {
        expect(govtDisposition(federation, federation)).toBe('ally');
    });

    it('is neutral toward unrelated govts', () => {
        expect(govtDisposition(federation, bystander)).toBe('neutral');
    });

    it('is neutral toward independents by default', () => {
        expect(govtDisposition(federation, undefined)).toBe('neutral');
    });

    it('independent ships have no politics', () => {
        expect(govtDisposition(undefined, federation)).toBe('neutral');
        expect(govtDisposition(undefined, undefined)).toBe('neutral');
    });

    it('xenophobic govts attack everyone except allies', () => {
        expect(govtDisposition(pirates, bystander)).toBe('enemy');
        expect(govtDisposition(pirates, undefined)).toBe('enemy');
        expect(govtDisposition(pirates, pirateFriend)).toBe('ally');
        expect(govtDisposition(pirates, pirates)).toBe('ally');
    });

    it('alwaysAttacksPlayer makes independents enemies', () => {
        const nasty = govt({
            id: 'nova:135', classes: [7],
            flags: {
                ...getDefaultGovtData().flags, alwaysAttacksPlayer: true,
            },
        });
        expect(govtDisposition(nasty, undefined)).toBe('enemy');
        expect(govtDisposition(nasty, bystander)).toBe('neutral');
    });
});

describe('effectiveStrength and oddsFavorable (govt MaxOdds)', () => {
    it('scales strength between 30% and 100% by shields', () => {
        expect(effectiveStrength(100, 1)).toBe(100);
        expect(effectiveStrength(100, 0)).toBeCloseTo(30);
        expect(effectiveStrength(100, 0.5)).toBeCloseTo(65);
        // Clamped outside [0, 1].
        expect(effectiveStrength(100, 2)).toBe(100);
        expect(effectiveStrength(100, -1)).toBeCloseTo(30);
    });

    it('MaxOdds 100 accepts up to a 1-to-1 fight', () => {
        expect(oddsFavorable(100, 50, 50)).toBeTrue();
        expect(oddsFavorable(100, 50, 51)).toBeFalse();
    });

    it('higher MaxOdds accepts worse odds', () => {
        expect(oddsFavorable(300, 50, 150)).toBeTrue();
        expect(oddsFavorable(300, 50, 151)).toBeFalse();
    });

    it('a zero-strength ship never fights', () => {
        expect(oddsFavorable(1000, 0, 1)).toBeFalse();
    });
});

describe('chooseNearest', () => {
    it('picks the nearest candidate', () => {
        expect(chooseNearest([['a', 100], ['b', 25], ['c', 400]])).toBe('b');
    });

    it('breaks exact distance ties by the smaller uuid, regardless of ' +
        'iteration order', () => {
            expect(chooseNearest([['b', 25], ['a', 25]])).toBe('a');
            expect(chooseNearest([['a', 25], ['b', 25]])).toBe('a');
        });

    it('returns undefined for no candidates', () => {
        expect(chooseNearest([])).toBeUndefined();
    });
});

describe('nextFormationSlot', () => {
    const f = (leader: string, slot: number): Formation => ({ leader, slot });

    it('starts at 0 when the leader has no followers', () => {
        expect(nextFormationSlot([], 'leader')).toBe(0);
        expect(nextFormationSlot([f('other', 0), f('other', 1)], 'leader'))
            .toBe(0);
    });

    it('appends past the highest slot of a contiguous formation', () => {
        expect(nextFormationSlot(
            [f('leader', 0), f('leader', 1), f('leader', 2)], 'leader'))
            .toBe(3);
    });

    it('does not reuse a live slot after a mid-formation death', () => {
        // Slots {0, 1, 2} lose slot 1. Counting siblings would return 2 —
        // a slot a live escort still holds, which FormationSystem's
        // rank-by-slot lookup would collapse onto one station.
        expect(nextFormationSlot([f('leader', 0), f('leader', 2)], 'leader'))
            .toBe(3);
    });

    it('ignores followers of other leaders', () => {
        expect(nextFormationSlot(
            [f('leader', 0), f('other', 7), f('leader', 1)], 'leader'))
            .toBe(2);
    });

    it('is independent of iteration order', () => {
        const slots = [f('leader', 3), f('leader', 0), f('leader', 2)];
        expect(nextFormationSlot(slots, 'leader')).toBe(4);
        expect(nextFormationSlot([...slots].reverse(), 'leader')).toBe(4);
    });
});

describe('formation geometry (the original\'s 45° echelon V, '
    + 'reference F1/F1b)', () => {
        it('steps by a = clamp(0.59 x frame width, 23.5, 59.5) px', () => {
            const a = (width: number) =>
                Math.round(formationSpacing(width) * 10) / 10;
            expect([12, 24, 48, 64, 96, 128, 200].map(a))
                .toEqual([23.5, 23.5, 28.3, 37.8, 56.6, 59.5, 59.5]);
        });

        it('pins the four measured slots: (-a, ±a) then (-2a, ±2a), '
            + 'left of the heading first', () => {
                // `lateral` is + to the leader's RIGHT; the original's first
                // escort flies LEFT of travel, the second right, the third
                // left-outer, the fourth right-outer.
                for (const a of [23.5, 56.6]) {
                    expect([0, 1, 2, 3].map(rank => formationOffset(rank, a)))
                        .toEqual([
                            { back: a, lateral: -a },
                            { back: a, lateral: a },
                            { back: 2 * a, lateral: -2 * a },
                            { back: 2 * a, lateral: 2 * a },
                        ]);
                }
            });

        it('extrapolates the V linearly: each further pair one row astern '
            + 'and out', () => {
                const a = 40;
                expect(formationOffset(4, a)).toEqual({ back: 120, lateral: -120 });
                expect(formationOffset(5, a)).toEqual({ back: 120, lateral: 120 });
                expect(formationOffset(9, a)).toEqual({ back: 200, lateral: 200 });
                for (let rank = 0; rank < 16; rank++) {
                    const { back, lateral } = formationOffset(rank, a);
                    // On the 45° arms, never on the leader's axis or ahead.
                    expect(back).toBeGreaterThan(0);
                    expect(Math.abs(lateral)).toBe(back);
                }
            });

        it('places slot 0 astern and to the left of a leader facing "up" '
            + '(angle 0)', () => {
                // Angle 0 is clock-up: unit vector (0, -1). Behind is +y and
                // left of travel is -x.
                const slot = formationSlotPosition(
                    new Position(0, 0), new Angle(0), 0, FORMATION_MIN_SPACING);
                expect(slot.y).toBeCloseTo(FORMATION_MIN_SPACING);
                expect(slot.x).toBeCloseTo(-FORMATION_MIN_SPACING);
            });

        it('rotates slot positions with the leader', () => {
            const up = formationSlotPosition(new Position(0, 0),
                new Angle(0), 3, 30);
            const right = formationSlotPosition(
                new Position(0, 0), new Angle(Math.PI / 2), 3, 30);
            // Rotating the leader 90° rotates the slot 90°.
            expect(right.x).toBeCloseTo(-up.y);
            expect(right.y).toBeCloseTo(up.x);
        });
    });

describe('steerFormation', () => {
    const ACCEL = 200;
    const DT = 1 / 60;

    function movement(overrides: Partial<MovementState>): MovementState {
        return {
            position: new Position(0, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
            ...overrides,
        };
    }

    function formation(overrides: Partial<Formation> = {}): Formation {
        return { leader: 'leader', slot: 0, ...overrides };
    }

    it('thrusts toward a distant slot once facing it (turn-and-burn)', () => {
        const leader = movement({ position: new Position(0, -1000) });
        // The slot is far up (-y); the follower already faces up.
        const follower = movement({ position: new Position(0, 0) });
        const state = formation();
        steerFormation(follower, leader, state, ACCEL, DT);
        expect(state.rcs ?? false).toBeFalse();
        expect(follower.turnTo instanceof Angle).toBeTrue();
        expect(follower.accelerating).toBe(1);
    });

    it('station-keeps on RCS when on station: heading pinned to the ' +
        'leader, engine dark', () => {
            const leader = movement({
                position: new Position(0, 0),
                velocity: new Vector(0, 0),
                rotation: new Angle(1),
            });
            const follower = movement({
                position: formationSlotPosition(
                    new Position(0, 0), new Angle(1), 2, FORMATION_MIN_SPACING),
                velocity: new Vector(0, 0),
            });
            const state = formation({ slot: 2 });
            steerFormation(follower, leader, state, ACCEL, DT);
            expect(state.rcs).toBeTrue();
            expect(follower.accelerating).toBe(0);
            expect((follower.turnTo as Angle).angle).toBeCloseTo(1);
        });

    it('matches velocity: a follower in the slot of a moving leader ' +
        'is steered along the leader velocity', () => {
            const leader = movement({
                position: new Position(0, 0),
                velocity: new Vector(200, 0),
                rotation: new Angle(Math.PI / 2),
            });
            const follower = movement({
                position: formationSlotPosition(
                    new Position(0, 0), new Angle(Math.PI / 2), 0, FORMATION_MIN_SPACING),
                velocity: new Vector(0, 0),
                rotation: new Angle(Math.PI / 2),
            });
            const state = formation();
            steerFormation(follower, leader, state, ACCEL, DT);
            // Stationary follower, moving leader: the correction points
            // along +x, which is exactly where the follower faces.
            expect(follower.accelerating).toBe(1);
            const heading = follower.turnTo as Angle;
            expect(heading.getUnitVector().x).toBeGreaterThan(0.9);
        });

    it('RCS nudges velocity without rotating and within the budget', () => {
        const leader = movement({
            velocity: new Vector(30, 0),
            rotation: new Angle(0.5),
        });
        // Exactly in the slot but 30 px/s slow: the correction is purely
        // velocity, under RCS_ENGAGE_SPEED.
        const follower = movement({
            position: formationSlotPosition(
                new Position(0, 0), new Angle(0.5), 0, FORMATION_MIN_SPACING),
            velocity: new Vector(0, 0),
            rotation: new Angle(2),
        });
        const state = formation();
        steerFormation(follower, leader, state, ACCEL, DT);
        expect(state.rcs).toBeTrue();
        // Velocity moved toward the leader's, capped by the budget.
        const budget = ACCEL * RCS_ACCEL_FRACTION * DT;
        expect(follower.velocity.length).toBeGreaterThan(0);
        expect(follower.velocity.length).toBeLessThanOrEqual(budget + 1e-9);
        // No rotation request except aligning with the leader, no
        // engine.
        expect(follower.accelerating).toBe(0);
        expect((follower.turnTo as Angle).angle).toBeCloseTo(0.5);
        expect(follower.turning).toBe(0);
    });

    it('converges on station under RCS with the heading never leaving ' +
        'the leader alignment', () => {
            const leader = movement({
                velocity: new Vector(40, 0),
                rotation: new Angle(Math.PI / 2),
            });
            const slot = formationSlotPosition(
                new Position(0, 0), new Angle(Math.PI / 2), 0, FORMATION_MIN_SPACING);
            // Slightly off station and slow — a correction well under
            // the RCS engage threshold.
            const follower = movement({
                position: new Position(slot.x - 8, slot.y + 6),
                velocity: new Vector(30, 0),
                rotation: new Angle(Math.PI / 2),
            });
            const state = formation();
            // The controller's station point is the slot itself.
            const error = () => formationSlotPosition(
                Position.fromVectorLike(leader.position),
                Angle.fromAngleLike(leader.rotation), 0, FORMATION_MIN_SPACING)
                .subtract(follower.position).length;
            const initialError = error();
            for (let i = 0; i < 600; i++) {
                steerFormation(follower, leader, state, ACCEL, DT);
                expect(state.rcs).toBeTrue();
                // RCS never asks for rotation away from the leader.
                expect((follower.turnTo as Angle).angle)
                    .toBeCloseTo(Math.PI / 2);
                expect(follower.accelerating).toBe(0);
                // Integrate: both drift; the follower closes the gap.
                follower.position = follower.position
                    .add(follower.velocity.scale(DT)) as Position;
                leader.position = leader.position
                    .add(leader.velocity.scale(DT)) as Position;
            }
            expect(error()).toBeLessThan(2);
            expect(error()).toBeLessThan(initialError);
            expect(follower.velocity.subtract(leader.velocity).length)
                .toBeLessThan(1);
        });

    it('hysteresis: holds the current regime between the thresholds', () => {
        const midpoint = (RCS_ENGAGE_SPEED + RCS_DISENGAGE_SPEED) / 2;
        const leader = movement({ rotation: new Angle(0) });
        // In slot with a pure velocity mismatch of exactly `midpoint`.
        const follower = () => movement({
            position: formationSlotPosition(
                new Position(0, 0), new Angle(0), 0, FORMATION_MIN_SPACING),
            velocity: new Vector(-midpoint, 0),
            rotation: new Angle(0),
        });
        const fromRcs = formation({ rcs: true });
        steerFormation(follower(), leader, fromRcs, ACCEL, DT);
        expect(fromRcs.rcs).toBeTrue();
        const fromBurn = formation({ rcs: false });
        steerFormation(follower(), leader, fromBurn, ACCEL, DT);
        expect(fromBurn.rcs).toBeFalse();
    });

    it('hysteresis: drops RCS above the disengage threshold and ' +
        'engages below the engage threshold', () => {
            const leader = movement({ rotation: new Angle(0) });
            const withMismatch = (speed: number) => movement({
                position: formationSlotPosition(
                    new Position(0, 0), new Angle(0), 0, FORMATION_MIN_SPACING),
                velocity: new Vector(-speed, 0),
                rotation: new Angle(0),
            });
            const state = formation({ rcs: true });
            steerFormation(withMismatch(RCS_DISENGAGE_SPEED + 10),
                leader, state, ACCEL, DT);
            expect(state.rcs).toBeFalse();
            steerFormation(withMismatch(RCS_ENGAGE_SPEED - 10),
                leader, state, ACCEL, DT);
            expect(state.rcs).toBeTrue();
        });
});

describe('steerFormation flying a real hull (finite turn rate, 60 Hz)', () => {
    const DT = 1 / 60;
    interface Hull { speed: number, acceleration: number, turnRate: number }
    /** The F1 reference's escort discs: Speed/Accel 600 (twice the
     * leader's), here at 180°/s. */
    const TYPICAL: Hull = {
        speed: 600 * ShipSpeedConversionFactor,
        acceleration: 600 * ShipAccelerationConversionFactor,
        turnRate: Math.PI,
    };
    /** The stock Cargo Drone (shïp nova:130): Speed 400, Accel 200, 60°/s
     * of turn — 180 px/s on 36 px/s^2 (#316's extreme hull). */
    const CARGO_DRONE: Hull = {
        speed: 400 * ShipSpeedConversionFactor,
        acceleration: 200 * ShipAccelerationConversionFactor,
        turnRate: Math.PI / 3,
    };

    /**
     * Flies `follower` on `rank` of a leader moving at a constant
     * `leaderVelocity` (heading along it, or "up" at rest) for `seconds`,
     * stepping the way the sim does: FormationSystem steers, then
     * MovementSystem's inertial step moves everyone. Returns the follower's
     * offset from the leader in the leader's frame (along: + ahead; across:
     * + LEFT of the heading, the reference's convention) and the largest
     * slot error over the last `holdSeconds`.
     */
    function fly(hull: Hull, rank: number, leaderVelocity: Vector,
        follower: MovementState, seconds: number, holdSeconds = 10,
        spacing = FORMATION_MIN_SPACING) {
        const rotation = leaderVelocity.length > 0
            ? leaderVelocity.angle : new Angle(0);
        let leaderPosition = new Position(0, 0);
        const formation: Formation = { leader: 'leader', slot: rank };
        const steps = Math.round(seconds / DT);
        let holdMax = 0;
        for (let i = 0; i < steps; i++) {
            const leader: MovementState = {
                accelerating: 0, position: leaderPosition, rotation,
                turnBack: false, turning: 0, velocity: leaderVelocity,
            };
            steerFormation(follower, leader, formation, hull.acceleration,
                DT, rank, hull.turnRate, spacing);
            // MovementSystem's inertial step.
            if (follower.turnTo instanceof Angle) {
                const error = follower.rotation.distanceTo(follower.turnTo)
                    .angle;
                follower.rotation =
                    Math.abs(error) <= hull.turnRate * DT
                        ? follower.turnTo
                        : follower.rotation.add(
                            Math.sign(error) * hull.turnRate * DT);
            }
            if (follower.accelerating > 0) {
                follower.velocity = follower.velocity.add(follower.rotation
                    .getUnitVector().scale(hull.acceleration * DT));
            }
            follower.velocity = follower.velocity.shortenToLength(hull.speed);
            follower.position = Position.fromVectorLike(
                follower.position.add(follower.velocity.scale(DT)));
            leaderPosition = Position.fromVectorLike(
                leaderPosition.add(leaderVelocity.scale(DT)));
            if (i >= steps - holdSeconds / DT) {
                holdMax = Math.max(holdMax, formationSlotPosition(
                    leaderPosition, rotation, rank, spacing)
                    .subtract(follower.position).length);
            }
        }
        const u = rotation.getUnitVector();
        const d = follower.position.subtract(leaderPosition);
        // Left of travel, screen y down: (u.y, -u.x).
        return {
            along: d.x * u.x + d.y * u.y,
            across: d.x * u.y - d.y * u.x,
            holdMax,
        };
    }

    function at(x: number, y: number, vx = 0, vy = 0,
        rotation = 0): MovementState {
        return {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(rotation), turnBack: false, turning: 0,
            velocity: new Vector(vx, vy),
        };
    }

    /** The reference F1 cruise speed: 4.49 px/frame at 30 Hz. */
    const CRUISE = 135;
    /** (along, across + left) of ranks 0-3 in units of the step `a`. */
    const MEASURED: Array<[number, number]> =
        [[-1, 1], [-1, -1], [-2, 2], [-2, -2]];
    /** 24 px discs (a = 23.5) and 96 px frames (a = 56.6). */
    const SPACINGS = [formationSpacing(24), formationSpacing(96)];

    it('holds the four measured slots at rest (reference F1/F1b)', () => {
        for (const a of SPACINGS) {
            MEASURED.forEach(([along, across], rank) => {
                const result = fly(TYPICAL, rank, new Vector(0, 0),
                    at(60, 40), 40, 10, a);
                expect(result.along).withContext(`a ${a} rank ${rank}`)
                    .toBeCloseTo(along * a, 0);
                expect(result.across).withContext(`a ${a} rank ${rank}`)
                    .toBeCloseTo(across * a, 0);
                expect(result.holdMax).toBeLessThan(1);
            });
        }
    });

    it('holds the SAME slots at full speed: no lead ahead of them '
        + '(reference F1: within 2 px of the rest slots at 135 px/s)', () => {
            for (const a of SPACINGS) {
                for (const heading of [0, Math.PI / 2, 2.4]) {
                    const velocity = new Angle(heading).getUnitVector()
                        .scale(CRUISE);
                    MEASURED.forEach(([along, across], rank) => {
                        const result = fly(TYPICAL, rank, velocity,
                            at(-80, 30, velocity.x, velocity.y), 40, 10, a);
                        const context = `a ${a} heading ${heading} rank ${rank}`;
                        expect(result.along).withContext(context)
                            .toBeCloseTo(along * a, 0);
                        expect(result.across).withContext(context)
                            .toBeCloseTo(across * a, 0);
                        expect(result.holdMax).toBeLessThan(1);
                    });
                }
            }
        });

    it('brings the Cargo Drone in from far off and holds it there '
        + 'without overshooting back and forth (#316 hull)', () => {
            // 600 px out, flying away from the slot at top speed: on the
            // bare gain profile it asked for far more braking than its
            // 36 px/s^2 and swung back and forth through the slot.
            for (const leaderVelocity of [new Vector(0, 0),
                new Vector(CARGO_DRONE.speed * 0.8, 0)]) {
                const result = fly(CARGO_DRONE, 1, leaderVelocity,
                    at(0, 600, 0, CARGO_DRONE.speed), 90, 15);
                expect(result.holdMax).withContext(
                    `leader at ${leaderVelocity.x} px/s`).toBeLessThan(3);
            }
        });

    it('does not orbit its slot on a hull that turns slowly for its speed',
        () => {
            // The stock Escape Pod (nova:895): Speed 2000, Accel 400, 30°/s.
            // The all-hulls sweep found it circling its slot one turning
            // radius (94 px/s / 0.52 rad/s = 180 px) out, for good; this
            // is a state on that orbit, taken from the sweep.
            const pod: Hull = {
                speed: 2000 * ShipSpeedConversionFactor,
                acceleration: 400 * ShipAccelerationConversionFactor,
                turnRate: Math.PI / 6,
            };
            const slot = formationSlotPosition(new Position(0, 0),
                new Angle(0), 0, FORMATION_MIN_SPACING);
            const result = fly(pod, 0, new Vector(0, 0),
                at(slot.x + 57.5, slot.y + 170, 89.2, -29.4, -0.315), 150,
                15);
            expect(result.holdMax).toBeLessThan(3);
        });
});

describe('chaserBlocksJump ("right behind" a fleeing ship)', () => {
    // The fleeing ship sits at the origin facing +x (Angle pi/2).
    function fleeing(): MovementState {
        return {
            position: new Position(0, 0),
            velocity: new Vector(100, 0),
            rotation: new Angle(Math.PI / 2),
            accelerating: 1,
            turning: 0,
            turnBack: false,
        };
    }
    function chaserAt(x: number, y: number): MovementState {
        return {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(Math.PI / 2),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        };
    }

    it('a close pursuer directly astern blocks the jump', () => {
        expect(chaserBlocksJump(fleeing(),
            chaserAt(-FLEE_JUMP_BLOCK_RANGE * 0.5, 0))).toBeTrue();
    });

    it('a pursuer astern but out of range does not', () => {
        expect(chaserBlocksJump(fleeing(),
            chaserAt(-FLEE_JUMP_BLOCK_RANGE * 2, 0))).toBeFalse();
    });

    it('a close ship AHEAD of the fleeing ship does not block', () => {
        expect(chaserBlocksJump(fleeing(),
            chaserAt(FLEE_JUMP_BLOCK_RANGE * 0.5, 0))).toBeFalse();
    });

    it('a close ship directly abeam does not block (outside the ' +
        'rear cone)', () => {
            expect(chaserBlocksJump(fleeing(),
                chaserAt(0, FLEE_JUMP_BLOCK_RANGE * 0.5))).toBeFalse();
        });

    it('astern-and-off-axis inside the cone still blocks', () => {
        // 45 degrees off dead-astern: inside the 60-degree half-angle.
        const d = FLEE_JUMP_BLOCK_RANGE * 0.5 / Math.SQRT2;
        expect(chaserBlocksJump(fleeing(), chaserAt(-d, d))).toBeTrue();
    });
});

describe('landingDestinations', () => {
    const stubMovement = { position: new Position(0, 0) } as unknown as MovementState;
    function entry(uuid: string, data: Partial<PlanetData>): PlanetEntry {
        return [uuid, stubMovement, { id: uuid },
            { ...getDefaultPlanetData(), ...data }] as const;
    }
    const planet = entry('planet nova:128', { gate: null });
    const hypergate = entry('planet nova:130', {
        gate: { kind: 'hypergate', destinations: [], emergenceAngle: null },
    });
    const wormhole = entry('planet nova:465', {
        gate: { kind: 'wormhole', destinations: [], emergenceAngle: null },
    });

    it('excludes wormholes (NPCs never park on a transit portal)', () => {
        const result = landingDestinations([planet, wormhole, hypergate]);
        expect(result.map(([uuid]) => uuid))
            .toEqual(['planet nova:128', 'planet nova:130']);
    });

    it('keeps ordinary planets and hypergates', () => {
        expect(landingDestinations([planet]).length).toBe(1);
        expect(landingDestinations([hypergate]).length).toBe(1);
    });

    it('returns an empty list when every stellar is a wormhole', () => {
        expect(landingDestinations([wormhole])).toEqual([]);
    });

    // Nobody trades with a rock or with a wrecked gate: the AI's
    // destinations quote the same landable() predicate the player's land
    // gate does.
    const jupiter = entry('planet nova:159', {
        gate: null,
        flags: { ...getDefaultPlanetData().flags, canLand: false },
    });
    // The stock destroyed gates carry no HyperLinks and have the can-land
    // bit clear; the working gate above keeps it.
    const deadGate = entry('planet nova:131', {
        gate: { kind: 'hypergate', destinations: [], emergenceAngle: null },
        flags: { ...getDefaultPlanetData().flags, canLand: false },
    });
    const destroyFirst = entry('planet nova:900', {
        gate: null,
        flags: {
            ...getDefaultPlanetData().flags,
            canLand: true, landOnlyIfDestroyed: true,
        },
    });

    it('excludes stellars that are not ports (Jupiter and friends)', () => {
        expect(landingDestinations([planet, jupiter]).map(([uuid]) => uuid))
            .toEqual(['planet nova:128']);
    });

    it('excludes DESTROYED hypergates, which NPCs used to "trade" with',
        () => {
            expect(landingDestinations([hypergate, deadGate])
                .map(([uuid]) => uuid)).toEqual(['planet nova:130']);
        });

    it('excludes land-only-if-destroyed stellars', () => {
        expect(landingDestinations([destroyFirst])).toEqual([]);
    });
});

/**
 * The gövt Flags 0x1000 eligibility rule as a pure predicate. The Bible
 * gives one sentence — "Warships will plunder non-mission, trader-type
 * enemies (including the player) before destroying them" — so every
 * clause of it is pinned here, together with the judgment calls that
 * sentence forced (see the NPC_PLUNDER_* constants).
 */
describe('npcPlunderEligible (gövt Flags 0x1000)', () => {
    const warship = { aiType: 3, plundersBeforeDestroying: true };
    const hulk = {
        aiType: 1, disabled: true, plunderSpent: false,
        missionShip: false, controlled: false, hostile: true,
    };

    it('lets a warship of a plundering govt board a disabled enemy trader',
        () => {
            expect(npcPlunderEligible(warship, hulk)).toBeTrue();
            expect(npcPlunderEligible(warship, { ...hulk, aiType: 2 }))
                .toBeTrue();
        });

    it('needs the govt flag', () => {
        expect(npcPlunderEligible(
            { ...warship, plundersBeforeDestroying: false }, hulk))
            .toBeFalse();
        expect(npcPlunderEligible(
            { ...warship, plundersBeforeDestroying: undefined }, hulk))
            .toBeFalse();
    });

    it('is warships only — AIType 3, not the piracy-police interceptor',
        () => {
            expect(npcPlundersHulks(3, true)).toBeTrue();
            for (const aiType of [1, 2, 4]) {
                expect(npcPlundersHulks(aiType, true))
                    .withContext(`AIType ${aiType}`).toBeFalse();
            }
        });

    it('is trader-type victims only (the Bible "Freighters", AI 1-2)',
        () => {
            for (const aiType of [3, 4]) {
                expect(npcPlunderEligible(warship, { ...hulk, aiType }))
                    .withContext(`AIType ${aiType}`).toBeFalse();
            }
            // A hull with no NPC brain at all is not a trader either.
            expect(npcPlunderEligible(warship, { ...hulk, aiType: undefined }))
                .toBeFalse();
        });

    it('spares mission ships, live ships, friends, and spent hulks', () => {
        expect(npcPlunderEligible(warship, { ...hulk, missionShip: true }))
            .toBeFalse();
        expect(npcPlunderEligible(warship, { ...hulk, disabled: false }))
            .toBeFalse();
        expect(npcPlunderEligible(warship, { ...hulk, hostile: false }))
            .toBeFalse();
        expect(npcPlunderEligible(warship, { ...hulk, plunderSpent: true }))
            .toBeFalse();
    });

    it('follows NPC_PLUNDER_TAKES_FROM_PLAYERS for a flown ship', () => {
        // The corrected Bible says the flag includes the player; NovaJS
        // does not model what an NPC takes from one, so the tunable is
        // off and this spec tracks it rather than the Bible.
        expect(npcPlunderEligible(warship, { ...hulk, controlled: true }))
            .toEqual(NPC_PLUNDER_TAKES_FROM_PLAYERS);
    });
});

describe('npcBoardArrived', () => {
    const at = (x: number, vx = 0): MovementState => ({
        accelerating: 0, position: new Position(x, 0), rotation: new Angle(0),
        turnBack: false, turning: 0, velocity: new Vector(vx, 0),
    });

    it('needs the boarder alongside the hulk', () => {
        expect(npcBoardArrived(at(0), at(NPC_BOARD_RADIUS - 1))).toBeTrue();
        expect(npcBoardArrived(at(0), at(NPC_BOARD_RADIUS + 1))).toBeFalse();
    });

    it('needs the boarder matched to the drift, not merely slow', () => {
        // Both moving together at speed: still alongside.
        expect(npcBoardArrived(at(0, 400), at(50, 400))).toBeTrue();
        // Screaming past it: not a boarding.
        expect(npcBoardArrived(at(0, 0), at(50, NPC_BOARD_SPEED + 10)))
            .toBeFalse();
    });
});

describe('steerArrive', () => {
    it('arrives with a hull that takes seconds to reach top speed, '
        + 'instead of orbiting the goal (#316)', () => {
            // The stock Cargo Drone (shïp nova:130): Speed 400, Accel 200,
            // 60°/s of turn — 180 px/s on 36 px/s^2. Flying past the goal
            // at top speed, the old cruise (nose at the goal, burn) never
            // removed the sideways velocity and circled it ~600 px out,
            // outside the braking radius, for good.
            const physics = {
                speed: 400 * ShipSpeedConversionFactor,
                acceleration: 200 * ShipAccelerationConversionFactor,
                turnRate: Math.PI / 3,
            };
            const delta_s = 1 / 60;
            const goal = new Position(0, 0);
            const movement: MovementState = {
                accelerating: 0,
                position: new Position(-1500, 0),
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, -physics.speed),
            };
            let arrivedAt: number | undefined;
            for (let i = 0; i < 60 * 90; i++) {
                if (steerArrive(movement, physics, goal, 90, 50)) {
                    arrivedAt = i / 60;
                    break;
                }
                // An inertial ship's MovementSystem step, finite turn rate.
                const heading = movement.turnTo instanceof Angle
                    ? movement.turnTo
                    : movement.turnBack && movement.velocity.length > 0
                        ? movement.velocity.angle.add(Math.PI) : undefined;
                if (heading) {
                    const error = movement.rotation.distanceTo(heading).angle;
                    movement.rotation =
                        Math.abs(error) <= physics.turnRate * delta_s
                            ? heading
                            : movement.rotation.add(
                                Math.sign(error) * physics.turnRate * delta_s);
                }
                if (movement.accelerating > 0) {
                    movement.velocity = movement.velocity.add(movement
                        .rotation.getUnitVector().scale(
                            physics.acceleration * delta_s));
                }
                movement.velocity =
                    movement.velocity.shortenToLength(physics.speed);
                movement.position = Position.fromVectorLike(
                    movement.position.add(movement.velocity.scale(delta_s)));
            }
            expect(arrivedAt).toBeDefined();
            expect(arrivedAt!).toBeLessThan(60);
        });
});
