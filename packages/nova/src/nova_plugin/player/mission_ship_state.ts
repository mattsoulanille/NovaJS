import * as t from 'io-ts';
import { map } from 'nova_ecs/datatypes/map';

/**
 * ============================================================================
 * Mission special-ship objectives: the per-mission progress state
 * ============================================================================
 *
 * A mission with special ships (mïsn ShipCount/ShipDude/ShipGoal)
 * carries a ShipObjective inside its ActiveMission. Everything the
 * SHARED simulation needs to evaluate the goal is frozen in here at
 * accept time (goal code, resolved spawn system, ship count), so the
 * sim never touches mission game data.
 *
 * This module is pure state + transitions with no ECS imports, so the
 * goal state machine is unit-testable and both the player-local
 * mission logic (mission_logic.ts) and the sim systems
 * (mission_ship_plugin.ts) can import it without cycles.
 *
 * The EVN Bible's goal codes (mïsn ShipGoal):
 *   -1 none      ships are scenery/ambushers; never block completion.
 *    0 destroy   "Destroy all the ships": each death counts; done when
 *                all ShipCount ships have died.
 *    1 disable   "Disable but don't destroy them": each ship counts
 *                the tick it becomes disabled. A ship destroyed before
 *                it was disabled makes the goal unachievable => the
 *                mission fails (at the next landing).
 *    2 board     "Board them": each ship counts the first time the
 *                MISSION'S OWNER boards it (mission_ship_plugin's
 *                MissionShipTrackSystem reads the shared BoardedComponent
 *                record). Offered — see goalSupported.
 *    3 escort    "Escort them (keep them from getting killed)": the
 *                goal never blocks completion; a mission ship dying
 *                fails the mission. Stock escort missions use ShipSyst
 *                -6 (follow the player), so the ships are respawned
 *                alongside the player in each system they enter.
 *    4 observe   "Observe them": a ship that cannot cloak is observed
 *                by merely sharing the system with the player; a
 *                cloak-capable ship must be seen up close while
 *                visible (OBSERVE_RANGE).
 *    5 rescue    "Rescue them (they start out disabled and stay that
 *                way until you board them)": the ships spawn as HULKS
 *                (mission_ship_spawn's makeMissionHulk) and each counts
 *                the first time the MISSION'S OWNER boards it, exactly
 *                like a board goal. Boarding also RESCUES it — the sim
 *                lifts the disable and it flies off under its own AI.
 *    6 chase off "Either kill them or scare them into jumping out of
 *                the system": a death OR a departure counts.
 *
 * Ships surviving after the goal completes LINGER: the Bible does not
 * say they leave, and the auto-abort flag's wording implies they stay
 * in play until the mission ends. They are despawned when their
 * owner's mission ends (which, since every mission-ending transition
 * happens while the owner is docked, is subsumed by the owner-absence
 * cleanup in mission_ship_plugin.ts).
 */

export const GOAL_NONE = -1;
export const GOAL_DESTROY = 0;
export const GOAL_DISABLE = 1;
export const GOAL_BOARD = 2;
export const GOAL_ESCORT = 3;
export const GOAL_OBSERVE = 4;
export const GOAL_RESCUE = 5;
export const GOAL_CHASE_OFF = 6;

/** Per-tracked-ship progress flags. */
export const ShipObjectiveLiveType = t.partial({
    /** The ship has been observed (GOAL_OBSERVE). */
    observed: t.boolean,
    /** The ship has been disabled (GOAL_DISABLE). */
    disabled: t.boolean,
    /** The ship has been boarded (GOAL_BOARD seam; see shipBoarded). */
    boarded: t.boolean,
});
export type ShipObjectiveLive = t.TypeOf<typeof ShipObjectiveLiveType>;

/**
 * The special-ship objective of one active mission. Serializable state
 * on the owner's MissionsComponent; mutated by the shared sim's goal
 * systems (identically on every peer) and read at landing.
 */
