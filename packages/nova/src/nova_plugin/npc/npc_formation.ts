import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { EntityMap } from 'nova_ecs/entity_map';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementState } from 'nova_ecs/plugins/movement_plugin';

/**
 * Formation state, slot geometry and the follower controller. The
 * per-tick system that drives it (FormationSystem) lives in
 * npc_formation_system.ts, because it orders itself after
 * NpcDecisionSystem, which in turn reads FormationComponent.
 */

// --- Formation tuning ---

/** Longitudinal spacing between formation rows, px. (Halved from the
 * first-cut 120 after Matthew's playtest: tighter wedge.) */
export const FORMATION_ROW_SPACING = 60;
/** Lateral spacing between adjacent cells of a row, px. (Halved from
 * the first-cut 110.) */
export const FORMATION_LATERAL_SPACING = 55;
/** How far ahead (seconds) followers lead the slot by the leader's
 * velocity, so they fly toward where the slot is going. */
const FORMATION_LOOKAHEAD_S = 0.4;
/** Position error is converted to closing velocity at this rate (1/s):
 * the proportional term of the follower controller. */
const FORMATION_POSITION_GAIN = 1.2;

// --- RCS (reaction control) tuning ---
//
// Ships holding formation get a reaction-control ability: small
// velocity corrections applied directly, WITHOUT rotating the ship,
// so station-keeping doesn't read as constant spin-and-thrust wiggle.
// The ship keeps its heading aligned with the leader's and the main
// engine stays dark (the engine flare is driven by the `accelerating`
// flag — animation_graphic_plugin's glowAlpha — which RCS never sets).
//
// This lives in the AI/steering layer (the formation controller), NOT
// in movement physics: EffectiveMovementPhysicsSystem stays the single
// per-tick writer of MovementPhysics, and RCS is a bounded velocity
// nudge made by steering before MovementSystem integrates — the same
// layer where knockback adjusts velocity. The budget derives from the
// ship's BASE acceleration (ShipPhysics), so afterburners and jump
// drives don't secretly boost thrusterless station-keeping.

/** RCS strength as a fraction of the ship's main-engine acceleration
 * (Matthew's spec: proportional to the ship's acceleration). */
export const RCS_ACCEL_FRACTION = 0.25;
/** Turn-and-burn hands over to RCS when the correction (desired minus
 * actual velocity, px/s) drops below this... */
export const RCS_ENGAGE_SPEED = 60;
/** ...and RCS hands back to turn-and-burn above this. The gap is the
 * hysteresis that stops flip-flopping at the boundary. */
export const RCS_DISENGAGE_SPEED = 120;

/**
 * Holds an escort in a deterministic formation slot on its leader when
 * it is not engaged. Used by fleet escorts and by bay fighters that
 * have no target.
 */
export const Formation = t.intersection([t.type({
    /** Leader entity uuid. */
    leader: t.string,
    /** 0-based slot index; see formationOffset for the geometry. */
    slot: t.number,
}), t.partial({
    /** Bay fighters: sim time (ms) at which the fighter stops holding
     * and turns home to dock (see bay_plugin). */
    dockAt: t.number,
    /** Whether the follower is currently station-keeping on RCS (the
     * hysteresis state of the formation controller). Sim state: it
     * must roll back and cross the wire with the ship or peers flip
     * modes at different ticks. */
    rcs: t.boolean,
})]);
export type Formation = t.TypeOf<typeof Formation>;
export const FormationComponent = new Component<Formation>('FormationComponent');

/**
 * The first free formation slot on `leaderUuid`: one past the highest
 * slot number any live sibling holds (0 when the leader has no
 * followers yet).
 *
 * COUNTING siblings instead would collide after a mid-formation death:
 * a leader holding slots {0, 1, 2} that loses slot 1 has a sibling
 * count of 2, which is still a live escort's slot, and FormationSystem
 * ranks stations by `siblingSlots.indexOf(slot)` — the two duplicates
 * would resolve to the same rank and stack on one station while
 * another sits empty.
 *
 * Taking a MAX (rather than accumulating) makes the result independent
 * of iteration order, so this is safe to run over an unordered entity
 * map in the deterministic simulation.
 */
export function nextFormationSlot(formations: Iterable<Formation>,
    leaderUuid: string): number {
    let slot = 0;
    for (const formation of formations) {
        if (formation.leader === leaderUuid) {
            slot = Math.max(slot, formation.slot + 1);
        }
    }
    return slot;
}

