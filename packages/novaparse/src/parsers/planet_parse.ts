import { Animation, getDefaultAnimationImage, getDefaultExitPoints } from "novadatainterface/animation";
import { BaseData } from "novadatainterface/base_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { getDefaultPictData } from "novadatainterface/pict_data";
import {
    GateData, PlanetData, PlanetDefenseFleet, PlanetDestructionData,
    PlanetDominationData, PlanetWeaponData, TradeTier,
} from "novadatainterface/planet_data";
import { DamageType } from "novadatainterface/weapon_data";
import { BLEND_MODES } from "novadatainterface/blend_modes";
import { SpobResource } from "../resource_parsers/spob_resource.js";
import { BaseParse } from "./base_parse.js";


/** Resource ids below 128 are reserved by the system; a CustPicID in that
 * range means "no custom landscape" (EVN Bible p. 60). */
const MIN_RESOURCE_ID = 128;
/** CustPicID is parsed as a uint16 (spob_resource.ts), so the usual
 * "omitted" encoding of -1 arrives as 65535 rather than a negative. */
const NO_CUSTOM_LANDING_PICT = 65535;

/**
 * Decodes the spöb DefCount field (EVN Bible, spöb resource): below 1000 it
 * is a plain ship count launched all at once; from 1000 up "ships will be
 * launched from the planet or station in waves. The last number in this
 * field is the number of ships in each wave, and the first 3-4 numbers
 * (minus 1 from the first digit) are the total number of ships". A wave
 * size of 0 means no waves (ResForge: "0 = unlimited"). Returns null when
 * the field describes no ships at all (DefCount <= 0, or a wave encoding
 * whose total is 0). See PlanetDefenseFleet for the five-digit reading.
 */
export function decodeDefenseCount(defCount: number):
    { count: number, waveSize: number | null } | null {
    if (defCount < 1000) {
        return defCount > 0 ? { count: defCount, waveSize: null } : null;
    }
    const waveSize = defCount % 10;
    // "The first 3-4 numbers": every digit but the last.
    const leading = Math.floor(defCount / 10);
    // "Minus 1 from the first digit": subtract one unit of the leading
    // digit's place value (100 for 1000-9999, 1000 for 10000-32767).
    const count = leading - 10 ** (String(leading).length - 1);
    if (count <= 0) {
        return null;
    }
    return { count, waveSize: waveSize === 0 ? null : waveSize };
}

/**
 * The linear rlëD approximation for a stellar graphic Type, for when there
 * is no spïn: 2000 + Type, less a one-id gap above the missing rlëD 2056
 * (the same rule SpobResource.graphic applies to the live Type).
 */
