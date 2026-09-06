import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ReturnWhenTargetRemovedComponent } from '../nova_plugin/bay_plugin.js';
import { Cargo, CargoComponent, cargoUsed } from '../nova_plugin/cargo_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import {
    TradeGood, TradeWorkingState, freeCargoSpace,
} from '../nova_plugin/trade_logic.js';
import { computeCargoCapacity } from './mission_session.js';

/**
 * ============================================================================
 * Fleet cargo: the player's escorts carry trade goods
 * ============================================================================
 *
 * The original's trade center trades against the whole FLEET, not just the
 * player's own hold. Ground truth, EVN Bible shïp InherentAI (~line 2479):
 *
 *   "only ships with inherent AI of 1 or 2 can be used to carry cargo
 *    when they are the player's escorts"
 *
 * and the stock strings the exchange composes its readout from (STR# 2002):
 * 197 "In Fleet:" (in place of 198 "In Hold:"), 363 "Free cargo space",
 * 364 "in your ship", 365 "in your fleet". The reference screenshots show
 * exactly how they compose — trade_center/earth_trade_center.png:
 *
 *   Commodity:                        In Fleet:    Price:
 *   ...
 *   Free cargo space in your ship: 15 tons
 *   Free cargo space in your fleet: 390 tons
 *
 * and trade_center/390_medical_supplies.png is the same pilot after buying
 * 390 tons of Medical Supplies in ONE transaction: both readouts go to 0
 * and the "In Fleet:" column shows 390, of which only 15 tons could
 * possibly be aboard the player's 15-ton hull. So a purchase spills into
 * the escorts, and the column is a fleet total.
 *
 * ---------------------------------------------------------------------------
 * WHAT FLEET CARGO IS *NOT* PART OF (Matthew's rule)
 * ---------------------------------------------------------------------------
 * Fleet space is for goods bought at an exchange, and nothing else:
 *
 *  - MISSION CARGO goes on the player's ship only. It lives under
 *    'mission:*' keys, which are never TradeGood keys, and this module
 *    refuses to write one into an escort hold even if handed one
 *    ({@link isMissionCargoKey}). Mission acceptance therefore keeps
 *    testing the player's own free space (mission_logic /
 *    MissionSession, which read the docked entity).
 *  - THE OUTFITTER never sees it. `outfitter_rules.freeMass` / `freeCargo`
 *    read only the docked ship's hull and installed outfits, so a mass
 *    expansion, a retool, or any freeCargo outfit is judged against the
 *    player's ship alone. Nothing here is wired into that context, and
 *    {@link shipFreeSpace} exists so callers that must stay ship-local
 *    have an obvious spelling for it.
 *  - JETTISON / PLUNDER / SCOOP stay ship-local: they act on a ship in
 *    the SIMULATION (asteroid_plugin's ScoopSystem, boarding_plugin's
 *    plunderCargo), which only ever reads one entity's own
 *    CargoComponent. The Bible says nothing about routing them through a
 *    fleet, and doing so would put a UI-side model into the sim.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE CARGO PHYSICALLY LIVES
 * ---------------------------------------------------------------------------
 * In the escort's OWN `CargoComponent`. Escorts are carried as whole
 * serialized entities (spaceport/landed_escorts.ts) and saved that way
 * (nova_plugin/save_game.ts's SavedEscort), and CargoComponent is
 * serializer-registered, so escort cargo needs no new persisted shape and
 * no new save version: it rides inside the record that already exists.
 *
 * That also gives the original's loss rule for free: an escort that is
 * destroyed is not in the world and not on any roster, so
 * `collectEscortsToSave` never sees it and its cargo is simply gone. This
 * is a DECISION where the Bible is silent (it documents EscSellValue and
 * upgrades but never says what happens to a dead escort's hold);
 * "cargo aboard a lost escort is lost" is the reading that needs no extra
 * bookkeeping and matches the fiction.
 *
 * ONLY LANDED ESCORTS TRADE. The holds come from the client's landed
 * roster — escorts that put down on the same rock as the player. An
 * escort still in flight above the port is SIMULATION state that every
 * peer owns; writing its hold from a UI dialog would be a desync. An
 * escort in another system is not at the market at all. The roster is
 * snapshotted when the exchange opens, so an escort that touches down
 * mid-visit joins the fleet on the next visit (deliberate: a working
 * trade session cannot grow a hold underneath itself).
 *
 * DOCUMENTED GAP: an escort HIRED at the bar during this same landing is
 * still only a ship id on PendingEscortsComponent — it has no entity, and
 * so no hold, until it spawns beside the player at lift-off. Its space is
 * therefore available from the next landing on, not this one. Closing that
 * would mean materializing hired escorts while docked, which is a bigger
 * change than the space is worth.
 *
 * DETERMINISM. Nothing here runs in the simulation. Holds are edited on
 * client-local roster entities while docked and are re-inserted with the
 * escort at lift-off through the normal addEntity input record, so every
 * peer sees the same escort with the same cargo. Cargo does not enter
 * `ShipPhysicsComponent`, so no mass changes (the original ignores cargo
 * mass too — shïp Mass is a fixed field).
 */

