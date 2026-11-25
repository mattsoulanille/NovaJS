import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { displayName, Stat } from '../nova_plugin/core/index.js';
import {
    CarriedEscortEntry, countsTowardEscortCap, ReturnWhenTargetRemovedComponent,
} from '../nova_plugin/escorts/index.js';
import {
    ammoStockOf, CreditsComponent, escortProvenance, NO_DEAL,
    PlayerEscortComponent,
    PlayerNamesComponent, sanitizeShipName, StoredShip, StoredShips,
    StoredShipsComponent,
} from '../nova_plugin/player/index.js';
import {
    applyOutfitPhysics, Cargo, CargoComponent, cargoUsed, FuelComponent,
    OutfitsStateComponent, ShipComponent, SourceComponent,
} from '../nova_plugin/ship/index.js';
import { makeNpcShip } from '../nova_plugin/spawn/index.js';
import {
    buildShipEntity, cargoForNewShip, deployedUnitCount, isPersistent,
    newShipCargoCapacity, outfitsForNewShip, partitionOutfits,
    ShipPurchaseContext, ShipyardCheck, shipListPrice,
} from './shipyard_rules.js';

/**
 * ============================================================================
 * SHIP STORAGE: the rules (docs/ship_storage.md)
 * ============================================================================
 *
 * The pilot's stored ships are a list of records on their own entity
 * (player/stored_ships.ts). This module is every operation on it, as plain
 * functions over the docked hull: the shipyard's hangar dialog
 * (hangar_dialog.ts) is the caller, and it hands every new hull to the
 * landing's transaction exactly as a shipyard purchase does
 * (LandedTransaction.adoptPurchasedShip, Spaceport.adoptPurchasedShip).
 *
 * Nothing here reads a clock or a PRNG, nothing is applied in a world, and
 * the hull passed in is never mutated: a swap returns a NEW hull (the old
 * one keeps its list, so a transaction rollback that hands it back hands back
 * the list it had). Only the operations that keep the hull — an escort into
 * storage, a stored ship out as an escort — write the list, and they write a
 * new array rather than edit the old one.
 *
 * THE SNAPSHOT (see the design note's table): the class, its class name,
 * the ship's own name (player_names.ts) when it has one, every outfit
 * aboard at its count, the hold and the fuel. Shield, armor and
 * ionization are not kept — a stored ship comes back fully repaired, as a
 * hull from the shipyard does — and the pilot's PERSISTENT outfits (oütf
 * 0x0004) are never stored: they follow the pilot onto whatever hull they
 * fly next, past that hull's limits (shipyard_rules judgment call 6).
 *
 * THE HOLD: each hull has its own, and a swap destroys nothing. The pilot's
 * hold and the incoming hull's are pooled; the incoming hull takes every ton
 * of mission cargo and as many commodities as it has room for, in
 * cargoForNewShip's order; the rest stays aboard the hull being put away.
 * That is usually at most what the hull held already, but not always: mission
 * cargo the incoming hull must take can push commodities out past what the
 * outgoing hull can hold (a 10 t hull carrying 20 t of mission cargo swapped
 * for a full 100 t freighter). Each hull keeps its own capacity, so such a
 * swap is REFUSED (swapHoldRefusal: 'holdFull') rather than overfill the
 * hull put away; the pilot can sell or jettison commodities first.
 *
 * NAMES (player/player_names.ts): the ship being flown has the pilot's name
 * for it, and a stored ship keeps its own (StoredShip `shipName`). A swap
 * brings the stored ship's name back as the ship's name and puts the
 * outgoing hull away under its own. Escorts carry no names (as in the
 * original), so a hull that becomes an escort leaves its name behind, and a
 * ship taken from an escort has none until the player names one at the
 * shipyard (until then the `p` screen shows the derived "<class> <number>").
 */

/** The game data the operations read; all synchronous (preloaded). */
export interface StorageLookups {
    getShip(id: string): ShipData | undefined;
    getOutfit(id: string): OutfitData | undefined;
}

