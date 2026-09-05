/**
 * The rules for buying and selling outfits in the outfitter, per the
 * EVN Bible's oütf documentation: free mass, gun/turret hardpoints,
 * the Max count (as multiplied by increase-maximum items), the
 * Availability control bit test, Contribute/Require flag coverage,
 * launcher-restricted ammunition, and the BuyRandom chance that the shop
 * has one today (day_roll.ts, shared with the two ship shops).
 *
 * Pure logic; the Outfitter menu supplies the context. Note that Gxxx
 * control-bit grants intentionally bypass all of these checks (see
 * makeControlBitHooks in ../nova_plugin/ncb.ts).
 */
import { OutfitData } from 'novadatainterface/outfit_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { DiscoveryAccess } from '../nova_plugin/discovery.js';
import {
    resolveNumberedResource, setStringPrefix, systemDiscoveryOperators,
} from '../nova_plugin/mission_logic.js';
import { evaluateNCBTest, NCBParseError } from '../nova_plugin/ncb.js';
import { installedOutfitMass } from '../nova_plugin/outfit_plugin.js';
import {
    dayRoll, passesDayRoll, resourceNumber as resourceNumberOf,
} from './day_roll.js';

export interface OutfitterContext {
    shipData: ShipData;
    /** The player's current outfits: global outfit id -> count. */
    outfits: ReadonlyMap<string, number>;
    /** Already-loaded game data. Unloaded ids may return undefined. */
    getOutfit(id: string): OutfitData | undefined;
    getWeapon(id: string): WeaponData | undefined;
    /** The player's control bits. */
    bits: ReadonlySet<number>;
    /** The player's current credits (the working copy while docked). */
    credits: number;
    /** Maps resource ids in NCB expressions (e.g. O142) to global ids. */
    resolveId?(id: number): string;
    /**
     * `Exxx` in an outfit's Availability: the player's per-system discovery
     * record (discovery.ts). Absent leaves every `Exxx` false. The shop is a
     * player-local screen, so this is only ever the LOCAL pilot's record —
     * an outfit gated on where you have been is on sale for you alone, which
     * is fine because nobody else is looking at your outfitter.
     */
    discovery?: DiscoveryAccess;
    /**
     * Whether a sÿst with this global id exists, so an `Exxx` term resolves
     * its bare number stock-first exactly as `Oxxx` does (see
     * resolveOutfitReference). Absent means "assume the writing plug-in's
     * own", the pre-existing behaviour for every numbered reference.
     */
    systemExists?(globalId: string): boolean;
    /**
     * Whether an oütf with this global id exists, for the same stock-first
     * resolution `Oxxx` needs (see resolveOutfitReference).
     *
     * Absent falls back to asking `getOutfit`, which is only as good as
     * what the caller's lookup is willing to say about a MISSING id — and
     * the running menu's lookup is not good enough on its own. See the
     * EXISTENCE, NOT WARMTH note on outfitReferenceExists.
     */
    outfitExists?(globalId: string): boolean;
    /**
     * Outfit id -> units the player owns that are NOT installed on the
     * docked ship: today, bay fighters still flying after the carrier
     * landed (see deployed_outfits.ts). They count against the outfit's
     * Max and against its launcher's ammo capacity, so landing with
     * fighters out cannot be used to buy past the cap. Absent or empty
     * means everything owned is aboard.
     *
     * They deliberately do NOT count towards mass, cargo, hardpoints or
     * Contribute, and they are not themselves sellable — a fighter in
     * flight is not on the ship to hand over. They DO block selling the
     * BAY they came out of, which would otherwise strand them (see
     * canSellOutfit). See deployed_outfits.ts for the rationale and for
     * how to add further sources of deployed units.
     */
    deployedCounts?: ReadonlyMap<string, number>;
    /**
     * The stellar whose outfitter the player is standing in, supplying the
     * tech level / SpecialTech / "buys anything" rules that decide what the
     * shop STOCKS (see visibleOutfits and buysBackOutfit).
     *
     * Optional: with no stellar there is no shop to gate against, so the
     * rules fall back to "everything is stocked here" — which is the
     * behaviour every caller had before these rules existed, and keeps
     * headless purchase tests that only care about mass/credits/hardpoints
     * free of stellar boilerplate. The real outfitter always sets it.
     */
    planet?: OutfitterStellar;
    /**
     * The union of the active ranks' Contribute sets (rank_logic.ts's
     * rankContribute). The EVN Bible's rank Contribute is "Another 64 bits
     * of Contribute values that kick in when the rank is active [which] can
     * be used to prevent the player from buying certain items ... until
     * achieving a certain rank", so it joins the ship + outfit set for the
     * Require test. Absent means "no ranks", the pre-rank behaviour.
     */
    rankContribute?: bigint;
    /**
     * The five STR# 2002 fragments the launcher sell refusal is composed
     * from, read out of the loaded game data by the Outfitter menu.
     * Absent falls back to AMMO_SELL_STRINGS, the stock wording (which
     * outfitter_rules_stock_test.ts pins against the real table).
     */
    ammoSellStrings?: AmmoSellStrings;
    /**
     * The absolute game day number (calendar.ts dayNumber) and the numeric
     * local id of the docked stellar, which together decide the oütf
     * BuyRandom day roll (day_roll.ts) — "the percent chance that an item
     * of this type will be available for purchase on a given day".
     *
     * Both optional, and an absent `day` means NO roll: the item is
     * offered, exactly as it is with the roll's master switch off. That is
     * what keeps a headless purchase check (which has no calendar and no
     * stellar) free of shop-inventory boilerplate, matching how an absent
     * `planet` means "everything is stocked here".
     */
    day?: number;
    /** See `day`. */
    stellarId?: number | null;
}

/**
 * The stock launcher-sell refusal, which the original composes from five
 * separate STR# 2002 ("misc strings", Nova Data 5.ndat) entries rather
 * than storing whole. Verified against the real table:
 *
 *   207 "You need to sell"   208 "unit"   209 "units"
 *   210 "of ammunition"      211 "before you can sell your"
 *
 * The count and the launcher's name are interpolated, giving e.g. "You
 * need to sell 4 units of ammunition before you can sell your Viper Bay."
 * Its immediate sibling at 206 is the other sell refusal
 * (NEGATIVE_FREE_MASS_REFUSAL below), and the anchors that pin the
 * numbering are 52 "No response.", 172 "Forbidden", and 222/223, all
 * already cited elsewhere in the codebase.
 */
export interface AmmoSellStrings {
    /** 207 */ needToSell: string;
    /** 208 */ unit: string;
    /** 209 */ units: string;
    /** 210 */ ofAmmunition: string;
    /** 211 */ beforeYouCanSell: string;
}

/** The STR# table the sell refusals live in, and their indices. */
export const SELL_REFUSAL_TABLE = 'nova:2002';
export const NEGATIVE_FREE_MASS_INDEX = 206;
export const AMMO_SELL_INDICES: { [K in keyof AmmoSellStrings]: number } = {
    needToSell: 207,
    unit: 208,
    units: 209,
    ofAmmunition: 210,
    beforeYouCanSell: 211,
};

/** Stock Nova's wording, verbatim, as the fallback for a short table. */
export const AMMO_SELL_STRINGS: AmmoSellStrings = {
    needToSell: 'You need to sell',
    unit: 'unit',
    units: 'units',
    ofAmmunition: 'of ammunition',
    beforeYouCanSell: 'before you can sell your',
};

/**
 * STR# 2002 index 206, the sell refusal for an item whose own removal
 * would leave the ship over its outfit-space limit — a Mass Expansion
 * (stock oütf 190, Mass -10) with the tonnage it freed already spent.
 */