/**
 * The inherent AI types whose ships can carry cargo as player escorts
 * (shïp InherentAI 1 = wimpy trader, 2 = brave trader). 3 and 4 are
 * warship/interceptor brains and carry nothing.
 */
export const CARGO_ESCORT_AI_TYPES: readonly number[] = [1, 2];

/** Whether a ship class may carry cargo while escorting the player. */
export function carriesCargo(shipData: ShipData): boolean {
    return CARGO_ESCORT_AI_TYPES.includes(shipData.inherentAI);
}

/** Mission cargo keys, which may never leave the player's own hold. */
export function isMissionCargoKey(key: string): boolean {
    return key.startsWith('mission:');
}

/**
 * One escort's hold in the fleet.
 *
 * `cargo` is the working copy the exchange edits; `entity` is the roster
 * entity it is committed back onto ({@link commitFleetHolds}) and is left
 * unset by unit tests, which only exercise the arithmetic.
 */
export interface FleetHold {
    /** The escort's uuid — the tie-break for fill order. */
    uuid: string;
    /** Tons this escort can hold in total. */
    capacity: number;
    /** Working copy of the escort's CargoComponent. */
    cargo: Cargo;
    /** The landed-roster entity to commit back onto, when there is one. */
    entity?: Entity;
}

/**
 * A trade session's whole fleet: the player's own working hold plus the
 * cargo-carrying escorts', holds sorted by uuid.
 *
 * `ship` is the same {@link TradeWorkingState} the solo exchange has
 * always edited, so every ship-local rule (mission cargo, the status
 * bar's Free readout, the outfitter) keeps reading exactly one hold.
 */
export interface FleetCargoState {
    ship: TradeWorkingState;
    holds: FleetHold[];
}

/** Whether this fleet has any cargo-carrying escort. */
export function hasCargoEscorts(state: FleetCargoState): boolean {
    return state.holds.length > 0;
}

/** Free tons in the PLAYER'S OWN hold — never the fleet's. */
export function shipFreeSpace(state: FleetCargoState): number {
    return freeCargoSpace(state.ship);
}

/** Free tons in one escort hold. */
export function holdFreeSpace(hold: FleetHold): number {
    return Math.max(0, hold.capacity - cargoUsed(hold.cargo));
}

/** Total tons the whole fleet can hold. */
export function fleetCapacity(state: FleetCargoState): number {
    return state.holds.reduce((total, hold) => total + hold.capacity,
        state.ship.cargoCapacity);
}

/** Free tons across the whole fleet (the player's ship included). */
export function fleetFreeSpace(state: FleetCargoState): number {
    return state.holds.reduce((total, hold) => total + holdFreeSpace(hold),
        shipFreeSpace(state));
}

/** Tons of one commodity held anywhere in the fleet. */
export function fleetHeld(state: FleetCargoState, key: string): number {
    return state.holds.reduce((total, hold) => total + (hold.cargo.get(key) ?? 0),
        state.ship.cargo.get(key) ?? 0);
}

/**
 * The fleet's combined manifest, for display only (the exchange's
 * quantity column and its "Other cargo:" line). Keys appear in the
 * player's-ship-then-escorts order the holds are stored in, so the
 * rendered text is stable.
 */
