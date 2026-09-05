import { BaseData, getDefaultBaseData } from "./base_data.js";
import { CloakData, getDefaultCloakData } from "./cloak_data.js";
import { CloakScannerData, getDefaultCloakScannerData } from "./cloak_scanner_data.js";
import { ShipPhysics } from "./ship_data.js";


export type OutfitPhysics = Partial<ShipPhysics> & { freeMass: number };

/**
 * The jamming strength this outfit contributes to its ship, for each of the
 * four jamming types (IR, radar, etheric wake, gravimetric). From the oütf
 * ModTypes 33-36 ("Jamming Type 1-4", EVN Bible). Values are percentages that
 * add across all of a ship's outfits (and can be negative). Ordered
 * [type1, type2, type3, type4] to match weapon JamVuln indices.
 */
export type JammingStrengths = readonly [number, number, number, number];

export function getDefaultJammingStrengths(): JammingStrengths {
    return [0, 0, 0, 0];
}

/** See OutfitData.requireGovtScope. */
export type RequireGovtScope =
    | 'all'
    | 'govtOrAllies'
    | 'independentOrGovt'
    | 'exceptGovt'
    | 'exceptIndependentOrGovt';

/**
 * Splits a raw oütf RequireGovt value into its gövt LOCAL id and scope
 * (EVN Bible ~:2052; see OutfitData.requireGovtScope for the table). Any
 * value outside the four documented ranges — -1, the stock editors' 0 and
 * 127 sentinels — is "applies in all outfit shops", which is what the
 * outfitter did unconditionally before the field was decoded.
 */
export function decodeRequireGovt(raw: number):
    { govtLocalId: number | null, scope: RequireGovtScope } {
    const ranges: [number, RequireGovtScope][] = [
        [0, 'govtOrAllies'],
        [1000, 'independentOrGovt'],
        [2000, 'exceptGovt'],
        [3000, 'exceptIndependentOrGovt'],
    ];
    for (const [offset, scope] of ranges) {
        if (raw >= offset + 128 && raw <= offset + 383) {
            return { govtLocalId: raw - offset, scope };
        }
    }
    return { govtLocalId: null, scope: 'all' };
}

export interface OutfitData extends BaseData {
    weapons: { [index: string]: number }, // globalID : count

