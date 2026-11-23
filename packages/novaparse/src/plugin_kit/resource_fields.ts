/**
 * Named byte offsets for the Nova resource fields that experiment plug-ins
 * (scripts/novaref plugin-make) set, so a plug-in spec can say
 * `"set": {"speed": 600}` instead of a raw offset.
 *
 * Offsets follow the field order of this package's own resource parsers
 * (src/resource_parsers/*_resource.ts) and docs/tmpl/tmpl_offsets.txt.
 * test/plugin_kit/resource_fields_test.ts writes every field here and reads
 * it back through the parser, so a wrong offset fails the spec.
 *
 * Field kinds: i16 / u16 / i32 / u32 / u64 (big-endian), `i16xN` arrays,
 * and `strN` (a NUL-padded C string in an N-byte buffer).
 */

export type FieldKind = "i16" | "u16" | "i32" | "u32" | "u64" | `i16x${number}` | `str${number}`;
export type FieldTable = { [name: string]: [offset: number, kind: FieldKind] };

/** The size of each type's template (EV Nova pads shorter resources). */
export const RESOURCE_SIZES: { [type: string]: number } = {
    "shïp": 1860, "wëap": 134, "oütf": 1028, "sÿst": 428, "spöb": 1118,
    "gövt": 192, "düde": 88, "mïsn": 1970, "jünk": 676, "përs": 400,
};