export const NEGATIVE_FREE_MASS_REFUSAL = 'Can\'t sell that item, because'
    + ' your ship would have negative free mass afterwards.';

/**
 * "You need to sell 4 units of ammunition before you can sell your Viper
 * Bay.", composed the way the original does: fragment 207, the count,
 * the singular/plural unit word (208/209), fragment 210, fragment 211,
 * and the launcher's display name. The trailing period is the engine's;
 * none of the five fragments carries one (206, which IS a whole
 * sentence, does).
 */
export function ammoSellRefusal(units: number, launcherName: string,
    strings: AmmoSellStrings = AMMO_SELL_STRINGS): string {
    const unitWord = units === 1 ? strings.unit : strings.units;
    return `${strings.needToSell} ${units} ${unitWord} ${strings.ofAmmunition}`
        + ` ${strings.beforeYouCanSell} ${launcherName}.`;
}

/**
 * The tech-level half of a stellar's stock rules, split out because shïp
 * resources carry the very same TechLevel / SpecialTech structure (EVN
 * Bible ~:2413, ~:2588). The shipyard can reuse meetsTechLevel with a
 * ShipData's techLevel once it grows an economy; nothing here is
 * outfit-specific. See the SHIPYARD SEAM note at the bottom of this file.
 */
export interface TechStellar {
    /** Everything with techLevel <= this is stocked. */
    techLevel: number;
    /** Extra tech levels stocked by EXACT match only (spöb SpecialTech). */
    specialTech: readonly number[];
}

/** Everything the outfitter's visibility and sell rules need from a stellar. */
export interface OutfitterStellar extends TechStellar {
    /**
     * spöb Flags2 0x0400: this shop buys any nonpermanent outfit the player
     * owns, regardless of tech level (EVN Bible ~:2862).
     */
    buysAnyOutfit: boolean;
}

/**
 * Whether a stellar stocks something of this tech level (EVN Bible ~:1794
 * for oütf, ~:2765 for the spöb side): everything at or below the stellar's
 * own TechLevel, PLUS anything whose TechLevel is EXACTLY one of the
 * stellar's eight SpecialTech values. The exact-match half is how a
 * low-tech world carries a few exotic items, and how an item with an absurd
 * TechLevel (the Bible's example is 15000) is pinned to one stellar.
 */
export function meetsTechLevel(techLevel: number,
    stellar: TechStellar): boolean {
    return stellar.techLevel >= techLevel
        || stellar.specialTech.includes(techLevel);
}

/**
 * NEVER ON SALE — the oütf BuyRandom rule.
 *
 * BuyRandom is "the percent chance that an item of this type will be
 * available for purchase on a given day, from 1-100" (Bible ~:2034). NovaJS
 * does not model a per-day shop inventory, so a positive value is simply
 * "offered". The Bible adds "values less than 1 or greater than 100 are
 * interpreted as 100", and the >100 half is honoured; the ZERO case is not,
 * because every piece of real data says zero means the item is never put on
 * a shelf at all — which is the ONLY thing left in an oütf that can say so:
 *
 *  - Extra Outfits' Bremesol Reactor is one item in two states, oütf 611
 *    "Online" and 612 "Offline". Same TechLevel (10000), same DispWeight,
 *    same 4,500,000cr cost, mutually exclusive Availability (`!o612` /
 *    `!o611`), and both are stocked by Tektaara Station (SpecialTech
 *    10000). The only field that differs is BuyRandom: 80 on the Online
 *    one, 0 on the Offline one — the state the reactor DEGRADES into,
 *    which the player is obviously not meant to buy.
 *  - Its oütf 524 "TAM Drone PD Laser" and 592 "TO Drone Offensive Laser"
 *    are drone-carried guns, and their dësc reads, in full: "Unused
 *    description. If you can read this something isn't working as
 *    intended." They are otherwise indistinguishable from oütf 460 "PD
 *    Laser", a real item on the same shelf (TechLevel 10000, DispWeight
 *    199, blank Availability, Require 0x900000001, no hide flags) — except
 *    that 460 has BuyRandom 55 and both drone guns have 0.
 *  - Stock agrees and costs nothing: of the 50 stock outfits with BuyRandom
 *    0, exactly ONE has a TechLevel any stellar stocks (oütf 347 "Rebel
 *    Cloaking Device - illegal"), and that one is already invisible via
 *    Availability `b9999` plus the 0x4000 hide flag. So this rule cannot
 *    change stock behaviour at all; it only stops plug-in items their own
 *    authors marked unsaleable from turning up on the shelves.
 *
 * It gates OFFERING only. An owned unit still shows so it can be sold, and
 * buysBackOutfit never consults this — mission-granted junk exists to be
 * dumped for credits, and its BuyRandom is routinely 0.
 */
export function neverOnSale(outfit: OutfitData): boolean {
    return outfit.buyRandom === 0;
}

/**
 * THE OTHER HALF OF BuyRandom — whether the shop has one of these TODAY.
 *
 * neverOnSale above reads the zero case ("never put on a shelf at all");
 * this reads the rest of the Bible's sentence, "the percent chance that an
 * item of this type will be available for purchase on a given day, from
 * 1-100" (~:2034). The roll itself, its determinism and its master switch
 * live in day_roll.ts, shared with the two ship shops so an outfit, a hull
 * and a hireable pilot are all decided the same way.
 *
 * WHY IT MATTERS BEYOND SHOP FLAVOUR. A plug-in uses it to offer a CHOICE
 * between mutually exclusive items. Extra Outfits' bridge officers are the
 * case in point: each of its six posts (oütf 504-521) has three candidates
 * whose Availability excludes the other two — `b9010 & !O<other> &
 * !O<other>` — and they carry BuyRandom 50 / 25 / 15, so on most days at
 * most one candidate for a post has turned up. With no roll all three sit
 * on the shelf at once and the outfitter looks like it will sell three
 * First Officers; the `!Oxxx` exclusions still stop the player from ever
 * OWNING two (see canBuyOutfit's availability denial), but only after one
 * has been bought.
 *
 * A day of 0 percent chance is not a refusal to sell something already
 * owned: nothing here is consulted by canSellOutfit or buysBackOutfit.
 */
export function offeredToday(outfit: OutfitData,
    context: Pick<OutfitterContext, 'day' | 'stellarId'>): boolean {
    return passesDayRoll(outfit.buyRandom, 'outfit',
        resourceNumberOf(outfit.id) ?? 0, context);
}

/**
 * The day's 0-99 roll for this outfit at this stellar — compared against
 * BuyRandom by {@link offeredToday}. Exported so the roll mechanism stays
 * under test while day_roll's master switch is off.
 */
export function outfitBuyRandomDayRoll(outfit: OutfitData,
    context: Pick<OutfitterContext, 'day' | 'stellarId'>): number {
    return dayRoll('outfit', resourceNumberOf(outfit.id) ?? 0, context);
}

/**
 * Whether a stellar puts this item on its shelves at all: it must be
 * offerable (see neverOnSale) and within the stellar's tech reach.
 */
export function stellarStocks(outfit: OutfitData,
    stellar: TechStellar): boolean {
    return !neverOnSale(outfit) && meetsTechLevel(outfit.techLevel, stellar);
}

/**
 * The stock rules of the stellar the player is docked at. The
 * buys-anything bit is a spöb Flags2 bit that planet_parse decodes into
 * the named flags, so it is read from there rather than from a raw field.
 *
 * The stellar's OWNING gövt is deliberately absent: the only thing the
 * outfitter would have wanted it for is the ränk PriceMod, and PriceMod does
 * not reach outfit prices (price_mod.ts). Tech reach and the buys-anything
 * bit are the whole of what a shop's stock depends on.
 */
