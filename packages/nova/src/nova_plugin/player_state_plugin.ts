import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { ShipObjectiveType } from './mission_ship_state.js';

/**
 * Serializable per-player gameplay state: the game date, credits, and
 * mission/cron progress. Like the control bits (ncb_plugin.ts), these
 * live on the player's ship entity and follow the player across ship
 * trades and system jumps.
 *
 * Almost nothing inside the simulation reads or writes these
 * components: the date advances at jump/landing transitions and
 * missions change while docked, both of which happen player-locally
 * while the entity is outside the simulation world (the
 * spaceport/outfitter commit pattern). The one exception is the
 * ShipObjective inside an ActiveMission: mission special-ship goal
 * progress accrues from SHARED sim events (deaths, disables), so the
 * shared goal systems (mission_ship_plugin.ts) mutate it identically
 * on every peer. The components are serializer-registered so they
 * ride through rollback snapshots, wire snapshots, and multiplayer
 * sync unchanged.
 */

export const GameDateType = t.type({
    /** Day of the month, 1-31. */
    day: t.number,
    /** Month, 1-12. */
    month: t.number,
    year: t.number,
});
export type GameDateState = t.TypeOf<typeof GameDateType>;
export const GameDateComponent = new Component<GameDateState>('GameDate');

export const CreditsType = t.type({
    credits: t.number,
});
export type Credits = t.TypeOf<typeof CreditsType>;
export const CreditsComponent = new Component<Credits>('Credits');

/**
 * The runtime state of one accepted mission. Static data stays in
 * MissionData (fetched by id); this records only what the player has
 * done with it. Random choices (destination, cargo quantity) are
 * resolved at accept time and frozen here.
 */
export const ActiveMissionType = t.intersection([t.type({
    /** MissionData id, e.g. 'nova:128'. */
    id: t.string,
    /** Absolute day number (calendar.ts) when the mission was accepted. */
    acceptedDay: t.number,
    /** Planet id where the mission was accepted. */
    acceptedAt: t.string,
    /** Resolved travel destination planet id, or null for none. */
    travelPlanet: t.union([t.string, t.null]),
    /** Resolved return-for-payment planet id, or null for none. */
    returnPlanet: t.union([t.string, t.null]),
    /** Resolved cargo type (0-255), or -1 for none. */
    cargoType: t.number,
    /** Resolved cargo quantity in tons; 0 when no cargo. */
    cargoQty: t.number,
    /** Whether the mission cargo is currently aboard. */
    cargoLoaded: t.boolean,
    /** Whether the travel destination has been visited (and its cargo
     * pickup/drop-off performed). */
    travelDone: t.boolean,
    /** Absolute day number after which the mission fails, or null. */
    deadlineDay: t.union([t.number, t.null]),
}), t.partial({
    /**
     * Special-ship goal progress (mission_ship_state.ts). Absent for
     * missions without special ships. The shared sim's goal systems
     * mutate this identically on every peer.
     */
    shipObjective: ShipObjectiveType,
    /**
     * The DEFERRED auto-abort (mïsn Flags 0x0001): this mission
     * auto-aborts "after the special ship is boarded" rather than at
     * accept, because its SpecialShipGoal is board or rescue. Frozen at
     * accept, with the two numeric effects the SIMULATION applies on that
     * boarding beside it (see MissionShipTrackSystem's rescueBoarded).
     */
    autoAbortOnBoard: t.boolean,
    /** mïsn Flags2 0x0002, "Apply mission Pay on auto-abort": the credits
     * to hand over when the deferred auto-abort fires. */
    autoAbortPay: t.number,
    /**
     * The same flag's NEGATIVE PayVal sibling: the percent of the player's
     * cash to take when the deferred auto-abort fires (PayVal -40001..
     * -40099). Decoded at accept — the simulation cannot read a mïsn — and
     * absent both when the mission pays instead and in saves written before
     * this field existed, which decode unchanged.
     */
    autoAbortTakePercent: t.number,
    /** mïsn Flags 0x0008, "Mission takes away 100 units of fuel upon
     * auto-abort": the fuel to deduct when it fires. */
    autoAbortFuel: t.number,
    /**
     * The deferred auto-abort has fired in the simulation; the
     * player-local half (the OnAbort set string, dropping the mission,
     * its popup) still has to run at the owner's next date advance. The
     * same shape as the objective's `shipDonePending`.
     */
    autoAbortPending: t.boolean,
    /**
     * mïsn PickupMode 2, "Pick up when boarding special ship", frozen at
     * accept time. The pickup happens in the shared simulation the tick
     * the owner boards the special ship (MissionShipTrackSystem), and the
     * sim never reads mission game data — the same reason
     * failIfPlayerDisabledOrDestroyed is frozen here.
     */
    pickupOnBoard: t.boolean,
    /**
     * Frozen at accept time from the mïsn Flags2 0x0004 bit
     * ("mission fails if player is disabled or destroyed"). The shared
     * sim reads this to decide whether a player disable/destroy should
     * fail the mission, without needing the mission game data.
     */
    failIfPlayerDisabledOrDestroyed: t.boolean,
    /**
     * Set true by the shared sim when a fail condition it can observe
     * has occurred (the owner was disabled or destroyed while
     * failIfPlayerDisabledOrDestroyed is set). Landing processing turns
     * this into an actual failure (OnFailure, failure notice). Mirrors
     * the shipObjective.failed marker for special-ship goals.
     */
    failed: t.boolean,
    /**
     * The special ships' name, drawn from the mïsn's ShipNameID STR#
     * list when the mission was accepted (mission_logic.ts). This is
     * the <SN> wildcard's value and the name every special ship of
     * this mission is spawned with. Absent when the mission has no
     * name list (ShipNameID -1) — and absent in saves written before
     * <SN> existed, which decode unchanged.
     */
    shipName: t.string,
    /**
     * The special ships' subtitle, drawn from the mïsn's ShipSubtitle
     * STR# list at accept — the sibling of shipName ("Tells Nova which
     * subtitle, if any, to use for the special ships"), shown under the
     * name in the target pane the way a përs subtitle is. Absent when
     * the mission has no subtitle list (ShipSubtitle -1), and absent in
     * older saves, which decode unchanged.
     */
    shipSubtitle: t.string,
})]);
export type ActiveMission = t.TypeOf<typeof ActiveMissionType>;

