import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Angle, Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { GovtComponent } from '../core/index.js';
import { ControlledByComponent } from '../player/index.js';

/**
 * ============================================================================
 * Boarding and plundering disabled ships (EVN Bible)
 * ============================================================================
 *
 * When a ship is DISABLED (disabled_component.ts) the player can pull
 * alongside and BOARD it. The Bible's boarding model:
 *
 *  - dude Booty flags (gövt/düde section) decide what a boarded ship
 *    yields: food/industrial/medical/luxury/metal/equipment cargo,
 *    money ("amount depends on the ship's purchase price"), or nothing
 *    at all ("repelled while attempting to board").
 *  - "Ships with 0 crew can't be boarded, nor can they capture any
 *    other ships" (shïp Crew).
 *  - capture odds relate to crew, and the marines outfit (oütf ModType
 *    25) "Adds the value in ModVal to your ship's effective crew
 *    complement when calculating capture odds".
 *  - BoardPenalty (gövt) is "Evilness from pirating one of this govt's
 *    ships".
 *
 * NovaJS SIMPLIFICATIONS (documented, since the Bible leaves the exact
 * numbers to the engine):
 *  - Booty flags are not modeled per-dude yet. A boarded ship instead
 *    yields the cargo it is actually carrying (its CargoComponent, up to
 *    the boarder's free hold), a money booty derived from its purchase
 *    price (creditBooty, fitted to the original), its remaining fuel
 *    (the plunder dialog's "Energy"), and its AMMUNITION. This reuses the live
 *    cargo/fuel/price/outfit data every ship already has; wiring the
 *    dude Booty-flag table (and the "repelled, nothing to take" case) is
 *    a documented follow-up.
 *  - AMMO (planAmmoPlunder): the Bible has no explicit "ammo" Booty flag
 *    — the plunder dialog's Ammo action lets the boarder restock the
 *    disabled ship's ammunition for weapons the boarder ALSO mounts.
 *    NovaJS rule: for each ammo outfit the victim carries (an outfit with
 *    a non-null ammoFor) whose weapon the boarder currently mounts (a
 *    launcher, WeaponsState count > 0), move rounds of that SAME outfit
 *    into the boarder's stock, up to the boarder's remaining capacity for
 *    that weapon (weapon MaxAmmo x launcher count, or the ammo outfit's
 *    Max when MaxAmmo is 0). Deterministic: victim outfit ids visited in
 *    sorted order, capacity shared across outfits feeding one weapon.
 *  - Capture odds follow the original's measured odds against the crew
 *    ratio (captureChance), the boarder's crew counting its marines
 *    (ModType 25, boarderMarines: positive ModVals add crew, negative
 *    ones add percentage points; reference "Capture, wave 33").
 *
 * MATCHES THE ORIGINAL (ruling #378, Matthew 2026-11-23: "match the
 * original fully ... It's supposed to be difficult to do while in
 * combat"). Every number in the boarding gate, the money booty and the
 * capture odds is fitted to the reference-Mac measurements in
 * docs/reference_experiments.md ("U9 wave 6", "U9 wave 7", "U9 wave 8"):
 *  - the range is a SQUARE, max(|dx|, |dy|), whose half-side grows with
 *    both sprites (boardingRange);
 *  - the relative speed must be under about 7.5 px/s, and "too fast" is a
 *    second, higher gate checked BEFORE the distance (boardingBlockedReason);
 *  - the two hulls' axes must be aligned, the same way or exactly opposite,
 *    within about 29 degrees (axesAligned) — the original has this gate too,
 *    and refuses a misaligned press SILENTLY;
 *  - the money is price / 40 plus a random part (creditBooty);
 *  - a derelict can never be captured, and the odds against a hulk the
 *    player disabled top out at 75% (capturable, captureChance).
 *
 * DETERMINISM / ROLLBACK: BoardingComponent (on the boarder) and
 * BoardedComponent (on the victim) are real, serializer-registered sim
 * state, so every peer's world agrees on who is boarding whom and what
 * has already been taken. All transfers are computed by a sim system
 * from replayed control inputs (boarding_plugin.ts); the capture roll
 * draws from the seeded RandomResource inside that system, never from
 * client randomness. This module holds only the component types, the
 * tuning constants, and the pure helpers — no system imports — so any
 * gameplay system can import the components without a cycle.
 */

/**
 * Present on the boarding ship while a plunder session is open against
 * `target`. Cleared when the player finishes (the 'done' action) or
 * when the target leaves the world / stops being boardable.
 */
export const BoardingState = t.type({
    /** UUID of the disabled ship being boarded. */
    target: t.string,
    /** Money booty offered, frozen at board time from the victim's
     * purchase price (the victim is a live entity that could be
     * destroyed mid-session, so the amount must not be re-derived). */
    creditsAvailable: t.number,
    /** Compatible ammo rounds the boarder could take, frozen at board time
     * (the boarder's launchers and the victim's ammo don't change mid-
     * session): the sum of planAmmoPlunder. 0 hides/greys the Ammo action. */
    ammoAvailable: t.number,
    /** The CAPTURE ODDS of this board, a whole percent drawn once as the
     * session opens (boardCaptureOdds: the crew-ratio table plus a per-board
     * spread, reference "Capture odds, wave 31"). The dialog shows exactly
     * this number and the capture is rolled against exactly this number, so
     * the two can never disagree; it is frozen because the original's odds
     * are drawn per board, not re-derived. */
    captureOdds: t.number,
    cargoTaken: t.boolean,
    creditsTaken: t.boolean,
    fuelTaken: t.boolean,
    ammoTaken: t.boolean,
    /**
     * Capture-attempt state, driving the capture-assignment dialog:
     *  'none'      no attempt yet — the ONE attempt this session gets,
     *  'failed'    the attempt was repelled. Transient: the session ends
     *              on the same tick it is set (see the one-capture-chance
     *              rule below), so nothing observes it for longer than
     *              the write. The literal is kept in the codec because
     *              the wire shape is additive-only.
     *  'succeeded' the ship was captured; the assignment dialog is up,
     *  'assigned'  the captured ship has been taken as an escort.
     *
     * There is no 'refused': at the escort cap (escort_cap.ts, rulings
     * #161 / #250) the capture ATTEMPT is unavailable — the plunder dialog
     * greys Capture and the sim ignores the press — rather than the keep
     * being refused afterwards. The literal that #161 first shipped for
     * that refusal was never persisted (a save extracts named fields from
     * the player entity, never this component, and only a player's own
     * press could set it), so it is dropped from the codec outright.
     */
    capture: t.union([
        t.literal('none'), t.literal('failed'),
        t.literal('succeeded'), t.literal('assigned')]),
    /** Whether the BoardPenalty crime has been charged this session. */
    crimeApplied: t.boolean,
});
export type BoardingState = t.TypeOf<typeof BoardingState>;
export const BoardingComponent = new Component<BoardingState>('Boarding');

