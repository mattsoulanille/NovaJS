import { Animation, getDefaultAnimationImage, getDefaultExitPoints } from "novajs/novadatainterface/Animation";
import { BaseData } from "novajs/novadatainterface/BaseData";
import { NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { getDefaultPictData } from "novajs/novadatainterface/PictData";
import { PlanetData } from "novajs/novadatainterface/PlanetData";
import { DamageType } from "novajs/novadatainterface/WeaponData";
import { BLEND_MODES } from "novajs/novadatainterface/BlendModes";
import { SpobResource } from "../resource_parsers/SpobResource";
import { BaseParse } from "./BaseParse";


export async function PlanetParse(spob: SpobResource, notFoundFunction: (m: string) => void): Promise<PlanetData> {
    var base: BaseData = await BaseParse(spob, notFoundFunction);

    const defaultPictData = getDefaultPictData();
    const defaultAnimationImage = getDefaultAnimationImage();

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
        pictID = defaultPictData.id;
    }

    var rledResource = spob.idSpace.rlëD[spob.graphic];
    var rledID: string;
    if (rledResource) {
        rledID = rledResource.globalID;
    }
    else {
        notFoundFunction("No matching rlëd id " + spob.graphic + " for spöb of id " + base.id);
        rledID = defaultAnimationImage.id;
    }

    const animation: Animation = {
        exitPoints: getDefaultExitPoints(),
        id: base.id,
        name: base.name,
        prefix: base.prefix,
        images: {
            baseImage: {
                id: rledID,
                dataType: NovaDataType.SpriteSheetImage,
                blendMode: BLEND_MODES.NORMAL,
                frames: {
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
        physics: {
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
        },
        position: [spob.position[0], spob.position[1]]
    }
}