export function stellarOf(planet: PlanetData): OutfitterStellar {
    return {
        techLevel: planet.techLevel,
        specialTech: planet.specialTech,
        buysAnyOutfit: planet.flags.buysAnyOutfit,
    };
}

export type BuyDenialReason =
    | 'notStocked'
    | 'notAvailableToday'
    | 'availability'
    | 'require'
    | 'maxCount'
    | 'needsLauncher'
    | 'gunHardpoints'
    | 'turretHardpoints'
    | 'mass'
    | 'cargo'
    | 'credits';

export type SellDenialReason =
    | 'notOwned'
    | 'cantSell'
    | 'fightersDeployed'
    | 'ammoAboard'
    | 'negativeFreeMass'
    | 'notStocked';

/**
 * The fraction of an outfit's purchase price the player recovers when
 * selling back a pre-owned unit. The EVN Bible gives no explicit
 * outfit-resale field, and its 25% figure is specifically the *ship*
 * trade-in ("25% of the original cost of your current ship and
 * upgrades", Bible shïp Cost field). Per Matthew's rule, standalone
 * outfit resale is 50% of the price, floored. (A unit bought and sold
 * within the same outfitter visit is refunded in full — that same-visit
 * accounting lives in the Outfitter menu, not here.)
 */
export const OUTFIT_RESALE_FRACTION = 0.5;

/**
 * What this outfitter charges for one unit of `outfit` aboard `ship`: its
 * oütf Cost as written — or, for an outfit flagged 0x0200, that Cost
 * MULTIPLIED BY THE SHIP CLASS'S MASS: "This item's total price is
 * proportional to the player's ship's mass. (ship class Mass field is
 * multiplied by this item's Cost field)" (EVN Bible ~:1974). Every stock
 * armour plating is flagged: Carbon Fiber (oütf 180, Cost 250) is 6,250 cr
 * on the mass-25 Heavy Shuttle of the original-hardware capture
 * outfitter/earth_outfitter_carbon_fiber_cant_hold_any_more.png ("Item
 * Price: 6,250 cr"), and 2,500,000 cr on a Leviathan (Mass 10,000).
 *
 * Everything that quotes or charges an outfit price goes through here --
 * the Outfitter's "Item Price:" line, the credits deducted on Buy,
 * canBuyOutfit's affordability test, maxBuyCount's credit bound, the
 * sell-back below and the shipyard's trade-in valuation -- so the shown
 * and charged figures are the same number by construction.
 *
 * `ship` is the hull the outfit is (or would be) installed on. It is
 * optional only for the specs and displays that price an outfit with no
 * hull in hand; without one a flagged outfit is quoted UNSCALED, which is
 * never what a shop wants, so every shop path passes its context's ship.
 *
 * NO ränk PriceMod. Per Matthew's ruling a rank discount bends SHIP prices
 * (and the hire fee taken off them) but never the outfitter: at Extra
 * Outfits' Spica Shipyard the same ranks that make the hulls free would
 * otherwise hand over the building materials those hulls are built from, and
 * the plug-in prices those materials from 2,500 to 7,000,000 cr precisely
 * because you are meant to pay for them. price_mod.ts has the full evidence.
 */
export function outfitPrice(outfit: OutfitData, ship?: ShipData): number {
    if (outfit.priceScalesWithShipMass && ship) {
        return outfit.price * ship.physics.mass;
    }
    return outfit.price;
}

/**
 * The tonnage one unit of `outfit` occupies aboard `ship` — the oütf Mass,
 * or for flag 0x0400 the ship-mass-proportional figure. The rule and its
 * rounding ruling live in nova_plugin/outfit_plugin.ts's
 * installedOutfitMass, which is also what the sim's physics derivation
 * uses, so the free mass this shop shows is the free mass the ship
 * flies with. Like outfitPrice, a missing ship means "as written".
 */
export function installedMass(outfit: OutfitData, ship?: ShipData): number {
    return ship
        ? installedOutfitMass(outfit, ship.physics.mass)
        : outfit.physics.freeMass;
}

/**
 * Credits recovered for selling one pre-owned unit: 50% of what this shop
 * would charge for it.
 *
 * Buy and sell-back are quoted off the same unmodified oütf Cost, which is
 * what keeps the invariant that matters: within one shop, buying and
 * immediately selling can never profit. Discounting one end and not the other
 * would mint credits, so the two must always move together -- today that
 * means neither moves at all. (A ship-mass-proportional price scales both
 * ends by the same hull, for the same reason.)
 */
export function outfitResaleValue(outfit: OutfitData, ship?: ShipData): number {
    return Math.floor(outfitPrice(outfit, ship) * OUTFIT_RESALE_FRACTION);
}

/**
 * The credits refunded for selling one unit of an outfit, given how many
 * units of it were bought during the current outfitter visit. A unit
 * bought this visit refunds the full price (you get back exactly what
 * you just paid); once those are exhausted, further sells are pre-owned
 * stock at outfitResaleValue (50%). Returns the amount to credit and the
 * remaining same-visit purchase count after this unit — call it once per
 * unit in a bulk sell and the full/half split falls out naturally (buy 3
 * this visit, sell 5 -> 3 full + 2 half).
 */
export function sellRefund(outfit: OutfitData, boughtThisVisit: number,
    ship?: ShipData): { credited: number, boughtThisVisit: number } {
    if (boughtThisVisit > 0) {
        return {
            credited: outfitPrice(outfit, ship),
            boughtThisVisit: boughtThisVisit - 1,
        };
    }
    return {
        credited: outfitResaleValue(outfit, ship), boughtThisVisit,
    };
}

export type OutfitterCheck<Reason> =
    | { allowed: true }
    | { allowed: false, reason: Reason, message: string };

function denied<Reason>(reason: Reason, message: string):
    OutfitterCheck<Reason> {
    return { allowed: false, reason, message };
}

function* ownedOutfits(context: OutfitterContext):
    Iterable<[OutfitData, number]> {
    for (const [id, count] of context.outfits) {
        const outfit = context.getOutfit(id);
        if (outfit && count > 0) {
            yield [outfit, count];
        }
    }
}

/** The ship's remaining outfit space in tons. */
export function freeMass(context: OutfitterContext): number {
    let free = context.shipData.physics.freeMass;
    for (const [outfit, count] of ownedOutfits(context)) {
        free -= installedMass(outfit, context.shipData) * count;
    }
    return free;
}

/**
 * The ship's cargo capacity after outfit modifications.
 *
 * THE DOCKED SHIP'S OWN HULL ONLY. Escort holds (spaceport/fleet_cargo.ts)
 * are deliberately invisible here: a mass expansion, a retool, or any
 * other freeCargo outfit is judged against the hull it is being bolted
 * to, never against tonnage a freighter escort happens to be hauling.
 * `OutfitterContext` carries no fleet field, which is what keeps that
 * true by construction.
 */
export function freeCargo(context: OutfitterContext): number {
    let free = context.shipData.physics.freeCargo;
    for (const [outfit, count] of ownedOutfits(context)) {
        free += (outfit.physics.freeCargo ?? 0) * count;
    }
    return free;
}

function hardpoints(context: OutfitterContext,
    kind: 'gun' | 'turret'): { max: number, used: number } {
    const physicsKey = kind === 'gun' ? 'maxGuns' : 'maxTurrets';
    const outfitKey = kind === 'gun' ? 'fixedGun' : 'turret';
    let max = context.shipData.physics[physicsKey];
    let used = 0;
    for (const [outfit, count] of ownedOutfits(context)) {
        max += (outfit.physics[physicsKey] ?? 0) * count;
        if (outfit[outfitKey]) {
            used += count;
        }
    }
    return { max, used };
}