export const RESOURCE_FIELDS: { [type: string]: FieldTable } = {
    "shïp": {
        cargo: [0, "i16"], shield: [2, "i16"], accel: [4, "i16"], speed: [6, "i16"],
        turn: [8, "i16"], fuel: [10, "i16"], freeMass: [12, "i16"], armor: [14, "i16"],
        shieldRecharge: [16, "i16"], weapons: [18, "i16x4"], weaponCounts: [26, "i16x4"],
        weaponAmmo: [34, "i16x4"], maxGuns: [42, "i16"], maxTurrets: [44, "i16"],
        techLevel: [46, "i16"], cost: [48, "i32"], deathDelay: [52, "i16"],
        armorRecharge: [54, "i16"], explode1: [56, "i16"], explode2: [58, "i16"],
        displayWeight: [60, "i16"], mass: [62, "i16"], length: [64, "i16"],
        ai: [66, "i16"], crew: [68, "i16"], strength: [70, "i16"], govt: [72, "i16"],
        flags: [74, "u16"], podCount: [76, "i16"], outfits: [78, "i16x4"],
        outfitCounts: [86, "i16x4"], fuelRegen: [94, "i16"], skillVar: [96, "i16"],
        flags2: [98, "u16"], contribute: [100, "u64"], availability: [108, "str255"],
        appearOn: [363, "str255"], onPurchase: [618, "str256"], deionize: [874, "i16"],
        ionization: [876, "i16"], keyCarried: [878, "i16"], outfits2: [880, "i16x4"],
        outfitCounts2: [888, "i16x4"], require: [896, "u64"], buyRandom: [904, "i16"],
        hireRandom: [906, "i16"], onCapture: [976, "str255"], onRetire: [1231, "str255"],
        shortName: [1486, "str64"], commName: [1550, "str32"], longName: [1582, "str128"],
        movieFile: [1710, "str32"], weapons2: [1742, "i16x4"], weaponCounts2: [1750, "i16x4"],
        weaponAmmo2: [1758, "i16x4"], subtitle: [1766, "str64"], flags3: [1830, "u16"],
        escortUpgradeTo: [1832, "i16"], escortUpgradeCost: [1834, "i32"],
        escortSellValue: [1838, "i32"], escortType: [1842, "i16"],
    },
    "wëap": {
        reload: [0, "i16"], duration: [2, "i16"], armorDamage: [4, "i16"],
        shieldDamage: [6, "i16"], guidance: [8, "i16"], speed: [10, "i16"],
        ammoType: [12, "i16"], graphic: [14, "i16"], inaccuracy: [16, "i16"],
        sound: [18, "i16"], impact: [20, "i16"], explosion: [22, "i16"],
        proxRadius: [24, "i16"], blastRadius: [26, "i16"], flags: [28, "u16"],
        seekerFlags: [30, "u16"], smokeSet: [32, "i16"], decay: [34, "i16"],
        beamLength: [48, "i16"], beamWidth: [50, "i16"], coronaFalloff: [52, "i16"],
        beamColor: [54, "u32"], coronaColor: [58, "u32"], subCount: [62, "i16"],
        subType: [64, "i16"], subTheta: [66, "i16"], subLimit: [68, "i16"],
        proxSafety: [70, "i16"], flags2: [72, "u16"], ionization: [74, "i16"],
        recoil: [86, "i16"], exitType: [88, "i16"], burstCount: [90, "i16"],
        burstReload: [92, "i16"], jamVuln: [94, "i16x4"], flags3: [102, "u16"],
        durability: [104, "i16"], guidedTurn: [106, "i16"], maxAmmo: [108, "i16"],
    },
    "oütf": {
        displayWeight: [0, "i16"], mass: [2, "i16"], techLevel: [4, "i16"],
        modType: [6, "i16"], modVal: [8, "i16"], max: [10, "i16"], flags: [12, "u16"],
        cost: [14, "i32"], modType2: [18, "i16"], modVal2: [20, "i16"],
        modType3: [22, "i16"], modVal3: [24, "i16"], modType4: [26, "i16"],
        modVal4: [28, "i16"], contribute: [30, "u64"], require: [38, "u64"],
        availability: [46, "str255"], onPurchase: [301, "str255"], onSell: [556, "str255"],
        shortName: [811, "str64"], lcName: [875, "str64"], lcPlural: [939, "str65"],
        itemClass: [1004, "i16"], scanMask: [1006, "u16"], buyRandom: [1008, "i16"],
    },
    "sÿst": {
        x: [0, "i16"], y: [2, "i16"], links: [4, "i16x16"], spobs: [36, "i16x16"],
        dudes: [68, "i16x8"], dudeProbs: [84, "i16x8"], avgShips: [100, "i16"],
        govt: [102, "i16"], buoy: [104, "i16"], asteroids: [106, "i16"],
        interference: [108, "i16"], persons: [110, "i16x8"], personProbs: [126, "i16x8"],
        background: [142, "u32"], murk: [146, "i16"], asteroidTypes: [148, "u16"],
        visibility: [150, "str256"], reinfFleet: [406, "i16"], reinfTime: [408, "i16"],
        reinfInterval: [410, "i16"],
    },
    "spöb": {
        x: [0, "i16"], y: [2, "i16"], type: [4, "i16"], flags: [6, "u32"],
        tribute: [10, "i16"], techLevel: [12, "i16"], specialTech: [14, "i16x3"],
        govt: [20, "i16"], minStatus: [22, "i16"], custPic: [24, "i16"],
        custSnd: [26, "i16"], defenseDude: [28, "i16"], defenseCount: [30, "i16"],
        flags2: [32, "u16"], animDelay: [34, "i16"], frame0Bias: [36, "i16"],
        hyperlinks: [38, "i16x8"], onDominate: [54, "str255"], onRelease: [309, "str255"],
        landingFee: [564, "i32"], gravity: [568, "i16"], weapon: [570, "i16"],
        strength: [572, "i32"], deadType: [576, "i16"], deadTime: [578, "i16"],
        explodeType: [580, "i16"], onDestroy: [582, "str255"], onRegen: [837, "str255"],
        specialTech2: [1092, "i16x5"],
    },
    "gövt": {
        voiceType: [0, "i16"], flags: [2, "u16"], flags2: [4, "u16"], scanFine: [6, "i16"],
        crimeTol: [8, "i16"], smugPenalty: [10, "i16"], disabPenalty: [12, "i16"],
        boardPenalty: [14, "i16"], killPenalty: [16, "i16"], shootPenalty: [18, "i16"],
        initialRec: [20, "i16"], maxOdds: [22, "i16"], classes: [24, "i16x4"],
        allies: [32, "i16x4"], enemies: [40, "i16x4"], skillMult: [48, "i16"],
        scanMask: [50, "u16"], commName: [52, "str16"], targetCode: [68, "str16"],
        require: [84, "u64"], inhJam: [92, "i16x4"], mediumName: [100, "str64"],
        color: [164, "u32"], shipColor: [168, "u32"], interface: [172, "i16"],
        newsPic: [174, "i16"],
    },
    "düde": {
        ai: [0, "i16"], govt: [2, "i16"], flags: [4, "u16"], infoTypes: [6, "u16"],
        ships: [8, "i16x16"], probs: [40, "i16x16"],
    },
    "mïsn": {
        availStel: [0, "i16"], availLoc: [4, "i16"], availRecord: [6, "i16"],
        availRating: [8, "i16"], availRandom: [10, "i16"], travelStel: [12, "i16"],
        returnStel: [14, "i16"], cargoType: [16, "i16"], cargoQty: [18, "i16"],
        pickupMode: [20, "i16"], dropoffMode: [22, "i16"], scanMask: [24, "u16"],
        payVal: [28, "i32"], shipCount: [32, "i16"], shipSyst: [34, "i16"],
        shipDude: [36, "i16"], shipGoal: [38, "i16"], shipBehav: [40, "i16"],
        shipNameID: [42, "i16"], shipStart: [44, "i16"], compGovt: [46, "i16"],
        compReward: [48, "i16"], shipSubtitle: [50, "i16"], briefText: [52, "i16"],
        quickBrief: [54, "i16"], loadCargText: [56, "i16"], dropCargText: [58, "i16"],
        compText: [60, "i16"], failText: [62, "i16"], timeLimit: [64, "i16"],
        canAbort: [66, "u16"], shipDoneText: [68, "i16"], auxShipCount: [72, "i16"],
        auxShipDude: [74, "i16"], auxShipSyst: [76, "i16"], flags: [80, "u16"],
        flags2: [82, "u16"], refuseText: [88, "i16"], availShipType: [90, "i16"],
        availBits: [92, "str255"], onAccept: [347, "str255"], onRefuse: [602, "str255"],
        onSuccess: [857, "str255"], onFailure: [1112, "str255"], onAbort: [1367, "str255"],
        require: [1622, "u64"], datePostInc: [1630, "i16"], onShipDone: [1632, "str255"],
        acceptButton: [1887, "str32"], refuseButton: [1919, "str33"], dispWeight: [1952, "i16"],
    },
    "jünk": {
        soldAt: [0, "i16x8"], boughtAt: [16, "i16x8"], basePrice: [32, "i16"],
        flags: [34, "u16"], scanMask: [36, "u16"], lcName: [38, "str64"],
        abbrev: [102, "str64"], buyOn: [166, "str255"], sellOn: [421, "str255"],
    },
    "përs": {
        linkSystem: [0, "i16"], govt: [2, "i16"], ai: [4, "i16"], aggression: [6, "i16"],
        cowardice: [8, "i16"], ship: [10, "i16"], weapons: [12, "i16x4"],
        weaponCounts: [20, "i16x4"], weaponAmmo: [28, "i16x4"], credits: [36, "i32"],
        shieldMod: [40, "i16"], hailPict: [42, "i16"], commQuote: [44, "i16"],
        hailQuote: [46, "i16"], linkMission: [48, "i16"], flags: [50, "u16"],
        activeOn: [52, "str256"], grantClass: [308, "i16"], grantCount: [310, "i16"],
        grantChance: [312, "i16"], subtitle: [314, "str64"], color: [378, "u32"],
        flags2: [382, "u16"],
    },
};