export function fleetCargo(state: FleetCargoState): Cargo {
    const total: Cargo = new Map(state.ship.cargo);
    for (const hold of state.holds) {
        for (const [key, tons] of hold.cargo) {
            total.set(key, (total.get(key) ?? 0) + tons);
        }
    }
    return total;
}

/**
 * The most tons of a good the fleet could buy: limited by credits and by
 * FLEET free space. This is the quantity dialog's max and default — the
 * reference screenshot (trade_center/buy_quantity.png) prefills 390, the
 * fleet's free space, on a pilot whose own hold has 15 tons free.
 */
export function maxFleetBuyQuantity(state: FleetCargoState,
    good: TradeGood): number {
    if (!good.canBuy || good.price <= 0 || isMissionCargoKey(good.key)) {
        return 0;
    }
    const affordable = Math.floor(state.ship.credits.credits / good.price);
    return Math.max(0, Math.min(affordable, fleetFreeSpace(state)));
}

/** The tons of a good the fleet could sell here: the fleet-wide holding. */
export function maxFleetSellQuantity(state: FleetCargoState,
    good: TradeGood): number {
    if (!good.canSell) {
        return 0;
    }
    return Math.max(0, fleetHeld(state, good.key));
}

/**
 * Buys up to `quantity` tons into the fleet, clamped to what fits and is
 * affordable. Returns the tons bought.
 *
 * FILL ORDER: the player's own hold first, then escorts in uuid order.
 * The Bible and the stock strings are silent on the order (the reference
 * screenshots only ever show a purchase that fills everything), so this
 * is a DECISION: the player's ship is the hold they can act on
 * everywhere else in the game, so goods land there first, and uuid order
 * makes the spill deterministic rather than dependent on roster
 * insertion.
 */
export function fleetBuyQuantity(state: FleetCargoState, good: TradeGood,
    quantity: number): number {
    const bought = Math.min(Math.floor(quantity),
        maxFleetBuyQuantity(state, good));
    if (bought <= 0) {
        return 0;
    }
    state.ship.credits.credits -= bought * good.price;

    let left = bought;
    const intoShip = Math.min(left, shipFreeSpace(state));
    if (intoShip > 0) {
        state.ship.cargo.set(good.key,
            (state.ship.cargo.get(good.key) ?? 0) + intoShip);
        left -= intoShip;
    }
    for (const hold of state.holds) {
        if (left <= 0) {
            break;
        }
        const into = Math.min(left, holdFreeSpace(hold));
        if (into > 0) {
            hold.cargo.set(good.key, (hold.cargo.get(good.key) ?? 0) + into);
            left -= into;
        }
    }
    return bought - left;
}

/** Buys as much as fits and is affordable (the one-click behavior). */
export function fleetBuy(state: FleetCargoState, good: TradeGood): number {
    return fleetBuyQuantity(state, good, maxFleetBuyQuantity(state, good));
}

/**
 * Sells up to `quantity` tons out of the fleet. Returns the tons sold.
 *
 * DRAIN ORDER: the player's own hold first, then escorts in uuid order.
 * Also a DECISION where the Bible is silent, and deliberately NOT the
 * inverse of the fill order: selling is how a player makes room for
 * MISSION cargo, which only their own ship can carry, so a sale has to be
 * able to free space there.
 */
export function fleetSellQuantity(state: FleetCargoState, good: TradeGood,
    quantity: number): number {
    const sold = Math.min(Math.floor(quantity),
        maxFleetSellQuantity(state, good));
    if (sold <= 0) {
        return 0;
    }
    let left = sold;
    const take = (cargo: Cargo) => {
        const held = cargo.get(good.key) ?? 0;
        const taken = Math.min(left, held);
        if (taken <= 0) {
            return;
        }
        if (taken >= held) {
            cargo.delete(good.key);
        } else {
            cargo.set(good.key, held - taken);
        }
        left -= taken;
    };
    take(state.ship.cargo);
    for (const hold of state.holds) {
        if (left <= 0) {
            break;
        }
        take(hold.cargo);
    }
    state.ship.credits.credits += (sold - left) * good.price;
    return sold - left;
}

/** Sells the fleet's entire holding of a good (the one-click behavior). */
export function fleetSell(state: FleetCargoState, good: TradeGood): number {
    return fleetSellQuantity(state, good, maxFleetSellQuantity(state, good));
}

