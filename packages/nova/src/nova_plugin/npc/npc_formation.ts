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
//
// Measured on the original EV Nova (docs/reference_experiments.md, F1 and
// F1b): escorts fly a 45° V TRAILING the leader. Row r (1, 2, ...) sits
// r * a px astern and r * a px out to the side, where the step `a` scales
// with the LARGEST sprite frame in the formation (formationSpacing). The
// slots are the SAME at rest and at full speed (±2 px; no speed-
// proportional lead or lag).

/** The step `a` per px of sprite frame width (F1b: a = 0.59 x S). */
export const FORMATION_SPACING_PER_FRAME_PX = 0.59;
/** `a` never drops below this, px (F1b: frames up to ~40 px all space
 * like a 40 px one; 24 px discs measured -25/±24 at F1). */
export const FORMATION_MIN_SPACING = 23.5;
/** ...nor rises above this, px (F1b: 128 px and larger frames). */
export const FORMATION_MAX_SPACING = 59.5;

/**
 * The formation step `a` (px per row, astern and out) for a formation whose
 * largest sprite FRAME width is `frameWidth` (reference F1b, ±1 px):
 * clamp(0.59 x S, 23.5, 59.5).
 *
 * S is the rlëD frame size (ShipData.spriteFrameWidth): a small disc drawn
 * inside a 96 px frame spaces like a 96 px ship. Not the visible pixels,
 * not shïp Length, not the shän frame-size fields. Only square frames were
 * measured; the frame WIDTH is used (max(width, height) is the untested
 * alternative for a non-square frame).
 */
export function formationSpacing(frameWidth: number): number {
    return Math.min(FORMATION_MAX_SPACING, Math.max(FORMATION_MIN_SPACING,
        FORMATION_SPACING_PER_FRAME_PX * frameWidth));
}

/** Position error is converted to closing velocity at this rate (1/s):
 * the proportional term of the follower controller. */
const FORMATION_POSITION_GAIN = 1.2;
/** The closing speed is also capped at what the follower can brake from,
 * sqrt(2 * this fraction * acceleration * distance) — the same cap and
 * fraction as the escort landing controller (player_escort_plugin's
 * ESCORT_APPROACH_BRAKE_FRACTION, #316). Without it the gain asks a hull
 * with a lot of top speed for its acceleration (the stock Cargo Drone, 180
 * px/s on 36 px/s^2; the Aurora Carriers; the Leviathans) to brake harder
 * than it can, and it overshoots its slot back and forth. */
export const FORMATION_BRAKE_FRACTION = 0.5;
/** ...and at this fraction of (turn rate x distance): a hull that turns
 * slowly for its speed (the stock Escape Pod, 30°/s) otherwise settles into
 * a circular orbit of its slot exactly one turning radius out, chasing a
 * correction that swings round as fast as it can turn. */
export const FORMATION_TURN_CLOSING_FRACTION = 0.5;

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
 * Whether an NPC escort in NPC mode `mode` is OFF ON BUSINESS OF ITS OWN,
 * out of its formation slot: fighting, fleeing, leaving, flying over to
 * plunder a hulk, or buzzing a player ship for a contraband scan. Both
 * station-keeping (FormationSystem) and NpcSteeringSystem read this ONE
 * list, so they never both steer the same ship.
 *
 * They used to keep a list each, and 'scan' was only in the steering's: a
 * fleet's AI 4 escort (a stock Heraan Firebird with its Aurora Cruiser) in
 * mode 'scan' was flown at the player by the scan arm and dragged back to
 * its slot by the RCS station-keeper in the same tick. It never came
 * within scan range, swung about near its station, and kept "trying to
 * scan" for the whole visit (Matthew's playtest, 2026-11-24, Heraan).
 */
export function offFormationBusiness(mode: string | undefined): boolean {
    return mode === 'attack' || mode === 'flee' || mode === 'depart'
        || mode === 'board' || mode === 'scan';
}

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
 * Formation slot geometry: the original EV Nova's 45° echelon V (reference
 * F1/F1b, docs/reference_experiments.md). Escorts alternate sides, LEFT of
 * the leader's heading first, each pair one row further astern and out by
 * the same step `spacing` (formationSpacing — the group's `a`):
 *
 *              L
 *           0     1          rank 0: (-a,  left a)  rank 1: (-a,  right a)
 *        2           3       rank 2: (-2a, left 2a) rank 3: (-2a, right 2a)
 *     4                 5    rank 4: (-3a, left 3a) ... (extrapolated)
 *
 * Rows 1-2 (ranks 0-3) are measured; rank 4 and up EXTRAPOLATE linearly
 * (row floor(rank / 2) + 1, r x a astern and out), so the V just grows
 * longer arms. Measured on player-led escorts; NPC fleet (flët) escorts use
 * the same table unmeasured.
 *
 * `back` is px astern of the leader; `lateral` is px to the leader's RIGHT
 * (formationSlotPosition's perpendicular), so left-side slots are negative.
 *
 * The layout is a function of RANK, not the persistent slot number: slot
 * ASSIGNMENT (hire order, continuation numbering) is unchanged, but the
 * formation-keeping systems convert a ship's slot to its rank among the
 * live same-leader slots, so when an escort leaves the ones behind it move
 * up and the V never has holes. Deterministic on every peer (ranks come
 * from sorting the synced slot numbers).
 */
export function formationOffset(rank: number,
    spacing: number): { back: number, lateral: number } {
    const row = Math.floor(rank / 2) + 1;
    const side = rank % 2 === 0 ? -1 : 1;
    return { back: row * spacing, lateral: side * row * spacing };
}

/**
 * The world-space position of a leader's formation station for the
 * escort of the given RANK, in a formation of step `spacing` (see
 * formationOffset, formationSpacing).
 */
export function formationSlotPosition(leaderPosition: Position,
    leaderRotation: Angle, rank: number, spacing: number): Position {
    const { back, lateral } = formationOffset(rank, spacing);
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
 * The correction is the desired velocity (leader's, plus a pull toward the
 * slot — proportional to the distance, capped at a speed the follower can
 * brake from and turn onto: FORMATION_BRAKE_FRACTION,
 * FORMATION_TURN_CLOSING_FRACTION) minus the follower's. The target is
 * the slot ITSELF: the original holds escorts on the same slots at rest
 * and at full speed (reference F1), so there is no lead ahead of it; the
 * leader's velocity is fed forward so a follower can hold the slot of a
 * moving leader with zero position error. Pure so tests can check
 * convergence and that RCS never turns the ship.
 */
export function steerFormation(movement: MovementState, leader: MovementState,
    formation: Formation, acceleration: number, delta_s: number,
    rank = formation.slot, turnRate = Infinity,
    spacing = FORMATION_MIN_SPACING): void {
    const slotPosition = formationSlotPosition(
        Position.fromVectorLike(leader.position),
        Angle.fromAngleLike(leader.rotation), rank, spacing);
    const error = slotPosition.subtract(movement.position);
    // Desired velocity: the leader's, plus a closing velocity toward the
    // slot, proportional to the distance but no faster than the follower
    // can brake from or turn onto.
    const distance = error.length;
    const closing = Math.min(distance * FORMATION_POSITION_GAIN,
        Math.sqrt(2 * FORMATION_BRAKE_FRACTION * acceleration * distance),
        FORMATION_TURN_CLOSING_FRACTION * turnRate * distance);
    const desired = distance > 1e-9
        ? Vector.fromVectorLike(leader.velocity)
            .add(error.normalize(closing))
        : Vector.fromVectorLike(leader.velocity);
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
