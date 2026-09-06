import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { BRIBE_MINIMUM } from '../reputation/index.js';

// --- NPC plundering of disabled hulks (gövt Flags 0x1000) ---
//
// EVN Bible, gövt Flags (unofficial-corrections edition, the copy at the
// repo root):
//
//   0x1000     Warships will plunder non-mission, trader-type enemies
//              (including the player) before destroying them
//
// (The original Ambrosia text read "non-mission, non-player enemies";
// Appendix V records the correction. Both agree on "warships",
// "non-mission" and "trader-type".)
//
// That sentence is the ONLY NPC-side boarding rule in the whole Bible.
// Everything it does not say is a judgment call, so each one is a named
// constant here and every one of them is listed in the report as wanting
// a ruling:
//
//  - "Warships" -> AIType 3 only. AIType 3 IS "Warship"; AIType 4 is
//    "Interceptor", whose documented job is the opposite one — it "acts
//    as 'piracy police' by attacking any ship that fires on or attempts
//    to board another, non-enemy ship". Putting interceptors on the
//    plundering side would have them police themselves.
//  - "trader-type" -> AIType 1 and 2, which is how the Bible spells the
//    same idea everywhere else: gövt Flags 0x0080 says "Freighters (i.e.
//    AiTypes 1 and 2)" and flët Flags 0x0001 says "Freighters
//    (InherentAI <= 2)".
//  - "(including the player)" IS implemented (Matthew's ruling): a
//    DISABLED player is boarded exactly like a hulk, and the pirates take
//    a cut of the player's cash. See npcPlunderCredits for the amount and
//    why it is pegged above the bribe.
//  - DISABLED FIRST is imposed by this engine, not by the Bible (the
//    flag says only "before destroying them"). Boarding in NovaJS is
//    defined against a disabled hulk (boarding_component.ts), so an NPC
//    plunder run waits for the hulk like the player does — the player
//    included.
//  - From an NPC HULK the boarder takes nothing material: there is
//    nowhere for an NPC's booty to go and no way for anyone to observe
//    it, so the whole point of the run is the DENIAL — the hulk's one
//    plunder is spent and the player is refused. From a PLAYER there is
//    somewhere for it to go, so credits actually move.
//
// This module holds the RULES (pure predicates and tunables). The
// decision system consults them when gathering candidates, the steering
// system flies the approach, and NpcPlunderBoardSystem
// (npc_plunder_board.ts) performs the claim.

/**
 * TUNABLE (Bible-ambiguous). AI types that run a plunder-boarding
 * approach when their government carries gövt Flags 0x1000.
 */
export const NPC_PLUNDER_BOARDER_AI_TYPES: ReadonlySet<number> = new Set([3]);
/**
 * TUNABLE (Bible-ambiguous). AI types that count as the flag's
 * "trader-type" victims.
 */
export const NPC_PLUNDER_VICTIM_AI_TYPES: ReadonlySet<number> = new Set([1, 2]);
/**
 * Whether NPCs plunder ships somebody is FLYING. The corrected Bible text
 * says gövt Flags 0x1000 includes the player, and Matthew's ruling agrees:
 * they do. Kept as a named constant so the predicate reads as a rule
 * rather than an omission, and so the specs can quote it.
 */
export const NPC_PLUNDER_TAKES_FROM_PLAYERS = true;

/**
 * ============================================================================
 * What pirates take off a disabled PLAYER
 * ============================================================================
 *
 * A cut of the player's cash — Matthew's ruling — and it MUST COST MORE
 * THAN BUYING THEM OFF. That relation is the whole design: a hostile ship
 * you can still fly away from will take `bribeAmount` (hail.ts) to leave
 * you alone, so if letting yourself be disabled and boarded were cheaper,
 * the bribe would be strictly dominated and nobody would ever pay one.
 *
 * So both terms of the demand are pegged above the bribe's:
 *
 *  - the FRACTION is above BRIBE_FRACTION_LARGE (0.30), the biggest cut
 *    any bribe takes — the pirate/`largerBribes` one, which is exactly the
 *    kind of government that carries the plunder flag in the first place;
 *  - the FLOOR is DERIVED from BRIBE_MINIMUM rather than written out, so
 *    raising the bribe floor cannot silently leave a cheap plunder behind
 *    it.
 *
 * The one place the two can be EQUAL is a purse too small to satisfy
 * either demand: both are capped at what the player actually has, and
 * nobody can take more than everything. npc_boarding_test pins the
 * relation (>= always, > whenever the bribe is not already taking the
 * whole purse) across a sweep of purses and both bribe flags, so the two
 * functions cannot drift apart.
 *
 * PURE AND DETERMINISTIC: a function of the synced CreditsComponent
 * alone, with no roll, so every peer deducts the same amount on the same
 * tick. (A random cut would also have to agree on the draw count with
 * every other NPC's decision roll.)
 */
