import { Animation, getDefaultAnimationImage, getDefaultExitPoints } from "novadatainterface/animation";
import { BaseData } from "novadatainterface/base_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { getDefaultPictData } from "novadatainterface/pict_data";
import { GateData, PlanetData, TradeTier } from "novadatainterface/planet_data";
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
    }
}