/** EV Nova allows at most 16 concurrently active missions. */
export const MAX_ACTIVE_MISSIONS = 16;

/** Active missions keyed by mission id (a mission can't be active twice). */
export const MissionsType = map(t.string, ActiveMissionType);
export type Missions = t.TypeOf<typeof MissionsType>;
export const MissionsComponent = new Component<Missions>('Missions');

/**
 * Per-player crön progress. `nextEligible` throttles re-activation
 * (postHoldoff); `phaseStart` is the day the current phase began.
 */
export const CronStateType = t.type({
    /** 'idle' | 'pre' (activated, holding off) | 'active'. */
    phase: t.union([t.literal('idle'), t.literal('pre'), t.literal('active')]),
    /** Absolute day the current phase began. */
    phaseStart: t.number,
    /** First absolute day the cron may activate (again). */
    nextEligible: t.number,
});
export type CronState = t.TypeOf<typeof CronStateType>;

export const CronStatesType = map(t.string, CronStateType);
export type CronStates = t.TypeOf<typeof CronStatesType>;
export const CronStatesComponent = new Component<CronStates>('CronStates');

/**
 * A mission event (completed / failed / ... ) generated while the
 * player was NOT at a spaceport screen — e.g. a deadline that expired
 * mid-flight during a jump's date advance. Queued here on the entity
 * and drained into the spaceport notices at the next landing so the
 * player still sees "Mission failed: ...". Kept minimal and
 * serializer-registered so it rides through rollback/sync like the
 * other player-state components.
 */