export const NPC_PLUNDER_CREDIT_FRACTION = 0.50;
/** The floor, pegged above the bribe's (see NPC_PLUNDER_CREDIT_FRACTION). */
export const NPC_PLUNDER_CREDIT_MINIMUM = 2 * BRIBE_MINIMUM;

/**
 * The credits pirates take off a disabled player: the larger of the
 * fraction and the floor, capped at what the player actually has.
 * Mirrors bribeAmount's shape exactly, one tier up.
 */
export function npcPlunderCredits(playerCredits: number): number {
    const purse = Math.max(0, Math.floor(playerCredits));
    const demand = Math.max(NPC_PLUNDER_CREDIT_MINIMUM,
        Math.floor(purse * NPC_PLUNDER_CREDIT_FRACTION));
    return Math.min(demand, purse);
}
/** TUNABLE. How far away a warship will notice a plunderable hulk. */
export const NPC_PLUNDER_SEEK_RANGE = 4000;
/** TUNABLE. "Pulled alongside", for an NPC (the player's own gate is
 * tighter, and additionally axis-aligned — an NPC is not asked to fly
 * that precisely). */
export const NPC_BOARD_RADIUS = 140;
/** TUNABLE. Relative speed at which an NPC counts as matched to the
 * hulk's drift. */
export const NPC_BOARD_SPEED = 60;

/**
 * Whether this NPC is a plunderer at all: the "Warships ... of this govt"
 * half of gövt Flags 0x1000. Split out so the decision step can decide in
 * one cheap test whether to look at hulks at all.
 */
export function npcPlundersHulks(aiType: number,
    plundersBeforeDestroying: boolean | undefined): boolean {
    return plundersBeforeDestroying === true
        && NPC_PLUNDER_BOARDER_AI_TYPES.has(aiType);
}

/**
 * Whether a warship of a plundering government would run a boarding
 * approach on this victim — the gövt Flags 0x1000 rule, as a pure
 * predicate over already-resolved facts so it can be pinned directly.
 */
export function npcPlunderEligible(boarder: {
    aiType: number, plundersBeforeDestroying: boolean | undefined,
}, victim: {
    /** The victim's NpcComponent aiType; undefined when it has no NPC
     * brain (a player's ship, a dev-spawned hull). */
    aiType: number | undefined,
    disabled: boolean,
    /** Its one plunder has already been spent (plunderSpent). */
    plunderSpent: boolean,
    /** It is a mission special ship — the flag's "non-mission". */
    missionShip: boolean,
    /** Somebody is flying it (ControlledByComponent). */
    controlled: boolean,
    /** The boarder's government calls it an enemy. */
    hostile: boolean,
}): boolean {
    if (!npcPlundersHulks(boarder.aiType,
        boarder.plundersBeforeDestroying)) {
        return false;
    }
    if (!victim.disabled || victim.plunderSpent || victim.missionShip
        || !victim.hostile) {
        return false;
    }
    if (victim.controlled) {
        return NPC_PLUNDER_TAKES_FROM_PLAYERS;
    }
    return victim.aiType !== undefined
        && NPC_PLUNDER_VICTIM_AI_TYPES.has(victim.aiType);
}

/**
 * Whether an NPC on a plunder approach has arrived: pulled alongside the
 * hulk and matched to its drift. Deliberately looser than the player's
 * gate (boardingBlockedReason) — an NPC is not asked to line its axis up
 * with the hulk's.
 */
export function npcBoardArrived(boarder: MovementState,
    hulk: MovementState): boolean {
    return hulk.position.subtract(boarder.position).lengthSquared
        <= NPC_BOARD_RADIUS * NPC_BOARD_RADIUS
        && hulk.velocity.subtract(boarder.velocity).lengthSquared
        <= NPC_BOARD_SPEED * NPC_BOARD_SPEED;
}
