import { Resource } from "resource_fork";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";
import { NovaResources } from "./resource_holder_base.js";

/** A single [name, value] modification an outfit performs. */
type OutfitFunction = [string, number | boolean];
type OutfitFunctions = Array<OutfitFunction>;

/**
 * Maps a ModType to its `[name, value]` function tuple, or null if the type
 * is unused/ignored (ModTypes 10 and 26) or unknown. Types documented in the
 * EVN Bible pp. 43-46 as the ModType/ModVal pairs. Types marked with a
 * boolean value ignore ModVal; the rest carry the ModVal as their value.
 */
function modFunction(modType: number, modVal: number): OutfitFunction | null {
    switch (modType) {
        case 1: return ["weapon", modVal];
        case 2: return ["freeCargo", modVal];
        case 3: return ["ammunition", modVal];
        case 4: return ["shield", modVal];
        case 5: return ["shieldRecharge", modVal];
        case 6: return ["armor", modVal];
        case 7: return ["acceleration", modVal];
        case 8: return ["speed", modVal];
        case 9: return ["turnRate", modVal];
        case 10: return null; // unused
        case 11: return ["escape pod", true];
        case 12: return ["energy", modVal];
        case 13: return ["density scanner", true];
        case 14: return ["IFF", true];
        case 15: return ["afterburner", modVal];
        case 16: return ["map", modVal];
        // Cloaking device. The ModVal bitfield is decoded by outfit_parse
        // via novadatainterface/cloak_data decodeCloakModVal.
        case 17: return ["cloak", modVal];
        case 18: return ["energyRecharge", modVal];
        case 19: return ["auto refuel", true];
        case 20: return ["auto eject", true];
        case 21: return ["clean legal record", modVal];
        case 22: return ["hyperspace speed mod", modVal];
        case 23: return ["hyperspace dist mod", modVal];
        case 24: return ["interference mod", modVal];
        case 25: return ["marines", modVal];
        case 26: return null; // unused
        case 27: return ["increase maximum", modVal];
        case 28: return ["murk modifier", modVal];
        case 29: return ["armorRecharge", modVal];
        case 30: return ["cloak scanner", modVal];
        case 31: return ["mining scoop", true];
        case 32: return ["multi-jump", modVal];
        case 33: return ["jam 1", modVal];
        case 34: return ["jam 2", modVal];
        case 35: return ["jam 3", modVal];
        case 36: return ["jam 4", modVal];
        case 37: return ["fast jump", true];
        case 38: return ["inertial damper", true];
        case 39: return ["deionize", modVal];
        case 40: return ["ionization", modVal];
        case 41: return ["gravity resistance", true];
        case 42: return ["deadly stellar resistance", true];
        case 43: return ["paint", modVal];
        case 44: return ["reinforcement inhibitor", modVal];
        case 45: return ["maxGuns", modVal];
        case 46: return ["maxTurrets", modVal];
        case 47: return ["bomb", modVal];
        case 48: return ["iff scrambler", modVal];
        case 49: return ["repair system", true];
        case 50: return ["nonlethal bomb", modVal];
        default: return null;
    }
}

