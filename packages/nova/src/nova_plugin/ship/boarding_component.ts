import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
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
 *    ratio (captureChance) with no marines term, because ModType 25 is
 *    not parsed yet. The marines additive is a documented seam in
 *    captureChance's caller.
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
 * Capture odds (fitted to the original, ruling #378)
 * ============================================================================
 *
 * The odds the original shows against a hulk the player disabled ("U9 wave
 * 8", item 5: a crew-10 boarder against hulks of crew 1-40, and a crew-500
 * one against crew 1), keyed by the crew RATIO boarder / defender:
 *
 *     ratio   10    2     1     0.67   0.5        0.25
 *     odds    75%   34%   20%   18%    17-18%     7%
 *
 * and 500 against 1 also read 75%: the odds top out at CAPTURE_CHANCE_MAX.
 * No simple formula fits (a crew share would give 67 / 50 / 40 / 33 / 20%)
 * and the doc proposes interpolating the points until one is found, so
 * captureChance interpolates this table linearly in the ratio: down to
 * CAPTURE_CHANCE_MIN near ratio 0, and up to the cap at ratio 10 (between 2 and 10 nothing was
 * measured). The hulk's damage plays no part (7, 8 and 9 shots against
 * crew 20 read 17, 18, 17%), and nothing else enters here either.
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
        [0.25, 0.07],
        [0.5, 0.175],
        [2 / 3, 0.18],
        [1, 0.20],
        [2, 0.34],
        [10, CAPTURE_CHANCE_MAX],
    ];

/**
 * Capture probability from crew counts (Bible: odds relate to crew, and
 * marines add to the boarder's effective crew — that additive is a
 * documented seam: ModType 25 is unparsed, so `attackerCrew` is the raw
 * shïp Crew today). See CAPTURE_ODDS_BY_CREW_RATIO.
 */
export function captureChance(attackerCrew: number,
    defenderCrew: number): number {
    if (attackerCrew <= 0) {
        return 0;
    }
    if (defenderCrew <= 0) {
        return CAPTURE_CHANCE_MAX;
    }
    const ratio = attackerCrew / defenderCrew;
    const table = CAPTURE_ODDS_BY_CREW_RATIO;
    for (let i = 1; i < table.length; i++) {
        const [r1, odds1] = table[i];
        if (ratio <= r1) {
            const [r0, odds0] = table[i - 1];
            return Math.max(CAPTURE_CHANCE_MIN,
                odds0 + (odds1 - odds0) * (ratio - r0) / (r1 - r0));
        }
    }
    return CAPTURE_CHANCE_MAX;
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