// ─────────────────────────────────────────────────────────────────────────
// Wording (STR# 2002)
// ─────────────────────────────────────────────────────────────────────────

/** STR# 2002 index 198 — the solo quantity-column header. */
export const HEADER_IN_HOLD = 'In Hold:';
/** STR# 2002 index 197 — the same column once a fleet carries cargo. */
export const HEADER_IN_FLEET = 'In Fleet:';

/** The quantity column's header for this fleet. */
export function quantityColumnHeader(state: FleetCargoState): string {
    return hasCargoEscorts(state) ? HEADER_IN_FLEET : HEADER_IN_HOLD;
}

/**
 * The free-space readout: one line solo, and the reference's split pair
 * once cargo-carrying escorts are along (STR# 2002 363 + 364 / 365).
 */
export function freeSpaceLines(state: FleetCargoState): string[] {
    const tons = (amount: number) => `${amount} tons`;
    if (!hasCargoEscorts(state)) {
        return [`Free cargo space: ${tons(shipFreeSpace(state))}`];
    }
    return [
        `Free cargo space in your ship: ${tons(shipFreeSpace(state))}`,
        `Free cargo space in your fleet: ${tons(fleetFreeSpace(state))}`,
    ];
}

// ─────────────────────────────────────────────────────────────────────────
// Building the fleet from the landed-escort roster
// ─────────────────────────────────────────────────────────────────────────

/** A landed-roster entry, as spaceport/landed_escorts.ts keeps them. */
export interface FleetEscortEntry {
    /** The player ship uuid this escort belongs to. */
    player: string;
    uuid: string;
    entity: Entity;
}

/**
 * Whether one of the player's ships can carry the fleet's trade goods.
 *
 * Excluded: BAY-LAUNCHED FIGHTERS (a deployed fighter is not a freighter
 * no matter what its hull's InherentAI says — the Bible's rule is about
 * ships "used to carry cargo when they are the player's escorts"),
 * mission ships (never the player's property), and any hull whose
 * InherentAI is not 1 or 2.
 *
 * Shared by the exchange's holds and the status bar's fleet readout, so
 * the tonnage the bar reports is exactly the tonnage the exchange trades.
 */
export function entityCarriesFleetCargo(entity: Entity,
    shipData: ShipData | undefined): boolean {
    const components = entity.components;
    if (components.has(ReturnWhenTargetRemovedComponent)
        || components.has(MissionShipComponent)) {
        return false;
    }
    return shipData !== undefined && carriesCargo(shipData);
}

/**
 * {@link entityCarriesFleetCargo} for a roster entry, additionally
 * skipping escorts belonging to another player (multiplayer rosters are
 * shared).
 */
export function escortCarriesFleetCargo(entry: FleetEscortEntry,
    playerUuid: string | undefined, shipData: ShipData | undefined): boolean {
    if (playerUuid !== undefined && entry.player !== playerUuid) {
        return false;
    }
    return entityCarriesFleetCargo(entry.entity, shipData);
}

/**
 * One ship's contribution to a fleet-wide readout: what it is carrying
 * and how much it could carry.
 */
export interface FleetMemberCargo {
    cargo?: ReadonlyMap<string, number>;
    capacity: number;
}

/**
 * The fleet's combined manifest and capacity, for the STATUS BAR's cargo
 * panel.
 *
 * RULING (Matthew): "'Free''s total in the status bar should include the
 * fleet." The references agree — trade_center/earth_trade_center.png
 * reads "Free: 390" beside a hull with 15 tons free, and
 * 390_medical_supplies.png (the same pilot, one purchase later) reads
 * "Med: 390" on that 15-ton hull. So both the per-commodity lines and the
 * free figure are fleet-wide, which is also the only way the player can
 * see what their freighters are hauling.
 *
 * Members are summed in the order given (the player's own ship first),
 * so the manifest's line order is stable. Mission cargo can only ever be
 * the player's own, so the "Special:" summary derived from this map is
 * unaffected by the fold.
 */
