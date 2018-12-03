import { SpobResource } from "../resourceParsers/SpobResource";
import { PlanetData } from "novadatainterface/PlanetData";
import { BaseParse } from "./BaseParse";
import { BaseData } from "novadatainterface/BaseData";
import { DefaultPictData } from "novadatainterface/PictData";
import { DamageType } from "novadatainterface/WeaponData";
import { Animation, DefaultExitPoints, DefaultAnimationImage } from "novadatainterface/Animation";



async function PlanetParse(spob: SpobResource, notFoundFunction: (m: string) => void): Promise<PlanetData> {
    var base: BaseData = await BaseParse(spob, notFoundFunction);

    var desc: string;
    var descResource = spob.idSpace.dësc[spob.landingDescID];
    if (descResource) {
        desc = descResource.text;
    }
    else {
        desc = "No matching dësc for spöb of id " + base.id;
        notFoundFunction(desc);
    }

    var pictID: string;
    var pict = spob.idSpace.PICT[spob.landingPictID]
    if (pict) {
        pictID = pict.globalID;
    }
    else {
        notFoundFunction("No matching PICT for spöb of id " + base.id);
        pictID = DefaultPictData.id;
    }

    var rledResource = spob.idSpace.rlëD[spob.graphic];
    var rledID: string;
    if (rledResource) {
        rledID = rledResource.globalID;
    }
    else {
        notFoundFunction("No matching rlëd id " + spob.graphic + " for spöb of id " + base.id);
        rledID = DefaultAnimationImage.id;
    }



    var animation: Animation = {
        exitPoints: DefaultExitPoints,
        id: base.id,
        name: base.name,
        prefix: base.prefix,
        images: {
            baseImage: {
                id: rledID,
                imagePurposes: {
                    normal: { start: 0, length: 1 }
                }
            }

        }
    };


    return {
        ...base,
        landingDesc: desc,
        landingPict: pictID,
        animation,
        vulnerableTo: <Array<DamageType>>["planetBuster"],
        properties: {
            shield: 1000,
            shieldRecharge: 1000,
            armor: 1000,
            armorRecharge: 1000,
            acceleration: 0,
            speed: 0,
            deionize: 0,
            energy: 0,
            energyRecharge: 0,
            ionization: 0,
            mass: 0,
            turnRate: 0,
        }
    }
}

export { PlanetParse };