/**
 * An outfit item (something you can buy from the "Outfit Ship" dialog).
 *
 * Inline byte layout (1028 bytes, matching Nova's own oütf data exactly),
 * documented in the EVN Bible pp. 43-46.
 *
 * The ResForge oütf template reports a total of only 1018 bytes because it
 * wraps the three secondary ModType/ModVal pairs in an FCNT/LSTC list that the
 * offset generator does not expand. In the real data the list is stored
 * INLINE: an outfit has four ModType/ModVal pairs (a primary plus three
 * secondaries), each a ModType word followed by a single ModVal word. The
 * "oütf.ModTypes" sub-template is only ResForge's UI for editing one pair; each
 * of its keyed groups is a single 2-byte word, so every pair is exactly 4
 * bytes. The resolved layout is:
 *
 *     0    DispWeight        (2B)
 *     2    Mass              (2B)
 *     4    TechLevel         (2B)
 *     6    ModType 1         (2B)   primary function
 *     8    ModVal  1         (2B)
 *     10   Max               (2B)
 *     12   Flags             (2B)
 *     14   Cost              (4B, int32)
 *     18   ModType 2         (2B)   secondary function
 *     20   ModVal  2         (2B)
 *     22   ModType 3         (2B)   secondary function
 *     24   ModVal  3         (2B)
 *     26   ModType 4         (2B)   secondary function
 *     28   ModVal  4         (2B)
 *     30   Contribute        (8B, 64-bit flag set)
 *     38   Require           (8B, 64-bit flag set)
 *     46   Availability NCB  (255B)
 *     301  OnPurchase NCB    (255B)
 *     556  OnSell NCB        (255B)
 *     811  Outfitter Name    (64B)
 *     875  LCName            (64B)
 *     939  LCPlural          (65B)
 *     1004 Item Class        (2B)
 *     1006 Scan Mask         (2B)
 *     1008 Available Random  (2B)
 *     1010 Require Bits ...  (2B)
 *     1012 Unused            (16B)
 *     = 1028 total
 */
class OutfResource extends BaseResource {
    /** Higher weights are shown closer to the top of the outfit dialog. */
    displayWeight: number;
    /** Mass in tons (0 = no appreciable mass). */
    mass: number;
    techLevel: number;
    max: number;
    flags: number;
    cost: number;
    /**
     * The four ModType/ModVal pairs decoded into `[name, value]` tuples, in
     * order, with unused/ignored/empty (ModType < 1) pairs dropped. See the
     * ModType table in the EVN Bible pp. 43-46.
     */
    functions: OutfitFunctions;
    /** 64-bit flag set contributed while owning this outfit. */
    contribute: bigint;
    /** 64-bit flags and'ed against the player's Contribute bits to buy. */
    require: bigint;
    /** NCB test gating outfitter availability. */
    availability: string;
    /** NCB set evaluated on purchase. */
    onPurchase: string;
    /** NCB set evaluated on sale. */
    onSell: string;
    /** Name shown in the outfit dialog menu. */
    outfitterName: string;
    /** Lower-case singular name. */
    lcName: string;
    /** Lower-case plural name. */
    lcPlural: string;
    /** Classification used by përs ships; 0/-1 = unused. */
    itemClass: number;
    /** Illegal-outfit mask matched against a gövt's ScanMask; 0 = unused. */
    scanMask: number;
    /** Percent chance (1-100) the outfit is on sale on a given day. */
    availableRandom: number;
    /** Which stellars the Require bits apply to; -1 = all outfit shops. */
    requireBitsApplyTo: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        this.displayWeight = r.int16();
        this.mass = r.int16();
        this.techLevel = r.int16();

        // Primary ModType/ModVal pair.
        const modTypes = [r.int16(-1)];
        const modVals = [r.int16()];

        this.max = r.int16();
        this.flags = r.uint16();
        this.cost = r.int32();

        // Three secondary ModType/ModVal pairs, stored inline after Cost.
        for (let i = 0; i < 3; i++) {
            modTypes.push(r.int16(-1));
            modVals.push(r.int16());
        }
        this.functions = modTypes.flatMap((modType, i) => {
            const fn = modFunction(modType, modVals[i]);
            return fn === null ? [] : [fn];
        });

        this.contribute = r.uint64();
        this.require = r.uint64();

        this.availability = r.string(0xff);
        this.onPurchase = r.string(0xff);
        this.onSell = r.string(0xff);

        this.outfitterName = r.string(0x40);
        this.lcName = r.string(0x40);
        this.lcPlural = r.string(0x41);

        this.itemClass = r.int16();
        this.scanMask = r.uint16();
        this.availableRandom = r.int16();
        this.requireBitsApplyTo = r.int16(-1);
    }

    get pictID(): number {
        return this.id - 128 + 6000;
    }
    get descID(): number {
        return this.id - 128 + 3000;
    }
}

export { OutfResource };
