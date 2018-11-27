
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { ShipData } from "novadatainterface/ShipData";
import { BaseParse } from "./BaseParse";
import { NovaResources } from "../ResourceHolderBase";
import { ShipResource } from "../resourceParsers/ShipResource";
import { BaseData } from "../../../NovaDataInterface/BaseData";


async function ShipParse(ship: ShipResource): Promise<ShipData> {

    var base: BaseData = await BaseParse(ship);

    var desc: string;
    try {
        desc = ship.idSpace.dësc[ship.descID].text;
    }
    catch (e) {
        desc = "Default description";
    }


    var pictID: string = ship.idSpace.PICT[ship.pictID].globalID;

    try {
        desc = ship.idSpace.dësc[ship.descID].string;
    }
    catch (e) {
        desc = "Parsing desc failed: " + e.message;
    }

    var initialExplosion: BaseResource | null = null; // TODO: Make this Explosion once it exists
    var finalExplosion: BaseResource | null = null;

    if (ship.initialExplosion >= 128) {
        let boomID = ship.idSpace.bööm[ship.initialExplosion].globalID;
        initialExplosion = await data[NovaDataType.Explosion].get(boomID);
    }

    if (ship.finalExplosion >= 128) {
        let boomID = ship.idSpace.bööm[ship.finalExplosion].globalID;
        finalExplosion = await data[NovaDataType.Explosion].get(boomID);
    }


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
        animation: { name: "tmp", id: "tmp", prefix: "tmp", images: {} }, // TODO: Fix
        freeMass: 0,
        ...base
    }
}

export { ShipParse };
