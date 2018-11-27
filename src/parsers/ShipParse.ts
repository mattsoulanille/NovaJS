
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { ShipData } from "novadatainterface/ShipData";
import { DefaultPictData } from "novadatainterface/PictData";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { BaseParse } from "./BaseParse";
import { NovaResources } from "../ResourceHolderBase";
import { ShipResource } from "../resourceParsers/ShipResource";
import { BaseData } from "novadatainterface/BaseData";
import { Animation } from "novadatainterface/Animation";
import { ShanParse } from "./ShanParse";


async function ShipParse(ship: ShipResource): Promise<ShipData> {

    var base: BaseData = await BaseParse(ship);





    var pictID = DefaultPictData.id;
    try {
        let pict = ship.idSpace.PICT[ship.pictID]
        if (typeof pict !== "undefined") {
            pictID = pict.globalID;
        }
    }
    catch (e) {
        console.warn(e);
    }



    var desc: string;
    try {
        desc = ship.idSpace.dësc[ship.descID].text;
    }
    catch (e) {
        desc = "Parsing desc failed: " + e.message;
    }

    // TODO: Parse Explosions
    var initialExplosion: ExplosionData | null = null;
    var finalExplosion: ExplosionData | null = null;

    if (ship.initialExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.initialExplosion]
        if (boom) {
            let boomID = boom.globalID;
            //initialExplosion = await data[NovaDataType.Explosion].get(boomID);
        }
    }

    if (ship.finalExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.finalExplosion]
        if (boom) {
            let boomID = boom.globalID;
            //finalExplosion = await data[NovaDataType.Explosion].get(boomID);
        }
    }



    var animation: Animation = await ShanParse(ship.idSpace.shän[ship.globalID]);

    return {
        pictID: pictID,
        desc: desc,
        shield: ship.shield,
        shieldRecharge: ship.shieldRecharge * 30 / 1000, // Recharge per second
        armor: ship.armor,
        armorRecharge: ship.armorRecharge * 30 / 1000,
        energy: ship.energy,
        energyRecharge: 30 / ship.energyRecharge, // Frames per unit -> units per second
        ionization: ship.ionization,
        deionize: ship.deionize / 100 * 30, // 100 is 1 point of ion energy per 1/30th of a second (evn bible)
        speed: ship.speed, // TODO: Figure out the correct scaling factor for these
        acceleration: ship.acceleration,
        turnRate: ship.turnRate * (100 / 30) * (2 * Math.PI / 360) | 0, // 30 / 100 degrees per second -> Radians per second
        mass: ship.mass,
        outfits: {}, //TODO: Parse Outfits
        initialExplosion: initialExplosion,
        finalExplosion: finalExplosion,
        deathDelay: ship.deathDelay / 60,
        largeExplosion: ship.deathDelay >= 60,
        displayWeight: ship.id, // TODO: Fix this once displayweight is implemented
        animation,
        freeMass: 0,
        ...base
    }
}

export { ShipParse };