export type FieldValue = number | string | bigint | number[];

/** Parses "@<offset>:<kind>" raw field names. */
function rawField(name: string): [number, FieldKind] | null {
    const m = /^@(\d+):(i16|u16|i32|u32|u64|i16x\d+|str\d+)$/.exec(name);
    return m ? [Number(m[1]), m[2] as FieldKind] : null;
}

function toNumber(v: FieldValue, what: string): number {
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^(0x[0-9a-f]+|-?\d+)$/i.test(v)) return Number(v);
    throw new Error(`${what} needs a number, got ${JSON.stringify(v)}`);
}

/**
 * Sets fields on a copy of `base` (grown to the type's template size if it
 * is shorter) and returns the copy. Field names come from RESOURCE_FIELDS or
 * are raw "@offset:kind". Numbers may be given as "0x..." strings.
 */
export function patchResource(type: string, base: ArrayLike<number>,
    set: { [field: string]: FieldValue }): Uint8Array {
    const table = RESOURCE_FIELDS[type] ?? {};
    const size = Math.max(base.length, RESOURCE_SIZES[type] ?? 0);
    const out = new Uint8Array(size);
    out.set(Array.from(base));
    const dv = new DataView(out.buffer);
    for (const [name, value] of Object.entries(set)) {
        const field = table[name] ?? rawField(name);
        if (!field) {
            throw new Error(`unknown ${type} field "${name}" (known: ${Object.keys(table).join(", ")})`);
        }
        const [at, kind] = field;
        const what = `${type}.${name}`;
        const str = /^str(\d+)$/.exec(kind);
        const arr = /^i16x(\d+)$/.exec(kind);
        if (str) {
            const cap = Number(str[1]);
            if (typeof value !== "string") throw new Error(`${what} needs a string`);
            if (value.length >= cap) throw new Error(`${what} is longer than ${cap - 1} characters`);
            out.fill(0, at, at + cap);
            for (let i = 0; i < value.length; i++) {
                const c = value.charCodeAt(i);
                if (c > 0x7e) throw new Error(`${what}: only ASCII is supported`);
                out[at + i] = c;
            }
        } else if (arr) {
            const n = Number(arr[1]);
            // Exactly n entries: an id list wants -1 for "none" but a count
            // list wants 0, so the spec spells every entry out.
            if (!Array.isArray(value) || value.length !== n) {
                throw new Error(`${what} needs an array of exactly ${n} numbers`);
            }
            for (let i = 0; i < n; i++) dv.setInt16(at + 2 * i, value[i]);
        } else if (kind === "u64") {
            dv.setBigUint64(at, BigInt(value as string | number | bigint));
        } else {
            const v = toNumber(value, what);
            if (kind === "i16") dv.setInt16(at, v);
            else if (kind === "u16") dv.setUint16(at, v);
            else if (kind === "i32") dv.setInt32(at, v);
            else dv.setUint32(at, v);
        }
    }
    return out;
}
