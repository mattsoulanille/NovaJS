import { Animation, getDefaultAnimation } from "novadatainterface/animation";
import { BaseData } from "novadatainterface/base_data";
import { getDefaultPictData } from "novadatainterface/pict_data";
import { ShipData, ShipPhysics } from "novadatainterface/ship_data";
import { BayGuidanceSet } from "novadatainterface/weapon_data";
import {
    builtInAmmoOutfitId, builtInWeaponOutfitId,
} from "../built_in_weapon_outfit.js";
import { NovaResources } from "../resource_parsers/resource_holder_base.js";
import { ShipResource } from "../resource_parsers/ship_resource.js";
import { BaseParse } from "./base_parse.js";
import { FlagNamespaceMap, resolveResourceFlags } from "../flag_namespace.js";
import { FPS, ShipAccelerationConversionFactor, ShipSpeedConversionFactor, ShipTurnRateConversionFactor } from "./constants.js";
import { ShanParse } from "./shan_parse.js";


/**
 * The gövt LOCAL id a shïp's InherentGovt names for status-bar (ïntf)
 * purposes, or null when the class has no inherent government at all. The
 * Bible's shïp section gives the field three ranges: 128-383 is both the
 * combat and the attributes govt, 1128-1383 is an attributes govt offset by
 * 1000, and 2128-2383 a combat govt offset by 2000. The gövt Interface rule
 * accepts either association, so all three collapse to one id here.
 */
export function interfaceGovtId(inherentGovt: number): number | null {
    if (inherentGovt >= 2128 && inherentGovt <= 2383) {
        return inherentGovt - 2000;
    }
    if (inherentGovt >= 1128 && inherentGovt <= 1383) {
        return inherentGovt - 1000;
    }
    if (inherentGovt >= 128 && inherentGovt <= 383) {
        return inherentGovt;
    }
    return null;
}

export type ShipPictMap = Promise<{ [index: string]: string }>;
export type WeaponOutfitMap = ShipPictMap;
/** Maps a weapon's global id to the outfit that is its ammo. */
export type AmmoOutfitMap = ShipPictMap;

export function ShipParseClosure(shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    ammoOutfitMap: AmmoOutfitMap,
    globalIDSpacePromise: Promise<NovaResources | Error>,
    // Namespaces the Require/Contribute bits per plug-in (flag_namespace.ts);
    // null (the default) passes the raw 64-bit values through.
    flagMapPromise: Promise<FlagNamespaceMap | null> = Promise.resolve(null),
): (s: ShipResource, m: (message: string) => void) => Promise<ShipData> {

    // Returns the function ShipParse with shipPictMap already assigned
    return function(ship: ShipResource, notFoundFunction: (m: string) => void) {
        return ShipParse(ship, notFoundFunction, shipPictMap, weaponOutfitMap,
            ammoOutfitMap, globalIDSpacePromise, flagMapPromise);
    }

}