export const ShipObjectiveType = t.intersection([t.type({
    /** ShipGoal code (see the module comment). */
    goal: t.number,
    /**
     * The system the ships appear in, resolved and frozen at accept
     * time; null means ShipSyst -6, "whatever system the player is in".
     */
    systemId: t.union([t.string, t.null]),
    /** Where in the system the ships start (mïsn ShipStart). */
    shipStart: t.number,
    /** ShipBehav code (-1 standard; 0 attack player; 1 protect). */
    behavior: t.number,
    /** Global düde id the ships are drawn from. */
    dudeId: t.string,
    /** ShipCount. */
    total: t.number,
    /** Ships whose per-ship objective is done (killed/disabled/...). */
    satisfied: t.number,
    /** The goal is complete (never true for GOAL_ESCORT/GOAL_NONE). */
    complete: t.boolean,
    /** The goal can no longer be achieved; fail the mission on landing. */
    failed: t.boolean,
    /**
     * The ship goal has just completed and OnShipDone has not run yet
     * (it runs at the next date advance — the first jump or landing
     * after the goal completes).
     *
     * ALSO THE DISPLAY'S CUE for the mïsn ShipDoneText, which the
     * original shows at this very moment rather than at that landing:
     * the owner's client watches this flag and puts the text on screen
     * in flight (display/mission_ship_done_plugin.ts). Reading it is
     * player-local and changes nothing here — only runShipDoneIfPending
     * clears it.
     */
    shipDonePending: t.boolean,
    /** Live tracked mission ships (uuid -> per-ship flags). Cleared by
     * the owner's client before it re-enters a system. */
    live: map(t.string, ShipObjectiveLiveType),
}), t.partial({
    /**
     * mïsn Flags 0x0800: the special ships' class, drawn once from the
     * düde at the mission's first spawn and kept "whenever the special
     * ships for that mission are created, until the mission ends"
     * (mission_ship_spawn's freezeShipType). ADDITIVE: absent on
     * missions without the flag, and on those accepted before it was
     * modelled, which are frozen at their next spawn.
     */
    shipId: t.string,
})]);
export type ShipObjective = t.TypeOf<typeof ShipObjectiveType>;

/**
 * Goals the engine can evaluate; the rest stay unofferable.
 *
 * GOAL_BOARD (2) IS OFFERED (Matthew's ruling). It is evaluated end to
 * end: MissionShipTrackSystem reads the shared BoardedComponent and
 * credits a board by the owner (shipBoarded), and mïsn PickupMode 2
 * ("pick up when boarding special ship") loads the mission cargo at the
 * same moment. The reference case is stock mïsn 832, "Recover Stolen
 * Art" — Temmin Shard's Leviathan: AvailLoc 1 (in the bar), ShipGoal 2,
 * PickupMode 2, DropOffMode 1, whose QuickBrief reads "Disable and board
 * the Leviathan in the Arcturus system, pick up the stolen art and then
 * head to <RST> in the <RSY> system." Both halves of that sentence now
 * work.
 *
 * GOAL_RESCUE (5) is offered too. The Bible's "they start out disabled
 * and stay that way until you board them" maps exactly onto the HULK
 * state this engine already has for derelict-govt spawns (gövt Flags1
 * 0x0800): DisabledComponent with `hulk: true`, which ShipDisableSystem
 * refuses to lift however healthy the armor is, so only an external
 * repair — a boarding — brings it back. Stock mïsn 141/650/651/652
 * ("Refuel Trader") are the rescue missions.
 *
 * EVERY goal is supported now, so this predicate exists only as the one
 * place a future unsupported goal would be listed.
 */
export function goalSupported(goal: number): boolean {
    return goal === GOAL_NONE || goal === GOAL_DESTROY
        || goal === GOAL_DISABLE || goal === GOAL_BOARD
        || goal === GOAL_ESCORT || goal === GOAL_OBSERVE
        || goal === GOAL_RESCUE || goal === GOAL_CHASE_OFF;
}

/** Goals whose remaining ships count down as they are satisfied (the
 * owner's client spawns total - satisfied on each system entry). */
function countsDown(goal: number): boolean {
    return goal === GOAL_DESTROY || goal === GOAL_DISABLE
        || goal === GOAL_OBSERVE || goal === GOAL_CHASE_OFF
        || goal === GOAL_BOARD || goal === GOAL_RESCUE;
}

