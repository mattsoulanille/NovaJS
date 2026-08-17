/**
 * The rules for buying and selling outfits in the outfitter, per the
 * EVN Bible's oütf documentation: free mass, gun/turret hardpoints,
 * the Max count (as multiplied by increase-maximum items), the
 * Availability control bit test, Contribute/Require flag coverage,
 * and launcher-restricted ammunition.
 *
 * Pure logic; the Outfitter menu supplies the context. Note that Gxxx
 * control-bit grants intentionally bypass all of these checks (see
 * makeControlBitHooks in ../nova_plugin/ncb.ts).
 */
import { OutfitData } from 'novadatainterface/outfit_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { evaluateNCBTest, NCBParseError } from '../nova_plugin/ncb.js';

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
     * Outfit id -> units the player owns that are NOT installed on the
     * docked ship: today, bay fighters still flying after the carrier
     * landed (see deployed_outfits.ts). They count against the outfit's
     * Max and against its launcher's ammo capacity, so landing with
     * fighters out cannot be used to buy past the cap. Absent or empty
     * means everything owned is aboard.
     *
     * They deliberately do NOT count towards mass, cargo, hardpoints,
     * Contribute, or what may be SOLD — a fighter in flight is not on
     * the ship to sell. See deployed_outfits.ts for the rationale and
     * for how to add further sources of deployed units.
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
 * The stock rules of the stellar the player is docked at. The
 * buys-anything bit is a spöb Flags2 bit that planet_parse decodes into
 * the named flags, so it is read from there rather than from a raw field.
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
    | 'availability'
    | 'require'
    | 'maxCount'
    | 'needsLauncher'
    | 'gunHardpoints'
    | 'turretHardpoints'
    | 'mass'
    | 'cargo'
    | 'credits';

export type SellDenialReason = 'notOwned' | 'cantSell' | 'notStocked';

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

/** Credits recovered for selling one pre-owned unit (50% of price). */
export function outfitResaleValue(outfit: OutfitData): number {
    return Math.floor(outfit.price * OUTFIT_RESALE_FRACTION);
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
export function sellRefund(outfit: OutfitData, boughtThisVisit: number):
    { credited: number, boughtThisVisit: number } {
    if (boughtThisVisit > 0) {
        return { credited: outfit.price, boughtThisVisit: boughtThisVisit - 1 };
    }
    return { credited: outfitResaleValue(outfit), boughtThisVisit };
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
        free -= outfit.physics.freeMass * count;
    }
    return free;
}

/**
 * The ship's cargo capacity after outfit modifications. Carried cargo
 * is not modeled yet (there's no trading), so this only keeps
 * cargo-consuming outfits from driving the capacity negative.
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
 * The maximum units of ammunition the player's launchers support, or
 * undefined if this outfit is not launcher-restricted. Per the EVN
 * Bible's MaxAmmo docs, ammo whose weapon has MaxAmmo <= 0 is
 * constrained by the outfit's Max field alone (freely buyable); ammo
 * whose weapon has MaxAmmo > 0 is capped at MaxAmmo per owned
 * launcher instance, so with no launcher none can be bought.
 */
