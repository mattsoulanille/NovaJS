import { OutfResource } from "../resourceParsers/OutfResource";
import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { OutfitData } from "novadatainterface/OutiftData";
import { DefaultPictData } from "novadatainterface/PictData";
import { FPS, TurnRateConversionFactor } from "./Constants";


const noUnitConversion = new Set(["cargo", "shield", "armor", "energy", "ionization"])
const perFrameTimes1000 = new Set(["shieldRecharge", "armorRecharge"]);

async function OutfitParse(outf: OutfResource, notFoundFunction: (m: string) => void): Promise<OutfitData> {
    var base: BaseData = await BaseParse(outf, notFoundFunction);

    // Unlike during parsing, these are objects instead of
    // lists of tuples because properties should not be repeated,
    // and objects enforce a "one value per key" requirement.
    var weapons: { [index: string]: number } = {};
    var properties: { [index: string]: number | boolean } = {};


    for (let i in outf.functions) {
        let func = outf.functions[i];
        let fType = func[0];
        let fVal = func[1];

        // Unit conversions. Everything should be in units / second.
        // Parse weapons as well.
        // Refactor me with ship properties???
        if (fType == "weapon") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for weapon val. Expected number");
            }

            let weap = outf.idSpace.wëap[fVal];
            if (!weap) {
                notFoundFunction("Missing wëap id " + fVal + " for oütf " + base.id);
                continue;
            }
            var weaponGlobalID = weap.globalID;

            if (!(weaponGlobalID in weapons)) {
                weapons[weaponGlobalID] = 0;
            }
            weapons[weaponGlobalID] += 1;
        }
        else if (noUnitConversion.has(fType)) {
            // No unit conversion needed
            properties[fType] = fVal;
        }
        else if (perFrameTimes1000.has(fType)) {
            // convert from (units * 1000) / frame to units / second
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            properties[fType] = fVal * FPS / 1000;
        }
        else if (fType == "deionize") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            properties["deionize"] = fVal * FPS / 100;
        }
        else if (fType == "turnRate") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            properties["deionize"] = fVal * TurnRateConversionFactor;
        }
        else if (fType == "energyRecharge") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            properties["energyRecharge"] = FPS / fVal;

        }
        else {
            //throw new Error("Unknown outfit function " + fType + " on outfit " + base.id);
        }
    }


    var pict: string;
    var pictResource = outf.idSpace.PICT[outf.pictID];
    if (pictResource) {
        pict = pictResource.globalID;
    }
    else {
        notFoundFunction("No matching PICT for oütf of id " + base.id);
        pict = DefaultPictData.id;
    }

    var desc: string;
    var descResource = outf.idSpace.dësc[outf.descID];
    if (descResource) {
        desc = descResource.text;
    }
    else {
        desc = "No matching dësc for oütf of id " + base.id;
        notFoundFunction(desc);
    }

    return {
        ...base,
        weapons,
        properties,
        pict,
        mass: outf.mass,
        price: outf.cost,
        desc,
        displayWeight: outf.displayWeight,
        max: outf.max
    }
}

export { OutfitParse }