/**
 * Present on a ship from the moment it is first boarded, naming the
 * boarder that spent its plunder, and marking the ship for mission-goal
 * tracking (mission_ship_state.ts shipBoarded seam).
 *
 * ============================================================================
 * ONE PLUNDER PER LIFE SEGMENT (Matthew's ruling, authoritative)
 * ============================================================================
 *
 * `plundered` is the DURABLE record that this hulk's one plunder has been
 * spent. Once it is set nothing may open another plunder session against
 * this ship — not after it is repaired, not after it is disabled again,
 * not by a different pirate. It is set the instant a plunder session
 * OPENS (not when booty is taken), so a boarder who takes nothing has
 * still used the ship's one boarding up, and it also carries the identity
 * of whoever spent it in `boarder` — which is how "another pirate got
 * here first" is expressed (npc_ai_plugin's NpcPlunderBoardSystem writes
 * exactly the same record).
 *
 * The record RESETS on a LIFE-SEGMENT boundary: the ship lands on a
 * planet and departs again, or it jumps to another system. That is
 * Matthew's multiplayer-persistence ruling, and it is what stops the
 * record being an unbounded permanent scar in a session that never ends.
 * Every place a ship leaves this system's world by a route it can come
 * back from calls `clearPlunderRecord` (see that function for the roster
 * of boundaries); a ship that leaves by dying takes its record with it.
 *
 * The Bible has NOTHING to say about any of this — its booty model is
 * stateless ("any ship of a given dude class ... will yield the same
 * types of booty when boarded", düde intro) — so the whole rule is
 * NovaJS's, per Matthew.
 *
 * WHAT THE OTHER FIELDS ARE FOR:
 *
 *  - `active` is MUTUAL EXCLUSION: only while a plunder session is
 *    actually open is a second boarding refused for THAT reason. It is
 *    cleared when the session ends. With the one-plunder rule above it is
 *    now the narrower of the two locks (a hulk whose session has ended is
 *    still refused, by `plundered`), but it is kept distinct because the
 *    two answer different questions and produce different feedback, and
 *    because `active` is corroborated against the named boarder so a
 *    boarder that vanished mid-session cannot strand anything.
 *
 *  - The `*Taken` flags are the BOOTY MEMORY. Cargo, fuel and ammo are
 *    physically removed from the victim, so re-boarding could never
 *    duplicate them; CREDITS are the exception — `creditsAvailable` is
 *    re-derived from the victim's ship class price on every board
 *    (creditBooty). They are now belt-and-braces behind `plundered` (a
 *    second session cannot open at all), and they survive a reset of the
 *    record only in the sense that the whole component goes with it.
 *
 * Capture state deliberately does NOT persist here: it lives on the
 * boarder's BoardingComponent, and the player gets exactly ONE capture
 * attempt inside the one session (see BoardingActionSystem) — a repelled
 * attempt ends the session on the spot.
 */
export const BoardedState = t.intersection([t.type({
    boarder: t.string,
}), t.partial({
    /** Whether a plunder session is open against this ship right now. */
    active: t.boolean,
    /**
     * This ship's one plunder has been spent (by `boarder`) and cannot be
     * spent again until the record resets. See the module note above.
     */
    plundered: t.boolean,
    cargoTaken: t.boolean,
    creditsTaken: t.boolean,
    fuelTaken: t.boolean,
    ammoTaken: t.boolean,
})]);
export type BoardedState = t.TypeOf<typeof BoardedState>;
export const BoardedComponent = new Component<BoardedState>('Boarded');

/**
 * Ends a ship's PLUNDER LIFE SEGMENT: the durable boarding record is
 * dropped, so the ship may be plundered once again.
 *
 * Called from every boundary at which a ship leaves this system's world
 * by a route it can return from — Matthew's "lands & departs a planet or
 * jumps to a new system":
 *
 *  - the player's own hyperspace jump (jump_plugin's JumpFromSystem, just
 *    before the entity is serialized and carried to the next system);
 *  - an escort following its player out, by jump (player_escort_plugin's
 *    sweepJumpingEscort) or through a gate (EscortFollowGateSystem);
 *  - an escort landing behind its player (EscortLandingSystem);
 *  - any ship that LANDS, which for a player is the LandEvent (covering
 *    an ordinary stellar and a gate transit alike) — boarding_plugin's
 *    BoardingLandingResetSystem;
 *  - an NPC trader that finishes loitering at a planet and sets off
 *    again, which is this engine's stand-in for an NPC landing and
 *    departing (npc_ai_plugin's dwell -> travel transition).
 *
 * Deliberately unconditional on `active`: a session whose victim has just
 * jumped or landed is over anyway (BoardingActionSystem ends a session
 * whose target has left the world), so there is nothing to protect.
 *
 * Idempotent, and free for the overwhelming majority of ships, which have
 * never been boarded and so carry no component at all.
 */
export function clearPlunderRecord(entity: Entity): void {
    entity.components.delete(BoardedComponent);
}

/**
 * ============================================================================
 * The boarding RANGE (fitted to the original, ruling #378)
 * ============================================================================
 *
 * The original boards only inside a SQUARE around the target, measured as
 * max(|dx|, |dy|) like the landing zone (boardingDistance), never a circle:
 * with a 24 px hulk and a 24 px boarder, (-10, 10) boarded 14.2 px away
 * while (3.6, 12.1), 12.7 px away, was "not close enough"
 * (docs/reference_experiments.md, "U9 wave 8", item 3).
 *
 * Its half-side grows with the TARGET's sprite and a little with the
 * BOARDER's (boardingRange):
 *
 *     R = (7 T + B) / 16
 *
 * T and B the two hulls' base sprite FRAME widths (ShipData
 * .spriteFrameWidth: the sprite counts, not the shän's size field — wave
 * 7's 96 px hulk whose shän still said 24 x 24 behaved like wave 8's).
 * Every bracket of the doc against it ("in" boarded or was refused
 * silently for alignment, "out" said "not close enough"; all in
 * max(|dx|, |dy|)):
 *
 *     target / boarder   in      out     R
 *     24 / 24            12.0    12.1    12.0
 *     96 / 24            38.9    47.6    43.5
 *     24 / 96            11.5    17.5    16.5
 *     24 / 48            ~15     ~15.5   13.5
 *
 * The 24 / 48 row (the 48 px Lightning of waves 6-7) is the one R misses,
 * by 1.5 px. Its stops are centroids of a disc half hidden under a solid
 * 48 px sprite, good to 1-2 px, and they overlap among themselves (a stop
 * at 13.9 was out, one at 15.8 was in); the wave-8 pointer hulls are good
 * to a pixel. So the TARGET factor puts the 96 px hulk mid-bracket, and the
 * BOARDER factor is the round one that keeps the 96 px ring under its 17.5
 * "out" while leaning toward the Lightning; together they make the 24 / 24
 * pair exactly 12.
 */
