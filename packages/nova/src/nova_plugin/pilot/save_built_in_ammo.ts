/**
 * Load-time repair of saves written while a built-in weapon's stock ammo
 * load was keyed by the weapon itself.
 *
 * A wëap's AmmoType names the weapon whose SUPPLY it draws on, which is
 * not always itself (EVN Bible ~:3117-3123): stock's Raven Turret (139)
 * draws on the Raven Rocket (138), whose ammo oütf is 143 "Raven Rocket".
 * novaparse used to look the AmmoLoad's oütf up by the turret's own id,
 * find none, and give the hull an implicit `nova:139:builtInAmmo`
 * magazine instead (80 stock hulls had one). A pilot who bought such a
 * ship owns that magazine; the parser now loads 143 instead.
 *
 * An owned `<W>:builtInAmmo` whose weapon's supply has a real ammo oütf
 * becomes that many of the oütf novaparse would load today
 * (preferredAmmoOutfit), capped the way buying it is: its Max (times its
 * increase-maximum items, outfitter_rules effectiveMax) and, when the
 * supply weapon sets MaxAmmo, the launchers' room (ammoCapacity), and the
 * hull's free mass (canBuyOutfit's mass gate: the implicit magazine weighed
 * nothing, the real oütf may not). What does not fit is dropped, as the
 * outfitter would never have sold it. The flown ship's outfits and every
 * stored ship's are repaired.
 *
 * WHY AT LOAD AND NOT A SAVE MIGRATION. Whether a supply has an oütf
 * depends on the installed data (a plug-in can add or remove one), and
 * save migrations are data-free and run once per version. This is
 * idempotent and runs on every load: a save with no such magazine is
 * returned as it is, and the next save write keeps the repaired list.
 * No save version bump. A magazine whose supply still has no oütf (a
 * plug-in's NPC-only weapon) stays: it is what the parser loads, and it
 * feeds the supply now (novaparse makeBuiltInAmmoOutfit). Saved ESCORTS
 * are serialized entities and are not rewritten here; their legacy
 * magazines feed the right supply too, so they fire.
 *
 * Client-only bookkeeping; never runs in the simulation.
 */
import type { OutfitData } from 'novadatainterface/outfit_data';
import type { ShipData } from 'novadatainterface/ship_data';
import type { WeaponData } from 'novadatainterface/weapon_data';
import { installedOutfitMass } from '../ship/index.js';
import {
    ammoSupplyWeaponId, builtInOutfitWeaponId, preferredAmmoOutfit,
} from 'novaparse/built_in_weapon_outfit';
import type { SaveData } from './save_game.js';

export interface BuiltInAmmoLookups {
    /** Every oütf id the data defines (NovaIDs.Outfit), id-space order. */
    readonly outfitIds: readonly string[];
    getOutfit(id: string): Promise<OutfitData | undefined>;
    getWeapon(id: string): Promise<WeaponData | undefined>;
    /** A hull class, for its free mass (unknown: not mass-gated). */
    getShip(id: string): Promise<ShipData | undefined>;
}

type Outfits = readonly (readonly [string, number])[];

function hasLegacyMagazine(outfits: Outfits): boolean {
    return outfits.some(([id]) => builtInOutfitWeaponId(id)?.kind === 'ammo');
}

/**
 * `save` with each owned legacy built-in magazine converted (see the
 * module comment); `save` itself when there is nothing to convert.
 */
export async function normaliseBuiltInAmmo(save: SaveData,
    lookups: BuiltInAmmoLookups): Promise<SaveData> {
    const storedShips = save.storedShips ?? [];
    if (!hasLegacyMagazine(save.outfits)
        && !storedShips.some(s => hasLegacyMagazine(s.outfits))) {
        return save;
    }
    // Supply weapon -> the oütfs feeding it, in id-space order. Built
    // only for a save that needs it (the client has every oütf preloaded).
    const feeding = new Map<string, string[]>();
    for (const id of lookups.outfitIds) {
        const ammoFor = (await lookups.getOutfit(id))?.ammoFor;
        if (ammoFor) {
            feeding.set(ammoFor, [...(feeding.get(ammoFor) ?? []), id]);
        }
    }
    const convert = async (outfits: Outfits, shipId: string) =>
        convertMagazines(outfits, await lookups.getShip(shipId), feeding,
            lookups);
    const outfits = await convert(save.outfits, save.ship);
    const stored = await Promise.all(storedShips.map(async ship => {
        const converted = await convert(ship.outfits, ship.ship);
        return converted === ship.outfits ? ship
            : { ...ship, outfits: converted };
    }));
    const storedChanged = stored.some((ship, i) => ship !== storedShips[i]);
    if (outfits === save.outfits && !storedChanged) {
        return save;
    }
    return {
        ...save, outfits,
        ...(storedChanged ? { storedShips: stored } : {}),
    } as SaveData;
}