/**
 * The union of the Contribute flag sets of the player's ship and all
 * owned outfits.
 */
export function playerContribute(context: OutfitterContext): bigint {
    let contribute = BigInt(context.shipData.contribute ?? '0x0')
        | (context.rankContribute ?? 0n);
    for (const [outfit, count] of ownedOutfits(context)) {
        if (count > 0) {
            contribute |= BigInt(outfit.contribute ?? '0x0');
        }
    }
    return contribute;
}

/**
 * The most of this outfit the player may own: the Max field times the
 * number of owned increase-maximum items that point at it. Max <= 0
 * means unlimited.
 */
export function effectiveMax(outfit: OutfitData,
    context: OutfitterContext): number {
    if (outfit.max <= 0) {
        return Infinity;
    }
    let multiplier = 0;
    for (const [owned, count] of ownedOutfits(context)) {
        if (owned.increasesMax === outfit.id) {
            multiplier += count;
        }
    }
    return outfit.max * Math.max(1, multiplier);
}

/**
 * How many instances of a weapon the player's installed outfits mount in
 * total (an outfit granting 2 of a weapon, owned 3 times, mounts 6).
 * Every weapon a ship carries arrives through an outfit, built-in hull
 * weapons included — novaparse synthesizes an oütf for those (see its
 * built_in_weapon_outfit.ts) — so this is the whole count.
 */
function mountedWeaponCount(weaponId: string,
    context: OutfitterContext): number {
    let mounted = 0;
    for (const [outfit, count] of ownedOutfits(context)) {
        mounted += (outfit.weapons[weaponId] ?? 0) * count;
    }
    return mounted;
}

/**
 * The maximum units of ammunition the player's launchers support, or
 * undefined if this outfit is not launcher-restricted (its quantity is
 * governed by the oütf Max field alone, so it is freely buyable).
 *
 * THE RULE, from the Bible's two fields. An ammo oütf (ModType 3) names a
 * wëap in its ModVal — the SUPPLY weapon, `ammoFor` here — and that
 * weapon's MaxAmmo is "the maximum amount of ammo per each instance of
 * this weapon. (so, if you have two of these weapons, the max amount of
 * ammo for that weapon type would actually be twice MaxAmmo, and so on)
 * Set to 0 or -1 if you want the ammo quantity to be constrained by the
 * oütf resource's Max field instead" (~:3375). So:
 *
 *   MaxAmmo <= 0  ->  undefined: oütf Max governs, no launcher needed.
 *   MaxAmmo  > 0  ->  MaxAmmo x (instances of the SUPPLY weapon mounted).
 *
 * "Instances of this weapon" is instances of the supply weapon itself,
 * NOT of every weapon that draws from its supply — those are two
 * different sets, and the difference is load-bearing in real data:
 *
 *  - The Nuclear Missile plug-in ('Nuke') splits them deliberately. Its
 *    ammo oütf 444 "Nuclear Missile" (Max 120) is ammo for wëap 238
 *    "Nuke Storage Rack" (MaxAmmo 8), a dummy weapon granted by oütf 446
 *    "Nuke Storage Rack" (Max 15); the thing that FIRES nukes is wëap 236,
 *    granted by oütf 445 "Missile Launcer", whose AmmoType draws on 238
 *    and whose own MaxAmmo is 0. Capacity is 8 per RACK — racks are the
 *    magazine, tubes are not. Walking the drawers instead read 236's
 *    MaxAmmo of 0 as "unlimited" and let a player with a tube and no rack
 *    buy 120 nukes, while a player with racks and no tube could buy none.
 *  - The 'singularity' plug-in has three ammo outfits whose supply weapon
 *    has MaxAmmo > 0 and an AmmoType of ["energy", n] (it burns fuel per
 *    shot as well as consuming an ammo outfit) — e.g. oütf 476 "Nuetrino
 *    Shard" for wëap 264 (MaxAmmo 25), granted by oütf 475. No weapon
 *    anywhere draws from those supplies, so the drawer walk found nothing
 *    and pinned capacity at 0: that ammo could never be bought at all.
 *
 * Nothing in stock distinguishes the two readings (every stock supply
 * weapon is its own launcher and points its AmmoType at itself), so this
 * is a strict improvement with no stock behaviour change.
 */
export function ammoCapacity(outfit: OutfitData,
    context: OutfitterContext): number | undefined {
    if (!outfit.ammoFor) {
        return undefined;
    }
    const supply = context.getWeapon(outfit.ammoFor);
    if (!supply || supply.maxAmmo <= 0) {
        return undefined;
    }
    return supply.maxAmmo * mountedWeaponCount(outfit.ammoFor, context);
}

/** Units of this outfit the player owns but that are not aboard (bay
 * fighters still in flight). See OutfitterContext.deployedCounts. */
function deployedCount(outfitId: string, context: OutfitterContext): number {
    return context.deployedCounts?.get(outfitId) ?? 0;
}

/**
 * How many of this outfit the player OWNS, counting units that are not
 * aboard right now (bay fighters still in flight). This is the count the
 * Bible's "or already has at least one of it" visibility carve-outs test:
 * a player whose whole fighter complement is launched still owns them, so
 * the item must not vanish from the outfitter while they are out.
 *
 * Not the same as the count that may be SOLD — see canSellOutfit, which
 * deliberately uses only the units actually aboard.
 */
export function ownedCount(outfitId: string, context: OutfitterContext):
    number {
    return (context.outfits.get(outfitId) ?? 0)
        + deployedCount(outfitId, context);
}

/**
 * The owned ammo units drawing from one weapon's supply, split by where
 * they physically are. Deployed rounds are gone from context.outfits
 * (consumeAmmo spent them at launch), so ownedOutfits cannot see them and
 * they are added separately — a fully-launched magazine has a zero (or
 * missing) aboard count and only deployed units.
 *
 * The split matters on the SELL side and only there: a round aboard can
 * be handed over to free magazine space, a deployed one cannot (see
 * canSellOutfit). Everything else wants the total.
 */
function ammoHeldFor(ammoFor: string, context: OutfitterContext):
    { aboard: number, deployed: number } {
    let aboard = 0;
    for (const [outfit, count] of ownedOutfits(context)) {
        if (outfit.ammoFor === ammoFor) {
            aboard += count;
        }
    }
    let deployed = 0;
    for (const [id, count] of context.deployedCounts ?? []) {
        if (context.getOutfit(id)?.ammoFor === ammoFor) {
            deployed += count;
        }
    }
    return { aboard, deployed };
}

/**
 * The total owned ammo units drawing from the same weapon's supply,
 * counting rounds that are currently deployed rather than in the
 * magazine — a launched fighter still occupies its slot in the bay.
 */
function ownedAmmoCount(ammoFor: string, context: OutfitterContext): number {
    const { aboard, deployed } = ammoHeldFor(ammoFor, context);
    return aboard + deployed;
}

