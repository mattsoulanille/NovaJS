import { OutfResource } from "../resource_parsers/outf_resource.js";
import { BaseData } from "novadatainterface/base_data";
import { BaseParse } from "./base_parse.js";
import { FlagNamespaceMap, resolveResourceFlags } from "../flag_namespace.js";
import { CloakData, decodeCloakModVal, getDefaultCloakData } from "novadatainterface/cloak_data";
import { CloakScannerData, decodeCloakScannerModVal, getDefaultCloakScannerData } from "novadatainterface/cloak_scanner_data";
import { OutfitData, OutfitPhysics } from "novadatainterface/outfit_data";
import { getDefaultPictData } from "novadatainterface/pict_data";
import { FPS, OutfitTurnRateConversionFactor, ShipAccelerationConversionFactor, ShipSpeedConversionFactor, ShipTurnRateConversionFactor } from "./constants.js";


// This should not be necessary!
const noUnitConversion = new Set(["freeCargo", "shield", "armor", "energy", "ionization", "maxGuns", "maxTurrets"])
type NoUnitConversion = "freeCargo" | "shield" | "armor" | "energy" | "ionization" | "maxGuns" | "maxTurrets";
const perFrameTimes1000 = new Set(["shieldRecharge", "armorRecharge"]);
type PerFrameTimes1000 = "shieldRecharge" | "armorRecharge";

