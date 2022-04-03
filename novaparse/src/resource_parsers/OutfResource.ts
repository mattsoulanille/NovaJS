import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resource_fork";

type OutfitFunctions = Array<[string, number | boolean]>;
class OutfResource extends BaseResource {
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
    }
    get displayWeight(): number {
        return this.data.getInt16(0);
    }
    get mass(): number {
        return this.data.getInt16(2);
    }
    get techLevel(): number {
        return this.data.getInt16(4);
    }
    get max(): number {
        return this.data.getInt16(10);
    }
    get pictID(): number {
        return this.id - 128 + 6000;
    }
    get descID(): number {
        return this.id - 128 + 3000;
    }
    get cost(): number {
        return this.data.getInt32(14);
    }
    get functions(): OutfitFunctions {
        var functions: OutfitFunctions = [];
        var modPositions = [6, 18, 22, 26];

        for (var i in modPositions) {
            let pos = modPositions[i];
            let modType = this.data.getInt16(pos);
            let modVal = this.data.getInt16(pos + 2);

            switch (modType) {
                case 1:
                    functions.push(["weapon", modVal]);
                    break;
                case 2:
                    functions.push(["freeCargo", modVal]);
                    break;
                case 3:
                    functions.push(["ammunition", modVal]);
                    break;
                case 4:
                    functions.push(["shield", modVal]);
                    break;
                case 5:
                    functions.push(["shieldRecharge", modVal]);
                    break;
                case 6:
                    functions.push(["armor", modVal]);
                    break;
                case 7:
                    functions.push(["acceleration", modVal]);
                    break;
                case 8:
                    functions.push(["speed", modVal]);
                    break;
                case 9:
                    functions.push(["turnRate", modVal]);
                    break;
                case 10:
                    // unused
                    break;
                case 11:
                    functions.push(["escape pod", true]);
                    break;
                case 12:
                    functions.push(["energy", modVal]);
                    break;
                case 13:
                    functions.push(["density scanner", true]);
                    break;
                case 14:
                    functions.push(["IFF", true]);
                    break;
                case 15:
                    functions.push(["afterburner", modVal]);
                    break;
                case 16:
                    functions.push(["map", modVal]);
                    break;
                case 17:
                    // This will need perhaps some more parsing. There are many different cloaking device types
                    functions.push(["cloak", modVal]);
                    break;
                case 18:
                    functions.push(["energyRecharge", modVal]);
                    break;
                case 19:
                    functions.push(["auto refuel", true]);
                    break;
                case 20:
                    functions.push(["auto eject", true]);
                    break;
                case 21:
                    functions.push(["clean legal record", modVal]);
                    break;
                case 22:
                    functions.push(["hyperspace speed mod", modVal]);
                    break;
                case 23:
                    // distance from system center
                    functions.push(["hyperspace dist mod", modVal]);
                    break;
                case 24:
                    functions.push(["interference mod", modVal]);
                    break;
                case 25:
                    functions.push(["marines", modVal]);
                    break;
                case 26:
                    // unused
                    break;
                case 27:
                    functions.push(["increase maximum", modVal]);
                    break;
                case 28:
                    functions.push(["murk modifier", modVal]);
                    break;
                case 29:
                    functions.push(["armorRecharge", modVal]);
                    break;
                case 30:
                    functions.push(["cloak scanner", modVal]);
                    break;
                case 31:
                    functions.push(["mining scoop", true]);
                    break;
                case 32:
                    functions.push(["multi-jump", modVal]);
                    break;
                case 33:
                    functions.push(["jam 1", modVal]);
                    break;
                case 34:
                    functions.push(["jam 2", modVal]);
                    break;
                case 35:
                    functions.push(["jam 3", modVal]);
                    break;
                case 36:
                    functions.push(["jam 4", modVal]);
                    break;
                case 37:
                    functions.push(["fast jump", true]);
                    break;
                case 38:
                    functions.push(["inertial damper", true]);
                    break;
                case 39:
                    functions.push(["deionize", modVal]);
                    break;
                case 40:
                    // increase ionization capacity
                    functions.push(["ionization", modVal]);
                    break;
                case 41:
                    functions.push(["gravity resistance", true]);
                    break;
                case 42:
                    functions.push(["deadly stellar resistance", true]);
                    break;
                case 43:
                    functions.push(["paint", modVal]);
                    break;
                case 44:
                    functions.push(["reinforcement inhibitor", modVal]);
                    break;
                case 45:
                    functions.push(["maxGuns", modVal]);
                    break;
                case 46:
                    functions.push(["maxTurrets", modVal]);
                    break;
                case 47:
                    functions.push(["bomb", modVal]);
                    break;
                case 48:
                    functions.push(["iff scrambler", true]);
                    break;
                case 49:
                    functions.push(["repair system", true]);
                    break;
                case 50:
                    functions.push(["nonlethal bomb", true]);
                    break;
                default:
                    break;
            }
        }
        return functions;
    }


}

export { OutfResource };
