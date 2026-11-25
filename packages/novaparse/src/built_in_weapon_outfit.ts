import { getDefaultOutfitData, OutfitData } from "novadatainterface/outfit_data";
import { GuidanceType, WeaponData } from "novadatainterface/weapon_data";

/**
 * A ship's stock armament comes from the shïp resource's WeapType fields,
 * which name wëap resources directly: "The next twelve fields tell Nova
 * which stock weapons to put on your ship when you first buy it ...
 * WeapType (x8) ID numbers of weapon types" (EVN Bible ~:2382). An oütf is
 * only needed to BUY a weapon at an outfitter, and plug-ins routinely ship
 * NPC-only weapons — launched fighters' guns especially — with no oütf at
 * all.
 *
 * NovaJS models a ship's weapons as outfits (nova_plugin/outfit_plugin.ts
 * derives WeaponsStateComponent from OutfitsStateComponent), so such a
 * weapon used to be dropped on the floor during ship parsing and the ship
 * flew unarmed. Instead, the weapon gets an IMPLICIT outfit: a zero-mass,
 * zero-price, unsellable item that grants exactly that one weapon.
 *
 * Implicit outfits are deliberately NOT in NovaIDs.Outfit. The outfitter
 * builds its shelves by enumerating those ids (spaceport/outfitter.ts
 * allOutfits), so leaving them out is what keeps a weapon the data never
 * made purchasable from becoming purchasable — while `data.Outfit.get`
 * still resolves the id for everything that looks an owned item up by id.
 */
const BUILT_IN_WEAPON_OUTFIT_SUFFIX = ":builtInWeapon";

/**
 * The same treatment for a built-in weapon's stock ammo load (the shïp
 * AmmoLoad field) when no ammunition oütf feeds that weapon's SUPPLY
 * either. Ammo is counted by finding owned outfits whose `ammoFor` names
 * the supply weapon (nova_plugin/weapon_plugin.ts countAmmo), so without
 * one an ammo-burning built-in weapon is loaded but unfireable.
 *
 * The id is keyed by the weapon that CARRIES the load (`<W>:builtInAmmo`),
 * but the magazine feeds W's supply: the weapon its AmmoType names, which
 * is not always W itself ("you could conceivably set it to use ammo from
 * another weapon's supply by setting the AmmoType to something else", EVN
 * Bible ~:3120). Stock does exactly that: the Raven Turret (wëap 139)
 * draws on the Raven Rocket's supply (wëap 138), fed by oütf 143.
 */
const BUILT_IN_AMMO_OUTFIT_SUFFIX = ":builtInAmmo";

/** The implicit outfit id for a weapon that no oütf provides. */
export function builtInWeaponOutfitId(weaponGlobalId: string): string {
    return weaponGlobalId + BUILT_IN_WEAPON_OUTFIT_SUFFIX;
}

/** The implicit ammunition outfit id for a weapon no oütf feeds. */
export function builtInAmmoOutfitId(weaponGlobalId: string): string {
    return weaponGlobalId + BUILT_IN_AMMO_OUTFIT_SUFFIX;
}

/**
 * What an implicit outfit id refers to — the weapon it mounts, or the
 * weapon it feeds — or undefined if the id is an ordinary oütf id.
 */
export function builtInOutfitWeaponId(outfitId: string):
    { kind: "weapon" | "ammo", weaponId: string } | undefined {
    if (outfitId.endsWith(BUILT_IN_WEAPON_OUTFIT_SUFFIX)) {
        return {
            kind: "weapon",
            weaponId: outfitId.slice(0, outfitId.length
                - BUILT_IN_WEAPON_OUTFIT_SUFFIX.length),
        };
    }
    if (outfitId.endsWith(BUILT_IN_AMMO_OUTFIT_SUFFIX)) {
        return {
            kind: "ammo",
            weaponId: outfitId.slice(0, outfitId.length
                - BUILT_IN_AMMO_OUTFIT_SUFFIX.length),
        };
    }
    return undefined;
}

/**
 * Guidance types the original engine mounts on a turret hardpoint rather
 * than a fixed gun (EVN Bible wëad Guidance: 1 turret, 5 point defense,
 * 8 beam turret, 10 point defense beam). Only used to label the implicit
 * outfit's hardpoint kind so hardpoint accounting stays honest; the ship
 * came with the weapon, so no purchase limit is ever checked against it.
 */