    // how it changes the physics of the ship it's attached to. Idea: What if these were allowed to be functions?
    physics: OutfitPhysics,
    /** Per-type jamming strength this outfit adds to the ship. */
    jamming: JammingStrengths,
    // Cloaking-device semantics decoded from ModType 17. isCloak is false
    // for non-cloak outfits. See cloak_data.ts for the bitfield.
    cloak: CloakData,
    // Cloak-scanner semantics decoded from ModType 30. isCloakScanner is
    // false for non-scanner outfits. See cloak_scanner_data.ts.
    cloakScanner: CloakScannerData,
    pict: string, // id of picture
    price: number,
    desc: string,
    displayWeight: number,
    /**
     * The item's tech level (oütf TechLevel, EVN Bible ~:1794). The item is
     * stocked at every spaceport whose own techLevel is >= this, and also at
     * any stellar listing this exact value in one of its eight SpecialTech
     * slots. See outfitter_rules.ts meetsTechLevel.
     */
    techLevel: number,
    /**
     * oütf flag 0x0100: don't show this item unless the player meets the
     * Require bits, or already has at least one of it (Bible ~:1974).
     */
    hideUnlessRequirementsMet: boolean,
    /**
     * oütf flag 0x0800: this item "can be sold anywhere, regardless of tech
     * level, requirements, or mission bits" (Bible ~:1980). Lifts the
     * stocking (tech level) gate on SELLING an owned unit; it does not
     * override cantSell (0x0008).
     */
    sellAnywhere: boolean,
    /**
     * oütf flag 0x1000: while this item is available for sale, it suppresses
     * all higher-numbered items with an equal DispWeight (Bible ~:1983).
     * Used in stock data to show only one variant of an item at a time.
     */
    excludesEqualDisplayWeight: boolean,
    /**
     * oütf flag 0x4000: don't show this item unless its Availability
     * evaluates to true, or the player already has at least one of it
     * (Bible ~:1988). Without this flag an item whose Availability is false
     * is still SHOWN, just not purchasable (Bible ~:1999).
     */
    hideUnlessAvailable: boolean,
    /** How many you can have (not counting weapon limitations). 0 = unlimited. */
    max: number,
    /**
     * oütf BuyRandom: "The percent chance that an item of this type will be
     * available for purchase on a given day, from 1-100" (Bible ~:2034).
     *
     * NovaJS does not roll the daily chance (there is no per-day shop
     * inventory), so every positive value means "offered". ZERO does not:
     * it is the data's marker for an item that is never offered for sale at
     * all — see `neverOnSale` in nova's spaceport/outfitter_rules.ts for the
     * evidence and the exact rule.
     */
    buyRandom: number,
    /** Control bit test expression gating purchase. Blank = available. */
    availability: string,
    /** Control bit set expression evaluated on purchase. */
    onPurchase: string,
    /** Control bit set expression evaluated on sale. */
    onSell: string,
    /**
     * 64-bit flag set contributed while owning this outfit, as a hex
     * string (JSON-safe; decode with BigInt).
     */
    contribute: string,
    /**
     * 64-bit flag set that must be covered by the union of the
     * Contribute sets of the player's ship and outfits to buy this
     * outfit. Hex string; decode with BigInt.
     */
    require: string,
    /** This item occupies a fixed gun hardpoint. */
    fixedGun: boolean,
    /** This item occupies a turret hardpoint. */
    turret: boolean,
    /**
     * oütf flag 0x0004: "This item stays with you when you trade ships"
     * (Bible ~:1962). On a shipyard purchase these units move onto the new
     * hull instead of being traded in with the old one, and they are
     * excluded from the trade-in valuation (you keep them, you don't sell
     * them). See spaceport/shipyard_rules.ts.
     *
     * NOT the same as flag 0x0020, which is persistence across a mission
     * set operator CHANGING the player's ship; that bit is unrelated to
     * buying and is deliberately not decoded here.
     */
    persistent: boolean,
    /** This item can't be sold. */
    cantSell: boolean,
    /**
     * oütf flag 0x0010: "Remove any items of this type after purchase
     * (useful for permits and other intangible purchases)" (Bible ~:1966).
     * The outfitter charges the price and runs OnPurchase, then takes the
     * unit straight back off the ship — stock uses it for the ship-upgrade
     * permits (oütf 314-318, whose OnPurchase is an `Hxxx` ship change)
     * and the Forged Exotic Ships & Weapons License (363).
     */
    removeAfterPurchase: boolean,
    /**
     * oütf flag 0x0020: "This item is persistent in the case where the
     * player's ship is changed by a mission set operator. The item's normal
     * persistence for when the player buys or captures a new ship is still
     * controlled by the 0x0004 bit" (Bible ~:1968). Read ONLY by the
     * `Hxxx` set operator (change ship, dropping nonpersistent outfits);
     * the shipyard reads `persistent` instead.
     */
    persistentOnShipChange: boolean,
    /**
     * oütf flag 0x2000: "This outfit appears in the Ranks section of the
     * player info dialog instead of in the Extras section" (Bible ~:1985).
     * Plumbed for the player-info dialog; two plug-in outfits set it.
     */
    showAsRank: boolean,
    /**
     * oütf flag 0x0200: "This item's total price is proportional to the
     * player's ship's mass (ship class Mass field is multiplied by this
     * item's Cost field)" (Bible ~:1974). Every stock armour plating sets
     * it: Carbon Fiber (oütf 180, Cost 250) is 6,250 cr on a mass-25 Heavy
     * Shuttle and 2,500,000 cr on a Leviathan. See outfitter_rules'
     * outfitPrice, which is the ONE place the multiplication happens.
     */
    priceScalesWithShipMass: boolean,
    /**
     * oütf flag 0x0400: "This item's total mass (at purchase) is
     * proportional to the player's ship's mass (ship class Mass field is
     * multiplied by this item's Mass field and then divided by 100). Only
     * works for positive-mass items" (Bible ~:1977). See
     * outfitter_rules' installedMass for the rounding ruling.
     */
    massScalesWithShipMass: boolean,
    /**
     * oütf RequireGovt (Bible ~:2052): WHERE the Require bits are enforced.
     * The raw field is a gövt id in one of four ranges (128-383,
     * 1128-1383, 2128-2383, 3128-3383) or -1; here it is split into the
     * govt's GLOBAL id (null when the requirement applies everywhere, or
     * the value names no gövt) and the range's meaning:
     *
     *   'all'                   -1 (and any out-of-range value, including
     *                           the stock editors' 127 / 0 sentinels):
     *                           "Requirements apply in all outfit shops."
     *   'govtOrAllies'          128-383: "only on stellars belonging to
     *                           this govt or its allies."
     *   'independentOrGovt'     1128-1383: "only on independent stellars
     *                           and stellars belonging to this govt or
     *                           its allies."
     *   'exceptGovt'            2128-2383: "on all stellars except those
     *                           belonging to this govt or its allies."
     *   'exceptIndependentOrGovt' 3128-3383: "on all stellars except
     *                           independent stellars or stellars belonging
     *                           to this govt or its allies."
     *
     * Consumed by outfitter_rules' requireApplies. Nine stock outfits use
     * 128 (Federation): the Medium Blaster, the IR/Radar missiles and
     * launchers, the Polaron Cannon and Carbon Fiber only need their
     * Federation licence at Federation-owned or allied worlds.
     */
    requireGovt: string | null,
    requireGovtScope: RequireGovtScope,
    /**
     * True for an IMPLICIT item that no oütf resource defines: the
     * synthesized outfit that mounts a ship's built-in weapon (or its
     * stock ammo load) when the data provides no purchasable item for it.
     * See novaparse's built_in_weapon_outfit.ts.
     *
     * A built-in is part of the hull, not cargo the player acquired: it is
     * never stocked or bought, never sold back, and never listed among the
     * player's extras. Always false for a real oütf.
     */
    builtIn: boolean,
    /**
     * The globalID of the weapon whose ammo supply this item fills, or
     * null if this isn't ammunition. Each item of the outfit is one
     * round of that weapon's ammo. Whether the item requires a
     * launcher to buy depends on that weapon's maxAmmo.
     */
    ammoFor: string | null,
    /**
     * The globalID of another outfit whose max count each one of this
     * item multiplies, or null.
     */
    increasesMax: string | null,
    /**
     * This item is a mining scoop (ModType 31): a ship carrying it
     * collects asteroid debris it flies over into its cargo hold.
     */
    miningScoop: boolean,
    /**
     * Amount this outfit clears the current system's murk by (ModType 28,
     * "murk modifier"). The Bible's ModVal is the amount to add to the
     * system's murkiness, so this is its negation: a stock Sensor Boost with
     * murk modifier -3 gives murkClear +3 (it removes 3 murk). Summed across
     * the player's outfits and fed into the display's MurkState.murkReduction.
     */
    murkClear: number,
    /**
     * Amount this outfit subtracts from the current system's radar
     * interference (ModType 24, "interference mod"). The Bible: "Subtracts the
     * value in ModVal from the current star system's Interference value", so
     * this is the ModVal directly. Summed across the player's outfits and fed
     * into the status bar's interferenceReduction.
     */
    interferenceReduction: number,
    /**
     * This item is an IFF decoder (ModType 14, "IFF / colorized radar"). When
     * the player owns one, radar blips are coloured by the ship's disposition
     * toward the player (hostile / friendly / neutral) instead of the flat dim
     * colour. ModVal is ignored.
     */
    iff: boolean,
    /**
     * This item is an auto-refueller (ModType 19): the ship slowly regenerates
     * hyperspace fuel on its own. ModVal is ignored.
     */
    autoRefuel: boolean,
    /**
     * Number of extra consecutive hyperspace jumps this outfit grants when the
     * player initiates a jump (ModType 32, "multi-jump"). Summed across
     * outfits. Zero for non-multi-jump outfits.
     */
    multiJump: number,
    /**
     * This item is a density scanner (ModType 13): reveals asteroid density /
     * lets the pilot see what an asteroid will drop. ModVal is ignored. The
     * sim has no asteroid-scanning UI yet, so this is plumbed but unconsumed.
     */
    densityScanner: boolean,
    /**
     * How many jumps out from the purchase system this map outfit reveals
     * (ModType 16, "map"): >=1 is that many jumps away, -1 reveals all
     * inhabited independent systems, <= -1000 reveals a whole govt class.
     * null for non-map outfits.
     *
     * Consumed by nova's spaceport/map_outfit.ts, which walks the real link
     * graph and raises the revealed systems to discovery level 2 ("landed
     * within" — the stock dësc promises the "location and contents"). Buying
     * one applies it and takes the item back off the ship; one granted by a
     * set string (the Vell-os ability) stays aboard and re-applies on every
     * system entry.
     */
    map: number | null,
    /**
     * Marines added to the ship's effective crew for capture odds (ModType 25).
     * Positive adds crew; -1..-100 is a direct capture-odds bonus percent. 0
     * for non-marine outfits. Boarding/capture does not exist in the sim yet,
     * so this is plumbed but unconsumed.
     */
    marines: number,
    /**
     * This item is a repair system (ModType 49): occasionally repairs the ship
     * while it is disabled. ModVal is ignored. Consumed by the sim's disabled
     * state (nova_plugin/disabled_component.ts): owning one repairs a disabled
     * ship to just above its disable threshold after a seeded-random delay.
     */
    repairSystem: boolean,
    /**
     * This item is an escape pod (ModType 11): the pilot survives their ship's
     * destruction. ModVal ignored. Death/respawn is minimal in the sim, so
     * this is plumbed but unconsumed.
     */
    escapePod: boolean,
    /**
     * This item is an auto-ejecting escape pod (ModType 20): ejects the pilot
     * automatically (requires an escape pod). ModVal ignored. Plumbed but
     * unconsumed (see escapePod).
     */
    autoEject: boolean,
    /**
     * Govt id whose legal record this outfit clears (ModType 21,
     * "clean legal record"): a govt id, or -1 for all. null for other outfits.
     * There is no legal/reputation system in the sim yet, so this is plumbed
     * but unconsumed. Stored as the raw ModVal (a gövt resource id, or -1).
     */
    cleanLegalRecord: number | null,
    /**
     * Govt class this IFF scrambler fools (ModType 48): any govt with this
     * value in its Class1-4 will treat the player as friendly, or -1 for all.
     * null for non-scrambler outfits. NPC disposition/targeting AI does not
     * exist yet, so this is plumbed but unconsumed.
     */
    iffScramblerClass: number | null,
    /**
     * Govt class whose reinforcements this outfit inhibits (ModType 44), or -1
     * for all. null otherwise. Reinforcement summoning does not exist yet, so
     * this is plumbed but unconsumed.
     */
    reinforcementInhibitorClass: number | null,
    /**
     * 15-bit 0RRRRRGGGGGBBBBB colour to paint the player's ship (ModType 43),
     * or null. Ship-tinting is not wired into the display yet, so this is
     * plumbed but unconsumed.
     */
    paintColor: number | null,
    /**
     * dësc id shown when this bomb destroys the player in flight (ModType 47),
     * or -1 for none. null for non-bomb outfits. Self-destruct/boarding
     * context does not exist yet, so this is plumbed but unconsumed.
     */
    bomb: number | null,
    /**
     * bööm id shown when this nonlethal bomb randomly self-destructs and
     * (nonfatally) damages the player (ModType 50). null for other outfits.
     * Plumbed but unconsumed.
     */
    nonlethalBomb: number | null,
}