/**
 * Every formation present in `entities` — the adapter for sim systems
 * that hold an EntityMap rather than a formation query result, so they
 * can feed `nextFormationSlot`.
 */
export function* formationsIn(entities: EntityMap): Iterable<Formation> {
    for (const [, entity] of entities) {
        const formation = entity.components.get(FormationComponent);
        if (formation) {
            yield formation;
        }
    }
}

/**
 * Formation slot geometry: the LEADER is the apex of the triangle, and
 * escort rows widen behind it — row r sits r * FORMATION_ROW_SPACING
 * astern and is (r + 1) cells wide (2, 3, 4, ... cells), each row
 * centered on the leader's axis with adjacent cells
 * FORMATION_LATERAL_SPACING apart. No escort ever occupies the apex
 * (that's the player's ship — Matthew's spec); the first escort row is
 * the flanking pair. RANKS are laid out so that EVERY escort count
 * flies a formation symmetric about the leader's axis. Counts 1-7 use
 * an explicit table (diagrams below — Matthew gets to veto specifics);
 * larger counts fill the widening rows with each row's occupants
 * arranged center-out, which keeps any occupancy symmetric.
 *
 *  count 1        count 2        count 3        count 4
 *     L              L              L              L
 *     1            1   2          1   2          1   2
 *                                   3          3       4
 *
 *  count 5        count 6          count 7
 *     L              L                L
 *   1   2          1   2            1   2
 *  3  4  5       3       4        3   4   5
 *                  5   6            6   7
 *
 *  - Count 1's lone escort sits centered one row back (a two-ship
 *    column; with one escort there is no triangle to have a top).
 *  - Count 3 is the leader-apex diamond: pair, then one centered in
 *    the 3-wide row. Count 5 fills that row (pair + full triple);
 *    count 7 adds a centered pair in the 4-wide row.
 *  - Counts 2 and 4 fly center-free flanking pairs — count 4 is the
 *    widening V from Paul's fork (escortPosition's hand-tuned 4-case).
 *  - Count 6 is the fork's other special case: three PAIRS with the
 *    middle column EMPTY (a hexagon). Filling the rows instead would
 *    park the sixth ship alone off-axis in the 4-wide row; the middle
 *    of the 3-wide row is skipped and the last pair tucks in behind.
 *  (Fork provenance: paul-npcs-era `escortPosition` special-cases 4
 *  and 6 exactly this way, and its base `triangleRaster` also starts
 *  rows at two cells — the leader-apex shape matches the fork's; the
 *  odd-count centered layouts here are new.)
 *
 * The layout is a function of (rank, count), NOT the persistent slot
 * number: slot ASSIGNMENT (hire order, continuation numbering) is
 * unchanged, but the formation-keeping systems convert a ship's slot
 * to its RANK among the live same-leader slots and pass the live
 * count. An escort joining or leaving therefore re-flows everyone to
 * the new count's layout — pure geometry, deterministic on every peer
 * (ranks come from sorting the synced slot numbers), and the RCS
 * controller slides ships the short hop to their new stations.
 */
export function formationOffset(rank: number,
    count?: number): { back: number, lateral: number } {
    // [row, lateral] in row/cell units, per rank, for counts 1-7.
    const SMALL_FORMATIONS: ReadonlyArray<
        ReadonlyArray<readonly [number, number]>> = [
            [],
            [[1, 0]],
            [[1, 0.5], [1, -0.5]],
            [[1, 0.5], [1, -0.5], [2, 0]],
            [[1, 0.5], [1, -0.5], [2, 1], [2, -1]],
            [[1, 0.5], [1, -0.5], [2, -1], [2, 0], [2, 1]],
            [[1, 0.5], [1, -0.5], [2, 1], [2, -1], [3, 0.5], [3, -0.5]],
            [[1, 0.5], [1, -0.5], [2, -1], [2, 0], [2, 1],
                [3, 0.5], [3, -0.5]],
        ];
    if (count !== undefined && count >= 1 && count <= 7 && rank < count) {
        const [row, lateralUnits] = SMALL_FORMATIONS[count][rank];
        return {
            back: row * FORMATION_ROW_SPACING,
            lateral: lateralUnits * FORMATION_LATERAL_SPACING,
        };
    }
    // General leader-apex triangle: row r (1-based) is (r + 1) cells
    // wide and holds ranks C(r-1) .. C(r)-1, where C(r) = r(r+3)/2 is
    // the cumulative capacity of rows 1..r.
    const row = Math.ceil((Math.sqrt(8 * rank + 17) - 3) / 2);
    const capacityBefore = ((row - 1) * (row + 2)) / 2;
    const indexInRow = rank - capacityBefore;
    // This row's occupancy: full (r + 1 cells) unless it is the
    // deepest, partially filled row of the formation.
    const occupancy = count === undefined ? row + 1
        : Math.min(row + 1, count - capacityBefore);
    // Occupants arranged center-out and symmetric for ANY occupancy:
    // odd k sits at 0, -1, +1, -2, +2, ...; even k at -0.5, +0.5,
    // -1.5, +1.5, ... (cell units).
    const oddRow = occupancy % 2 === 1;
    const pairIndex = oddRow
        ? Math.floor((indexInRow + 1) / 2) : Math.floor(indexInRow / 2) + 0.5;
    const side = (oddRow ? indexInRow : indexInRow + 1) % 2 === 1 ? -1 : 1;
    const lateralUnits = oddRow && indexInRow === 0 ? 0 : side * pairIndex;
    return {
        back: row * FORMATION_ROW_SPACING,
        lateral: lateralUnits * FORMATION_LATERAL_SPACING,
    };
}

