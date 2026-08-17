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
 * AmmoLoad field) when no ammunition oütf feeds that weapon either. Ammo
 * is counted by finding owned outfits whose `ammoFor` names the weapon
 * (nova_plugin/weapon_plugin.ts countAmmo), so without one an
 * ammo-burning built-in weapon is loaded but unfireable.
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

/** The implicit magazine feeding a built-in `weapon`. */
export function makeBuiltInAmmoOutfit(weapon: WeaponData): OutfitData {
    return {
        ...builtInBase(weapon),
        id: builtInAmmoOutfitId(weapon.id),
        name: `${weapon.name} Ammunition`,
        desc: `${weapon.name} Ammunition`,
        ammoFor: weapon.id,
    };
}