/** How many ships the owner's client should spawn on system entry. */
export function shipsToSpawn(objective: ShipObjective): number {
    if (objective.failed || objective.complete) {
        return 0;
    }
    if (!countsDown(objective.goal)) {
        return objective.total;
    }
    return Math.max(0, objective.total - objective.satisfied);
}

function updateCompletion(objective: ShipObjective): void {
    if (!objective.complete && countsDown(objective.goal)
        && objective.satisfied >= objective.total) {
        objective.complete = true;
        objective.shipDonePending = true;
    }
}

/** A newly inserted mission ship starts being tracked. */
export function registerShip(objective: ShipObjective, uuid: string): void {
    if (!objective.live.has(uuid)) {
        objective.live.set(uuid, {});
    }
}

/** A tracked ship died (the shared sim's DeathEvent). */
export function shipDied(objective: ShipObjective, uuid: string): void {
    const flags = objective.live.get(uuid);
    if (!flags) {
        return;
    }
    objective.live.delete(uuid);
    switch (objective.goal) {
        case GOAL_DESTROY:
        case GOAL_CHASE_OFF:
            objective.satisfied++;
            break;
        case GOAL_DISABLE:
            // Destroyed before it was disabled: unachievable.
            if (!flags.disabled) {
                objective.failed = true;
            }
            break;
        case GOAL_ESCORT:
            objective.failed = true;
            break;
        // GOAL_OBSERVE: an unobserved ship dying just leaves fewer to
        // observe now; the remainder respawn on the next system entry.
    }
    updateCompletion(objective);
}

/**
 * A tracked ship left the simulation without dying (an NPC jump-out,
 * or a flee that reached the system edge).
 */
export function shipDeparted(objective: ShipObjective, uuid: string): void {
    if (!objective.live.has(uuid)) {
        return;
    }
    objective.live.delete(uuid);
    if (objective.goal === GOAL_CHASE_OFF) {
        // "Scare them into jumping out of the system."
        objective.satisfied++;
    }
    updateCompletion(objective);
}

/** A tracked ship became disabled. */
export function shipDisabled(objective: ShipObjective, uuid: string): void {
    const flags = objective.live.get(uuid);
    if (!flags || flags.disabled) {
        return;
    }
    flags.disabled = true;
    if (objective.goal === GOAL_DISABLE) {
        objective.satisfied++;
        updateCompletion(objective);
    }
}

/**
 * A tracked ship has been boarded by the owner. Mirrors shipDisabled: one
 * board counts once — which is also all a ship ever gets, since a hulk's
 * plunder record is spent by its first boarding (boarding_component.ts).
 * Called by MissionShipTrackSystem off the shared BoardedComponent.
 *
 * Credits both boarding goals. GOAL_BOARD ("board them") and GOAL_RESCUE
 * ("they start out disabled and stay that way UNTIL YOU BOARD THEM")
 * differ only in how the ship starts out, never in what satisfies them.
 */
export function shipBoarded(objective: ShipObjective, uuid: string): void {
    const flags = objective.live.get(uuid);
    if (!flags || flags.boarded) {
        return;
    }
    flags.boarded = true;
    if (objective.goal === GOAL_BOARD || objective.goal === GOAL_RESCUE) {
        objective.satisfied++;
        updateCompletion(objective);
    }
}

/** A tracked ship has been observed by the owner. */
export function shipObserved(objective: ShipObjective, uuid: string): void {
    const flags = objective.live.get(uuid);
    if (!flags || flags.observed) {
        return;
    }
    flags.observed = true;
    if (objective.goal === GOAL_OBSERVE) {
        objective.satisfied++;
        updateCompletion(objective);
    }
}

/**
 * Whether the objective permits mission completion at the return
 * stellar: escort ships must merely have stayed alive; counting goals
 * must be complete; goalless ships never block.
 */
export function objectiveAllowsCompletion(objective: ShipObjective): boolean {
    if (objective.failed) {
        return false;
    }
    switch (objective.goal) {
        case GOAL_NONE:
        case GOAL_ESCORT:
            return true;
        default:
            return objective.complete;
    }
}
