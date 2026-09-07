import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { replaceEscortShipClass } from '../nova_plugin/escorts/escort_action.js';
import {
    escortProvenance, PlayerEscort, PlayerEscortComponent,
} from '../nova_plugin/player/player_escort.js';
import { ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { escortSellValue, escortUpgradeCost } from './escort_fees.js';

/**
 * ============================================================================
 * Settling the escort deals the player queued — at the shipyard
 * ============================================================================
 *
 * Upgrading and selling an escort are DEFERRED in the original: pressing
 * the button over the comm channel only queues the deal ("Will be upgraded
 * at next shipyard" / "Will be sold off at next shipyard" — STR# 2002 291
 * and 294), and nothing happens until the player next puts down somewhere
 * with a shipyard. nova_plugin/escorts/escort_action.ts writes the two flags; THIS
 * module is the other end, where the money moves.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RUNS ON THE CLIENT'S LANDED ROSTER
 * ---------------------------------------------------------------------------
 *
 * Because that is where the escorts ARE. An escort that lands with its
 * player is serialized out of the simulation and held whole on the owning
 * client (spaceport/landed_escorts.ts's CarriedEscort roster, driven from
 * browser.ts) until the lift-off puts it back. While it is on that roster
 * it is not in any world, so nothing in the simulation could refit it.
 *
 * That is not a special case — it is how the entire spaceport economy
 * works. The docked player's own entity is out of the world too, and every
 * purchase the player makes while landed (a hull, an outfit, a hold full of
 * food, a refuel) is applied to that held entity and reaches the other
 * peers as part of the `addEntity` record that puts it back at lift-off.
 * A settled escort deal rides exactly the same way: the credits change on
 * the held player entity, the class swap changes the held escort entity,
 * and both are encoded into the insertion records the launch schedules.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 * ---------------------------------------------------------------------------
 *
 *  - ONLY AT A SHIPYARD (spöb hasShipyard). Landing anywhere else does
 *    nothing at all and leaves every deal queued — the caller decides that;
 *    this function is only called when there is a shipyard.
 *  - A SALE pays the escort's shïp EscSellValue and REMOVES it from the
 *    roster, which is the whole of "it does not lift off with you": the
 *    roster is the only thing that would have put it back in the world.
 *    Anything in its hold goes with it (Matthew's ruling — the cargo is
 *    aboard the ship being sold), and so does any wing of its own, for the
 *    same reason releaseEscort un-marks a released carrier's fighters: they
 *    were the player's only through their carrier.
 *  - AN UPGRADE charges the escort's shïp EscUpgrdCost and swaps the class
 *    through the same replaceEscortShipClass the simulation uses, cargo
 *    clamp included.
 *  - A SALE WINS over an upgrade if both are somehow set. They are mutually
 *    exclusive by construction (queueing either clears the other), so this
 *    is only reachable through a hand-edited save; selling is the reading
 *    that cannot leave the player holding a hull they did not want.
 *  - INSUFFICIENT CREDITS: the upgrade is SKIPPED AND STAYS QUEUED. The
 *    player can come back when they can afford it — a deal they never got
 *    is not a deal they should lose. (A sale never fails this way: it pays
 *    the player.)
 *  - A STALE TARGET IS DROPPED. `pendingUpgrade` stores the class resolved
 *    when the button was pressed; if the escort's CURRENT shïp UpgradeTo no
 *    longer names it (the escort changed class some other way), the queue
 *    is cleared rather than honoured. Charging one class's price for
 *    another class's hull is the failure this exists to prevent.
 *  - A SALE OF A HIRED ESCORT IS DROPPED, not paid: a hired pilot's hull
 *    was never the player's. The flag can only be a hired escort's through
 *    a capture that was later re-classified, or a hand-edited save, but the
 *    rule is re-checked here rather than trusted from the flag — the same
 *    policy applyEscortAction follows.
 *  - AN ESCORT WHOSE HOLD IS OPEN IN A VENUE IS SKIPPED ENTIRELY, flags and
 *    all, and retried on the next docked frame. The trade center checks out
 *    working copies of the landed escorts' holds when it opens and writes
 *    them back at Done (fleet_cargo.ts); settling a SALE in between would
 *    splice the escort off the roster while the exchange was still filling
 *    its hold, and the exchange would then commit that cargo onto an entity
 *    nothing will ever lift off — goods gone, credits spent. An UPGRADE is
 *    frozen for the same reason: it rewrites the escort's own cargo (the
 *    class swap clamps it to the new hull) and its capacity, both of which
 *    the open hold would overwrite from a copy taken before the swap.
 *    Freezing costs nothing: the settlement runs on EVERY docked frame, so
 *    "retry next frame" means the deal lands the moment Done releases the
 *    hold, and these deals have already waited since the last shipyard.
 *
 * TWO THINGS ARE DELIBERATELY NOT RE-CHECKED HERE.
 *
 *  - THE TARGET HULL'S OWN GATES (shïp Require / Availability, which
 *    hail_dialog_plugin's escortUpgradeOffer applies before the button is
 *    offered at all). They gate the OFFER, the way they gate a shipyard's
 *    grid; a deal already struck is not re-litigated because the player
 *    sold the outfit whose Contribute unlocked the class. If that turns
 *    out to be wrong, this is where the check goes — the gates are pure
 *    (shipyard_stock_rules.ts) and the docked player entity is right here.
 *  - THE SETTLING STELLAR'S PriceMod. The comm box quoted the player a
 *    figure before they committed; see escort_fees.ts's ruling.
 *
 * Prices come from escort_fees.ts, the one module that owns them, and are
 * taken at the LIST price.
 *
 * Order is the ROSTER's order, which is the order the escorts landed in and
 * is the same on every replay of this client's session. Nothing here reads
 * a clock or a PRNG.
 */

/** The shape of a landed-roster entry this settlement needs. */
export interface EscortDealEntry {
    /** The player ship uuid this escort belongs to. */
    player: string;
    /** The uuid the escort had before it left the simulation. */
    uuid: string;
    /** The escort's full serialized entity. */
    entity: Entity;
}

/** What one settled sale paid. */
export interface SettledSale {
    uuid: string;
    /** The escort's ship class as it was sold. */
    shipId: string | undefined;
    /** Credits paid to the player (shïp EscSellValue). */
    value: number;
    /** Its own wing, dropped from the roster with it. */
    withCarrier: string[];
}

/** What one settled upgrade cost. */
export interface SettledUpgrade {
    uuid: string;
    /** The class it was flying. */
    fromShip: string | undefined;
    /** The class it is flying now. */
    toShip: string;
    /** Credits taken from the player (shïp EscUpgrdCost). */
    cost: number;
}

export interface EscortDealSettlement {
    sold: SettledSale[];
    upgraded: SettledUpgrade[];
    /**
     * The NET change to the player's credits: sale proceeds minus upgrade
     * costs. Applied by the caller to the docked player's entity, which is
     * the only thing that knows where the credits live while landed.
     */
    credits: number;
}

/**
 * The upgrade classes this roster's queued deals will need built, so the
 * caller can load their game data before calling {@link settleEscortDeals}
 * (which must be synchronous — it mutates a roster the frame loop owns).
 *
 * Deliberately not filtered by the stale-target or affordability rules:
 * loading a class that then turns out not to be needed costs a cache entry,
 * while missing one silently leaves a legitimate deal queued forever.
 * Sorted and de-duplicated so the loads are a fixed set.
 */
export function queuedUpgradeTargets(roster: readonly EscortDealEntry[],
    player: string): string[] {
    const targets = new Set<string>();
    for (const entry of roster) {
        if (entry.player !== player) {
            continue;
        }
        const pending = entry.entity.components
            .get(PlayerEscortComponent)?.pendingUpgrade;
        if (pending !== undefined) {
            targets.add(pending);
        }
    }
    return [...targets].sort();
}

/**
 * Writes an escort's ownership marker with the queued-deal flags cleared.
 * Deleting rather than writing `undefined` keeps the encoded shape (and so
 * the desync hash) identical to an escort that never had a deal queued —
 * the same rule escort_action.ts's setEscortDeal follows.
 */
function clearDeals(entity: Entity, marker: PlayerEscort): void {
    const next: PlayerEscort = { ...marker };
    delete next.pendingUpgrade;
    delete next.pendingSale;
    entity.components.set(PlayerEscortComponent, next);
}

/**
 * Every roster entry whose parent chain reaches `uuid` — a sold carrier's
 * own wing, which goes with it.
 *
 * The walk is over the roster's PRE-DEPARTURE uuids, which is the space
 * `PlayerEscort.parent` names while an escort is carried (the re-insertion
 * remaps them only as it puts the batch back down). Bounded by the roster
 * length: each pass adds at least one entry or stops.
 */
function wingOf(roster: readonly EscortDealEntry[], uuid: string): Set<string> {
    const inSubtree = new Set<string>([uuid]);
    for (let grew = true; grew;) {
        grew = false;
        for (const entry of roster) {
            if (inSubtree.has(entry.uuid)) {
                continue;
            }
            const parent = entry.entity.components
                .get(PlayerEscortComponent)?.parent;
            if (parent !== undefined && inSubtree.has(parent)) {
                inSubtree.add(entry.uuid);
                grew = true;
            }
        }
    }
    inSubtree.delete(uuid);
    return inSubtree;
}

/**
 * Settles every queued deal on `roster` belonging to `player`, MUTATING the
 * roster (sold escorts and their wings are spliced out) and the escort
 * entities (an upgraded escort's class is replaced in place).
 *
 * `credits` is what the player has right now; upgrades are refused — and
 * left queued — once the running balance cannot cover the next one, which
 * is why the balance is tracked here rather than checked once up front.
 * Sales are settled FIRST for the same reason: a player who queued a sale
 * and an upgrade in the same trip meant to pay for the second with the
 * first, and the original's own message pair ("sold for a profit of" /
 * "upgraded at a cost of", STR# 2002 299-300) reports them in that order.
 *
 * `getShip` must already have the classes {@link queuedUpgradeTargets}
 * named; a class it cannot produce leaves that upgrade queued (better to
 * settle it on the next visit than to refit against a cold cache).
 *
 * Returns what happened, so the caller can report it and apply the net
 * credits. Every deal that is settled or dropped has its flag cleared, so
 * calling this again on the same roster is a no-op — which matters,
 * because the client calls it on every frame it is docked at a shipyard
 * (escorts keep touching down while the player shops).
 */
export function settleEscortDeals(roster: EscortDealEntry[], player: string,
    credits: number,
    getShip: (id: string) => ShipData | undefined,
    /**
     * Whether an escort's hold is checked out by an open venue right now, in
     * which case its deals are left QUEUED and retried on the next docked
     * frame (see the module comment's rule, and LandedTransaction.holdOpen
     * in landed_transaction.ts). Omitted — every unit test, and any caller
     * with no venue — freezes nothing.
     */
    holdOpen: (uuid: string) => boolean = () => false):
    EscortDealSettlement {
    const settlement: EscortDealSettlement =
        { sold: [], upgraded: [], credits: 0 };
    let balance = credits;

    // ── Sales first (they fund the upgrades; see above) ──────────────────
    for (const entry of [...roster]) {
        const marker = entry.entity.components.get(PlayerEscortComponent);
        if (entry.player !== player || !marker?.pendingSale) {
            continue;
        }
        // The sale takes the escort's whole WING with it, so any open hold
        // anywhere in that subtree freezes the sale — the exchange would
        // otherwise commit a hold onto an entity this splice removed.
        if (holdOpen(entry.uuid)
            || [...wingOf(roster, entry.uuid)].some(holdOpen)) {
            continue; // Frozen: stays queued, retried next frame.
        }
        clearDeals(entry.entity, marker);
        if (escortProvenance(entry.entity) !== 'captured') {
            continue; // Never the player's to sell; the flag just goes.
        }
        const shipData = entry.entity.components.get(ShipDataComponent);
        if (!shipData) {
            continue; // Nothing to price it by; the deal simply lapses.
        }
        const value = escortSellValue(shipData);
        const wing = wingOf(roster, entry.uuid);
        for (let i = roster.length - 1; i >= 0; i--) {
            if (roster[i] === entry || wing.has(roster[i].uuid)) {
                roster.splice(i, 1);
            }
        }
        balance += value;
        settlement.credits += value;
        settlement.sold.push({
            uuid: entry.uuid, shipId: shipData.id, value,
            withCarrier: [...wing].sort(),
        });
    }

    // ── Then the upgrades ────────────────────────────────────────────────
    for (const entry of roster) {
        const marker = entry.entity.components.get(PlayerEscortComponent);
        const pending = marker?.pendingUpgrade;
        if (entry.player !== player || !marker || pending === undefined) {
            continue;
        }
        if (holdOpen(entry.uuid)) {
            // The class swap rewrites this escort's cargo and capacity; an
            // open hold would overwrite both from a pre-swap copy. Stays
            // queued until Done releases it.
            continue;
        }
        const shipData = entry.entity.components.get(ShipDataComponent);
        if (!shipData) {
            continue; // Not fully built; try again next landing.
        }
        if (shipData.escortUpgradeShip !== pending) {
            // STALE: this escort is no longer the ship the deal was struck
            // for. Drop the queue rather than charge one class's price for
            // another class's hull.
            clearDeals(entry.entity, marker);
            continue;
        }
        const upgraded = getShip(pending);
        if (!upgraded) {
            continue; // Class not loaded; stays queued.
        }
        const cost = escortUpgradeCost(shipData);
        if (balance < cost) {
            continue; // Can't pay today; stays queued (Matthew's ruling).
        }
        balance -= cost;
        settlement.credits -= cost;
        settlement.upgraded.push({
            uuid: entry.uuid, fromShip: shipData.id, toShip: pending, cost,
        });
        // Clear the flags BEFORE the swap: replaceEscortShipClass leaves
        // the ownership marker alone, but reading the marker after the
        // class has moved would invite exactly the confusion the stale
        // check above exists to catch.
        clearDeals(entry.entity, marker);
        replaceEscortShipClass(entry.entity, pending, upgraded);
    }

    return settlement;
}