/**
 * The global id an `Oxxx` term inside outfit `from`'s Availability names.
 *
 * Numeric ids in scenario scripting live in ONE flat space: a plug-in
 * that defines resource 514 either overrides the stock 514 or occupies an
 * id the stock data never used. NovaJS splits that space by prefix, and
 * the loader (novaparse's IDSpaceHandler) resolves the collision the same
 * way every time — a plug-in resource keeps the "nova:" prefix when it
 * overrides a stock one, and only gets its own prefix when there is no
 * stock resource to override. So "the stock id if there is one, else the
 * WRITING plug-in's own" reproduces exactly what the original engine
 * sees; it is mission_logic's resolveNumberedResource, applied to outfits.
 *
 * The writer is `from.writerPrefix`, NOT the prefix of its id, and the
 * difference is the whole point (see BaseData.writerPrefix). Reading the
 * id's prefix broke every Oxxx written by a plug-in INTO an overridden
 * stock resource. Extra Outfits overrides stock oütf 197 / 228 / 256 (the
 * Afterburner, Solar Panels and Battery Pack) purely to add `!o548`,
 * `!o593`, `!o594` — "not while you have my 2nd Generation one". Those
 * ids resolved to nonexistent stock outfits 548/593/594, so every term was
 * false, `!false` was true, and the first-generation item stayed on sale
 * with its successor installed.
 *
 * Hard-coding "nova:" (the state before any of this existed) had the
 * mirror-image failure for a plug-in's OWN outfits: Extra Outfits' three
 * Engineering Officer grades (oütf 513/514/515) are each
 * `b9010 & !O<other> & !O<other>`, and stock outfits stop at 443, so every
 * one of those exclusions silently passed and all three could be bought.
 */
function resolveOutfitReference(id: number, from: OutfitData,
    context: OutfitterContext): string {
    return resolveNumberedResource(id, setStringPrefix(from),
        globalId => outfitReferenceExists(globalId, context));
}

/**
 * EXISTENCE, NOT WARMTH. Whether the game data defines an outfit with this
 * global id — the one question resolveOutfitReference asks, and the one it
 * used to get wrong.
 *
 * The old spelling was `context.getOutfit(id)` truthiness, and against the
 * running menu's lookup that is not an existence test at all. Two
 * behaviours downstream of it turn a miss into a lasting lie:
 *
 *   - Gettable.getCached returns undefined for an id it has not loaded and
 *     STARTS A BACKGROUND LOAD, so the same probe answers differently a
 *     frame later, and
 *   - GameDataAggregator resolves an id no data source defines to
 *     `Defaults[dataType]` rather than rejecting, so that background load
 *     succeeds and caches a placeholder (`{ id: 'default', ... }`) under
 *     the id nothing defines.
 *
 * The result was a purchase rule that flipped between two selections of the
 * same tile: Extra Outfits' officers are oütf 504-521 and stock outfits stop
 * at 443, so a post's `!Oxxx` exclusion resolved to the plug-in's own
 * sibling (owned, refused) on the first evaluation and to a phantom
 * `nova:xxx` (absent, allowed) on every one after — hiring a second officer
 * for the same post, since applyBuy trusts this gate. See
 * outfitter_officer_reselect_test.ts.
 *
 * So: prefer `context.outfitExists`, an id-list lookup that cannot be
 * affected by load order (MissionUniverse.hasOutfit). Without one, fall
 * back to `getOutfit` but demand that what comes back actually IS the
 * outfit asked for — which rejects the aggregator's placeholder and is
 * true by construction for the exhaustive id-keyed maps the headless
 * callers pass.
 */
function outfitReferenceExists(globalId: string,
    context: OutfitterContext): boolean {
    if (context.outfitExists) {
        return context.outfitExists(globalId);
    }
    return context.getOutfit(globalId)?.id === globalId;
}

/**
 * Whether the outfit's Availability control bit test passes.
 * Malformed expressions log and count as available, matching the
 * blank-expression default.
 *
 * `Oxxx` counts deployed units as owned, per the Bible's note that "the
 * Oxxx operator also considers any carried fighters that are deployed
 * when it examines the player's current list of outfits" — hence
 * ownedCount rather than a bare lookup.
 *
 * `Exxx` ("has the player explored system xxx") reads the local pilot's
 * discovery record when the caller supplied one, with the sÿst number
 * scoped to the outfit's OWN writing plug-in — the same id-space rule
 * resolveOutfitReference applies to `Oxxx`, and for the same reason.
 */
export function availabilityTest(outfit: OutfitData,
    context: OutfitterContext): boolean {
    const resolveId = context.resolveId
        ?? (id => resolveOutfitReference(id, outfit, context));
    const discovery = systemDiscoveryOperators(context.discovery,
        setStringPrefix(outfit), context.systemExists);
    try {
        return evaluateNCBTest(outfit.availability ?? '', {
            getBit: bit => context.bits.has(bit),
            hasOutfit: id => ownedCount(resolveId(id), context) > 0,
            ...(discovery ? { hasExplored: discovery.hasExplored } : {}),
        });
    } catch (error) {
        if (error instanceof NCBParseError) {
            console.warn(`Bad Availability for outfit ${outfit.id}:`, error);
            return true;
        }
        throw error;
    }
}

/**
 * Whether the player's Contribute bits cover this outfit's Require set.
 * Shared by the purchase check and by the 0x0100 visibility rule, which
 * hides an unmet item entirely instead of merely greying it.
 */
export function requirementsMet(outfit: OutfitData,
    context: OutfitterContext): boolean {
    const require = BigInt(outfit.require ?? '0x0');
    return (require & playerContribute(context)) === require;
}

/** Checks every purchase requirement for buying one of this outfit. */
export function canBuyOutfit(outfit: OutfitData,
    context: OutfitterContext): OutfitterCheck<BuyDenialReason> {
    // The shop has to deal in it at all. Normally an out-of-stock item is
    // not even displayed, but an owned one can be on show purely so it can
    // be SOLD (see visibleOutfits) — that must not make it buyable.
    // neverOnSale is a property of the ITEM, so it holds with or without a
    // stellar; the tech level needs one to compare against.
    if (neverOnSale(outfit)
        || (context.planet
            && !meetsTechLevel(outfit.techLevel, context.planet))) {
        return denied('notStocked', 'They don\'t sell these here.');
    }

    // The oütf BuyRandom day roll. A failed roll HIDES the item from the
    // grid (see buyVisible), so this is the purchase-side backstop for a
    // selection that survived from before the day turned over.
    if (!offeredToday(outfit, context)) {
        return denied('notAvailableToday',
            'They don\'t have any of these today.');
    }

    if (!availabilityTest(outfit, context)) {
        return denied('availability', 'Not available.');
    }

    if (!requirementsMet(outfit, context)) {
        return denied('require', 'You lack something this requires.');
    }

    // Deployed units (fighters still in flight) count as owned: they
    // come back, and the Max is a limit on how many the player HAS,
    // not on how many happen to be sitting in the bay right now.
    const owned = ownedCount(outfit.id, context);
    if (owned >= effectiveMax(outfit, context)) {
        return denied('maxCount', 'You can\'t carry any more of these.');
    }

    if (outfit.ammoFor) {
        const capacity = ammoCapacity(outfit, context);
        if (capacity !== undefined
            && ownedAmmoCount(outfit.ammoFor, context) >= capacity) {
            return denied('needsLauncher', capacity === 0
                ? 'You need a launcher for this ammunition.'
                : 'Your launchers can\'t hold any more ammunition.');
        }
    }

    if (outfit.fixedGun) {
        const { max, used } = hardpoints(context, 'gun');
        if (used >= max) {
            return denied('gunHardpoints', 'You have no free gun hardpoint.');
        }
    }
    if (outfit.turret) {
        const { max, used } = hardpoints(context, 'turret');
        if (used >= max) {
            return denied('turretHardpoints',
                'You have no free turret hardpoint.');
        }
    }

    if (installedMass(outfit, context.shipData) > freeMass(context)) {
        return denied('mass', 'You don\'t have enough free mass.');
    }

    const cargoUse = outfit.physics.freeCargo ?? 0;
    if (cargoUse < 0 && freeCargo(context) + cargoUse < 0) {
        return denied('cargo', 'You don\'t have enough cargo space.');
    }

    // Checked last: structural denials (mass, hardpoints, Max) are
    // permanent, but "can't afford" just means come back with money.
    if (outfitPrice(outfit, context.shipData) > context.credits) {
        return denied('credits', 'You can\'t afford this item.');
    }

    return { allowed: true };
}