/** The pilot's stored ships, empty when they have none. */
export function storedShipsOf(entity: Entity): StoredShips {
    return entity.components.get(StoredShipsComponent) ?? [];
}

/**
 * Writes `ships` as the pilot's list: a NEW array, and no component at all
 * for an empty list (stored_ships.ts: a pilot with nothing stored carries
 * nothing).
 */
export function setStoredShips(entity: Entity, ships: StoredShips): void {
    if (ships.length === 0) {
        entity.components.delete(StoredShipsComponent);
    } else {
        entity.components.set(StoredShipsComponent, [...ships]);
    }
}

/** The name a hull of `shipId` is listed under. */
export function shipName(shipId: string, lookups: StorageLookups): string {
    const ship = lookups.getShip(shipId);
    return ship ? displayName(ship.name) : shipId;
}

/** `[id, count]` pairs, sorted by id, zero counts dropped. */
function sortedPairs(entries: Iterable<[string, number]>): [string, number][] {
    return [...entries]
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** An entity's outfits aboard as id -> count. */
function outfitCounts(entity: Entity): Map<string, number> {
    return new Map([...entity.components.get(OutfitsStateComponent) ?? []]
        .map(([id, { count }]) => [id, count]));
}

/**
 * A hull as a stored-ship record: its class, name, every outfit aboard,
 * its hold and its fuel. `strip` is the outfits to leave OUT (the pilot's
 * persistent ones, when it is the pilot's hull being put away), and `cargo`
 * the hold to record in place of the entity's own (the pooled leftovers of
 * a swap).
 */
export function snapshotHull(entity: Entity, storedAt: string,
    lookups: StorageLookups,
    options: { strip?: ReadonlyMap<string, number>, cargo?: Cargo } = {}):
    StoredShip {
    const shipId = entity.components.get(ShipComponent)?.id;
    if (!shipId) {
        throw new Error('Cannot store an entity that is not a ship');
    }
    const outfits = outfitCounts(entity);
    for (const [id, count] of options.strip ?? []) {
        outfits.set(id, (outfits.get(id) ?? 0) - count);
    }
    const ownName = sanitizeShipName(
        entity.components.get(PlayerNamesComponent)?.ship);
    return {
        ship: shipId,
        name: shipName(shipId, lookups),
        ...(ownName !== undefined ? { shipName: ownName } : {}),
        outfits: sortedPairs(outfits),
        cargo: sortedPairs(options.cargo
            ?? entity.components.get(CargoComponent) ?? []),
        fuel: entity.components.get(FuelComponent)?.current ?? 0,
        storedAt,
    };
}

/**
 * The name a stored ship is listed under: its own name when it has a
 * non-blank one, else its class name.
 */
export function storedShipLabel(record: StoredShip): string {
    const own = sanitizeShipName(record.shipName);
    return own ? own : record.name;
}

/**
 * Gives `hull` the ship name `name` (player_names.ts), or none (`ship`
 * dropped, so the derived "<class> <number>" stands in). The record is
 * replaced, never mutated: the hull it was carried from shares it.
 */
function nameHull(hull: Entity, name: string | undefined): void {
    const { ship: _old, ...names } =
        hull.components.get(PlayerNamesComponent) ?? {};
    const cleaned = sanitizeShipName(name);
    hull.components.set(PlayerNamesComponent,
        cleaned !== undefined ? { ...names, ship: cleaned } : names);
}

/**
 * Whether every outfit a record carries is loaded. A stored ship can hold
 * a plug-in outfit whose plug-in has since been removed; taking it out
 * would leave a hull whose physics and weapons can never be derived (and
 * a save that quarantines), so the hangar refuses it as 'notLoaded'.
 */
export function recordOutfitsLoaded(record: StoredShip,
    lookups: StorageLookups): boolean {
    return record.outfits.every(([id]) => lookups.getOutfit(id) !== undefined);
}

/** The pilot's persistent outfits aboard `hull`: what follows the pilot. */
export function persistentOutfits(hull: Entity, lookups: StorageLookups):
    Map<string, number> {
    const kept = new Map<string, number>();
    for (const [id, count] of outfitCounts(hull)) {
        if (count > 0 && isPersistent(lookups.getOutfit(id))) {
            kept.set(id, count);
        }
    }
    return kept;
}

/**
 * The outfits aboard the hull being taken out: its stored loadout plus the
 * pilot's persistent outfits (counts add where both have one).
 */
export function incomingOutfits(record: StoredShip,
    persistent: ReadonlyMap<string, number>):
    Map<string, { count: number }> {
    const merged = new Map<string, { count: number }>();
    for (const [id, count] of [...record.outfits, ...persistent]) {
        if (count > 0) {
            merged.set(id, { count: (merged.get(id)?.count ?? 0) + count });
        }
    }
    return merged;
}

/**
 * THE HOLD EXCHANGE of a swap (see the module comment): what the incoming
 * hull carries away, and what stays aboard the hull being put away.
 */
export function exchangeHolds(pilot: Cargo, incoming: Iterable<[string, number]>,
    capacity: number): { aboard: Cargo, leftBehind: Cargo } {
    const pooled = new Map(pilot);
    for (const [key, tons] of incoming) {
        pooled.set(key, (pooled.get(key) ?? 0) + tons);
    }
    const aboard = cargoForNewShip(pooled, capacity);
    const leftBehind: Cargo = new Map();
    for (const [key, tons] of pooled) {
        const left = tons - (aboard.get(key) ?? 0);
        if (left > 0) {
            leftBehind.set(key, left);
        }
    }
    return { aboard, leftBehind };
}

/**
 * The fuel tank of a `shipData` hull carrying `outfits`: the class's energy
 * plus every outfit's (applyOutfitPhysics, as ShipPhysicsProvider derives
 * it). An outfit that is not loaded counts for nothing (the hangar refuses
 * such a ship before it gets here).
 */
export function fuelCapacity(shipData: ShipData,
    outfits: Iterable<[string, number]>, lookups: StorageLookups): number {
    const resolved: [OutfitData, number][] = [];
    for (const [id, count] of outfits) {
        const outfit = lookups.getOutfit(id);
        if (outfit) {
            resolved.push([outfit, count]);
        }
    }
    return applyOutfitPhysics(shipData.physics, resolved).energy;
}

/**
 * A fuel stat holding `units` of a `capacity` tank. The max is the real
 * tank, not `units`: an escort is refuelled at lift-off to its stat's max
 * (escort_restock.ts) before any provider has run on it, so a max of
 * `units` would send a ship stored dry out dry (review finding 2). The
 * providers still own recharge.
 */
function fuelStat(units: number, capacity: number): Stat {
    return new Stat({
        current: Math.max(0, Math.min(units, capacity)), max: capacity,
        min: 0, recharge: 0,
    });
}

/**
 * The hull the pilot flies away in, built from a record: the record's class,
 * its outfits plus the pilot's persistent ones, the pooled hold, its fuel,
 * and every piece of pilot state the old hull carried (buildShipEntity's
 * CARRIED_COMPONENTS — credits, missions, bits, ranks, records, the stored
 * list, this landing's hires). No credits move: storage is free. The old
 * hull is left untouched.
 *
 * Returns the hull and what of the pilot's pooled hold did NOT go aboard it.
 */
export function buildHullFromRecord(oldHull: Entity, record: StoredShip,
    persistent: ReadonlyMap<string, number>, lookups: StorageLookups):
    { hull: Entity, leftBehind: Cargo } {
    const shipData = lookups.getShip(record.ship);
    if (!shipData) {
        throw new Error(`Ship ${record.ship} is not loaded`);
    }
    const outfits = incomingOutfits(record, persistent);
    const { aboard, leftBehind } = exchangeHolds(
        oldHull.components.get(CargoComponent) ?? new Map(), record.cargo,
        newShipCargoCapacity(shipData, outfits, lookups));
    const hull = buildShipEntity(oldHull, shipData, outfits,
        oldHull.components.get(CreditsComponent)?.credits ?? 0,
        lookups.getOutfit);
    hull.components.set(CargoComponent, aboard);
    hull.components.set(FuelComponent, fuelStat(record.fuel,
        fuelCapacity(shipData, [...outfits].map(([id, { count }]) =>
            [id, count] as [string, number]), lookups)));
    // The ship's own name comes back with it (or none, for a ship that
    // never had one); the pilot's name is carried with the pilot's state.
    nameHull(hull, record.shipName);
    return { hull, leftBehind };
}

/**
 * THE PLAYER'S HULL FOR STORED SHIP `index`: the pilot takes the stored
 * ship out and the hull they are flying goes into storage IN ITS SLOT. The
 * new hull is returned; `hull` is not changed. Throws on an index out of
 * range or a class whose data is not loaded (the hangar checks both first).
 */
export function swapWithStored(hull: Entity, index: number, storedAt: string,
    lookups: StorageLookups): Entity {
    const list = storedShipsOf(hull);
    const record = list[index];
    if (!record) {
        throw new Error(`No stored ship at ${index}`);
    }
    const persistent = persistentOutfits(hull, lookups);
    const built = buildHullFromRecord(hull, record, persistent, lookups);
    const outgoing = snapshotHull(hull, storedAt, lookups,
        { strip: persistent, cargo: built.leftBehind });
    setStoredShips(built.hull, list.map((entry, i) =>
        i === index ? outgoing : entry));
    return built.hull;
}

/**
 * Whether swapping `hull` for `incoming` (a stored ship's record, or an
 * escort's snapshot) would leave more cargo aboard the hull being put away
 * than its hold takes: 'holdFull', else undefined. See the module comment's
 * THE HOLD. Needs the outgoing class and every outfit loaded; with them
 * missing it does not refuse (the caller's 'notLoaded' checks come first).
 */
export function swapHoldRefusal(hull: Entity, incoming: StoredShip,
    lookups: StorageLookups): 'holdFull' | undefined {
    const incomingData = lookups.getShip(incoming.ship);
    const outgoingId = hull.components.get(ShipComponent)?.id;
    const outgoingData = outgoingId ? lookups.getShip(outgoingId) : undefined;
    if (!incomingData || !outgoingData) {
        return undefined;
    }
    const persistent = persistentOutfits(hull, lookups);
    const { leftBehind } = exchangeHolds(
        hull.components.get(CargoComponent) ?? new Map(), incoming.cargo,
        newShipCargoCapacity(incomingData,
            incomingOutfits(incoming, persistent), lookups));
    const kept = outfitCounts(hull);
    for (const [id, count] of persistent) {
        kept.set(id, (kept.get(id) ?? 0) - count);
    }
    const outgoingCapacity = newShipCargoCapacity(outgoingData,
        new Map([...kept].map(([id, count]) => [id, { count }])), lookups);
    return cargoUsed(leftBehind) > outgoingCapacity ? 'holdFull' : undefined;
}

// ── Captured escorts ────────────────────────────────────────────────────

/**
 * Whether a landed-roster entry is an escort the hangar can swap with or
 * store: the player's, CAPTURED (a hired pilot's hull was never the
 * player's — the same line the comm dialog's Sell draws), and an escort the
 * cap counts (not a bay fighter, not a mission ship). A launched fighter
 * from a build before BayFighterComponent still carries its return-to-bay
 * marker, which excludes it too.
 */
export function storableEscort(entry: CarriedEscortEntry, player: string):
    boolean {
    const { entity } = entry;
    return entry.player === player
        && entity.components.has(ShipComponent)
        && escortProvenance(entity) === 'captured'
        && countsTowardEscortCap(entity)
        && !entity.components.has(ReturnWhenTargetRemovedComponent);
}

/**
 * Whether escort `uuid` has a wing of its own out — fighters it launched,
 * on the landed roster or still in the world. Such an escort cannot be put
 * away or swapped: its fighters would have no carrier to come home to (the
 * escort's counterpart of shipyard_rules judgment call 8).
 */
export function escortWingOut(uuid: string,
    roster: readonly CarriedEscortEntry[],
    world: Iterable<[string, Entity]> = []): boolean {
    const launchedBy = (entity: Entity) =>
        entity.components.get(SourceComponent) === uuid
        || entity.components.get(PlayerEscortComponent)?.parent === uuid;
    for (const entry of roster) {
        if (entry.uuid !== uuid && launchedBy(entry.entity)) {
            return true;
        }
    }
    for (const [other, entity] of world) {
        if (other !== uuid && launchedBy(entity)) {
            return true;
        }
    }
    return false;
}

/**
 * A CAPTURED ESCORT built from a record, for the landed roster: the hull
 * built the way a hired escort is (makeNpcShip — its class's inherent AI,
 * no government), with the record's outfits, hold and fuel, and the durable
 * ownership marker of a prize: provenance 'captured', nothing queued.
 * Formation, firing group and owner are stamped by the lift-off that puts it
 * in the world (landed_escorts.ts prepareCarriedEscorts), which also
 * restocks it like any escort that landed with the player — an OWNED
 * escort's restock, back up to the record's ammo counts, which the marker
 * snapshots here (`ammoStock`, player_escort.ts).
 */
export function buildEscortFromRecord(record: StoredShip, player: string,
    lookups: StorageLookups): Entity {
    const shipData = lookups.getShip(record.ship);
    if (!shipData) {
        throw new Error(`Ship ${record.ship} is not loaded`);
    }
    const escort = makeNpcShip(shipData, 0, null, new Position(0, 0),
        new Angle(0), new Vector(0, 0));
    escort.components.set(OutfitsStateComponent, new Map(
        record.outfits.map(([id, count]) => [id, { count }])));
    escort.components.set(CargoComponent, new Map(record.cargo));
    escort.components.set(FuelComponent, fuelStat(record.fuel,
        fuelCapacity(shipData, record.outfits, lookups)));
    // The hull is the player's own, so it rearms back up to what it has
    // aboard NOW, not to capacity (player_escort.ts's OWNED ESCORT AMMO).
    escort.components.set(PlayerEscortComponent, {
        player, parent: player, provenance: 'captured', deal: NO_DEAL,
        ammoStock: ammoStockOf(record.outfits,
            id => Boolean(lookups.getOutfit(id)?.ammoFor)),
    });
    return escort;
}

/**
 * THE PLAYER SWAPS SHIPS WITH A CAPTURED ESCORT: the pilot flies away in the
 * escort's hull (its outfits, hold and fuel, plus the pilot's persistent
 * outfits and as much of the pilot's hold as fits), and the hull they were
 * flying becomes the escort in its place (with the hold's overflow). Returns
 * both; neither input is changed, and the caller puts `escort` into the
 * roster entry the old escort had, so the escort count does not move.
 */
export function swapWithEscort(hull: Entity, escort: Entity, storedAt: string,
    player: string, lookups: StorageLookups):
    { hull: Entity, escort: Entity } {
    const incoming = snapshotHull(escort, storedAt, lookups);
    const persistent = persistentOutfits(hull, lookups);
    const built = buildHullFromRecord(hull, incoming, persistent, lookups);
    const outgoing = snapshotHull(hull, storedAt, lookups,
        { strip: persistent, cargo: built.leftBehind });
    return {
        hull: built.hull,
        escort: buildEscortFromRecord(outgoing, player, lookups),
    };
}

/**
 * A STORED SHIP SENT ALONG AS AN ESCORT: record `index` leaves the pilot's
 * list (written onto `hull`, as a new array) and comes back as a captured
 * escort for the caller to put on the landed roster. The escort cap is the
 * caller's to check first (escortCapFull).
 */
export function storedToEscort(hull: Entity, index: number, player: string,
    lookups: StorageLookups): Entity {
    const list = storedShipsOf(hull);
    const record = list[index];
    if (!record) {
        throw new Error(`No stored ship at ${index}`);
    }
    const escort = buildEscortFromRecord(record, player, lookups);
    setStoredShips(hull, list.filter((_, i) => i !== index));
    return escort;
}

/**
 * A CAPTURED ESCORT PUT INTO STORAGE: its snapshot joins the END of the
 * pilot's list (written onto `hull`, as a new array). The caller takes the
 * escort off the landed roster, which is the whole of "it does not lift off
 * with you". Whatever deal was queued against it is dropped with it: a
 * stored ship is not an escort, and the deals are escorts' (escort_deals.ts).
 */
export function escortToStorage(hull: Entity, escort: Entity, storedAt: string,
    lookups: StorageLookups): StoredShip {
    const record = snapshotHull(escort, storedAt, lookups);
    setStoredShips(hull, [...storedShipsOf(hull), record]);
    return record;
}

// ── Buying a ship and keeping the old one ───────────────────────────────

/**
 * BUY AND KEEP (Option-click Buy Ship, while ship storage is on): the new
 * hull at its full asking price — there is no trade-in, because nothing is
 * traded — and the hull the pilot was flying goes into storage at the END of
 * the list. Otherwise exactly a purchase: the bought class's stock loadout
 * plus the pilot's persistent outfits (outfitsForNewShip), the pilot's state
 * carried (buildShipEntity), and the hold handled as every storage swap
 * handles it (exchangeHolds: what does not fit stays aboard the old hull,
 * never jettisoned). The caller has checked {@link canBuyAndKeep} and runs
 * the shïp OnPurchase as the shipyard does; the old class's OnRetire is NOT
 * run, since it was not sold. `oldHull` is not changed.
 */
export function buyAndKeep(oldHull: Entity, newShip: ShipData,
    context: ShipPurchaseContext, storedAt: string, lookups: StorageLookups):
    Entity {
    const outfits = outfitsForNewShip(newShip, context);
    const { aboard, leftBehind } = exchangeHolds(
        oldHull.components.get(CargoComponent) ?? new Map(), [],
        newShipCargoCapacity(newShip, outfits, context));
    const hull = buildShipEntity(oldHull, newShip, outfits,
        context.credits - shipListPrice(newShip, context), context.getOutfit);
    hull.components.set(CargoComponent, aboard);
    const outgoing = snapshotHull(oldHull, storedAt, lookups, {
        strip: partitionOutfits(context).kept, cargo: leftBehind,
    });
    setStoredShips(hull, [...storedShipsOf(oldHull), outgoing]);
    return hull;
}

/**
 * Whether the pilot can buy `newShip` and keep the one they fly: the
 * trade-in's own rules (shipyard_rules canBuyShip — no fighters out, since
 * the old hull is put away with its bays) against the FULL asking price.
 */
export function canBuyAndKeep(newShip: ShipData,
    context: ShipPurchaseContext): ShipyardCheck {
    if (deployedUnitCount(context) > 0) {
        return {
            allowed: false, reason: 'fightersDeployed',
            message: STORAGE_REFUSAL_TEXT.fightersDeployed,
        };
    }
    if (shipListPrice(newShip, context) > context.credits) {
        return {
            allowed: false, reason: 'credits',
            message: "You can't afford this ship without a trade-in!",
        };
    }
    return { allowed: true };
}

/** Why a storage operation is refused, if it is. */
export type StorageRefusal =
    | 'fightersDeployed'
    | 'wingDeployed'
    | 'escortCap'
    | 'notLoaded'
    | 'notCaptured'
    | 'holdFull';

/** What the hangar says for each refusal. */
export const STORAGE_REFUSAL_TEXT: Record<StorageRefusal, string> = {
    fightersDeployed: 'You must recall your fighters before changing ships!',
    wingDeployed: 'That ship must recall its fighters first.',
    escortCap: 'You already have the maximum possible number of escorts.',
    notLoaded: 'That ship\'s data could not be loaded.',
    notCaptured: 'Only a ship you own can be stored.',
    holdFull: 'Your old ship has no room for the cargo that would be left '
        + 'aboard it. Sell some first.',
};