export function getDefaultOutfitData(): OutfitData {
    return {
        ...getDefaultBaseData(),
        weapons: {},
        physics: {
            freeMass: 0
        },
        jamming: getDefaultJammingStrengths(),
        cloak: getDefaultCloakData(),
        cloakScanner: getDefaultCloakScannerData(),
        pict: "default",
        price: 0,
        desc: "default outfit",
        displayWeight: 0,
        techLevel: 0,
        hideUnlessRequirementsMet: false,
        sellAnywhere: false,
        excludesEqualDisplayWeight: false,
        hideUnlessAvailable: false,
        max: 0,
        // 100, not 0: a hand-made or synthesized outfit is always offered.
        buyRandom: 100,
        availability: "",
        onPurchase: "",
        onSell: "",
        contribute: "0x0",
        require: "0x0",
        fixedGun: false,
        turret: false,
        persistent: false,
        cantSell: false,
        removeAfterPurchase: false,
        persistentOnShipChange: false,
        showAsRank: false,
        priceScalesWithShipMass: false,
        massScalesWithShipMass: false,
        requireGovt: null,
        requireGovtScope: 'all',
        builtIn: false,
        ammoFor: null,
        increasesMax: null,
        miningScoop: false,
        murkClear: 0,
        interferenceReduction: 0,
        iff: false,
        autoRefuel: false,
        multiJump: 0,
        densityScanner: false,
        map: null,
        marines: 0,
        repairSystem: false,
        escapePod: false,
        autoEject: false,
        cleanLegalRecord: null,
        iffScramblerClass: null,
        reinforcementInhibitorClass: null,
        paintColor: null,
        bomb: null,
        nonlethalBomb: null,
    }
}