/**
 * Whether this outfitter will buy a unit of this outfit back at all,
 * ignoring whether the player actually has one.
 *
 * The default is that a shop only deals in what it would itself stock: an
 * outfitter cannot buy an item whose tech level is beyond it. That default
 * is not stated outright in the Bible, but it is the only reading under
 * which its two escape hatches mean anything —
 *   - oütf 0x0800 (~:1980), "can be sold anywhere, regardless of tech
 *     level, requirements, or mission bits", and
 *   - spöb Flags2 0x0400 (~:2862), the shop "can buy any nonpermanent
 *     outfits the player owns, regardless of tech level"
 * both exist purely to LIFT a tech-level restriction on selling, so that
 * restriction has to be there by default.
 *
 * JUDGMENT CALL — "nonpermanent" in the 0x0400 text is read as "not
 * flagged can't-sell (oütf 0x0008)", not as "not flagged persistent
 * (0x0004)". Persistence only governs whether an item follows the player
 * across a ship trade (Bible ~:1964) and never blocked selling, whereas
 * can't-sell is exactly the "you are stuck with this" property the word
 * permanent describes. So cantSell still wins over 0x0400.
 *
 * 0x0800 is honoured to the letter: "regardless of tech level,
 * requirements, or mission bits". Selling never consults Require or
 * Availability for ANY outfit here — those gate buying, not dumping what
 * you already carry — so the requirements/mission-bits half of the
 * guarantee holds unconditionally, and 0x0800's remaining job is to lift
 * the tech-level gate. That combination is load-bearing for
 * mission-granted junk (used-up carbon fiber and the like), which is
 * handed to the player precisely so it can be sold, often at a world that
 * would never stock it and long after the bit that granted it cleared.
 * outfitter_visibility_test.ts pins this end to end.
 */
export function buysBackOutfit(outfit: OutfitData,
    stellar: OutfitterStellar): boolean {
    if (outfit.cantSell) {
        return false;
    }
    return outfit.sellAnywhere || stellar.buysAnyOutfit
        || meetsTechLevel(outfit.techLevel, stellar);
}

/**
 * Every ammunition supply that selling ONE unit of this outfit would
 * shrink, with the rounds held for it and the room that would be left.
 *
 * `outfit.weapons` names the weapons an outfit grants, and a weapon is a
 * MAGAZINE for the ammo outfits whose `ammoFor` names it (that same
 * ammo-outfit id is the key deployedCounts is built on — see
 * deployed_outfits.ts, which attributes each flying fighter back to an
 * owned ammo outfit via its BayFighterComponent.bayWeaponId). A bay is
 * just the case of this where the rounds are fighters.
 *
 * There are TWO room-left figures because a round aboard and a round in
 * flight are not in the same danger, and only one of them is governed by
 * the ammunition ceiling:
 *
 *  - `roomLeft`, for the capacity refusal, is ammoCapacity's own: MaxAmmo
 *    per mounted instance when the supply weapon carries a positive
 *    MaxAmmo, so selling one unit of an outfit granting n of them frees
 *    MaxAmmo x n and leaves MaxAmmo x (mounted - n). When MaxAmmo <= 0
 *    there is no launcher-derived ceiling at all — the ammo outfit's own
 *    oütf Max governs and no weapon coming or going can move it — so the
 *    room left is UNBOUNDED and no sale can ever put those rounds over
 *    their limit. That is Matthew's ruling: an IR Missile Launcher sells
 *    with a full hold of IR Missiles.
 *  - `roomLeftForDeployed` adds the one thing that is not about capacity:
 *    a fighter still in flight is dropped outright if it has no bay to
 *    come home to (bay_plugin's refundFighterToBay), so the last instance
 *    of a weapon deployed rounds belong to holds them even when MaxAmmo
 *    says nothing. Rounds already ABOARD need no such protection — they
 *    stay in the hold as ammunition the ship cannot currently fire, which
 *    is exactly the IR Missile case.
 *
 * Yields nothing for an ordinary outfit (it grants no weapons), for the
 * FIGHTER or ammo outfit itself (ammunition grants no weapon), and for a
 * weapon no owned ammo outfit feeds. That last one is why selling the Nuke
 * plug-in's firing tube (oütf 445, granting wëap 236) is free while selling
 * a rack (oütf 446, granting the supply wëap 238) is checked: no ammo oütf
 * names 236, so the tube is not a magazine.
 */
function shrunkenMagazines(outfit: OutfitData, context: OutfitterContext): {
    aboard: number, deployed: number,
    roomLeft: number, roomLeftForDeployed: number,
}[] {
    const magazines = [];
    for (const [weaponId, mounted] of Object.entries(outfit.weapons)) {
        if (mounted <= 0) {
            continue;
        }
        const held = ammoHeldFor(weaponId, context);
        if (held.aboard + held.deployed <= 0) {
            continue;
        }
        const supply = context.getWeapon(weaponId);
        const remaining = mountedWeaponCount(weaponId, context) - mounted;
        if (!supply || supply.maxAmmo <= 0) {
            magazines.push({
                ...held,
                roomLeft: Infinity,
                roomLeftForDeployed: remaining > 0 ? Infinity : 0,
            });
            continue;
        }
        const roomLeft = supply.maxAmmo * remaining;
        magazines.push({ ...held, roomLeft, roomLeftForDeployed: roomLeft });
    }
    return magazines;
}

/**
 * Checks whether the player may sell one of this outfit.
 *
 * See THE LAUNCHER SELL RULE below for the ammunition half.
 */
export function canSellOutfit(outfit: OutfitData,
    context: OutfitterContext): OutfitterCheck<SellDenialReason> {
    // Only units actually aboard may be sold; a fighter still in flight is
    // not on the ship to hand over (see OutfitterContext.deployedCounts).
    if ((context.outfits.get(outfit.id) ?? 0) <= 0) {
        return denied('notOwned', 'You don\'t have any of these.');
    }
    if (outfit.cantSell) {
        return denied('cantSell', 'This can\'t be sold.');
    }
    for (const { aboard, deployed, roomLeft, roomLeftForDeployed } of
        shrunkenMagazines(outfit, context)) {
        // Deployed rounds first: they cannot be sold to make room (they
        // are not aboard, so canSellOutfit denies them as notOwned), so
        // when THEY alone overflow what is left, the only move is to
        // recall — different advice, hence its own wording. This is also
        // the exploit Matthew named: buy a bay and its fighters, launch
        // them, land, sell the bay back. The fighters are not in
        // context.outfits at all, so the notOwned check above cannot see
        // them; without this they were converted to credits and left
        // pointing at a hangar that no longer exists, and
        // refundFighterToBay silently dropped each one on docking because
        // the carrier mounted zero bays (bay_plugin.ts). That last
        // sentence is why this one test is not the pure capacity one:
        // see roomLeftForDeployed in shrunkenMagazines.
        if (deployed > roomLeftForDeployed) {
            return denied('fightersDeployed',
                'You can\'t sell this while its fighters are deployed.');
        }
        if (aboard + deployed > roomLeft) {
            return denied('ammoAboard', ammoSellRefusal(
                aboard + deployed - roomLeft, outfit.name,
                context.ammoSellStrings));
        }
    }
    // Selling an item that GRANTED outfit space (a negative-Mass Mass
    // Expansion, stock oütf 190) shrinks the hold it freed. STR# 2002
    // index 206 is the original's own sentence for exactly this.
    const mass = installedMass(outfit, context.shipData);
    if (mass < 0 && freeMass(context) + mass < 0) {
        return denied('negativeFreeMass', NEGATIVE_FREE_MASS_REFUSAL);
    }
    if (context.planet && !buysBackOutfit(outfit, context.planet)) {
        return denied('notStocked', 'They don\'t deal in these here.');
    }
    return { allowed: true };
}

