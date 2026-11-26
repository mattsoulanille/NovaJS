import { MovementState } from 'nova_ecs/plugins/movement_plugin';
import { STANDARD_COMMODITY_BASE_PRICES } from '../ship/index.js';

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
//    cargo and a share of the cash, then let him go — measured on the
//    original (reference "Pirates and a disabled player (A9), wave 38";
//    see below). The player's HULL type does not matter (a warship-type
//    player hull was plundered the same way), and the Bible's "before
//    destroying them" did not happen: the pirate left him disabled.
//  - DISABLED FIRST: the flag says only "before destroying them", but the
//    original's pirate fired until "Ship disabled.", stopped, and boarded
//    (reference A9, wave 38). Boarding in NovaJS is defined against a
//    disabled hulk (boarding_component.ts) anyway, so an NPC plunder run
//    waits for the hulk like the player does — the player included.
//  - From an NPC HULK the boarder takes nothing material: there is
//    nowhere for an NPC's booty to go and no way for anyone to observe
//    it, so the whole point of the run is the DENIAL — the hulk's one
//    plunder is spent and the player is refused. From a PLAYER there is
//    somewhere for it to go, so cargo and credits actually move.
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
 * MEASURED (reference "Pirates and a disabled player (A9), wave 38", seven
 * runs): a 0x1000 warship that has disabled the player comes alongside,
 * sits on him about 5 s (NPC_PLUNDER_DOCK_MS) and takes CARGO AND CREDITS
 * in one go — "<N> tons of cargo and <M> credits stolen!" — then lets him
 * go (npc/let_go.ts): non-hostile, off out of the system, the player left
 * disabled and not shot again.
 *
 *  - CARGO: as much as the pirate's own free hold takes (all 20 t of food;
 *    50 of 80 t into a 50 t hold), the costliest commodity first (30 t of
 *    equipment before 20 t of industrial; one run). npcPlunderCargoPlan.
 *  - CREDITS: a drawn share of the purse. npcPlunderCredits.
 */

/**
 * The credit share, in steps of NPC_PLUNDER_CREDIT_STEP of the purse: a
 * uniform integer draw in [MIN_STEPS, MAX_STEPS].
 *
 * MEASURED (reference "Pirate plunder share (A9), wave 39", with wave 38's
 * five draws): every take is a whole number of 0.3% steps of the purse,
 * eighteen of eighteen at purses from 10,000 to 5,000,000, and the number
 * of steps ran 17 to 35 (sorted: 17, 19, 21, 22, 22, 23, 25, 25, 26, 27,
 * 27, 27, 28, 30, 33, 34, 35, 35) with no dependence on the purse (17 at
 * 200,000, 34 at 10,000, 35 at 1,000,000). GUESS on the shape: uniform on
 * 17-35 (the edges from eighteen draws; 15-35 or 17-36 is not ruled out).
 * Wave 38's five 50,000 readings, all in 25-28, were a narrow sample.
 */
export const NPC_PLUNDER_CREDIT_STEP = 0.003;
export const NPC_PLUNDER_CREDIT_MIN_STEPS = 17;
export const NPC_PLUNDER_CREDIT_MAX_STEPS = 35;

/**
 * The credits pirates take off a disabled player with `playerCredits`,
 * given ONE uniform draw `roll` in [0, 1) from the seeded RandomResource:
 * floor(purse x steps x 0.3%), never more than the purse.
 */
export function npcPlunderCredits(playerCredits: number,
    roll: number): number {
    const purse = Math.max(0, Math.floor(playerCredits));
    const span = NPC_PLUNDER_CREDIT_MAX_STEPS
        - NPC_PLUNDER_CREDIT_MIN_STEPS + 1;
    const steps = NPC_PLUNDER_CREDIT_MIN_STEPS
        + Math.min(span - 1, Math.floor(roll * span));
    // Integer arithmetic: steps x 3 / 1000 of the purse, so a 50,000 purse
    // gives exactly 150 x steps (2,550 .. 5,250) on every peer.
    return Math.min(purse, Math.floor(purse * steps * 3 / 1000));
}

/**
 * The rank of a cargo key for a pirate's take: the standard commodities
 * by base price, dearest first (equipment, 550, before industrial, 350:
 * the one measured order), then jünk (GUESS: unmeasured; a jünk's price is
 * game data the board does not read), and mission cargo never (GUESS: no
 * run carried any; taking it would leave a mission no way to finish).
 * Returns undefined for a key the pirate does not take.
 */
function cargoTakeRank(key: string): number | undefined {
    const standard = /^cargo:(\d+)$/.exec(key);
    if (standard) {
        const price = STANDARD_COMMODITY_BASE_PRICES[Number(standard[1])];
        return price === undefined ? undefined : -price;
    }
    if (key.startsWith('junk:')) {
        return 0;
    }
    return undefined;
}

/**
 * What a pirate takes from a disabled player's hold: up to `freeSpace`
 * tons, the costliest commodity first (cargoTakeRank), ties by key so
 * every peer moves the same tons of the same commodities. Returns [key,
 * tons] entries with tons > 0.
 */
export function npcPlunderCargoPlan(cargo: ReadonlyMap<string, number>,
    freeSpace: number): [string, number][] {
    const ranked: [string, number][] = [];
    for (const key of cargo.keys()) {
        const rank = cargoTakeRank(key);
        if (rank !== undefined) {
            ranked.push([key, rank]);
        }
    }
    ranked.sort(([a, ra], [b, rb]) => ra - rb || (a < b ? -1 : a > b ? 1 : 0));
    let remaining = Math.max(0, Math.floor(freeSpace));
    const plan: [string, number][] = [];
    for (const [key] of ranked) {
        if (remaining <= 0) {
            break;
        }
        const take = Math.min(Math.max(0, Math.floor(cargo.get(key) ?? 0)),
            remaining);
        if (take > 0) {
            plan.push([key, take]);
            remaining -= take;
        }
    }
    return plan;
}

/**
 * MEASURED. How long a plunder boarder sits on its prize before the take:
 * reference A9, wave 38 — the pirate came alongside about 76 s and the
 * line came at 81.3 s (12.5-14 s after the disable in all seven runs, the
 * approach included). The same dock for an NPC hulk (GUESS: only the
 * player was watched).
 */
export const NPC_PLUNDER_DOCK_MS = 5000;

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
