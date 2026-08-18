/**
 * ============================================================================
 * "The player has already read this mission's ShipDoneText"
 * ============================================================================
 *
 * mïsn ShipDoneText is "The desc to show when you complete the special
 * ship goal" (EVN Bible), and the original shows it AT THAT MOMENT — the
 * tick the goal completes, in flight, with no landing in between. NovaJS
 * shows it there too: the goal completion is flagged in the shared
 * simulation (ShipObjective.shipDonePending) and the OWNER's display
 * presents the text off that flag (display/mission_ship_done_plugin.ts).
 *
 * The set string beside it, OnShipDone, still runs at the owner's next
 * DATE ADVANCE (jump or landing) — see runPendingShipDone — because it
 * needs the mission universe and a player entity the client may commit
 * to. That deferred pass also QUEUES a 'shipDone' event carrying the same
 * text, which is what the landing popups render. Without a word between
 * them the player would read the text twice: once in space and once on
 * the ground.
 *
 * This is that word. The display marks a mission id here the moment it
 * puts the text on screen; processInFlightMissions TAKES the mark at the
 * next date advance and drops the event's popup. Both halves run in the
 * same client process — the display world and the docked/jumping player
 * entity are the same browser tab — so a plain module-level set is the
 * whole mechanism, and nothing about it crosses the wire or enters the
 * simulation.
 *
 * WHY NOT SIMULATION STATE. Whether a popup has been read is not a fact
 * about the universe: it is local to one player's screen, it must not
 * make two peers' worlds differ, and it must not be replayed by the
 * rollback driver. The same reasoning keeps the përs hail-quote "already
 * said" record display-side (ship_mission_offer_plugin.ts).
 *
 * WHY TAKING (not merely reading) THE MARK. A mark is consumed by the
 * first date advance that sees it, so it cannot suppress a LATER
 * ShipDoneText — a mission whose goal completes twice cannot exist, but a
 * pilot swap or a mission id reused by a different plug-in set within the
 * same tab could otherwise leave a stale entry behind for good.
 *
 * NOT PERSISTED, deliberately. If the player quits between the goal
 * completing and the next jump or landing, the mark is gone and the
 * deferred event shows the text on the ground — the pre-existing
 * behaviour, and the right fallback: the text is shown once either way.
 */

/** mïsn ids whose ShipDoneText this client has already put on screen. */
const shown = new Set<string>();

/** The display has shown `missionId`'s ShipDoneText in flight. */
export function markShipDoneTextShown(missionId: string): void {
    shown.add(missionId);
}

/**
 * Whether `missionId`'s ShipDoneText has already been shown in flight,
 * consuming the mark. True means the deferred 'shipDone' event must not
 * put the same text on screen again.
 */
export function takeShipDoneTextShown(missionId: string): boolean {
    return shown.delete(missionId);
}

/** Drops every mark. For specs, and for a fresh pilot in the same tab. */
export function clearShipDoneTextShown(): void {
    shown.clear();
}
