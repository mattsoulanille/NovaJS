import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * ============================================================================
 * The pilot's STORED SHIPS (ship storage, docs/ship_storage.md)
 * ============================================================================
 *
 * Every hull the pilot owns but is not flying and has not got with them as
 * an escort: a full snapshot of a customized ship, kept on the PILOT'S OWN
 * ENTITY. The pilot flies exactly one ship; storing it means taking another
 * one out (spaceport/ship_storage.ts has the rules, the shipyard's hangar the
 * UI).
 *
 * WHY A COMPONENT ON THE PLAYER, NOT CLIENT STATE. It is the pilot's
 * property in the same sense as their credits: it must ride the lift-off's
 * insertion record so every peer holds the same pilot, be in the rollback
 * snapshots and the desync hash, carry across every change of hull (the
 * shipyard's, a set string's, the hangar's own — it is in
 * missions/mission_ship_change.ts's PLAYER_STATE_COMPONENTS), and be written
 * into the pilot save (save_game.ts `storedShips`). Nothing in the
 * simulation reads or writes it: the list only changes while the pilot is
 * docked, out of every world, which is the spaceport's commit pattern.
 *
 * ABSENT WHEN EMPTY. A pilot who has never stored a ship carries no
 * component at all, so their hash input and insertion record are exactly
 * what they were before ship storage existed; emptying the list removes it.
 *
 * WHY A RECORD AND NOT A SERIALIZED ENTITY (which is how the save keeps
 * escorts). A stored ship is not a ship in any world: it is a hull class and
 * what is aboard it. A record says exactly that, its codec is ours to version,
 * and it cannot be invalidated by an unrelated component's codec changing
 * (save_game.ts's WIRE COMPATIBILITY note). What a snapshot keeps, and what it
 * deliberately does not (shield, armor, ionization, an escort's queued deal),
 * is decided in spaceport/ship_storage.ts.
 *
 * The list is in storage order and has no ids: the hangar addresses an entry
 * by index, and swapping a hull for a stored one puts the outgoing hull in the
 * incoming one's slot, so the order the player sees is stable.
 */
export const StoredShipType = t.type({
    /** Global shïp id of the hull (its class). */
    ship: t.string,
    /**
     * The hull's display name when it was stored — its class name, since
     * hulls carry no names of their own. Kept so the hangar can list the ship
     * even when its class no longer loads (a plug-in removed).
     */
    name: t.string,
    /**
     * Every outfit aboard, as [global outfit id, count], sorted by id: the
     * whole loadout including ammunition and mass-scaled items, at the counts
     * the hull had. The pilot's PERSISTENT outfits (oütf 0x0004) are never
     * here — they follow the pilot (ship_storage.ts).
     */
    outfits: t.array(t.tuple([t.string, t.number])),
    /** What is in its hold, as [commodity key, tons], sorted by key. */
    cargo: t.array(t.tuple([t.string, t.number])),
    /** Fuel aboard, in FuelComponent units (100 = one jump). */
    fuel: t.number,
    /**
     * Global spöb id of the stellar it was put away at. Global storage does
     * not read it (any shipyard reaches every stored ship); it is recorded
     * so a location-specific mode can be added without a save migration.
     */
    storedAt: t.string,
});
export type StoredShip = t.TypeOf<typeof StoredShipType>;

export const StoredShipsType = t.array(StoredShipType);
export type StoredShips = t.TypeOf<typeof StoredShipsType>;

/** See the module comment. Registered in PlayerStatePlugin. */
export const StoredShipsComponent =
    new Component<StoredShips>('StoredShips');