export async function ShipParse(ship: ShipResource,
    notFoundFunction: (message: string) => void,
    shipPictMap: ShipPictMap,
    weaponOutfitMap: WeaponOutfitMap,
    ammoOutfitMap: AmmoOutfitMap,
    globalIDSpacePromise: Promise<NovaResources | Error>,
    flagMapPromise: Promise<FlagNamespaceMap | null> = Promise.resolve(null),
): Promise<ShipData> {

    var globalIDSpace = await globalIDSpacePromise;

    if (globalIDSpace instanceof Error) {
        throw globalIDSpace;
    }
    const flagMap = await flagMapPromise;

    var base: BaseData = await BaseParse(ship, notFoundFunction);

    var desc: string;
    var descResource = ship.idSpace.dësc[ship.descID];
    if (descResource) {
        desc = descResource.text;
    }
    else {
        desc = "No matching dësc for shïp of id " + base.id;
        notFoundFunction(desc);
    }

    // The shipyard "More Info" artwork is the ship dësc's Graphic field —
    // the same mechanism the spöb bar description uses for its picture, not
    // a fixed offset from the browse pict. In stock data it resolves to
    // PICT 20000 + shïp id: a 600x400 painted scene (the ship staged
    // against a station or planet), against the 200x200 browse render at
    // 5000 + id - 128 and the 128x64 HUD target render at 3000 + id - 128.
    // Only 97 of the 288 stock ships resolve one (99 have a dësc, two of
    // which set graphic <= 0); the rest, and plug-in ships, which
    // routinely omit it, fall back to the browse pict.
    const infoGraphic = descResource?.graphic ?? -1;
    const infoPict = infoGraphic > 0
        ? (ship.idSpace.PICT[infoGraphic]?.globalID ?? null) : null;

    // TODO: Parse Explosions
    var initialExplosionID: string | null = null;
    var finalExplosionID: string | null = null;

    // Refactor into a function? Eh, there's only 2 of them.
    if (ship.initialExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.initialExplosion]
        if (boom) {
            initialExplosionID = boom.globalID;
        }
        else {
            notFoundFunction("shïp id " + base.id + " missing bööm of id " + ship.initialExplosion);
        }
    }

    if (ship.finalExplosion !== null) {
        let boom = ship.idSpace.bööm[ship.finalExplosion]
        if (boom) {
            finalExplosionID = boom.globalID;
        }
        else {
            notFoundFunction("shïp id " + base.id + " missing bööm of id " + ship.finalExplosion);
        }
    }

    // shïp Explode2 + 1000 (EVN Bible ~:2445, deferring to wëap ExplodType
    // ~:3159): "Explosion type 0-63, plus a random number of type-0
    // explosions around it". Explosion type 0 is bööm 128, resolved
    // through the ship's own id space so a plug-in that overrides bööm 128
    // gets ITS sparks — the same lookup weapon_parse does for the wëap
    // half of the same rule (its `explosion128sparks`).
    //
    // Absence is NOT reported to notFoundFunction, unlike the Explode1 /
    // Explode2 lookups above: the sparks are a garnish on a fireball the
    // ship shows anyway, so a scenario with no bööm 128 at all should
    // lose the garnish rather than fail to parse every ship that sets the
    // +1000 bit (the same call the optional `infoPict` above makes).
    const finalExplosionSparksID = ship.finalExplosionSparks
        ? (ship.idSpace.bööm[128]?.globalID ?? null) : null;


    var shanResource = ship.idSpace.shän[ship.id];
    var animation: Animation;
    if (shanResource) {
        animation = await ShanParse(shanResource, notFoundFunction);
    }
    else {
        notFoundFunction("No matching shän for shïp of id " + base.id);
        animation = getDefaultAnimation();
    }



    var pictID: string;
    var pict = ship.idSpace.PICT[ship.pictID]
    if (pict) {
        pictID = pict.globalID;
    }
    else {
        pictID = (await shipPictMap)[base.id];
        if (!pictID) {
            notFoundFunction("No matching PICT for ship of id " + base.id);
            pictID = getDefaultPictData().id;
        }
    }




    // Outfits and weapons are included on the ship. Weapons need to be
    // turned into their corresponding outfits.

    var outfits: { [index: string]: number } = {} // globalID : count

    // Parse Outfits
    // Refactor with parse weapons?
    for (let i in ship.outfits) {
        var o = ship.outfits[i];
        var localID = o.id;
        var count = o.count;

        let outfit = ship.idSpace.oütf[localID];
        if (!outfit) {
            notFoundFunction("No matching oütf of id " + localID + " for ship of id " + base.id);
            continue; // Outfit not found so don't add it
        }
        var globalID = outfit.globalID;
        if (!outfits[globalID]) {
            outfits[globalID] = 0;
        }
        outfits[globalID] += count;
    }

    // Parse weapons, turning them into their corresponding outfits.
    for (let i in ship.weapons) {
        var w = ship.weapons[i];
        var localID = w.id;
        var count = w.count;

        var weapon = ship.idSpace.wëap[localID]
        if (!weapon) {
            notFoundFunction("No matching wëap of id " + localID + " for ship of id " + base.id);
            continue;
        }
        var globalID = weapon.globalID;

        // A shïp's WeapType weapons are wëap ids, not oütf ids: an oütf
        // exists only so the weapon can be BOUGHT (EVN Bible ~:2382).
        // Plug-ins ship NPC-only weapons with no oütf — Planet Rico's
        // "Swarmer Discharge" on its Swarmer fighter, say — so when none
        // provides this weapon, mount it through an implicit,
        // unpurchasable outfit rather than dropping it and leaving the
        // ship unarmed.
        var outfitID = (await weaponOutfitMap)[globalID]
            ?? builtInWeaponOutfitId(globalID);
        if (!outfits[outfitID]) {
            outfits[outfitID] = 0;
        }
        outfits[outfitID] += count;

        // The stock ammo load (AmmoLoad) becomes that many of the
        // weapon's ammo outfit. It is ignored for weapons that don't
        // draw ammo from an outfit. Bay weapons DO draw from one (their
        // fighters — see AmmoTypeParse). When the weapon burns ammo but
        // no oütf feeds it, the load rides in an implicit magazine for
        // the same reason the weapon itself does: otherwise the ship
        // carries a weapon it can never fire.
        if (w.ammo > 0) {
            const usesAmmoOutfit = BayGuidanceSet.has(weapon.guidance)
                || (weapon.ammoType >= 0 && weapon.ammoType <= 255);
            var ammoOutfitID = (await ammoOutfitMap)[globalID]
                ?? (usesAmmoOutfit ? builtInAmmoOutfitId(globalID) : undefined);
            if (ammoOutfitID) {
                if (!outfits[ammoOutfitID]) {
                    outfits[ammoOutfitID] = 0;
                }
                outfits[ammoOutfitID] += w.ammo;
            }
        }
    }

    // The ship's free mass is mass on top of the mass of preinstalled outfits,
    // so to find it's actual free mass, we add in the masses of all the outfits.
    // (this is done while outfits are parsed).
    var freeMass = ship.freeSpace;
    for (let outfitID in outfits) {
        // Implicit built-in-weapon outfits have no oütf resource behind
        // them and take up no space: the hull's own mass budget already
        // accounts for the weapons it comes with.
        let outfit = globalIDSpace.oütf[outfitID];
        if (!outfit) {
            continue;
        }
        freeMass += outfit.mass * outfits[outfitID];
    }

    // The government whose ïntf status bar this class shows for the player.
    const interfaceGovtLocalId = interfaceGovtId(ship.inherentGovt);
    const interfaceGovt = interfaceGovtLocalId !== null
        ? (ship.idSpace.gövt[interfaceGovtLocalId]?.globalID ?? null)
        : null;

    // ESCORT UPGRADE TARGET (EVN Bible shïp UpgradeTo ~:2661): a LOCAL shïp
    // id, resolved to a global one exactly like inherentGovt below. BOTH of
    // the Bible's "can't be upgraded" sentinels — 0 and -1 — land under 128
    // and become null, so a consumer has one thing to test. An id that names
    // no ship in this id space is reported through notFoundFunction like
    // every other dangling reference and likewise becomes null, rather than
    // silently naming a class the upgrade could never produce.
    let escortUpgradeShip: string | null = null;
    if (ship.escortUpgradeShip >= 128) {
        escortUpgradeShip =
            ship.idSpace.shïp[ship.escortUpgradeShip]?.globalID ?? null;
        if (escortUpgradeShip === null) {
            notFoundFunction("No matching shïp of id " + ship.escortUpgradeShip
                + " for the escort upgrade of ship of id " + base.id);
        }
    }

    // EVN Bible shïp Flags: slow (75%), semi-fast (125%), and fast
    // (150%) hyperspace jump speed. The bits are mutually exclusive.
    var jumpSpeedMult = 1;
    if (ship.flagsN & 0x0001) {
        jumpSpeedMult = 0.75;
    } else if (ship.flagsN & 0x0002) {
        jumpSpeedMult = 1.25;
    } else if (ship.flagsN & 0x0004) {
        jumpSpeedMult = 1.5;
    }

    var physics: ShipPhysics = {
        shield: ship.shield,
        shieldRecharge: ship.shieldRecharge * FPS / 1000, // Recharge per second
        armor: ship.armor,
        armorRecharge: ship.armorRecharge * FPS / 1000,
        energy: ship.energy,
        // Frames per unit -> units per second. 0 means no regeneration.
        energyRecharge: ship.energyRecharge === 0 ? 0 : FPS / ship.energyRecharge,
        ionization: ship.ionization,
        deionize: ship.deionize / 100 * FPS, // 100 is 1 point of ion energy per 1/30th of a second (evn bible)
        speed: ship.speed * ShipSpeedConversionFactor,
        acceleration: ship.acceleration * ShipAccelerationConversionFactor,
        turnRate: ship.turnRate * ShipTurnRateConversionFactor,
        inertialess: Boolean(ship.flags2N & 0x40),
        mass: ship.mass,
        freeMass,
        freeCargo: ship.cargoSpace,
        maxGuns: ship.maxGuns,
        maxTurrets: ship.maxTurrets,
        jumpSpeedMult,
        canJumpWithoutSlowing: Boolean(ship.flags2N & 0x20),
        jumpDistanceMod: 0,
        // Afterburners come from outfits (ModType 15), not ship data.
        afterburner: 0,
        // Multi-jump (ModType 32), auto-refuel (ModType 19), and the
        // hyperspace speed mod (ModType 22) come from outfits, not ship
        // data.
        multiJump: 0,
        autoRefuel: false,
        hyperspaceSpeedMod: 0,
    }

    return {
        physics,
        pict: pictID,
        infoPict,
        desc: desc,
        outfits,
        initialExplosion: initialExplosionID,
        finalExplosion: finalExplosionID,
        finalExplosionSparks: finalExplosionSparksID,
        deathDelay: ship.deathDelay / FPS,
        // shïp DeathDelay >= 60 FRAMES (EVN Bible ~:2427) — compared on the
        // raw field, not the seconds `deathDelay` above. This is the "huge
        // explosion ... proportional to the ship's mass" branch, and it is
        // NOT the Explode2 +1000 sparks flag above; the two were conflated
        // into one field until finalExplosionSparks was added.
        largeExplosion: ship.deathDelay >= 60,
        displayWeight: ship.displayOrder,
        animation,
        // shïp Flags2 0x0008 (EVN Bible ~:2572): "Ship can be fired on by
        // point defense systems". This is the SHIP half of the Bible's
        // description of point defense — "fires automatically at incoming
        // guided weapons and nearby ships" (wëap Guidance 9/10, ~:3103) —
        // and it is expressed on the same field the wëap parser uses for
        // the missile half (weapon_parse's vulnerableTo), so one marker
        // and one collision tag cover both. 131 of the 288 stock shïp
        // resources set it, and they are the fighters and small craft:
        // Viper, Fed Viper, Lightning, Thunderhead, Firebird, Shuttle.
        // The capital ships (Fed Carrier, Fed Destroyer, IDA Frigate,
        // Leviathan) do not, and so cannot be touched by point defense.
        vulnerableTo: (ship.flags2N & 0x0008)
            ? ["normal", "pointDefense"] : ["normal"],
        // Flag sets as JSON-safe hex strings, namespaced per plug-in (so
        // they may run past 64 bits).
        contribute: "0x" + resolveResourceFlags(flagMap, ship, ship.contribute).toString(16),
        require: "0x" + resolveResourceFlags(flagMap, ship, ship.require).toString(16),
        // The shipyard gates (EVN Bible shïp Availability ~:2588, BuyRandom
        // ~:2630, and the Flags3 0x0100/0x0200/0x4000 bits ~:2655).
        availability: ship.availabilityNCB,
        buyRandom: ship.buyRandom,
        hideIfAvailabilityFalse: Boolean(ship.flags3N & 0x0100),
        hideIfRequireUnmet: Boolean(ship.flags3N & 0x0200),
        excludeEqualDisplayWeight: Boolean(ship.flags3N & 0x4000),
        strength: ship.strength,
        inherentAI: ship.inherentAI,
        // Resolve the ship's inherent gövt to its global id (-1 / missing
        // becomes null), for the mïsn AvailShipType ship-govt ranges.
        inherentGovt: ship.inherentGovt >= 128
            ? (ship.idSpace.gövt[ship.inherentGovt]?.globalID ?? null)
            : null,
        // The ïntf status bar's govt reads the SAME field through the Bible's
        // three InherentGovt encodings (both / attributes-only 1128-1383 /
        // combat-only 2128-2383), because the gövt Interface rule fires on
        // either association. Most stock player-flyable ships use the
        // attributes-only form, so this is what actually selects the bar.
        interfaceGovt: interfaceGovt,
        price: ship.cost,
        techLevel: ship.techLevel,
        hireRandom: ship.hireRandom,
        escortType: ship.escortType,
        // ESCORT MANAGEMENT (EVN Bible shïp ~:2661). UpgradeTo is a LOCAL
        // shïp id, resolved to a global one like inherentGovt above; BOTH of
        // the Bible's "can't be upgraded" sentinels (0 and -1) — and a id
        // that names no ship in this id space — collapse to null, so the
        // consumer has one thing to test. A dangling id is reported through
        // notFound like every other unresolvable reference rather than
        // silently becoming an upgrade to nothing.
        escortUpgradeShip,
        escortUpgradeCost: ship.escortUpgradeCost,
        // Raw: the "<= 0 means 10% of the ship's cost" default is applied by
        // spaceport/escort_fees.ts, which is where the price rules live.
        escortSellValue: ship.escortSellValue,
        shortName: ship.shortName,
        longName: ship.longName,
        subtitle: ship.subtitle,
        // The hire-escort pilot description parallels the shipyard
        // description range: dësc 14000 + (shïp local id - 128).
        pilotDesc: ship.idSpace.dësc[ship.id - 128 + 14000]?.text ?? "",
        // EVN Bible shïp Flags 0x0010: "Ship is disabled at 10% armor
        // instead of 33%".
        disableArmorFraction: (ship.flagsN & 0x0010) ? 0.10 : 0.33,
        length: ship.length,
        crew: ship.crew,
        freeSpace: ship.freeSpace,
        // EVN Bible shïp Flags 0x1000/0x2000/0x4000: "Ship's turrets
        // have a blind spot to the front/sides/rear".
        turretBlindSpots: {
            front: Boolean(ship.flagsN & 0x1000),
            sides: Boolean(ship.flagsN & 0x2000),
            rear: Boolean(ship.flagsN & 0x4000),
        },
        ...base
    }
}
