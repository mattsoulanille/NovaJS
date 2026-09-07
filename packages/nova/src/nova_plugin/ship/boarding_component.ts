import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
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
 *    price (CREDIT_BOOTY_FRACTION), its remaining fuel (the plunder
 *    dialog's "Energy"), and its AMMUNITION. This reuses the live
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
 *  - Capture odds use a crew-ratio formula (captureChance) with no
 *    marines term, because ModType 25 is not parsed yet. The marines
 *    additive is a documented seam in captureChance's caller.
 *
 * MATTHEW'S EXPLICIT SPEC (authoritative): boarding additionally
 * requires the boarding ship's axis to be ALIGNED with the target's —
 * facing the same way or exactly opposite (parallel or anti-parallel),
 * within AXIS_ALIGN_TOLERANCE_RAD. See axesAligned.
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
 * Boarding window (mirrors the landing gate in planet_plugin.ts).
 * TUNABLE: 150 px center-to-center is "pulled alongside" for the small
 * ship sprites, and the same slow-speed threshold as landing, applied
 * to the RELATIVE velocity so you must match the drifting hulk's motion
 * rather than merely be slow in absolute terms.
 */
export const BOARD_DISTANCE_SQUARED = 22_500;
export const BOARD_REL_SPEED_SQUARED = 3_000;

/**
 * Axis-alignment tolerance (Matthew's spec). TUNABLE: 15 degrees each
 * side of parallel and of anti-parallel — tight enough that you must
 * deliberately line up with the hulk, loose enough to be achievable by
 * hand.
 */
export const AXIS_ALIGN_TOLERANCE_RAD = Math.PI / 12;

/**
 * Money booty as a fraction of the victim's purchase price (Bible:
 * "amount depends on the ship's purchase price"; the fraction is
 * undocumented). TUNABLE.
 */
export const CREDIT_BOOTY_FRACTION = 0.10;

/** Capture-chance clamp, so a wildly one-sided crew count still leaves
 * a sliver of uncertainty either way. */
export const CAPTURE_CHANCE_MIN = 0.05;
export const CAPTURE_CHANCE_MAX = 0.95;

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
 */
export type BoardBlockReason =
    | 'noTarget' | 'notDisabled' | 'noCrew'
    | 'tooFar' | 'tooFast' | 'notAligned' | 'alreadyBoarded';

/**
 * Pure boarding gate. Checks, in the order the on-screen feedback
 * prioritizes: a disabled target must be selected, it must have crew
 * (Bible: 0-crew ships can't be boarded), and the boarder must be close,
 * matched in speed, and axis-aligned (Matthew's spec).
 */
export function boardingBlockedReason(input: {
    hasTarget: boolean;
    targetDisabled: boolean;
    targetCrew: number;
    distanceSquared: number;
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
    if (input.distanceSquared >= BOARD_DISTANCE_SQUARED) {
        return 'tooFar';
    }
    if (input.relSpeedSquared >= BOARD_REL_SPEED_SQUARED) {
        return 'tooFast';
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

/** Money booty from a victim's purchase price (floored, non-negative). */
export function creditBooty(price: number): number {
    return Math.max(0, Math.floor(price * CREDIT_BOOTY_FRACTION));
}

/**
 * Whether a boarded ship may be CAPTURED at all. A ship somebody is
 * FLYING — any peer's player ship, marked ControlledByComponent — never
 * can be. PLUNDER of it is untouched: robbing a disabled rival is PvP
 * piracy and stays legal.
 *
 * WHY (Matthew's LAN playtest, his ruling): capture used to stamp the
 * escort set (formation link, escort command, the captor's firing group)
 * onto a hull that still had ControlledByComponent, so the victim kept
 * flying it under their own input while the captor's escort commands
 * partly drove it — the ships answered weapon orders from a captain who
 * was not aboard. There is no half-owned ship in this model, so capture
 * of a crewed ship is simply impossible.
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
 * simulation refused — a guaranteed desync.
 *
 * Both capture routes consult this: the instant bay-capture gate and the
 * plunder session's capture roll (which then never draws from the seeded
 * PRNG, so the draw count stays agreed), and the dialog greys its Capture
 * Ship button off the same predicate.
 */
export function capturable(target: Entity): boolean {
    return !target.components.has(ControlledByComponent);
}

/**
 * Capture probability from crew counts (Bible: odds relate to crew, and
 * marines add to the boarder's effective crew — that additive is a
 * documented seam: ModType 25 is unparsed, so `attackerCrew` is the raw
 * shïp Crew today). A simple share-of-total model, clamped so neither
 * side is ever a certainty.
 */
export function captureChance(attackerCrew: number,
    defenderCrew: number): number {
    if (attackerCrew <= 0) {
        return 0;
    }
    const raw = attackerCrew / (attackerCrew + Math.max(0, defenderCrew));
    return Math.max(CAPTURE_CHANCE_MIN, Math.min(CAPTURE_CHANCE_MAX, raw));
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