const TURRET_GUIDANCE: ReadonlySet<GuidanceType> = new Set<GuidanceType>([
    "turret", "pointDefense", "beamTurret", "pointDefenseBeam",
]);

/**
 * The weapon whose ammunition supply `weapon` draws on (its AmmoType), or
 * undefined for one that tracks no ammo supply (unlimited, or fuel per
 * shot). A bay draws on its own (weapon_parse.ts AmmoTypeParse).
 */
export function ammoSupplyWeaponId(weapon: WeaponData): string | undefined {
    const ammoType = weapon.ammoType;
    return Array.isArray(ammoType) && ammoType[0] === "weapon"
        ? ammoType[1] : undefined;
}

/**
 * Which of the oütfs feeding one supply weapon a stock ammo load becomes,
 * given every oütf whose `ammoFor` is that weapon in id-space order (the
 * stock files, then each plug-in in load order). Undefined when none does.
 *
 * Several often do. In stock: the Radar Missile supply (wëap 135) is fed
 * by 137 "Radar Missile", 327 "Illegal Radar Missile" and 330 "Disabling
 * Radar Missile"; the Wraithii's (145) by 152, 255, 279 and 346. A
 * plug-in can add another (an extra ammo "set" for a stock launcher, say).
 * The original keeps ammunition as one pool PER WEAPON (a pilot file holds
 * an ammo count for each of the 256 wëaps; novaparse pilot_data.ts
 * `ammo`), so every feeding oütf is the same rounds under another label,
 * and the choice decides only which item the load is shown and sold as.
 * The Bible does not name one, so the rule is:
 *
 *  1. an oütf with a stock id (prefix `nova`, which includes a plug-in
 *     OVERRIDE of a stock id) before one only a plug-in adds, so
 *     installing a plug-in never changes what a stock hull ships with;
 *  2. then the lowest resource number: in stock that is always the base
 *     item, ahead of its illegal, disabling and cloaked variants;
 *  3. then id-space order, so equal numbers from two plug-ins still pick
 *     the same one on every peer.
 */
export function preferredAmmoOutfit(feeding: readonly string[]):
    string | undefined {
    const rank = (id: string): [number, number] => {
        const colon = id.lastIndexOf(":");
        const resource = Number(id.slice(colon + 1));
        return [id.slice(0, colon) === "nova" ? 0 : 1,
            Number.isFinite(resource) ? resource : Infinity];
    };
    let best: string | undefined;
    let bestRank: [number, number] | undefined;
    for (const id of feeding) {
        const r = rank(id);
        if (bestRank === undefined || r[0] < bestRank[0]
            || (r[0] === bestRank[0] && r[1] < bestRank[1])) {
            best = id;
            bestRank = r;
        }
    }
    return best;
}

/** Fields every implicit outfit shares. */
function builtInBase(weapon: WeaponData) {
    return {
        ...getDefaultOutfitData(),
        prefix: weapon.prefix,
        // The hull's own mass budget already accounts for the weapons it
        // comes with, so the implicit item must occupy nothing.
        physics: { freeMass: 0 },
        price: 0,
        // There is no oütf for this weapon, so the original offers the
        // player no way to trade it in either.
        cantSell: true,
        builtIn: true,
    };
}

/** The implicit outfit granting `weapon` to a ship that comes with it. */
export function makeBuiltInWeaponOutfit(weapon: WeaponData): OutfitData {
    const turret = TURRET_GUIDANCE.has(weapon.guidance);
    return {
        ...builtInBase(weapon),
        id: builtInWeaponOutfitId(weapon.id),
        name: weapon.name,
        desc: weapon.name,
        weapons: { [weapon.id]: 1 },
        fixedGun: !turret,
        turret,
    };
}

/**
 * The implicit magazine carrying a built-in `weapon`'s stock load. It
 * feeds the weapon's ammo SUPPLY (its AmmoType target), which is what
 * countAmmo looks for when the weapon fires; a weapon with no supply keeps
 * its own id there, as before. (A save written before this carried such a
 * magazine with `ammoFor` the weapon itself, which nothing ever drew on;
 * the same id now feeds the turret it was meant for.)
 */
export function makeBuiltInAmmoOutfit(weapon: WeaponData): OutfitData {
    return {
        ...builtInBase(weapon),
        id: builtInAmmoOutfitId(weapon.id),
        name: `${weapon.name} Ammunition`,
        desc: `${weapon.name} Ammunition`,
        ammoFor: ammoSupplyWeaponId(weapon) ?? weapon.id,
    };
}