export const PendingMissionNoticeType = t.intersection([t.type({
    missionId: t.string,
    missionName: t.string,
    type: t.string,
    text: t.string,
}), t.partial({
    payment: t.number,
    /** Global PICT id of the dësc Graphic paired with `text` (fail /
     * shipDone picts queued mid-flight), absent when the dësc has none. */
    pict: t.string,
    /** <SN> value for the notice's text (additive; older records simply
     * fall back to the generic phrase). */
    specialShipName: t.string,
})]);
export type PendingMissionNotice = t.TypeOf<typeof PendingMissionNoticeType>;
export const PendingMissionNoticesType = t.array(PendingMissionNoticeType);
export type PendingMissionNotices =
    t.TypeOf<typeof PendingMissionNoticesType>;
export const PendingMissionNoticesComponent =
    new Component<PendingMissionNotices>('PendingMissionNotices');

/**
 * The special ships of a mission that auto-aborted the moment it was
 * accepted WHILE DOCKED (mïsn Flags 0x0001 in its immediate form), waiting
 * for the lift-off that will spawn them.
 *
 * The Bible calls the immediate auto-abort "sometimes useful to create
 * special ships" and requires special ships for it to trigger at all: the
 * ships ARE the mission. Stock nova:614-629 — the sixteen "Avoid
 * Federation Task Force / Rebel Enforcement Squad / ..." missions the
 * crime-tier bits offer at the main spaceport — are ShipCount 3-10,
 * ShipSyst -6 (follow the player), invisible and cantRefuse: the popup is
 * the "a squad has been dispatched to hunt you" warning and the squad is
 * the point. An auto-aborted mission never joins MissionsComponent, which
 * is what buildMissionShipSpawns walks at every system entry, so without
 * this the warning showed and no squad ever came. The IN-FLIGHT accept
 * (ship_mission_accept.ts) already keeps the offer's frozen objective for
 * the same reason; this is the docked counterpart, in the same shape.
 *
 * Written by MissionSession.commit from the working state acceptOffer
 * pushed to; drained by buildMissionShipSpawns at the owner's next system
 * entry (the lift-off), BEFORE the entity is encoded into its insertion
 * record, so it never reaches a peer. Serializer-registered all the same,
 * like PendingMissionNotices, so a rollback snapshot or a docked mirror
 * carries it unchanged. Carried onto a hull bought before lift-off
 * (shipyard_rules.ts CARRIED_COMPONENTS) and written into the pilot save
 * while non-empty (save_game.ts `autoAbortShips`), so neither a shipyard
 * visit nor a save-and-quit between the warning and the lift-off loses
 * the squad. (The notices are still not saved; that gap stands.)
 */
export const PendingAutoAbortShipType = t.intersection([t.type({
    /** The auto-aborted mïsn, for the düde / aux / name lookups. */
    missionId: t.string,
    /** The offer's frozen objective (spawn system, düde, count, ...). */
    shipObjective: ShipObjectiveType,
    travelPlanet: t.union([t.string, t.null]),
    returnPlanet: t.union([t.string, t.null]),
}), t.partial({
    /** The <SN> pick the auto-abort notice showed, so the ships wear it. */
    shipName: t.string,
    shipSubtitle: t.string,
})]);
export type PendingAutoAbortShip = t.TypeOf<typeof PendingAutoAbortShipType>;
export const PendingAutoAbortShipsType = t.array(PendingAutoAbortShipType);
export type PendingAutoAbortShips =
    t.TypeOf<typeof PendingAutoAbortShipsType>;
export const PendingAutoAbortShipsComponent =
    new Component<PendingAutoAbortShips>('PendingAutoAbortShips');

export const PlayerStatePlugin: Plugin = {
    name: 'PlayerStatePlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        deltaMaker.addComponent(GameDateComponent, {
            componentType: GameDateType,
        });
        deltaMaker.addComponent(CreditsComponent, {
            componentType: CreditsType,
        });
        deltaMaker.addComponent(MissionsComponent, {
            componentType: MissionsType,
        });
        deltaMaker.addComponent(CronStatesComponent, {
            componentType: CronStatesType,
        });
        deltaMaker.addComponent(PendingMissionNoticesComponent, {
            componentType: PendingMissionNoticesType,
        });
        deltaMaker.addComponent(PendingAutoAbortShipsComponent, {
            componentType: PendingAutoAbortShipsType,
        });
    }
};