/*
 * THE LAUNCHER SELL RULE.
 *
 * Stock STR# 2002 carries a sentence composed for one denial and nothing
 * else, at indices 207-211 (see AmmoSellStrings): "You need to sell 4 units
 * of ammunition before you can sell your Viper Bay." Its sibling at 206 is
 * the other sell refusal, which is why sell denials are captioned in the
 * outfitter at all.
 *
 * THE RULE IS PURELY ABOUT CAPACITY. RULING (Matthew, 2026-08-17): "You
 * should be able to sell an IR missile launcher even if you have IR
 * missiles (and this rule generalizes and should change our interpretation
 * of ammo limits)." So the sale is refused if and only if it would leave
 * the rounds held OVER the capacity that remains — never merely because a
 * launcher for them is going away. The capacity is ammoCapacity's, and it
 * has exactly two shapes (Bible ~:3375):
 *
 *  - MaxAmmo <= 0 on the supply weapon: the ceiling is the ammo outfit's
 *    own oütf Max, times its ModType 27 multipliers. Launchers do not enter
 *    into it, so selling one — INCLUDING THE LAST ONE — cannot create a
 *    shortfall. This is every ordinary missile in stock data: 200 IR
 *    Missiles may be bought with no launcher (oütf Max 200, wëap MaxAmmo
 *    0), and symmetrically the launcher may be sold with all 200 aboard.
 *    Ammunition the ship cannot currently fire is the player's business.
 *  - MaxAmmo > 0: capacity is MaxAmmo per mounted instance of the supply
 *    weapon, so N launchers hold N x MaxAmmo and N-1 hold one MaxAmmo less.
 *    This is where the STR# sentence lives — bays, and the Nuke plug-in's
 *    storage racks. The count in it is the SHORTFALL, not the whole
 *    magazine: two Viper Bays (4 each) with 8 fighters aboard says "You
 *    need to sell 4 units", and the last Viper Bay with 4 aboard says 4.
 *
 * WHAT COUNTS AS A LAUNCHER is therefore not a flag but a relation, and a
 * narrow one: an outfit is a magazine for some ammunition when it grants
 * the wëap that ammunition's ModVal names (its `ammoFor`) AND that wëap
 * carries a positive MaxAmmo. Ordinary equipment grants no weapons; a gun
 * whose ammo nobody owns has an empty magazine; a weapon that merely DRAWS
 * on someone else's supply is not that supply's magazine (the Nuke
 * plug-in's tube versus its racks); and an ordinary missile launcher has no
 * magazine of its own at all. See shrunkenMagazines.
 *
 * THE DEPLOYED-FIGHTER INTERACTION. A bay is a magazine whose rounds are
 * fighters, so both refusals live on the same shortfall: rounds ABOARD can
 * be sold to make room and get the stock sentence, deployed ones cannot and
 * get 'fightersDeployed' ("recall them"). Selling one of two full Viper
 * Bays with 4 fighters out and 4 aboard therefore asks for the 4 aboard to
 * go; with 5 out and none aboard it asks for a recall; with 3 out and none
 * aboard it just succeeds, because the surviving bay holds all three. That
 * last case used to be refused outright, deliberately, as the conservative
 * choice available before this rule existed.
 *
 * The ONE place the deployed half parts company with the capacity rule is
 * the last instance of a MaxAmmo <= 0 bay — stock has four of those (wëap
 * 177-180, the variant Viper and Anaconda bays). Ammunition aboard survives
 * such a sale untouched, so the capacity rule rightly says nothing; a
 * fighter in FLIGHT does not, because refundFighterToBay drops it when the
 * carrier mounts no bay. Losing a fighter outright is not the same event as
 * holding a round you cannot fire, so the anti-strand refusal stands on its
 * own there. bay_plugin_test pins it on real stock resources.
 *
 * NOT COVERED: the other way an ammunition ceiling can shrink is selling an
 * increase-maximum item (ModType 27) that was multiplying the ammo's oütf
 * Max. Neither the Bible nor the STR# strings connect that to this refusal,
 * and it is unreachable in shipped data — a survey of stock plus all
 * twenty-six bundled plug-ins finds no ModType 27 resource at all — so it
 * is left alone rather than guessed at.
 */

/** A sane ceiling for bulk purchases of an effectively unlimited
 * outfit (zero mass, no Max): the quantity dialog clamps here. */
export const BULK_BUY_LIMIT = 9999;

/**
 * The most of this outfit the player could buy right now, for the
 * option-click quantity dialog: unit purchases are simulated against a
 * working copy of the outfit list until one fails a check in
 * canBuyOutfit (mass, Max, hardpoints, ammo capacity, availability).
 * OnPurchase side effects aren't simulated; the real purchase loop
 * still applies them (and re-checks) per unit. Affordability bounds the
 * count too: each simulated unit spends the outfit's price, so the loop
 * stops once the remaining credits can't cover another (the
 * floor(credits/price) bound, alongside the space/Max/hardpoint ones).
 */