/**
 * The world-space position of a leader's formation station for the
 * escort of the given RANK (see formationOffset) — pass the live
 * formation count for the per-count symmetric layouts.
 */
export function formationSlotPosition(leaderPosition: Position,
    leaderRotation: Angle, rank: number, count?: number): Position {
    const { back, lateral } = formationOffset(rank, count);
    const u = leaderRotation.getUnitVector();
    // Perpendicular (rotate u by +90°).
    const p = new Vector(-u.y, u.x);
    return new Position(
        leaderPosition.x - u.x * back + p.x * lateral,
        leaderPosition.y - u.y * back + p.y * lateral);
}

// --- Formation keeping ---

/**
 * Steers a follower toward its slot. Two regimes with hysteresis
 * (state in formation.rcs):
 *
 *  - Large correction (above RCS_DISENGAGE_SPEED, or above
 *    RCS_ENGAGE_SPEED when not yet on RCS): the classic turn-and-burn
 *    — point at the correction and use the main engine.
 *  - Small correction: RCS station-keeping — a velocity nudge budgeted
 *    at RCS_ACCEL_FRACTION of the ship's main acceleration, applied
 *    directly with NO rotation and NO `accelerating` (so no engine
 *    flare); the ship holds its heading on the leader's.
 *
 * The correction is the desired velocity (leader's, plus a
 * proportional pull toward the slot) minus the follower's. Pure so
 * tests can check convergence and that RCS never turns the ship.
 */
export function steerFormation(movement: MovementState, leader: MovementState,
    formation: Formation, acceleration: number, delta_s: number,
    rank = formation.slot, count?: number): void {
    const slotPosition = formationSlotPosition(
        Position.fromVectorLike(leader.position),
        Angle.fromAngleLike(leader.rotation), rank, count);
    const lead = Vector.fromVectorLike(leader.velocity)
        .scale(FORMATION_LOOKAHEAD_S);
    const error = slotPosition.add(lead).subtract(movement.position);
    // Desired velocity: the leader's, plus a correction proportional
    // to the position error.
    const desired = Vector.fromVectorLike(leader.velocity)
        .add(error.scale(FORMATION_POSITION_GAIN));
    const correction = desired.subtract(movement.velocity);

    // Hysteresis: engage RCS below the low threshold, drop it above
    // the high one, keep the previous regime in between.
    const magnitude = correction.length;
    if (formation.rcs) {
        if (magnitude > RCS_DISENGAGE_SPEED) {
            formation.rcs = false;
        }
    } else if (magnitude < RCS_ENGAGE_SPEED) {
        formation.rcs = true;
    }

    if (formation.rcs) {
        // RCS station-keeping: nudge velocity toward desired, capped
        // by this tick's RCS budget; never rotate, never light the
        // main engine. Replaces (does not mutate) the velocity object
        // per the movement contract.
        const budget = acceleration * RCS_ACCEL_FRACTION * delta_s;
        const nudge = magnitude <= budget
            ? correction : correction.normalize(budget);
        movement.velocity = Vector.fromVectorLike(movement.velocity)
            .add(nudge);
        movement.accelerating = 0;
        movement.turnBack = false;
        movement.turnTo = Angle.fromAngleLike(leader.rotation);
        return;
    }

    // Turn-and-burn: point at the correction, main engine when
    // roughly aligned.
    const heading = correction.angle;
    movement.turnTo = heading;
    movement.turnBack = false;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.7 ? 1 : 0;
}