// `flagMap` namespaces the Require/Contribute bits per plug-in (see
// flag_namespace.ts); null passes the raw 64-bit values through.
export async function OutfitParse(outf: OutfResource, notFoundFunction: (m: string) => void,
    flagMap: FlagNamespaceMap | null = null): Promise<OutfitData> {
    var base: BaseData = await BaseParse(outf, notFoundFunction);

    // Unlike during parsing, these are objects instead of
    // lists of tuples because properties should not be repeated,
    // and objects enforce a "one value per key" requirement.
    var weapons: { [index: string]: number } = {};
    var physics: OutfitPhysics = { freeMass: outf.mass };
    let ammoFor: string | null = null;
    let increasesMax: string | null = null;
    let miningScoop = false;
    // Passive outfit modifiers decoded from the long-tail ModTypes. See
    // OutfitData for each field's semantics; values default to their
    // "not present" value and are set / accumulated by the loop below.
    let murkClear = 0;
    let interferenceReduction = 0;
    let iff = false;
    let autoRefuel = false;
    let multiJump = 0;
    let densityScanner = false;
    let map: number | null = null;
    let marines = 0;
    let repairSystem = false;
    let escapePod = false;
    let autoEject = false;
    let cleanLegalRecord: number | null = null;
    let iffScramblerClass: number | null = null;
    let reinforcementInhibitorClass: number | null = null;
    let paintColor: number | null = null;
    let bomb: number | null = null;
    let nonlethalBomb: number | null = null;
    // Per-type jamming strength (IR, radar, etheric wake, gravimetric) from
    // ModTypes 33-36. Percentages, summed across the outfit's mod pairs.
    var jamming: [number, number, number, number] = [0, 0, 0, 0];
    // ModType 17 "cloaking device"; decoded from its ModVal bitfield. The
    // resource parser emits it as a ["cloak", modVal] function tuple.
    var cloak: CloakData = getDefaultCloakData();
    // ModType 30 "cloak scanner"; decoded from its ModVal bitfield. The
    // resource parser emits it as a ["cloak scanner", modVal] tuple.
    var cloakScanner: CloakScannerData = getDefaultCloakScannerData();

    for (let i in outf.functions) {
        let func = outf.functions[i];
        let fType = func[0];
        let fVal = func[1];

        if (fType === "cloak") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for cloak val. Expected number");
            }
            cloak = decodeCloakModVal(fVal);
            continue;
        }

        if (fType === "cloak scanner") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for cloak scanner val. Expected number");
            }
            cloakScanner = decodeCloakScannerModVal(fVal);
            continue;
        }

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
        else if (fType === "ammunition") {
            // Each item of this outfit is one round of ammo for the
            // weapon with the given id.
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for ammunition val. Expected number");
            }
            let ammoWeap = outf.idSpace.wëap[fVal];
            if (!ammoWeap) {
                notFoundFunction("Missing wëap id " + fVal + " for ammunition oütf " + base.id);
                continue;
            }
            ammoFor = ammoWeap.globalID;
        }
        else if (fType === "increase maximum") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for increase maximum val. Expected number");
            }
            let maxOutf = outf.idSpace.oütf[fVal];
            if (!maxOutf) {
                notFoundFunction("Missing oütf id " + fVal + " for increase-maximum oütf " + base.id);
                continue;
            }
            increasesMax = maxOutf.globalID;
        }
        else if (fType === "afterburner") {
            // ModVal is fuel units burned per second of afterburner use.
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics.afterburner = fVal;
        }
        else if (fType === "mining scoop") {
            miningScoop = true;
        }
        else if (noUnitConversion.has(fType)) {
            //else if (fType === "freeCargo") {
            // No unit conversion needed
            physics[<NoUnitConversion>fType] = <number>fVal;
        }
        else if (perFrameTimes1000.has(fType)) {
            // convert from (units * 1000) / frame to units / second
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics[<PerFrameTimes1000>fType] = fVal * FPS / 1000;
        }
        else if (fType === "deionize") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics[fType] = fVal * FPS / 100;
        }
        else if (fType === "turnRate") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics[fType] = fVal * OutfitTurnRateConversionFactor;
        }
        else if (fType === "energyRecharge") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            // Frames per unit of fuel -> units per second. Negative
            // values are 'fuel sucking' mode and drain instead.
            physics[fType] = fVal === 0 ? 0 : FPS / fVal;
        } else if (fType === "speed") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics[fType] = fVal * ShipSpeedConversionFactor;
        } else if (fType === "acceleration") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics[fType] = fVal * ShipAccelerationConversionFactor;
        }
        else if (fType === "hyperspace dist mod") {
            // Change to the no-jump zone's radius, in pixels.
            if (typeof fVal !== "number") {
                throw new Error("Wrong type. Expected number");
            }
            physics.jumpDistanceMod = fVal;
        }
        else if (fType === "fast jump") {
            // Grants the carrying ship the ability to enter hyperspace
            // without slowing down.
            physics.canJumpWithoutSlowing = true;
        }
        else if (fType === "inertial damper") {
            physics.inertialess = true;
        }
        else if (fType === "murk modifier") {
            // ModVal is the amount ADDED to the system's murkiness (EVN
            // Bible); murkClear is how much murk this outfit REMOVES, so it
            // is the negation. Summed across outfits (an outfit could carry
            // several murk-modifier pairs).
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for murk modifier. Expected number");
            }
            murkClear -= fVal;
        }
        else if (fType === "interference mod") {
            // ModVal is subtracted from the system's radar interference (EVN
            // Bible), so it is the reduction directly. Summed across outfits.
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for interference mod. Expected number");
            }
            interferenceReduction += fVal;
        }
        else if (fType === "IFF") {
            iff = true;
        }
        else if (fType === "auto refuel") {
            autoRefuel = true;
            // Flow through the ship physics so applyOutfitPhysics ORs the
            // capability onto the ship (like fast jump / inertial damper).
            physics.autoRefuel = true;
        }
        else if (fType === "multi-jump") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for multi-jump. Expected number");
            }
            multiJump += fVal;
            // Also flow it through the ship physics so applyOutfitPhysics sums
            // it into the ship's ShipPhysics.multiJump (like jumpDistanceMod).
            physics.multiJump = (physics.multiJump ?? 0) + fVal;
        }
        else if (fType === "hyperspace speed mod") {
            // Signed change (in days) to the ship's per-jump hyperspace
            // travel time (EVN Bible ModType 22). Summed across outfits and
            // flowed through the ship physics; the effective per-jump time is
            // floored at 1 day in calendar.ts.
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for hyperspace speed mod. Expected number");
            }
            physics.hyperspaceSpeedMod =
                (physics.hyperspaceSpeedMod ?? 0) + fVal;
        }
        else if (fType === "density scanner") {
            densityScanner = true;
        }
        else if (fType === "map") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for map. Expected number");
            }
            map = fVal;
        }
        else if (fType === "marines") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for marines. Expected number");
            }
            marines += fVal;
        }
        else if (fType === "repair system") {
            repairSystem = true;
        }
        else if (fType === "escape pod") {
            escapePod = true;
        }
        else if (fType === "auto eject") {
            autoEject = true;
        }
        else if (fType === "clean legal record") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for clean legal record. Expected number");
            }
            cleanLegalRecord = fVal;
        }
        else if (fType === "iff scrambler") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for iff scrambler. Expected number");
            }
            iffScramblerClass = fVal;
        }
        else if (fType === "reinforcement inhibitor") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for reinforcement inhibitor. Expected number");
            }
            reinforcementInhibitorClass = fVal;
        }
        else if (fType === "paint") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for paint. Expected number");
            }
            paintColor = fVal;
        }
        else if (fType === "bomb") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for bomb. Expected number");
            }
            bomb = fVal;
        }
        else if (fType === "nonlethal bomb") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for nonlethal bomb. Expected number");
            }
            nonlethalBomb = fVal;
        }
        else if (fType === "jam 1" || fType === "jam 2"
            || fType === "jam 3" || fType === "jam 4") {
            if (typeof fVal !== "number") {
                throw new Error("Wrong type for jamming. Expected number");
            }
            // "jam 1".."jam 4" -> index 0..3
            const idx = Number(fType.slice(4)) - 1;
            jamming[idx] += fVal;
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
        pict = getDefaultPictData().id;
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
        physics,
        jamming,
        cloak,
        cloakScanner,
        pict,
        price: outf.cost,
        desc,
        displayWeight: outf.displayWeight,
        techLevel: outf.techLevel,
        max: outf.max,
        availability: outf.availability,
        onPurchase: outf.onPurchase,
        onSell: outf.onSell,
        // Flag sets as JSON-safe hex strings, namespaced per plug-in (so
        // they may run past 64 bits).
        contribute: "0x" + resolveResourceFlags(flagMap, outf, outf.contribute).toString(16),
        require: "0x" + resolveResourceFlags(flagMap, outf, outf.require).toString(16),
        fixedGun: (outf.flags & 0x1) > 0,
        turret: (outf.flags & 0x2) > 0,
        // 0x4: stays with you when you trade ships (Bible ~:1962).
        // Read by the shipyard's purchase rules, not the outfitter's.
        persistent: (outf.flags & 0x4) > 0,
        cantSell: (outf.flags & 0x8) > 0,
        // A parsed oütf is a real item by definition; only synthesized
        // built-in-weapon outfits set this.
        builtIn: false,
        // Outfitter visibility / sellability flags; see outfit_data.ts and
        // spaceport/outfitter_rules.ts for what each one gates.
        hideUnlessRequirementsMet: (outf.flags & 0x100) > 0,
        sellAnywhere: (outf.flags & 0x800) > 0,
        excludesEqualDisplayWeight: (outf.flags & 0x1000) > 0,
        hideUnlessAvailable: (outf.flags & 0x4000) > 0,
        ammoFor,
        increasesMax,
        miningScoop,
        murkClear,
        interferenceReduction,
        iff,
        autoRefuel,
        multiJump,
        densityScanner,
        map,
        marines,
        repairSystem,
        escapePod,
        autoEject,
        cleanLegalRecord,
        iffScramblerClass,
        reinforcementInhibitorClass,
        paintColor,
        bomb,
        nonlethalBomb,
    }
}