async function convertMagazines(outfits: Outfits, ship: ShipData | undefined,
    feeding: ReadonlyMap<string, readonly string[]>,
    lookups: BuiltInAmmoLookups): Promise<[string, number][]> {
    let list = outfits as [string, number][];
    for (const [id, count] of outfits) {
        const builtIn = builtInOutfitWeaponId(id);
        if (builtIn?.kind !== 'ammo') {
            continue;
        }
        const weapon = await lookups.getWeapon(builtIn.weaponId);
        const supply = weapon && ammoSupplyWeaponId(weapon);
        const target = supply === undefined ? undefined
            : preferredAmmoOutfit(feeding.get(supply) ?? []);
        const targetData = target === undefined ? undefined
            : await lookups.getOutfit(target);
        if (supply === undefined || target === undefined || !targetData) {
            continue;
        }
        const rest = list.filter(([other]) => other !== id);
        const room = await roomFor(targetData, supply, rest, ship, lookups);
        const existing = rest.find(([other]) => other === target)?.[1] ?? 0;
        const total = existing + Math.max(0, Math.min(count, room));
        // The converted rounds take the magazine's place in the list
        // (or join the oütf's own entry, where the ship has one).
        list = list.flatMap(([other, n]): [string, number][] =>
            other === id
                ? (existing > 0 || total === 0 ? [] : [[target, total]])
                : other === target ? [[target, total]]
                    : [[other, n]]);
    }
    return list;
}

/**
 * How many more of ammo oütf `outfit` (feeding `supply`) a ship owning
 * `owned` may hold: the outfitter's purchase caps (effectiveMax,
 * ammoCapacity when the supply weapon sets MaxAmmo, and the free mass of
 * hull class `ship` when it is known).
 */
async function roomFor(outfit: OutfitData, supply: string,
    owned: Outfits, ship: ShipData | undefined,
    lookups: BuiltInAmmoLookups): Promise<number> {
    const data = new Map<string, OutfitData | undefined>();
    for (const [id] of owned) {
        if (!data.has(id)) {
            data.set(id, await lookups.getOutfit(id));
        }
    }
    return ammoPurchaseRoom(outfit, owned, ship, id => data.get(id),
        await lookups.getWeapon(supply));
}

/**
 * roomFor with every lookup already in hand: how many more of ammo oütf
 * `outfit` a ship of class `ship` owning `owned` could buy. Its Max
 * (times its increase-maximum items), the launchers' room when the
 * supply weapon (`supplyWeapon`, the weapon `outfit.ammoFor` names) sets
 * MaxAmmo, and the hull's free mass when `ship` is known. The original
 * pilot import (title/original_pilot_import.ts) caps a file's ammo with
 * it too.
 */
export function ammoPurchaseRoom(outfit: OutfitData, owned: Outfits,
    ship: ShipData | undefined,
    getOutfit: (id: string) => OutfitData | undefined,
    supplyWeapon: WeaponData | undefined): number {
    const supply = outfit.ammoFor;
    let freeMass = ship?.physics.freeMass ?? Infinity;
    let multiplier = 0;
    let mounted = 0;
    let supplied = 0;
    let held = 0;
    for (const [id, count] of owned) {
        if (id === outfit.id) {
            held += count;
        }
        const data = getOutfit(id);
        if (!data) {
            continue;
        }
        if (ship) {
            freeMass -= installedOutfitMass(data, ship.physics.mass) * count;
        }
        if (data.increasesMax === outfit.id) {
            multiplier += count;
        }
        if (supply) {
            mounted += (data.weapons[supply] ?? 0) * count;
            if (data.ammoFor === supply) {
                supplied += count;
            }
        }
    }
    let room = outfit.max <= 0 ? Infinity
        : outfit.max * Math.max(1, multiplier) - held;
    if (supplyWeapon && supplyWeapon.maxAmmo > 0) {
        room = Math.min(room, supplyWeapon.maxAmmo * mounted - supplied);
    }
    const unit = ship ? installedOutfitMass(outfit, ship.physics.mass) : 0;
    if (unit > 0) {
        room = Math.min(room, Math.floor(freeMass / unit));
    }
    return Math.max(0, room);
}