function linearStellarGraphic(type: number): number {
    const graphic = type + 2000;
    return graphic > 2058 ? graphic - 1 : graphic;
}

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

    // CustPicID < 128 means "no custom landscape" (EVN Bible p. 60; the
    // field is parsed unsigned, so -1 reads as 65535 and misses the first
    // lookup). The engine then shows the STANDARD landscape for the
    // stellar's Type: a pre-made PICT at 10000 + Type (the raw type, before
    // the rlëD gap adjustment). Validated against original hardware: Port
    // Kane (Type 34, CustPicID -1) renders exactly PICT 10034. Hypergates,
    // wormholes, and unlandable stellars have no standard landscape PICT in
    // the game data; only those fall through to the default placeholder.
    //
    // The range test is explicit rather than "whatever the lookup misses":
    // a CustPicID that IS set to a real id but fails to resolve is a data
    // error worth reporting, and must not be silently swallowed by the
    // standard-landscape fallback.
    var pictID: string;
    const customPictSet = spob.landingPictID >= MIN_RESOURCE_ID
        && spob.landingPictID !== NO_CUSTOM_LANDING_PICT;
    var pict = customPictSet
        ? spob.idSpace.PICT[spob.landingPictID]
        : undefined;
    if (customPictSet && !pict) {
        notFoundFunction("No matching custom landing PICT of id "
            + spob.landingPictID + " for spöb of id " + base.id
            + "; falling back to the standard landscape");
    }
    pict = pict ?? spob.idSpace.PICT[10000 + spob.type];
    if (pict) {
        pictID = pict.globalID;
    }
    else {
        notFoundFunction("No matching PICT for spöb of id " + base.id);
        pictID = defaultPictData.id;
    }

    // Resolve the stellar graphic through its spïn (sprite-info) resource:
    // Nova maps the spöb Type (0-255) to spïn (1000 + Type), whose SpriteID
    // is the real rlëD id (EVN Bible p. 13). This indirection is NOT a plain
    // 2000 + Type offset — wormholes (Type 59) point at rlëD 2300, and some
    // stellars reuse a lower sprite — so the spïn lookup is authoritative.
    // Done here (not in the spöb resource ctor) because it needs the fully
    // built id space: a spöb's spïn can live in a different data file, so a
    // constructor-time lookup would race the parse order. Fall back to the
    // spöb's linear-approximation `graphic` when no spïn exists (e.g. sparse
    // plug-in data).
    const spin = spob.idSpace.spïn[1000 + spob.type];
    const rledGraphicID = spin ? spin.spriteID : spob.graphic;
    var rledResource = spob.idSpace.rlëD[rledGraphicID];
    var rledID: string;
    if (rledResource) {
        rledID = rledResource.globalID;
    }
    else {
        notFoundFunction("No matching rlëd id " + rledGraphicID + " for spöb of id " + base.id);
        rledID = defaultAnimationImage.id;
    }

    // Hypergate / wormhole transit metadata. The spöb HyperLink fields hold
    // local spöb ids of the connected gates/wormholes; resolve each to its
    // global id (the same key SystemData.planets uses) so transit can find the
    // destination stellar and the system it lives in.
    let gate: GateData | null = null;
    if (spob.isHypergate || spob.isWormhole) {
        const destinations: string[] = [];
        for (const linkLocal of spob.hyperlinks) {
            const linkedSpob = spob.idSpace.spöb[linkLocal];
            if (linkedSpob) {
                destinations.push(linkedSpob.globalID);
            } else {
                notFoundFunction("No corresponding spöb " + linkLocal
                    + " for hyperlink from spöb " + base.id);
            }
        }
        // CustSndID doubles as the emergence angle for gates/wormholes: 0-359
        // is an exact angle, anything else means a random direction (Bible
        // p. 60). null signals "random" so the transit code can pick a
        // seeded-random angle deterministically.
        const angle = spob.ambientSound;
        const emergenceAngle = (angle >= 0 && angle <= 359) ? angle : null;
        gate = {
            // Hypergate and wormhole are independent bits; if a stellar somehow
            // sets both, treat it as a hypergate (offers an explicit choice).
            kind: spob.isHypergate ? "hypergate" : "wormhole",
            destinations,
            emergenceAngle,
        };
    }

    const animation: Animation = {
        exitPoints: getDefaultExitPoints(),
        blink: null, // Planets have no running lights.
        animationMode: null, // Planets have no shän extra-frame animation.
        weapDecay: 0, // No weapon overlay outside shän ships.
        id: base.id,
        name: base.name,
        prefix: base.prefix,
        writerPrefix: base.writerPrefix,
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

    // Resolve the owning gövt to its global id; -1 and other sentinel
    // values stay null (independent).
    let govt: string | null = null;
    if (spob.government >= 128) {
        govt = spob.idSpace.gövt[spob.government]?.globalID ?? null;
    }

    // The upper spöb Flags nibbles encode a price tier per standard
    // commodity: 0x1 low, 0x2 medium, 0x4 high, 0 = won't trade
    // (EVN Bible p. 59). Nibble order (high to low): food, industrial,
    // medical, luxury, metal, equipment.
    const tierOf = (nibble: number): TradeTier | null => {
        switch (nibble & 0x7) {
            case 0x1: return "low";
            case 0x2: return "med";
            case 0x4: return "high";
            default: return null;
        }
    };
    const tradeTiers = [28, 24, 20, 16, 12, 8].map(
        shift => tierOf(spob.flags >>> shift));

    // The bar description lives at dësc 10000 + (spöb local id - 128),
    // paralleling the shipyard (13000+) and pilot (14000+) ranges.
    const barDescResource = spob.idSpace.dësc[spob.id - 128 + 10000];
    const barDesc = barDescResource?.text ?? "";
    // The bar dësc's Graphic field points to a PICT shown in the bar's
    // "Bar + pict" frame (PICT 8504); -1/absent means no picture.
    const barGraphic = barDescResource?.graphic ?? -1;
    const barPict = barGraphic >= 0
        ? (spob.idSpace.PICT[barGraphic]?.globalID ?? null) : null;

    // The spöb CustSndID (parsed as `ambientSound`) is the ambient snd
    // resource looped while the player is on this stellar's spaceport main
    // screen (EVN Bible p. 60). It is only an ambient sound for a normal
    // stellar: hypergates and wormholes repurpose the same field as the
    // emergence angle (resolved into `gate.emergenceAngle` above), so a gate
    // never carries a spaceport ambient. Ambient snd ids are real 'snd '
    // resources (128+, mirroring the CustPicID "< 128 = none" convention);
    // -1/absent/sub-128 means no ambient sound.
    let spaceportSound: string | null = null;
    if (!gate && spob.ambientSound >= 128) {
        spaceportSound = spob.idSpace["snd "][spob.ambientSound]?.globalID ?? null;
        if (!spaceportSound) {
            notFoundFunction("No matching snd " + spob.ambientSound
                + " for spöb ambient sound of id " + base.id);
        }
    }

    // Stellar defence, weapon, domination and destruction (#306). Parsed
    // only — no gameplay reads these yet. Every id here is a SOFT
    // reference, like the sÿst spawn tables: an unresolvable one degrades
    // to "none" with a warning rather than going through notFoundFunction,
    // which throws in strict mode and would fail a stellar that parsed
    // before these fields existed.
    let defense: PlanetDefenseFleet | null = null;
    const defenseCount = decodeDefenseCount(spob.defenseCount);
    if (spob.defenseDude >= 128 && defenseCount) {
        const dude = spob.idSpace.düde[spob.defenseDude];
        if (dude) {
            defense = { dude: dude.globalID, ...defenseCount };
        } else {
            console.warn("Missing düde id " + spob.defenseDude
                + " for the defence fleet of spöb " + base.id);
        }
    }

    // Weapon "0 or -1  No weapon", "128-383  Stellar has a weapon of this
    // type".
    let weapon: PlanetWeaponData | null = null;
    if (spob.weapon >= 128) {
        const weap = spob.idSpace.wëap[spob.weapon];
        if (weap) {
            weapon = {
                id: weap.globalID,
                firesOnlyWhenProvoked: Boolean(spob.flags2 & 0x0200),
            };
        } else {
            console.warn("Missing wëap id " + spob.weapon
                + " for spöb " + base.id);
        }
    }

    // Tribute "-1 or 0  Default amount (1000 credits x Tech Level)".
    const tribute = spob.tribute > 0 ? spob.tribute : 1000 * spob.techLevel;

    // DeadType "-1  Don't display different graphic type when destroyed",
    // "0-255  Display this stellar graphic when destroyed": a stellar Type,
    // resolved through spïn exactly like the live graphic above.
    let deadGraphic: string | null = null;
    if (spob.deadType >= 0) {
        const deadSpin = spob.idSpace.spïn[1000 + spob.deadType];
        const deadRled = deadSpin
            ? deadSpin.spriteID : linearStellarGraphic(spob.deadType);
        deadGraphic = spob.idSpace.rlëD[deadRled]?.globalID ?? null;
        if (!deadGraphic) {
            console.warn("Missing rlëD id " + deadRled
                + " for the destroyed graphic of spöb " + base.id);
        }
    }

    // ExplodType: the resource has already applied the +128 (and stripped
    // the +1000 sparks bias into explosionSparks); -1 arrives as null.
    let explosion: string | null = null;
    if (spob.explosion !== null && spob.explosion >= 128) {
        explosion = spob.idSpace.bööm[spob.explosion]?.globalID ?? null;
        if (!explosion) {
            console.warn("Missing bööm id " + spob.explosion
                + " for spöb " + base.id);
        }
    }
    // The sparks are explosion type 0 (bööm 128) in the spöb's own id
    // space, exactly as ship_parse resolves finalExplosionSparks.
    const explosionSparks = explosion && spob.explosionSparks
        ? (spob.idSpace.bööm[128]?.globalID ?? null) : null;

    const domination: PlanetDominationData = {
        tribute,
        alwaysDominated: Boolean(spob.flags2 & 0x0020),
        // The NCB strings were rewritten to physical bits by
        // ncb_namespace before any parser runs (NCB_FIELDS["spöb"]).
        onDominate: spob.onDominate,
        onRelease: spob.onRelease,
    };

    const destruction: PlanetDestructionData = {
        // Strength "Set this to 0 or -1 for an invincible stellar".
        strength: spob.strength > 0 ? spob.strength : null,
        startsDestroyed: Boolean(spob.flags2 & 0x0040),
        deadGraphic,
        animateOnlyWhenDestroyed: Boolean(spob.flags2 & 0x0080),
        // DeadTime "0 for a stellar that regenerates at the end of every
        // day, or -1 for a stellar that never regenerates on its own".
        regenerationDays: spob.deadTime >= 0 ? spob.deadTime : null,
        explosion,
        explosionSparks,
        onDestroy: spob.onDestroy,
        onRegen: spob.onRegen,
    };

    return {
        ...base,
        landingDesc: desc,
        landingPict: pictID,
        animation,
        govt,
        // spöb MinStatus (int16 at offset 22), passed through verbatim
        // including both sentinels (-32767 ignored / 32767 never).
        minStatus: spob.minStatus,
        flags: {
            canLand: Boolean(spob.flags & 0x1),
            hasCommodityExchange: Boolean(spob.flags & 0x2),
            hasOutfitter: Boolean(spob.flags & 0x4),
            hasShipyard: Boolean(spob.flags & 0x8),
            isStation: Boolean(spob.flags & 0x10),
            uninhabited: Boolean(spob.flags & 0x20),
            hasBar: Boolean(spob.flags & 0x40),
            landOnlyIfDestroyed: Boolean(spob.flags & 0x80),
            // NOTE: this one is a Flags2 bit, not a Flags bit (EVN Bible's
            // Flags2 block, ~:2862) — the outfit shop buys back anything
            // nonpermanent the player owns, ignoring tech level.
            buysAnyOutfit: Boolean(spob.flags2 & 0x400),
        },
        techLevel: spob.techLevel,
        // Only meaningful slots: unset SpecialTech entries are -1 (and 0
        // appears as filler). Dropping them is behaviour-preserving because
        // the exact-match rule only ever fires for an outfit/ship whose own
        // TechLevel is that value, and a TechLevel <= 0 item is already
        // admitted everywhere by the ordinary `spob.techLevel >= x` test.
        specialTech: spob.specialTech.filter(tech => tech > 0),
        tradeTiers,
        barDesc,
        barPict,
        animationDelay: spob.animationDelay,
        spaceportSound,
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
            inertialess: true,
        },
        position: [spob.position[0], spob.position[1]],
        gate,
        landingFee: spob.landingFee,
        defense,
        weapon,
        domination,
        destruction,
        // Flags2 0x0100 "Stellar is deadly - all ships that touch it are
        // destroyed immediately".
        deadly: Boolean(spob.flags2 & 0x0100),
        // Gravity "0 for none, positive for stellars that pull, negative
        // for stellars that push": signed, passed through.
        gravity: spob.gravity,
    }
}
