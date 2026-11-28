import { Component } from 'nova_ecs/component';
import type { SystemMove } from '../nova_plugin/missions/index.js';

/**
 * ============================================================================
 * THE LANDED DEPARTURE: Qxxx / Mxxx / Nxxx run while the player is landed
 * ============================================================================
 *
 * The EVN Bible's three operators that take the player somewhere:
 *
 *   Mxxx  "move the player to system xxx. The player will be put on top of
 *         the first stellar in the system, or in the center of the system
 *         if no stellars exist there."
 *   Nxxx  "move the player to system xxx. The player will remain at the
 *         same x/y coordinates, relative to the center of the system."
 *   Qxxx  "make the player immediately leave (absquatulate) whatever
 *         stellar he's landed on and return to space, and show a message
 *         at the bottom of the screen. The message is randomly selected
 *         from the STR# resource with ID xxx, and is parsed for mission
 *         text tags (e.g. <PSN> and <PRK>)"
 *
 * In flight they are the in-flight accept's business (the move rides the
 * accept record, MissionSystemMoveSystem; a Q only shows its message,
 * there being no stellar to leave — ship_mission_accept.ts). Landed, every
 * set string the landing's transaction runs — a completion's OnSuccess in
 * the landing pass, an OnAccept / OnRefuse at a popup, the bar or the BBS,
 * an outfit's OnPurchase — RECORDS its request here, on the transaction's
 * session (LandedTransaction wires the hooks, and a savepoint rollback
 * undoes a request with everything else the venue did):
 *
 *  - A Q asks the spaceport to leave AFTER THE CURRENT DIALOG: the dialog
 *    the string ran under (the completion text, the briefing) is shown,
 *    nothing further is put to the player (no more offers, the venue
 *    closes), and the spaceport departs through its ordinary Leave — the
 *    same settlements, the same lift-off path, the same checkpoint.
 *    Stock's finales: the last mission of every main string completes
 *    with `M472 Q25048` (mïsn nova:686, the Auroran finale; 354, 381, 417,
 *    474, 712, 887), "A mysterious force transports you to an unknown
 *    location...".
 *  - An M / N names where that departure goes: instead of lifting off
 *    into the system the stellar is in, the ship is carried to the named
 *    system (client/transit.ts followSpaceportSystemMove), on top of its
 *    first stellar for M and at the stellar's own x/y for N. The last one
 *    run wins. An M / N WITHOUT a Q (ARPIA's mïsn 1034 OnSuccess `M773`,
 *    Extra Outfits' "Buy Station" oütf 552 OnPurchase `N800`) does not
 *    end the visit: the player stays landed, and their next Leave takes
 *    them to the named system. MEASURED (reference "M / N without Q while
 *    landed (ncbops)"): the original moves him AT ONCE but leaves him
 *    docked — the spaceport stays up under the old stellar's name, the
 *    map opened from it already reads the destination as "Current
 *    System" (LandedTransaction.movedToSystem, OpenStarmapOptions
 *    .currentSystemId), and the Leave launches there; no date, no fuel.
 *    An oütf's OnPurchase / OnSell `Mxxx` launches at the docked
 *    stellar's x/y, exactly where an `Nxxx` does (outfitter.ts), and a Q
 *    there ejects the player straight from the outfitter.
 */
export interface LandedDeparture {
    /** A Qxxx ran: leave the stellar after the current dialog. */
    leave: boolean;
    /** Every Qxxx's STR# (and the running plug-in, for its bare number),
     * in the order they ran: one status-line message each. */
    quotes: { stringId: number, prefix: string }[];
    /** The last Mxxx / Nxxx, resolved stock-first. */
    move?: SystemMove;
}

export function emptyDeparture(): LandedDeparture {
    return { leave: false, quotes: [] };
}

export function cloneDeparture(departure: LandedDeparture): LandedDeparture {
    return {
        leave: departure.leave,
        quotes: departure.quotes.map(quote => ({ ...quote })),
        ...(departure.move ? { move: { ...departure.move } } : {}),
    };
}

/** Whether `departure` changes the lift-off at all. */
export function departureRequested(departure: LandedDeparture): boolean {
    return departure.leave || departure.move !== undefined
        || departure.quotes.length > 0;
}

/**
 * What the spaceport's Leave hands the client's lift-off, on the departing
 * hull: where the ship goes (an M / N) and the Q messages, already picked
 * and expanded, for the status line once the ship is in space.
 *
 * DISPLAY-SIDE BOOKKEEPING, like PendingEscortsComponent: the client pops
 * it before the hull is encoded into any insertion record
 * (client/docking.ts onLeaveSpaceport), and it is not part of SaveData.
 */
export interface PendingDeparture {
    move?: SystemMove;
    statusMessages: string[];
}

export const PendingDepartureComponent =
    new Component<PendingDeparture>('PendingDeparture');
