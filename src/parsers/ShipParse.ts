
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { ShipData, ShipProperties } from "novadatainterface/ShipData";
import { DefaultPictData } from "novadatainterface/PictData";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { BaseParse } from "./BaseParse";
import { NovaResources } from "../ResourceHolderBase";
import { ShipResource } from "../resourceParsers/ShipResource";
import { BaseData } from "novadatainterface/BaseData";
import { Animation, DefaultAnimation } from "novadatainterface/Animation";
import { ShanParse } from "./ShanParse";
import { DescResource } from "../resourceParsers/DescResource";
import { FPS, TurnRateConversionFactor } from "./Constants";

type ShipPictMap = Promise<{ [index: string]: string }>;
type WeaponOutfitMap = ShipPictMap;

function ShipParseClosure(shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    globalIDSpace: Promise<NovaResources>): (s: ShipResource, m: (message: string) => void) => Promise<ShipData> {

    // Returns the function ShipParse with shipPictMap already assigned
    return function(ship: ShipResource, notFoundFunction: (m: string) => void) {
        return ShipParse(ship, notFoundFunction, shipPictMap, weaponOutfitMap, globalIDSpace);
    }
}



async function ShipParse(ship: ShipResource,
    notFoundFunction: (message: string) => void,
    shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    globalIDSpace: Promise<NovaResources>): Promise<ShipData> {


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
        animation = DefaultAnimation;
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
            pictID = DefaultPictData.id;
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
        let outfit = (await globalIDSpace).oütf[outfitID];
        freeMass += outfit.mass * outfits[outfitID];
    }


    var properties: ShipProperties = {
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
        mass: ship.mass,
        freeMass: 0,
    }

    return {
        properties,
        pictID: pictID,
        desc: desc,
        outfits,
        initialExplosion: initialExplosionID,
        finalExplosion: finalExplosionID,
        deathDelay: ship.deathDelay / FPS,
        largeExplosion: ship.deathDelay >= 60,
        displayWeight: ship.id, // TODO: Fix this once displayweight is implemented
        animation,
        ...base
    }
}

export { ShipParse, ShipParseClosure, ShipPictMap, WeaponOutfitMap };
