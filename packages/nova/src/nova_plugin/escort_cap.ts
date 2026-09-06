import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from './bay_plugin.js';
import { MissionShipComponent } from './mission_ship_component.js';
import { PlayerEscortComponent } from './player_escort.js';

/**
 * ============================================================================
 * The escort cap (maintainer ruling #161)
 * ============================================================================
 *
 * A player may have at most SIX escorts, and the six are the escorts the
 * player has HIRED (at the bar) or CAPTURED (boarded and kept). Nothing
 * else counts, and nothing else is limited:
 *
 *   - escorts a MISSION grants (mïsn ShipBehav 1 / escort-goal ships that
 *     fly in formation on the player) join regardless of the cap and are
 *     not counted against it — they belong to the mission, not the player
 *     (see escortsOnPayroll in player_escort_plugin.ts for the same line);
 *   - fighters LAUNCHED FROM BAYS — the player's own or a carrier
 *     escort's — are outfits flying, not escorts, and are unlimited.
 *
 * The cap is enforced at the two places an escort is acquired, with the
 * same refusal (STR# 2002 index 123): the bar's hire dialog
 * (spaceport/hire_escort.ts) and the plunder session's "keep as escort"
 * (boarding_plugin.ts). Both count through ONE function,
 * {@link cappedEscortCount}, which counts an escort wherever it happens
 * to be at that moment — see its doc for the places, and for what each
 * caller can and cannot see.
 *
 * The original refuses a hire past a cap but the Bible never states the
 * number; six is the maintainer's ruling from the original game.
 */
export const MAX_ESCORTS = 6;

/** STR# 2002 index 123, verbatim, as the fallback for a short table. */
export const MAX_ESCORTS_MESSAGE =
    'You already have the maximum possible number of escorts.';

/**
 * Whether a ship that is (or is about to be) the player's escort counts
 * against {@link MAX_ESCORTS}: a hired or captured escort does; a mission
 * ship and a bay fighter do not. Reads the synced identity components,
 * which is what makes the sim-side count deterministic on every peer.
 */
export function countsTowardEscortCap(escort: Entity): boolean {
    return !escort.components.has(BayFighterComponent)
        && !escort.components.has(MissionShipComponent);
}

/**
 * An escort the client is carrying for its player while the escort is out
 * of every world — landed with the player, or riding a jump (the entry
 * shape of spaceport/landed_escorts.ts's CarriedEscort, and of the roster
 * getter the spaceport is handed). `uuid` is the uuid the escort had in
 * the world it left, and will have again: it is the identity the count
 * de-duplicates on.
 */
export interface CarriedEscortEntry {
    player: string;
    uuid: string;
    entity: Entity;
}

/**
 * Where a hired or captured escort can be at the moment it is counted.
 * Every source is optional: a caller supplies what it can see, and an
 * escort in a source the caller cannot see is invisible to it (see
 * {@link cappedEscortCount} for what that costs each caller).
 */
export interface EscortCapSources {
    /**
     * The live world the player is in (or was just pulled out of): the
     * escorts still in flight, keyed by uuid. The simulation's entity
     * map on the sim side; the display world's on the client, which
     * carries PlayerEscort, BayFighter and MissionShip because all three
     * are synced.
     */
    world?: Iterable<[string, Entity]>;
    /**
     * The client's carried rosters — escorts that have left the world
     * to follow the player: touched down on the stellar the player is
     * docked at, or already warped out ahead of the player's own jump.
     */
    carried?: Iterable<CarriedEscortEntry>;
    /**
     * Pilots hired at the bar THIS landing, who have no entity until
     * lift-off spawns them (spaceport/pending_escorts.ts, plus the hire
     * dialog's own not-yet-committed list). A count, because there is
     * nothing to de-duplicate against: a hire is in exactly one of the
     * two lists at a time, and becomes a world entity only as the
     * component is popped.
     */
    pending?: number;
}

/**
 * THE ONE COUNT the cap is enforced against: how many of `player`'s
 * escorts count toward {@link MAX_ESCORTS} right now.
 *
 * An escort is counted whether it is a live entity in the world or a
 * roster record the client is carrying, and NEVER twice: the world and
 * the carried rosters are unioned by uuid, which the escort keeps as it
 * moves between them (EscortLandingSystem deletes it from the world and
 * hands the client the same uuid; lift-off re-inserts it under it). An
 * escort that is momentarily in both is still one escort — and it is,
 * routinely: the display frame that carries a landing event emits the
 * event (roster insert) BEFORE it applies the frame's removals
 * (communication/apply_simulation_frame.ts). Pending hires have no
 * entity and are added on top.
 *
 * THE LANDING / TAKE-OFF WINDOW. The player lands first; each escort
 * flies down after them and is moved from the world to the landed
 * roster as it touches down, over several seconds. Across that window
 * the count is constant for a fleet that survives it: an escort in
 * flight is in `world`, one that has landed is in `carried`, and each is
 * exactly one of the two. An escort shot down on the way in leaves the
 * count (it is in neither), which is right — it is gone. Take-off
 * reverses the moves with the same invariant. The bar therefore counts
 * from the display world AND the roster, and neither from the
 * EscortPayrollComponent mirror: that is the WAGE mirror, hired-only
 * (a captured prize draws no pay and is not in it) and frozen from the
 * moment the player left the world (an escort lost on the way down
 * stays in it), so it can both undercount and overcount the fleet the
 * cap is about.
 *
 * WHAT THE SIMULATION CANNOT SEE. The boarding gate runs in the
 * simulation, on every peer, and so may read only synced state: the
 * `world`. The client's rosters are not synced (they are per-player
 * client state, by design — see player_escort_plugin.ts), so an escort
 * that is on a roster while the player boards a hulk is invisible to
 * the capture gate. That is the residual window: the rosters are
 * drained the moment the player is back in a world and at rest
 * (browser.ts: lift-off, jump arrival, and the held batch of a
 * multi-jump chain or a gate arrival once carriedBatchSettled), but the
 * re-inserts arrive as input records a few ticks later, and a capture
 * assigned inside those ticks is counted against the world alone. A
 * boarding takes a disabled target, an approach, and three presses, so
 * the ticks are not a practical way past the cap; it is documented here
 * rather than closed because closing it would mean syncing the roster.
 */
export function cappedEscortCount(player: string,
    sources: EscortCapSources): number {
    const counted = new Set<string>();
    for (const [uuid, escort] of sources.world ?? []) {
        if (escort.components.get(PlayerEscortComponent)?.player !== player) {
            continue;
        }
        if (countsTowardEscortCap(escort)) {
            counted.add(uuid);
        }
    }
    for (const { player: owner, uuid, entity } of sources.carried ?? []) {
        if (owner !== player) {
            continue;
        }
        if (countsTowardEscortCap(entity)) {
            counted.add(uuid);
        }
    }
    return counted.size + (sources.pending ?? 0);
}
