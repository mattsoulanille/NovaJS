import { Animation, getDefaultAnimation } from "novadatainterface/Animation";
import { BaseData } from "novadatainterface/BaseData";
import { getDefaultPictData } from "novadatainterface/PictData";
import { ShipData, ShipPhysics } from "novadatainterface/ShipData";
import { NovaResources } from "../resource_parsers/ResourceHolderBase";
import { ShipResource } from "../resource_parsers/ShipResource";
import { BaseParse } from "./BaseParse";
import { FPS, TurnRateConversionFactor } from "./Constants";
import { ShanParse } from "./ShanParse";


export type ShipPictMap = Promise<{ [index: string]: string }>;
export type WeaponOutfitMap = ShipPictMap;

export function ShipParseClosure(shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    globalIDSpacePromise: Promise<NovaResources | Error>): (s: ShipResource, m: (message: string) => void) => Promise<ShipData> {

    // Returns the function ShipParse with shipPictMap already assigned
    return function(ship: ShipResource, notFoundFunction: (m: string) => void) {
        return ShipParse(ship, notFoundFunction, shipPictMap, weaponOutfitMap, globalIDSpacePromise);
    }

}

export async function ShipParse(ship: ShipResource,
    notFoundFunction: (message: string) => void,
    shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    globalIDSpacePromise: Promise<NovaResources | Error>): Promise<ShipData> {

    var globalIDSpace = await globalIDSpacePromise;

    if (globalIDSpace instanceof Error) {
        throw globalIDSpace;
    }

    var base: BaseData = await BaseParse(ship, notFoundFunction);

    var desc: string;
    var descResource = ship.idSpace.dësc[ship.descID];
    if (descResource) {
        desc = descResource.text;
    }
    else {
        desc = "No matching dësc for shïp of id " + base.id;
        notFoundFunction(desc);
    }

    // TODO: Parse Explosions
    var initialExplosionID: string | null = null;
    var finalExplosionID: string | null = null;

    // Refactor into a function? Eh, there's only 2 of them.
    if (ship.initialExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.initialExplosion]
        if (boom) {
            initialExplosionID = boom.globalID;
        }
        else {
            notFoundFunction("shïp id " + base.id + " missing bööm of id " + ship.initialExplosion);
        }
    }

    if (ship.finalExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.finalExplosion]
        if (boom) {
            finalExplosionID = boom.globalID;
        }
        else {
            notFoundFunction("shïp id " + base.id + " missing bööm of id " + ship.finalExplosion);
        }
    }


    var shanResource = ship.idSpace.shän[ship.id];
    var animation: Animation;
    if (shanResource) {
        animation = await ShanParse(shanResource, notFoundFunction);
    }
    else {
        notFoundFunction("No matching shän for shïp of id " + base.id);
        animation = getDefaultAnimation();
    }



    var pictID: string;
    var pict = ship.idSpace.PICT[ship.pictID]
    if (pict) {
        pictID = pict.globalID;
    }
    else {
        pictID = (await shipPictMap)[base.id];
        if (!pictID) {
            notFoundFunction("No matching PICT for ship of id " + base.id);
            pictID = getDefaultPictData().id;
        }
    }




    // Outfits and weapons are included on the ship. Weapons need to be
    // turned into their corresponding outfits.

    var outfits: { [index: string]: number } = {} // globalID : count

    // Parse Outfits
    // Refactor with parse weapons?
    for (let i in ship.outfits) {
        var o = ship.outfits[i];
        var localID = o.id;
        var count = o.count;

        let outfit = ship.idSpace.oütf[localID];
        if (!outfit) {
            notFoundFunction("No matching oütf of id " + localID + " for ship of id " + base.id);
            continue; // Outfit not found so don't add it
        }
        var globalID = outfit.globalID;
        if (!outfits[globalID]) {
            outfits[globalID] = 0;
        }
        outfits[globalID] += count;
    }

    // Parse weapons, turning them into their corresponding outfits.
    for (let i in ship.weapons) {
        var w = ship.weapons[i];
        var localID = w.id;
        var count = w.count;

        var weapon = ship.idSpace.wëap[localID]
        if (!weapon) {
            notFoundFunction("No matching wëap of id " + localID + " for ship of id " + base.id);
            continue;
        }
        var globalID = weapon.globalID;

        var outfitID = (await weaponOutfitMap)[globalID];
        if (!outfitID) {
            notFoundFunction("No matching oütf for weapon of id " + weapon.globalID);
            continue;
        }
        if (!outfits[outfitID]) {
            outfits[outfitID] = 0;
        }
        outfits[outfitID] += count;
    }

    // The ship's free mass is mass on top of the mass of preinstalled outfits,
    // so to find it's actual free mass, we add in the masses of all the outfits.
    // (this is done while outfits are parsed).
    var freeMass = ship.freeSpace;
    for (let outfitID in outfits) {
        let outfit = globalIDSpace.oütf[outfitID];
        freeMass += outfit.mass * outfits[outfitID];
    }

    var physics: ShipPhysics = {
        shield: ship.shield,
        shieldRecharge: ship.shieldRecharge * FPS / 1000, // Recharge per second
        armor: ship.armor,
        armorRecharge: ship.armorRecharge * FPS / 1000,
        energy: ship.energy,
        energyRecharge: FPS / ship.energyRecharge, // Frames per unit -> units per second
        ionization: ship.ionization,
        deionize: ship.deionize / 100 * FPS, // 100 is 1 point of ion energy per 1/30th of a second (evn bible)
        speed: ship.speed, // TODO: Figure out the correct scaling factor for these
        acceleration: ship.acceleration,
        turnRate: ship.turnRate * TurnRateConversionFactor,
        inertialess: Boolean(ship.flags2N & 0x40),
        mass: ship.mass,
        freeMass,
        freeCargo: ship.cargoSpace,
    }

    return {
        physics,
        pict: pictID,
        desc: desc,
        outfits,
        initialExplosion: initialExplosionID,
        finalExplosion: finalExplosionID,
        deathDelay: ship.deathDelay / FPS,
        largeExplosion: ship.deathDelay >= 60,
        displayWeight: ship.id, // TODO: Fix this once displayweight is implemented
        animation,
        vulnerableTo: ["normal"], // TODO: Parse if it's vulnerable to point defense
        ...base
    }
}