export function maxBuyCount(outfit: OutfitData, context: OutfitterContext,
    limit = BULK_BUY_LIMIT): number {
    // Every purchase gate is MONOTONE in the count bought (max, ammo
    // capacity, hardpoints, mass, cargo, credits all only get tighter as
    // units are added), so "can I buy n?" is monotone in n and the largest
    // n is a binary search — ~11 canBuyOutfit evaluations for the 2000-unit
    // ammo case instead of 2000 (each evaluation walks every owned outfit
    // for mass/contribute; the linear scan lagged the game for half a
    // second on a big ammo buy). Only OnPurchase side effects could break
    // monotonicity, and this function never runs them: it is the DIALOG's
    // prefill/clamp, and the actual bulk buy re-checks per unit for outfits
    // that carry them.
    const canBuyN = (n: number) => {
        const working = new Map(context.outfits);
        working.set(outfit.id, (working.get(outfit.id) ?? 0) + (n - 1));
        return canBuyOutfit(outfit, {
            ...context, outfits: working,
            credits: context.credits
                - (n - 1) * outfitPrice(outfit, context.shipData),
        }).allowed;
    };
    if (limit <= 0 || !canBuyN(1)) {
        return 0;
    }
    let lo = 1;          // known buyable
    let hi = limit + 1;  // known not buyable (or beyond the limit)
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (canBuyN(mid)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * Whether buying this outfit has per-unit side effects that can change
 * what a LATER unit is allowed to do — an OnPurchase set string, or a
 * legal-record clean (ModType 21). Purchases of such outfits must be
 * applied one unit at a time with a re-check between; everything else
 * (ammo, plain equipment) can be applied as one count bump.
 */
export function hasPurchaseSideEffects(outfit: OutfitData): boolean {
    // ModType 16 maps count: buying one reveals systems and then removes
    // itself from the ship (outfitter.ts applyBuy), which the batched
    // side-effect-free path would get wrong. So does a 0x0010 item, which
    // comes straight back off the ship the same way.
    return Boolean(outfit.onPurchase) || outfit.cleanLegalRecord !== null
        || outfit.map !== null || outfit.removeAfterPurchase;
}

/**
 * The most of this outfit the player could sell right now, for the
 * option-click quantity dialog and the greyed Sell button.
 *
 * Not simply "everything owned" any more: since the launcher sell rule
 * landed, the nth sale can be refused while the first is allowed — three
 * Viper Bays holding 8 fighters may drop to two (8 of 8 still fit) but not
 * to one (only 4 would). Every sell gate tightens monotonically as units
 * go (each sale can only shrink the magazine left and the free mass left),
 * so the largest allowed count is a binary search, exactly as maxBuyCount
 * does on the buy side.
 */
export function maxSellCount(outfit: OutfitData,
    context: OutfitterContext): number {
    const owned = context.outfits.get(outfit.id) ?? 0;
    const canSellN = (n: number) => {
        const working = new Map(context.outfits);
        working.set(outfit.id, owned - (n - 1));
        return canSellOutfit(outfit, { ...context, outfits: working }).allowed;
    };
    if (owned <= 0 || !canSellN(1)) {
        return 0;
    }
    let lo = 1;            // known sellable
    let hi = owned + 1;    // known not sellable
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (canSellN(mid)) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * A total order on outfit global ids matching what the 0x1000 exclusion
 * rule means by "higher-numbered": the numeric resource id.
 *
 * JUDGMENT CALL — the original has ONE flat id space per resource type
 * (plug-ins overlay stock resources by id), so the resource NUMBER is the
 * thing being compared and it is compared first here, across prefixes too.
 * NovaJS's "prefix:" namespacing is an artifact of loading files
 * separately, so it only breaks ties (and ids with no number sort last),
 * purely to keep the order total and the output deterministic.
 */
export function compareOutfitIds(a: string, b: string): number {
    const [numA, numB] = [resourceNumberOf(a), resourceNumberOf(b)];
    if (numA !== numB) {
        if (numA === null) return 1;
        if (numB === null) return -1;
        return numA - numB;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether the shop would actually sell the player one of these right now,
 * which is what the 0x1000 rule means by "available for sale": it is
 * stocked here, the player meets its Require bits, and its Availability
 * test passes.
 *
 * Deliberately ignores mass, hardpoints, Max and credits. Those are
 * transient facts about the player's ship and wallet, and letting them
 * decide the rule would make a full cargo hold change WHICH items the shop
 * displays. It also ignores the "already has at least one" carve-outs: an
 * item shown only because the player owns one is not being offered for
 * sale, so it must not suppress anything.
 */
export function availableForSale(outfit: OutfitData,
    context: OutfitterContext): boolean {
    if (neverOnSale(outfit) || !offeredToday(outfit, context)
        || (context.planet
            && !meetsTechLevel(outfit.techLevel, context.planet))) {
        return false;
    }
    return requirementsMet(outfit, context)
        && availabilityTest(outfit, context);
}

/**
 * Whether this outfit passes the BUY-side visibility gates, before the
 * 0x1000 exclusion pass. Note that failing Availability without the 0x4000
 * flag is NOT a visibility failure: per the Bible (~:1999) such an item
 * "might appear in the outfit window even if Availability is false (it
 * will still not be able to be purchased)", i.e. it shows greyed, which is
 * canBuyOutfit's 'availability' denial.
 */
function buyVisible(outfit: OutfitData, context: OutfitterContext): boolean {
    // A failed BuyRandom day roll HIDES the item rather than greying it
    // (Matthew's ruling, day_roll.ts), which is what the shipyard does
    // with its own roll. An owned unit still shows, so it can be sold:
    // visibleOutfits admits that case before ever reaching here.
    if (neverOnSale(outfit) || !offeredToday(outfit, context)
        || (context.planet
            && !meetsTechLevel(outfit.techLevel, context.planet))) {
        return false;
    }
    // Both of these hide-flags spare an item the player already has at
    // least one of, counting deployed fighters as had.
    const owned = ownedCount(outfit.id, context) > 0;
    if (outfit.hideUnlessRequirementsMet && !owned
        && !requirementsMet(outfit, context)) {
        return false;
    }
    if (outfit.hideUnlessAvailable && !owned
        && !availabilityTest(outfit, context)) {
        return false;
    }
    return true;
}

/**
 * The outfits an outfitter shows, in display order.
 *
 * An outfit appears when the shop offers it (BuyRandom and tech level, plus
 * the 0x0100 / 0x4000 hide-flags and the 0x1000 exclusion), OR when the
 * player owns one
 * and this shop will buy it back — owned stock stays visible so it can be
 * sold, which is also why the two hide-flags carve out "already has at
 * least one". An owned item the shop will NOT buy back (its tech level is
 * beyond this world, with neither escape hatch set) is left out: there is
 * nothing the player could do with it here.
 *
 * Ordering is by DispWeight descending — "items with a higher display
 * weight are shown closer to the top" (Bible ~:1785), which is the
 * direction the grid already used — with ties broken by ascending id so
 * the list is deterministic and matches resource order.
 *
 * Purchasability is a SEPARATE gate: canBuyOutfit still decides which of
 * these render greyed. Some outfits show but cannot be bought; others
 * never appear at all.
 */
export function visibleOutfits(outfits: Iterable<OutfitData>,
    context: OutfitterContext): OutfitData[] {
    const ordered = [...outfits].sort((a, b) =>
        b.displayWeight - a.displayWeight || compareOutfitIds(a.id, b.id));

    // 0x1000: an item that is available for sale suppresses every
    // higher-numbered item sharing its exact DispWeight. Suppression is
    // driven only by items that are themselves available for sale, so a
    // hidden or merely-owned item never excludes anything.
    // (availableForSale implies buyVisible: passing Require and
    // Availability outright satisfies both hide-flags without needing
    // their owned carve-outs.)
    const excluders = ordered.filter(outfit =>
        outfit.excludesEqualDisplayWeight
        && availableForSale(outfit, context));
    const excluded = new Set<string>();
    for (const excluder of excluders) {
        for (const other of ordered) {
            if (other.displayWeight === excluder.displayWeight
                && compareOutfitIds(other.id, excluder.id) > 0) {
                excluded.add(other.id);
            }
        }
    }

    return ordered.filter(outfit => {
        // A built-in weapon is part of the hull, not an item: no oütf
        // defines it, so the original has nothing to show or buy back
        // (see novaparse's built_in_weapon_outfit.ts). Such ids are
        // already absent from NovaIDs.Outfit, so the shop never enumerates
        // one; this keeps an owned built-in off the shelves too.
        if (outfit.builtIn) {
            return false;
        }
        // A suppressed item the player owns still shows, so it can be sold;
        // 0x1000 governs what is offered FOR SALE, not what the player is
        // allowed to get rid of.
        if (context.outfits.get(outfit.id) ?? 0) {
            if (!context.planet || buysBackOutfit(outfit, context.planet)) {
                return true;
            }
        }
        return buyVisible(outfit, context) && !excluded.has(outfit.id);
    });
}

/*
 * SHIPYARD SEAM. Ships carry the same TechLevel / SpecialTech structure as
 * outfits (EVN Bible ~:2413 for shïp TechLevel, ~:2588 for the stellar
 * side), so a future shipyard should call meetsTechLevel(ship.techLevel,
 * stellar) with the same OutfitterStellar built from the docked PlanetData.
 * What does NOT carry over: the oütf 0x0100/0x0800/0x1000/0x4000 flags and
 * spöb Flags2 0x0400 are outfit-only, and ships have no DispWeight, so
 * there is no exclusion pass to reuse.
 *
 * The shipyard now has an economy — the trade-up pricing and outfit
 * persistence rules live in shipyard_rules.ts — but it still stocks every
 * ship regardless of tech level, so the meetsTechLevel call above remains
 * unwired. It needs the docked PlanetData plumbed into the Shipyard menu.
 */