export const BOARD_RANGE_TARGET_SPRITE_FACTOR = 7 / 16;
export const BOARD_RANGE_BOARDER_SPRITE_FACTOR = 1 / 16;
/**
 * The frame width assumed for a hull whose data has none (spriteFrameWidth
 * 0: no shän / base rlëD). NovaJS's choice, not a measurement: a typical
 * small hull (the 48 px Lightning class).
 */
export const BOARD_RANGE_DEFAULT_SPRITE_WIDTH = 48;

function spriteWidthOrDefault(width: number): number {
    return width > 0 ? width : BOARD_RANGE_DEFAULT_SPRITE_WIDTH;
}

/**
 * Half-side, in px, of the square around the target that the boarder's
 * centre must be inside (inclusive). See the range note above.
 */
export function boardingRange(targetSpriteWidth: number,
    boarderSpriteWidth: number): number {
    return BOARD_RANGE_TARGET_SPRITE_FACTOR
        * spriteWidthOrDefault(targetSpriteWidth)
        + BOARD_RANGE_BOARDER_SPRITE_FACTOR
        * spriteWidthOrDefault(boarderSpriteWidth);
}

/** The distance the board range is measured in: the larger of the
 * offset's two components (Chebyshev), in world (= screen) axes. */
export function boardingDistance(dx: number, dy: number): number {
    return Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * The boarding SPEED gates, on the RELATIVE velocity (so matching a
 * drifting hulk's motion counts; every measured hulk was at rest, where
 * relative and absolute speed are the same). Fitted to the original
 * ("U9 wave 7", nine passes over the hulk):
 *
 *  - Boarding needs under BOARD_MAX_REL_SPEED: boarded at 3.4, 6.2 and
 *    7.3 px/s; refused at 7.8 (128 presses), 9.2 and 11.
 *  - At or over BOARD_TOO_FAST_REL_SPEED the answer is "too fast", and it
 *    is checked BEFORE the distance: every press at 16 and 22 px/s said
 *    "too fast", 67-70 px from the hulk included, while every press at
 *    11 px/s still said "not close enough". The threshold is between 11
 *    and 16; the midpoint is taken.
 *  - Between the two the original refuses with the misleading "not close
 *    enough", even with the ships on top of each other, and so does
 *    NovaJS (boardingBlockedReason answers 'tooFar').
 *
 * Far stricter than the landing gate (20 px/s): boarding is meant to be
 * hard to pull off in a fight.
 */
export const BOARD_MAX_REL_SPEED = 7.5;
export const BOARD_REL_SPEED_SQUARED = BOARD_MAX_REL_SPEED ** 2;
export const BOARD_TOO_FAST_REL_SPEED = 13.5;
export const BOARD_TOO_FAST_REL_SPEED_SQUARED = BOARD_TOO_FAST_REL_SPEED ** 2;

/**
 * Axis-alignment tolerance, each side of parallel and of anti-parallel.
 * This began as Matthew's own spec (at 15 degrees); the original turned
 * out to have the same gate ("U9 wave 8", item 1): inside the range a
 * press is refused, SILENTLY, unless the two hulls' axes are within about
 * 25-30 degrees of each other, facing the same way or exactly opposite.
 * Nine sweeps sat on one spot and stayed silent until only a turn opened
 * the dialog. Gaps that boarded: 24, 25 (three times), 28, and once about
 * 35-40; gaps that stayed silent: 30 (three times), and once 20. Each
 * heading is good to one 10-degree sprite frame. 29 degrees, midway
 * between the largest clean board (28) and the repeated silence (30),
 * keeps every clean board inside and every repeated silence outside.
 */
export const AXIS_ALIGN_TOLERANCE_RAD = 29 * Math.PI / 180;

/**
 * Whether two ship axes are parallel or anti-parallel within `tol`.
 * Uses the deterministic Angle subtraction (no atan2/trig): the
 * difference lands in [-pi, pi), so |diff| near 0 is parallel and |diff|
 * near pi is anti-parallel.
 */
export function axesAligned(a: Angle, b: Angle,
    tol = AXIS_ALIGN_TOLERANCE_RAD): boolean {
    const diff = Math.abs(a.subtract(b).angle);
    return diff <= tol || diff >= Math.PI - tol;
}

/**
 * Why a board attempt was rejected, or null when it is allowed.
 *
 * 'alreadyBoarded' is NOT produced by `boardingBlockedReason` below: it
 * is decided by the gate AFTER the bay-capture and own-escort-repair
 * branches, because those two are not plunder and the one-plunder rule
 * must not touch them (Matthew: "Boarding for other purposes (repairing/
 * refuelling your own disabled escort, fuel transfer) is NOT
 * restricted"). See BoardingGateSystem.
 *
 * 'notAligned' is a refusal with NO message: the original prints nothing
 * for it (and clears the status line), see boardingBlockedMessage.
 *
 * 'alreadyBoarded' is also the refusal of a live mission's rescue ship
 * (encounters/rescue_board.ts): its line is the original's catch-all,
 * "You can't board this ship.", whichever the cause.
 */
export type BoardBlockReason =
    | 'noTarget' | 'notDisabled' | 'noCrew'
    | 'tooFar' | 'tooFast' | 'notAligned' | 'alreadyBoarded';

/**
 * Pure boarding gate, in the original's order: a disabled target must be
 * selected and have crew (Bible: 0-crew ships can't be boarded); then
 * "too fast" at or over BOARD_TOO_FAST_REL_SPEED at ANY distance; then
 * "not close enough" outside the square range; then "not close enough"
 * again for a ship in range but not under BOARD_MAX_REL_SPEED (the
 * original's own misleading answer); and last the silent alignment
 * refusal. See the constants above for the measurements behind each step.
 */
export function boardingBlockedReason(input: {
    hasTarget: boolean;
    targetDisabled: boolean;
    targetCrew: number;
    /** max(|dx|, |dy|) between the two centres (boardingDistance). */
    distance: number;
    /** Half-side of the board square (boardingRange). */
    range: number;
    relSpeedSquared: number;
    aligned: boolean;
}): BoardBlockReason | null {
    if (!input.hasTarget) {
        return 'noTarget';
    }
    if (!input.targetDisabled) {
        return 'notDisabled';
    }
    if (input.targetCrew <= 0) {
        return 'noCrew';
    }
    if (input.relSpeedSquared >= BOARD_TOO_FAST_REL_SPEED_SQUARED) {
        return 'tooFast';
    }
    if (input.distance > input.range) {
        return 'tooFar';
    }
    if (input.relSpeedSquared >= BOARD_REL_SPEED_SQUARED) {
        return 'tooFar';
    }
    if (!input.aligned) {
        return 'notAligned';
    }
    return null;
}

/**
 * A board that SUCCEEDS leaves the boarder moving exactly with the ship it
 * boarded (Matthew's ruling, 2026-11-24: "Upon boarding a ship, we should
 * set the player's velocity equal to that ship's"). The gate above
 * already holds the relative speed under BOARD_MAX_REL_SPEED, so this
 * only removes the last few px/s of drift that would otherwise carry the
 * two hulls apart while the plunder dialog is open (the simulation keeps
 * running behind it). Unmeasured on the original (reference Pending,
 * "U9 velocity"); a sim rule, listed in docs/novajs_enhancements.md.
 *
 * A hulk still COASTING to rest (disabled_component.ts
 * disabledCoastSpeed: exponential drag, tau 3.74 s, measured in reference
 * "A disabled ship's coast, wave 25") keeps slowing after the board while
 * the boarder keeps the speed it was given, so the two only stay together
 * exactly when the hulk was already at rest (or is a waiting rescue ship,
 * which holds still). The coast lasts far longer than the old 45 px/s^2
 * brake did (about 12 s for the measured 34 px/s hulk, not 0.8 s), so a
 * moving hulk is a more common board now; the gate is on the RELATIVE
 * speed, so matching it is enough. While the dialog is up the hulk goes
 * on at most (its speed at the board) x tau further (about 125 px for
 * that hulk) and the boarder at the board speed, so the hulls separate,
 * more slowly than under the old brake, which stopped the hulk at once.
 *
 * Only the velocity changes: the heading, the turn and the thrust input
 * are the boarder's own. The vector is a fresh value (never the hulk's
 * own instance, never mutated in place). An INERTIALESS boarder steers
 * its velocity toward heading x targetSpeed every step, so a targetSpeed
 * it already carries is brought to the new speed too, or the match would
 * be undone on the next tick.
 *
 * Applied by BoardingGateSystem on every board past the gate that is not
 * then refused (plunder, own-escort repair, bay capture, a rescue's
 * retrieval or silent first board). A refused board changes nothing.
 */
export function matchBoardedVelocity(boarder: MovementState,
    boarded: Pick<MovementState, 'velocity'>) {
    boarder.velocity = new Vector(boarded.velocity.x, boarded.velocity.y);
    if (boarder.targetSpeed !== undefined) {
        boarder.targetSpeed = boarder.velocity.length;
    }
}

/**
 * Whether a hulk's one plunder has already been spent — by the player, by
 * a rival player, or by an NPC pirate that got there first. The single
 * reading of the durable record, shared by the boarding gate, the NPC
 * boarding approach (which gives up on a hulk somebody else has already
 * taken), and the specs.
 */
export function plunderSpent(boarded: BoardedState | undefined): boolean {
    return boarded?.plundered === true;
}

/**
 * ============================================================================
 * The money booty (fitted to the original, ruling #378)
 * ============================================================================
 *
 *     credits = max(1,000, B + 1,000 k)
 *     B = price / 40, down to a multiple of 250   (creditBootyBase)
 *     k = uniform in [0, floor(B / 1,000))         (creditBootyRandomSteps)
 *
 * with ONE draw of the seeded PRNG per board (the gate makes it as the
 * session opens; the amount is then frozen in BoardingState
 * .creditsAvailable). Every board on the original ("U9 waves 6-8"; a hulk
 * boards once, so one amount per hulk):
 *
 *     price       credits             B        k drawn   k range
 *     2,000       1,000               50       -         (floor)
 *     20,000      1,000 (x2)          500      -         (floor)
 *     50,000      1,250 (x24)         1,250    0         {0}
 *     100,000     2,500               2,500    0         {0, 1}
 *     200,000     5,000, 7,000        5,000    0, 2      {0..4}
 *     300,000     12,500, 11,500      7,500    5, 4      {0..6}
 *     500,000     19,500, 21,500      12,500   7, 9      {0..11}
 *     750,000     35,750, 32,750      18,750   17, 14    {0..17}
 *     1,000,000   26,000, 45,000      25,000   1, 20     {0..24}
 *     2,000,000   87,000              50,000   37        {0..49}
 *
 * Every amount over the floor is price / 40 plus a whole number of
 * thousands, and stays under price / 20 (B + 1,000 (floor(B / 1,000) - 1)
 * < 2 B). The step count is why the 50,000 hull paid exactly 1,250 on all
 * 24 boards (one step: k is always 0) while the dear hulls vary, and
 * 750,000's 35,750 is its very top step. The amount is a multiple of 250
 * for every price (the base is rounded down to one; every measured price
 * divides exactly). The Bible only says the amount "depends on the ship's
 * purchase price".
 */
export const CREDIT_BOOTY_PRICE_DIVISOR = 40;
/** The base is a multiple of this many credits. */
export const CREDIT_BOOTY_BASE_STEP = 250;
/** The random part is a whole number of these. */
export const CREDIT_BOOTY_RANDOM_STEP = 1_000;
/** No board pays less than this (the 2,000 and 20,000 hulls). */
export const CREDIT_BOOTY_FLOOR = 1_000;

/** The price / 40 base of the money booty, down to a multiple of 250. */
export function creditBootyBase(price: number): number {
    const base = Math.max(0, price) / CREDIT_BOOTY_PRICE_DIVISOR;
    return Math.floor(base / CREDIT_BOOTY_BASE_STEP) * CREDIT_BOOTY_BASE_STEP;
}

/** How many 1,000-credit steps the random part draws from (k is uniform
 * in [0, this)); 0 or 1 means there is no random part. */
export function creditBootyRandomSteps(price: number): number {
    return Math.floor(creditBootyBase(price) / CREDIT_BOOTY_RANDOM_STEP);
}

/**
 * The money booty for a hull of this purchase price, given ONE uniform
 * draw `roll` in [0, 1) from the seeded RandomResource. See the note
 * above for the fit.
 */
export function creditBooty(price: number, roll: number): number {
    const steps = creditBootyRandomSteps(price);
    const k = steps > 0
        ? Math.min(steps - 1, Math.max(0, Math.floor(roll * steps))) : 0;
    return Math.max(CREDIT_BOOTY_FLOOR,
        creditBootyBase(price) + k * CREDIT_BOOTY_RANDOM_STEP);
}

/**
 * ============================================================================
 * The plunder self-destruct (reference "Disabled ships, wave 24" and
 * "Plunder self-destruct, wave 25")
 * ============================================================================
 *
 * Taking booty can print "Oops! You tripped this ship's security
 * self-destruct mechanism." (stock STR# 2002 "misc strings", index 112
 * 0-based): the dialog closes, the hulk is destroyed at once, the player
 * is unharmed. The Bible has no field for it (no shïp, gövt or oütf entry
 * mentions a plunder self-destruct), so it is the engine's own.
 *
 * MEASURED (wave 25, 27 boards' takes read shot by shot): every take
 * (Cargo, Credits, Energy) is its own draw; a take that does not trip
 * leaves the dialog open for the next; the order does not matter (Cargo
 * tripped as the first, second and third take); derelicts (Capture Odds
 * 0%: waves 6-7's hulks tripped 8 times in 15 takes) and a live hull the
 * player disabled (75%) both trip, so nothing is exempt by govt; and the
 * take that trips is still DELIVERED (the hold filled after a tripped
 * Cargo take), see boarding_plugin.ts.
 *
 * THE ODDS DIFFER BY ITEM. Counts, all hulls and orders pooled:
 *
 *   | item    | trips / takes | rate  | ~95% interval (Wilson) | used |
 *   |---------|---------------|-------|------------------------|------|
 *   | Cargo   | 10 / 12       | 0.83  | 0.55 - 0.95            | 0.85 |
 *   | Credits |  4 / 15       | 0.27  | 0.11 - 0.52            | 0.25 |
 *   | Energy  |  2 / 4        | 0.50  | 0.15 - 0.85            | 0.50 |
 *   | Ammo    | 11 / 13       | 0.85  | 0.58 - 0.96            | 0.85 |
 *
 * These are FITS FROM SMALL SAMPLES: each rate is the count's own ratio
 * rounded to the nearest 0.05 (one rule for all; the samples cannot tell,
 * say, 0.80 from 0.85, so no digit past that is meant). Ammo's row is
 * reference "Plunder Ammo take, waves 31 and 32": THIRTEEN takes of a
 * stock IR Missile pair from one 50 t hulk type (Ammo was "None" on every
 * earlier hulk, and the kit's self-fed launcher is not plunderable), Cargo's
 * rate; a tripped Ammo take still delivered every round (wave 32, four
 * tripped takes). The hull, govt, the player's crew and rating were never
 * varied, so whether they matter is open.
 */
export type PlunderItem = 'cargo' | 'credits' | 'fuel' | 'ammo';
export const PLUNDER_SELF_DESTRUCT_CHANCE: Readonly<Record<PlunderItem, number>> = {
    cargo: 0.85,
    credits: 0.25,
    /** The dialog's "Energy" row (fuel). */
    fuel: 0.5,
    /** 11 / 13 takes (waves 31-32, see above), delivered when tripped
     * (wave 32). */
    ammo: 0.85,
};

/** Whether taking `item` trips the hulk's self-destruct, given ONE
 * uniform draw `roll` in [0, 1) from the seeded RandomResource. */
export function plunderTripsSelfDestruct(item: PlunderItem,
    roll: number): boolean {
    return roll < PLUNDER_SELF_DESTRUCT_CHANCE[item];
}

/** Looks up a government's data by id: the sim's GovtsResource with the
 * cached game data behind it, or the display's cached game data. */
export type BoardingGovtLookup =
    (govtId: string) => { flags: { startsDisabled: boolean } } | undefined;

/**
 * Whether a ship belongs to a DERELICT government (gövt Flags1 0x0800,
 * "ships of this govt start out disabled"). The original never lets one
 * be captured: "Capture Odds: 0%" with Capture Ship greyed on all 29
 * derelict boards of "U9 waves 6-8", against crew 10 and crew 500, and
 * with 90% of the hulk's armor shot away first; the same hull of an
 * ordinary government, disabled by the player, could be.
 *
 * Read off the GOVERNMENT, not DisabledComponent's `hulk` flag: a mïsn
 * ShipGoal 5 rescue hulk is a hulk too, but not a derelict.
 */
export function isDerelict(target: Entity,
    lookupGovt: BoardingGovtLookup): boolean {
    const govtId = target.components.get(GovtComponent)?.id;
    return govtId !== undefined
        && lookupGovt(govtId)?.flags.startsDisabled === true;
}

/**
 * Whether a boarded ship may be CAPTURED at all. Two kinds never can:
 *
 *  - a DERELICT (isDerelict): the original's rule (ruling #378);
 *  - a ship somebody is FLYING — any peer's player ship, marked
 *    ControlledByComponent. PLUNDER of it is untouched: robbing a
 *    disabled rival is PvP piracy and stays legal.
 *
 * WHY THE FLOWN-SHIP RULE (Matthew's LAN playtest, his ruling): capture
 * used to stamp the escort set (formation link, escort command, the
 * captor's firing group) onto a hull that still had ControlledByComponent,
 * so the victim kept flying it under their own input while the captor's
 * escort commands partly drove it — the ships answered weapon orders from
 * a captain who was not aboard. There is no half-owned ship in this model,
 * so capture of a crewed ship is simply impossible.
 *
 * WHY ControlledByComponent IS THE RIGHT DISCRIMINATOR IN MULTIPLAYER.
 * It is what makes a ship a player's ship in the first place (ship_control
 * .ts: it names the peer whose inputs steer this hull), it is
 * serializer-registered (ShipController's build), and it is NOT in
 * PEER_LOCAL_COMPONENTS — the set of components allowed to differ between
 * peers. So it rides wire snapshots, rollback snapshots and the display
 * bridge, is part of the hashed shared state every desync check compares,
 * and reads identically on every peer and in the display world. The
 * peer-local marker PlayerShipSelector would have been the wrong choice
 * for exactly the opposite reason: it exists only on the local peer, so
 * gating on it would let peer A capture peer B's ship while peer B's own
 * simulation refused — a guaranteed desync. The derelict rule is equally
 * peer-identical: GovtComponent is synced state and the government data
 * is static game data.
 *
 * Both capture routes consult this: the instant bay-capture gate and the
 * plunder session's capture roll (which then never draws from the seeded
 * PRNG, so the draw count stays agreed), and the dialog greys its Capture
 * Ship button off the same predicate.
 */
export function capturable(target: Entity,
    lookupGovt: BoardingGovtLookup): boolean {
    return !target.components.has(ControlledByComponent)
        && !isDerelict(target, lookupGovt);
}

/**
 * ============================================================================
 * Capture odds (fitted to the original, ruling #378; reference "U9 wave 8",
 * "Capture odds, wave 31", "Capture odds at crew ratio 1 and above, wave
 * 32", "Capture, wave 33", "Capture, wave 34" and "Capture, wave 35")
 * ============================================================================
 *
 * The odds the original shows against a hulk the player disabled, keyed by
 * the crew RATIO boarder / defender (wave 32, finding 2: the ratio is what
 * counts, 20 v 20 read as 10 v 10 and 20 v 10 as 10 v 5):
 *
 *     ratio   10    7     6.5   6    5      3      2      1      0.67   0.5    0.25   0.2
 *     odds    75%   75%   73.0% 70%  59.8%  42.4%  31.7%  19.4%  18%    16.2%  10%    12.0%
 *     centre  110%  80%   75%   70%  60%    (41%)  32%    20%    18%    16.5%  12%    12%
 *
 * THE TABLE IS THE CENTRE OF A BOARD'S DRAW, UNCAPPED; the 75% cap comes
 * after the draw (boardCaptureOdds). GUESS, the model (reference "Capture,
 * wave 35", Proposed), fitted to ratios 5-7 together: the centre rises 10
 * points a ratio from 5 (60, 70, 80 at 7, and on to 110 at 10), each board
 * draws +-5 around it, THEN the cap. So ratio 6 reads 65-75 (wave 34,
 * finding 1: 75, 71, 69, 68, 69, 68, mean 70); ratio 6.5 reads 70-80
 * capped, 70-75 with 75 about half the time, a mean of about 73.6 (wave
 * 35, MEASURED: 73, 70, 75, 73, 73, 74, mean 73.0; the old narrowed draw
 * allowed only 71-75 and missed the 70); ratio 7 reads 75-85 capped,
 * always 75 (wave 33, finding 2: crew 70 v 10, 75% on all five boards);
 * ratio 10 and the crew-1 hulk always 75 (waves 8, 25, 30, 32). Ratio 6's
 * measured point (kept in the table) now sits on the line from 5 to 7.
 * Ratio 3 (wave 33, finding 3: 38-45%, mean 42.4 over five boards) sits on
 * the straight line from 2 to 5 (41%), so it needs no point of its own.
 *
 * 0.67 is wave 8's single reading; the rest are MEANS over the boards of
 * waves 8 and 30-32: 10 (75% on every board, waves 8 and 32; 500 against 1
 * too: the odds top out at CAPTURE_CHANCE_MAX), 5 (crew 50 v 10: 55-64%,
 * four boards), 2 (10 v 5 and 20 v 10: 29-34%, seven boards), 1 (10 v 10
 * and 20 v 20: 18-22%, seven boards; 20% kept, within a point of the
 * mean), 0.5 (crew 20: 12-18%, six boards; the reference's proposed 16.5),
 * 0.25 (crew 40: 7-12%, three boards) and 0.2 (crew 50: 7-17%, thirteen
 * boards). No simple formula fits (a crew share would give 83 / 67 / 50 /
 * 40 / 33 / 20%), so captureOddsCentre interpolates the table linearly
 * in the ratio: from 0 at ratio 0 (floored at CAPTURE_CHANCE_MIN) up to
 * 110% at ratio 10 and held there beyond; captureChance caps it.
 *
 * THE 0.25 POINT IS HELD AT 0.2's 12%, not its own 10% mean: three boards
 * (7, 11, 12) are too few to say the odds DIP as the boarders gain on the
 * defenders, a dip would make adding crew lower the odds, and 10% sits well
 * inside the per-board spread below. (The reference's proposal was 0.11.)
 *
 * THE ODDS ARE DRAWN PER BOARD (wave 31, finding 1): the same hulk, the
 * same boarder and the same seven hits read 11, 17, 13, 10 and 14%. So the
 * table gives the draw's CENTRE (the boards' mean wherever the draw stays
 * under the cap), and boardCaptureOdds draws each board's odds as a whole
 * percent around it, once, as the session opens; the dialog shows that
 * number and the capture is rolled against it. The hulk's damage plays no
 * part (7 vs 9 hits against crew 50: 13.0 vs 13.3%; 7, 8 and 9 shots
 * against crew 20: 17, 18, 17%), and nothing else enters here either.
 */
export const CAPTURE_CHANCE_MAX = 0.75;
/**
 * The floor under every capture the table allows: "There should always be at
 * least a 1% chance to capture a ship" (Matthew, 2026-11-23). A deliberate
 * departure from the original, which reads 0% against overwhelming crews.
 * It does not reach a derelict (capturable() refuses those before any odds)
 * or a crewless boarder (the Bible's "cannot capture").
 */
export const CAPTURE_CHANCE_MIN = 0.01;
export const CAPTURE_ODDS_BY_CREW_RATIO:
    ReadonlyArray<readonly [number, number]> = [
        [0, 0],
        [0.2, 0.12],
        [0.25, 0.12],
        [0.5, 0.165],
        [2 / 3, 0.18],
        [1, 0.20],
        [2, 0.32],
        [5, 0.60],
        [6, 0.70],
        [7, 0.80],
        [10, 1.10],
    ];

/**
 * The UNCAPPED centre of a board's capture odds from crew counts (Bible:
 * odds relate to crew, and marines add to the boarder's effective crew:
 * `attackerCrew` is the EFFECTIVE crew, shïp Crew plus the positive
 * marines, boarderMarines): CAPTURE_ODDS_BY_CREW_RATIO interpolated, at
 * least CAPTURE_CHANCE_MIN, and the table's last centre beyond its last
 * ratio (or against a crewless defender). Above ratio 6.5 it passes the
 * 75% cap: boardCaptureOdds draws around it and caps after the draw.
 */
export function captureOddsCentre(attackerCrew: number,
    defenderCrew: number): number {
    const table = CAPTURE_ODDS_BY_CREW_RATIO;
    if (attackerCrew <= 0) {
        return 0;
    }
    if (defenderCrew <= 0) {
        return table[table.length - 1][1];
    }
    const ratio = attackerCrew / defenderCrew;
    for (let i = 1; i < table.length; i++) {
        const [r1, odds1] = table[i];
        if (ratio <= r1) {
            const [r0, odds0] = table[i - 1];
            return Math.max(CAPTURE_CHANCE_MIN,
                odds0 + (odds1 - odds0) * (ratio - r0) / (r1 - r0));
        }
    }
    return table[table.length - 1][1];
}

/**
 * The capture probability the crew counts give, CAPPED at
 * CAPTURE_CHANCE_MAX: captureOddsCentre under the cap. Below ratio 6 it is
 * the boards' mean; nearer the cap the boards average under it, as the
 * draw piles up at 75 (ratio 6.5: 75 here, the boards 70-75, mean about
 * 73.6). See CAPTURE_ODDS_BY_CREW_RATIO; a board's own odds are
 * boardCaptureOdds.
 */
export function captureChance(attackerCrew: number,
    defenderCrew: number): number {
    return Math.min(CAPTURE_CHANCE_MAX,
        captureOddsCentre(attackerCrew, defenderCrew));
}

/**
 * How far, in whole percentage points, one board's odds may fall either side
 * of the table's mean. MEASURED bound (reference "Capture odds at crew ratio
 * 1 and above, wave 32", finding 3): all 38 boards from ratio 0.2 to 5 lie
 * within 5 points of their ratio's mean, and the widest (7 against 12, 55
 * against 60) reach 5 at both ends of the table, so the spread is the same
 * at every ratio below the cap. GUESS: its shape (uniform).
 */
export const CAPTURE_ODDS_SPREAD_POINTS = 5;

/**
 * ONE BOARD'S CAPTURE ODDS, as a whole percent: the table's UNCAPPED centre
 * (captureOddsCentre, rounded to a percent) plus an even draw of whole
 * points in [-w, +w], w = CAPTURE_ODDS_SPREAD_POINTS, THEN capped at 75%.
 *
 * GUESS, the shape: the spread is uniform and symmetric, so under the cap
 * the boards' mean is the table's. It NARROWS only at the 1% floor (w is no
 * more than the gap down to it). At the cap it does not narrow: the draw
 * is taken around the uncapped centre and every figure over 75 reads 75
 * (reference "Capture, wave 35", Proposed: ratio 6.5's boards read 70-75,
 * a narrowed 71-75 missed its 70; ratio 6 had read 75 from a centre of 70).
 * Ratio 7 and up (a centre of 80 or more) and the crew-1 hulk read 75% on
 * every board, as all of the original's did (waves 8, 25, 30 and 33).
 *
 * `draw` is an unsigned 32-bit hash the caller salts per board (the
 * boarder, the victim and the board's own seeded draw: boarding_plugin.ts),
 * so every peer and the display read the same number. 0 for a crewless
 * boarder, like captureChance.
 *
 * `bonusPoints`: the boarder's percent marines (boarderMarines), added
 * after the draw and capped at CAPTURE_CHANCE_MAX (reference "Capture,
 * wave 33", finding 4: ModVal -20 read 35, 35, 45 at ratio 1, whose own
 * boards read 15-25). MEASURED, the cap holds over the bonus ("Capture,
 * wave 34", finding 4: crew 70 + ModVal -20 read 75 three times, not 95).
 */
export function boardCaptureOdds(attackerCrew: number, defenderCrew: number,
    draw: number, bonusPoints = 0): number {
    const centre = Math.round(
        captureOddsCentre(attackerCrew, defenderCrew) * 100);
    if (centre <= 0) {
        return 0;
    }
    const floor = Math.round(CAPTURE_CHANCE_MIN * 100);
    const cap = Math.round(CAPTURE_CHANCE_MAX * 100);
    const w = Math.max(0, Math.min(CAPTURE_ODDS_SPREAD_POINTS,
        centre - floor));
    const odds = centre - w + ((draw >>> 0) % (2 * w + 1));
    // The cap after the draw and the bonus (the bonus is never negative,
    // so this is the capped draw plus the bonus, capped again).
    return Math.min(cap, odds + Math.max(0, Math.floor(bonusPoints) || 0));
}

/**
 * ============================================================================
 * Marines (oütf ModType 25; reference "Capture, wave 33", finding 4)
 * ============================================================================
 *
 * The Bible: "Adds the value in ModVal to your ship's effective crew
 * complement when calculating capture odds. 1 and up: add this number to
 * the player's ship's effective crew size. -1 to -100: increase the
 * player's capture odds by this amount (e.g. -5 is an increase of 5%)".
 *
 * MEASURED, one outfit of each kind on a crew-10 boarder against a crew-10
 * hulk: ModVal 10 read 34, 32, 25 (ratio 2's band, 29-34, not ratio 1's
 * 15-25: ten more crew, 20 v 10); ModVal -20 read 35, 35, 45 (ratio 1's
 * mean plus about 20 points). So:
 *
 *  - `crew`: every positive ModVal adds that many crew to the boarder's
 *    side of the ratio (captureChance);
 *  - `oddsPoints`: every negative one adds its magnitude, in percentage
 *    points, to the board's drawn odds (boardCaptureOdds), under the cap.
 *
 * Both read again at a second ratio ("Capture, wave 34", findings 2-3):
 * ModVal 10 on a crew-30 boarder read 46, 55, 45 (ratio 4's band, crew 40
 * v 10), ModVal -20 on crew 30 read 60, 57, 64 (ratio 3's 42.4 plus about
 * 18 points: a flat bonus in points, not a factor).
 *
 * GUESSES: several units (or several marine outfits) add up, count times
 * ModVal; a percent ModVal below -100 counts as 100; marines give a
 * CREWLESS boarder nothing (the Bible's "0 crew ... can't capture" holds:
 * see boarderEffectiveCrew); only one unit of each kind was measured.
 */
export interface BoarderMarines {
    /** Crew the positive ModVals add. */
    crew: number;
    /** Percentage points the negative ModVals add to the odds. */
    oddsPoints: number;
}

/**
 * Sums a boarder's marines from its outfits (`outfits`: id -> count, as
 * OutfitsState; `marinesOf`: the outfit's parsed ModType 25 value, 0 for
 * none). Order-free sums of integers, so every peer agrees.
 */
export function boarderMarines(
    outfits: Iterable<readonly [string, { count: number }]> | undefined,
    marinesOf: (outfitId: string) => number | undefined): BoarderMarines {
    let crew = 0;
    let oddsPoints = 0;
    for (const [id, state] of outfits ?? []) {
        const count = Math.max(0, Math.floor(state.count) || 0);
        const value = Math.trunc(marinesOf(id) ?? 0) || 0;
        if (count <= 0 || value === 0) {
            continue;
        }
        if (value > 0) {
            crew += value * count;
        } else {
            oddsPoints += Math.min(100, -value) * count;
        }
    }
    return { crew, oddsPoints };
}

/** The boarder's EFFECTIVE crew for the capture ratio: shïp Crew plus its
 * positive marines; a crewless boarder stays crewless (it cannot capture,
 * GUESS that marines do not change that). */
export function boarderEffectiveCrew(shipCrew: number,
    marines: BoarderMarines): number {
    return shipCrew > 0 ? shipCrew + marines.crew : 0;
}

/**
 * ============================================================================
 * The capture self-destruct (reference "Capture, wave 33", finding 5)
 * ============================================================================
 *
 * A Capture Ship click can be answered "Oops! You tripped this ship's
 * security self-destruct mechanism." (STR# 2002 #112) instead of an
 * outcome: no capture, the hulk destroyed, as a plunder take's trip
 * (PLUNDER_SELF_DESTRUCT_CHANCE). MEASURED: 3 of 39 clicks (waves 33 and
 * 34, "Capture, wave 34", finding 5: at 75%, 32% and 75%), about 0.08, so
 * the rate 0.1 is kept (Wilson 95% about 0.03-0.20); wave 46's CU rig
 * ("The capture prompt's keys ... (CU leftover), wave 46", finding 4)
 * added 1 of 7 at 75%, 4 of 46 in all (0.087). GUESSES: a separate
 * draw made BEFORE the capture roll (a trip leaves no outcome to read),
 * the same at every odds (the trips came at high and low odds alike).
 */
export const CAPTURE_SELF_DESTRUCT_CHANCE = 0.1;

/** Whether a capture attempt trips the hulk's self-destruct, given ONE
 * uniform draw `roll` in [0, 1) from the seeded RandomResource. */
export function captureTripsSelfDestruct(roll: number): boolean {
    return roll < CAPTURE_SELF_DESTRUCT_CHANCE;
}

/**
 * Plans a cargo plunder: which commodities move and how many tons,
 * greedily filling the boarder's free hold. Keys are visited in sorted
 * order so every peer moves exactly the same tons of the same
 * commodities. Returns [key, tons] entries with tons > 0.
 */
export function planCargoPlunder(
    targetCargo: ReadonlyMap<string, number>,
    freeSpace: number): [string, number][] {
    let remaining = Math.max(0, Math.floor(freeSpace));
    const plan: [string, number][] = [];
    for (const key of [...targetCargo.keys()].sort()) {
        if (remaining <= 0) {
            break;
        }
        const available = targetCargo.get(key) ?? 0;
        const take = Math.min(available, remaining);
        if (take > 0) {
            plan.push([key, take]);
            remaining -= take;
        }
    }
    return plan;
}

/** Fuel that can move from the victim's tank into the boarder's,
 * clamped by both the victim's remaining fuel and the boarder's
 * headroom. */
export function fuelTransferAmount(victimFuel: number, boarderFuel: number,
    boarderFuelMax: number): number {
    return Math.max(0, Math.min(victimFuel, boarderFuelMax - boarderFuel));
}

/**
 * What the boarder needs to know about one of the victim's ammo outfits to
 * decide the plunder: the weapon it supplies and the boarder's total capacity
 * for that weapon's ammo. The sim resolves this from game data (an outfit's
 * ammoFor, the weapon's MaxAmmo, the outfit's Max, and how many launchers the
 * boarder mounts); it is `undefined` when the outfit is not ammo the boarder
 * can use (not an ammo outfit, or the boarder mounts no matching launcher).
 */
export interface AmmoOutfitInfo {
    /** Weapon global id this outfit supplies ammo for (OutfitData.ammoFor). */
    ammoFor: string;
    /** Total rounds the boarder can hold for that weapon (MaxAmmo x launcher
     * count, or the ammo outfit's Max when MaxAmmo is 0); Infinity if
     * uncapped. */
    capacity: number;
}

/**
 * One of the boarder's MOUNTED bay weapons, as the bay-capture shortcut
 * needs to see it. Resolved by the gate from the boarder's
 * WeaponsStateComponent plus game data (the bay wëap's ShipID and
 * MaxAmmo), its magazine, and the live entity map.
 */
export interface CaptureBayCandidate {
    /** Global id of the bay wëap. */
    bayWeaponId: string;
    /** The ship class this bay launches (BayWeaponData.shipID). */
    shipId: string;
    /** The bay's MaxAmmo; <= 0 means "no simulation-side cap" (see
     * refundFighterToBay, which reads the same field the same way). */
    maxAmmo: number;
    /** How many of this bay the boarder mounts (WeaponState.count). */
    mounted: number;
    /** Fighter rounds for this bay currently in the boarder's magazine. */
    held: number;
    /** This bay's fighters currently deployed from the boarder. */
    deployed: number;
}

/**
 * Whether a captured fighter would fit in this bay: its magazine rounds
 * plus its already-deployed fighters must be under the bay's capacity
 * (MaxAmmo per bay times the bays mounted).
 *
 * MaxAmmo <= 0 is treated as UNBOUNDED, matching refundFighterToBay: a
 * bay with no MaxAmmo defers to the ammo outfit's Max field, which is
 * game data rather than simulation state, so the sim does not cap it.
 * Counting deployed fighters (not just the magazine) is what makes the
 * capture safe to bank later: the docking refund is guaranteed to have
 * room, so the capture becomes permanent.
 */
export function bayCaptureRoom(bay: CaptureBayCandidate): boolean {
    if (bay.mounted <= 0) {
        return false;
    }
    if (bay.maxAmmo <= 0) {
        return true;
    }
    return bay.held + bay.deployed < bay.maxAmmo * bay.mounted;
}

/**
 * The bay a boarded ship is captured into, or undefined when none of the
 * boarder's bays takes that ship class with room to spare.
 *
 * A candidate must launch exactly this ship class and have room. When
 * several qualify the LOWEST-SORTED bay weapon id wins, so every peer
 * picks the same bay from the same synced state (the same tie-break
 * refundFighterToBay and weapon_plugin's consumeAmmo use for outfits).
 * Bays that fit but are full are skipped rather than blocking the
 * shortcut — a full bay is not a reason to ignore an empty one.
 */
export function chooseCaptureBay(targetShipId: string,
    candidates: Iterable<CaptureBayCandidate>): string | undefined {
    return [...candidates]
        .filter(bay => bay.shipId === targetShipId && bayCaptureRoom(bay))
        .map(bay => bay.bayWeaponId)
        .sort()[0];
}

/**
 * Plans an ammo plunder: for each ammo outfit the victim carries whose weapon
 * the boarder also mounts, how many rounds move into the boarder's stock,
 * capped by the boarder's remaining capacity for that weapon. Deterministic:
 * victim outfit ids are visited in sorted order, and capacity is SHARED across
 * outfits that feed the same weapon (two ammo outfits for one launcher can't
 * each fill it). Returns [outfitId, rounds] entries with rounds > 0.
 *
 * `boarderRoundsByWeapon` is the boarder's current rounds keyed by weapon id;
 * `info(outfitId)` resolves the weapon + capacity (see AmmoOutfitInfo),
 * returning undefined to skip an outfit.
 */
export function planAmmoPlunder(
    victimOutfits: ReadonlyMap<string, number>,
    boarderRoundsByWeapon: ReadonlyMap<string, number>,
    info: (outfitId: string) => AmmoOutfitInfo | undefined,
): [string, number][] {
    const plan: [string, number][] = [];
    // Rounds already committed this plan, per weapon, so shared capacity is
    // respected across multiple ammo outfits feeding the same launcher.
    const committed = new Map<string, number>();
    for (const outfitId of [...victimOutfits.keys()].sort()) {
        const available = Math.max(0, Math.floor(victimOutfits.get(outfitId) ?? 0));
        if (available <= 0) {
            continue;
        }
        const meta = info(outfitId);
        if (!meta) {
            continue;
        }
        const already = (boarderRoundsByWeapon.get(meta.ammoFor) ?? 0)
            + (committed.get(meta.ammoFor) ?? 0);
        const room = Math.max(0, meta.capacity - already);
        const take = Math.min(available, room);
        if (take > 0) {
            plan.push([outfitId, take]);
            committed.set(meta.ammoFor,
                (committed.get(meta.ammoFor) ?? 0) + take);
        }
    }
    return plan;
}