export function sumFleetCargo(members: readonly FleetMemberCargo[]):
    { cargo: Cargo, capacity: number } {
    const cargo: Cargo = new Map();
    let capacity = 0;
    for (const member of members) {
        capacity += member.capacity;
        for (const [key, tons] of member.cargo ?? []) {
            if (tons > 0) {
                cargo.set(key, (cargo.get(key) ?? 0) + tons);
            }
        }
    }
    return { cargo, capacity };
}

/**
 * Builds the fleet's escort holds from the client's landed roster, in
 * uuid order. Each hold gets a WORKING COPY of the escort's cargo;
 * {@link commitFleetHolds} writes them back.
 *
 * An escort whose ship data cannot be loaded is skipped rather than
 * guessed at, so a data failure loses capacity instead of inventing it.
 * Repeated uuids collapse to one hold: two holds over one entity would
 * double-count its capacity and then fight over the commit.
 */
export async function collectFleetHolds(
    escorts: readonly FleetEscortEntry[],
    playerUuid: string | undefined,
    gameData: SimulationGameDataInterface): Promise<FleetHold[]> {
    const ordered = [...escorts].sort((a, b) => a.uuid < b.uuid ? -1
        : a.uuid > b.uuid ? 1 : 0);
    const holds: FleetHold[] = [];
    const seen = new Set<string>();
    for (const entry of ordered) {
        if (seen.has(entry.uuid)) {
            continue;
        }
        seen.add(entry.uuid);
        const shipId = entry.entity.components.get(ShipComponent)?.id;
        let shipData: ShipData | undefined;
        if (shipId !== undefined) {
            try {
                shipData = await gameData.data.Ship.get(shipId);
            } catch (e) {
                console.warn(`Fleet cargo: no ship data for ${shipId}:`, e);
            }
        }
        if (!escortCarriesFleetCargo(entry, playerUuid, shipData)) {
            continue;
        }
        holds.push({
            uuid: entry.uuid,
            capacity: await computeCargoCapacity(entry.entity, gameData),
            cargo: new Map(entry.entity.components.get(CargoComponent) ?? []),
            entity: entry.entity,
        });
    }
    return holds;
}

// ─────────────────────────────────────────────────────────────────────────
// The hold LEASE
// ─────────────────────────────────────────────────────────────────────────
//
// The exchange snapshots the landed roster's holds when it opens and writes
// them back at Done, but the roster keeps CHANGING underneath it: the client
// settles the escort deals the player queued over the comm channel on every
// docked frame at a shipyard, and a settled SALE splices its escort out of
// the roster (spaceport/escort_deals.ts). Nothing stopped that from
// happening to an escort whose hold was open — the exchange would then
// commit a hold onto an entity that is not on any roster, so the goods
// evaporated while the credits stayed spent.
//
// An open hold is therefore a LEASE on its escort: while the trade visit
// holds it, that escort's queued deals are frozen and simply retried on the
// next docked frame (a frame the settlement was going to run on anyway — it
// runs on all of them). An exchange visit is seconds long and the deals are
// already deferred to "the next shipyard", so waiting until Done costs the
// player nothing; the alternative (re-running the whole buy allocation
// against the shrunken fleet at commit time and refunding the overflow)
// charges the player for goods and then takes some back, which is a worse
// thing to have happen while they are looking at the screen.
//
// THE LEASE IS A PROPERTY OF THE LANDING'S TRANSACTION
// (spaceport/landed_transaction.ts: leaseFleetHolds / holdOpen), scoped to
// the trade visit's savepoint — committed with its release, discarded with
// its rollback, so a throw out of show() cannot leave it behind. It used to
// be a module-level registry, which was exactly one skipped close away from
// freezing an escort's sale for the rest of the session.

/**
 * Commits each hold's working cargo back onto its roster entity, so the
 * escort lifts off (and is saved) carrying it. Mission cargo is dropped
 * defensively: it must never ride an escort, whatever put it there.
 */
export function commitFleetHolds(holds: readonly FleetHold[]) {
    for (const hold of holds) {
        if (!hold.entity) {
            continue;
        }
        const cargo: Cargo = new Map();
        for (const [key, tons] of hold.cargo) {
            if (tons > 0 && !isMissionCargoKey(key)) {
                cargo.set(key, tons);
            }
        }
        hold.entity.components.set(CargoComponent, cargo);
    }
}