export function ammoCapacity(outfit: OutfitData,
    context: OutfitterContext): number | undefined {
    if (!outfit.ammoFor) {
        return undefined;
    }
    const suppliedWeapon = context.getWeapon(outfit.ammoFor);
    if (!suppliedWeapon || suppliedWeapon.maxAmmo <= 0) {
        return undefined;
    }
    let capacity = 0;
    for (const [owned, outfitCount] of ownedOutfits(context)) {
        for (const [weaponId, weaponCount] of Object.entries(owned.weapons)) {
            const launcher = context.getWeapon(weaponId);
            if (!launcher || launcher.ammoType === 'unlimited'
                || launcher.ammoType[0] !== 'weapon'
                || launcher.ammoType[1] !== outfit.ammoFor) {
                continue;
            }
            if (launcher.maxAmmo <= 0) {
                // This launcher defers to the outfit's Max field.
                return undefined;
            }
            capacity += launcher.maxAmmo * weaponCount * outfitCount;
        }
    }
    return capacity;
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
 * The total owned ammo units drawing from the same weapon's supply,
 * counting rounds that are currently deployed rather than in the
 * magazine — a launched fighter still occupies its slot in the bay.
 */
function ownedAmmoCount(ammoFor: string, context: OutfitterContext): number {
    let owned = 0;
    for (const [outfit, count] of ownedOutfits(context)) {
        if (outfit.ammoFor === ammoFor) {
            owned += count;
        }
    }
    // Deployed units are gone from context.outfits, so ownedOutfits
    // cannot see them; add them separately. A fully-launched magazine
    // has a zero (or missing) count and only deployed units.
    for (const [id, count] of context.deployedCounts ?? []) {
        if (context.getOutfit(id)?.ammoFor === ammoFor) {
            owned += count;
        }
    }
    return owned;
}

/**
 * The global id an `Oxxx` term inside `from`'s Availability names.
 *
 * Numeric ids in scenario scripting live in ONE flat space: a plug-in
 * that defines resource 514 either overrides the stock 514 or occupies an
 * id the stock data never used. NovaJS splits that space by prefix, and
 * the loader (novaparse's IDSpaceHandler) resolves the collision the same
 * way every time — a plug-in resource keeps the "nova:" prefix when it
 * overrides a stock one, and only gets its own prefix when there is no
 * stock resource to override. So "the plug-in's own id if it has one,
 * else the stock id" reproduces exactly what the original engine sees.
 *
 * Hard-coding "nova:" here instead meant an Oxxx term in a plug-in outfit
 * pointed at a stock outfit that usually does not exist, so the term was
 * always false. The Extra Outfits plug-in leans on Oxxx for mutual
 * exclusion — its three Engineering Officer grades (oütf 513/514/515)
 * are each `b9010 & !O<other> & !O<other>`, and about twenty more of its
 * outfits pair up the same way — and stock outfits stop at 443, so every
 * one of those exclusions silently passed and all three grades could be
 * bought at once.
 */
function resolveOutfitReference(id: number, from: string,
    context: OutfitterContext): string {
    const local = `${resourcePrefix(from)}:${id}`;
    return context.getOutfit(local) ? local : `nova:${id}`;
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
 */
export function availabilityTest(outfit: OutfitData,
    context: OutfitterContext): boolean {
    const resolveId = context.resolveId
        ?? (id => resolveOutfitReference(id, outfit.id, context));
    try {
        return evaluateNCBTest(outfit.availability ?? '', {
            getBit: bit => context.bits.has(bit),
            hasOutfit: id => ownedCount(resolveId(id), context) > 0,
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
    if (context.planet
        && !meetsTechLevel(outfit.techLevel, context.planet)) {
        return denied('notStocked', 'They don\'t sell these here.');
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

    if (outfit.physics.freeMass > freeMass(context)) {
        return denied('mass', 'You don\'t have enough free mass.');
    }

    const cargoUse = outfit.physics.freeCargo ?? 0;
    if (cargoUse < 0 && freeCargo(context) + cargoUse < 0) {
        return denied('cargo', 'You don\'t have enough cargo space.');
    }

    // Checked last: structural denials (mass, hardpoints, Max) are
    // permanent, but "can't afford" just means come back with money.
    if (outfit.price > context.credits) {
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

/** Checks whether the player may sell one of this outfit. */
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
    if (context.planet && !buysBackOutfit(outfit, context.planet)) {
        return denied('notStocked', 'They don\'t deal in these here.');
    }
    return { allowed: true };
}

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
            credits: context.credits - (n - 1) * outfit.price,
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
    return Boolean(outfit.onPurchase) || outfit.cleanLegalRecord !== null;
}

/**
 * The most of this outfit the player could sell right now: everything
 * owned, or nothing when it can't be sold.
 */
export function maxSellCount(outfit: OutfitData,
    context: OutfitterContext): number {
    return canSellOutfit(outfit, context).allowed
        ? (context.outfits.get(outfit.id) ?? 0) : 0;
}

/**
 * The numeric resource id inside a global id like "nova:128" (128), or
 * null when there isn't one. Mirrors mission_logic's numericId; kept local
 * so these rules stay a dependency-free pure module.
 */
function resourceNumber(globalId: string): number | null {
    const parsed = parseInt(globalId.slice(globalId.lastIndexOf(':') + 1), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The plug-in prefix in a global id like "extra-outfits:471" ("nova" when
 * there isn't one). Mirrors mission_logic's idPrefix; kept local so these
 * rules stay a dependency-free pure module, as resourceNumber above is.
 */
function resourcePrefix(globalId: string): string {
    const colon = globalId.lastIndexOf(':');
    return colon < 0 ? 'nova' : globalId.slice(0, colon);
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
    const [numA, numB] = [resourceNumber(a), resourceNumber(b)];
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
    if (context.planet
        && !meetsTechLevel(outfit.techLevel, context.planet)) {
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
    if (context.planet
        && !meetsTechLevel(outfit.techLevel, context.planet)) {
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
 * An outfit appears when the shop offers it (tech level, plus the 0x0100 /
 * 0x4000 hide-flags and the 0x1000 exclusion), OR when the player owns one
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
