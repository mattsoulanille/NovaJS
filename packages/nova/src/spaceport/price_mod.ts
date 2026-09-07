import { Entity } from 'nova_ecs/entity';
import { ActiveRanksComponent, RankLookup, rankPriceMod } from '../nova_plugin/ncb/index.js';

/**
 * ============================================================================
 * ränk PriceMod — the one place a shop price is bent
 * ============================================================================
 *
 * EVN Bible, ränk PriceMod: "Used to modify the prices of items and ships at
 * planets owned by the affiliated government. A value of 100 equals 100% of
 * original price (i.e. prices are unchanged). Higher or lower values raise or
 * lower the prices correspondingly."
 *
 * WHICH modifier applies at a given stellar is rank_logic.ts's `rankPriceMod`
 * (ownership only, 0 means unused, several affiliated ranks compound — the
 * evidence for each ruling is written up there). THIS module is the other
 * half: turning that percentage into the credits figure, once, so that the
 * shops that use it cannot disagree about it.
 *
 * ============================================================================
 * SHIPS ONLY, NOT OUTFITS — Matthew's ruling, and the data behind it
 * ============================================================================
 *
 * Despite the Bible's "items and ships", NovaJS applies PriceMod to the SHIP
 * price (and the hire fee derived from it) and NOT to outfitter items. The
 * ruling came out of playtesting Extra Outfits' Spica Shipyard — "while ships
 * should be free, building materials and outfits should NOT be" — and the
 * plug-in's own data is what settles it.
 *
 * The Spica Shipyard is the only place in any shipped or installed data where
 * PriceMod is steep enough to be decisive: buying oütf extra-outfits:552 "Buy
 * Station" (10,000,000 cr) grants four otherwise-EMPTY ränks 168-171, each
 * AffilGovt extra-outfits:302 and PriceMod 1. Compounded that is 1e-6 percent,
 * which floors EVERYTHING at the station to zero. What the station sells is
 * the tell — its outfitter (spöb extra-outfits:802, SpecialTech 10003) stocks
 * two very different kinds of item:
 *
 *   BUILD ORDERS, already priced 0 in the data:
 *     562 Build Cargo Drone  0 cr    564 Build Shuttle    0 cr
 *     590 Build Leviathan    0 cr    638 Build Corvette   0 cr   (etc.)
 *   RAW MATERIALS, carefully priced by the ton:
 *     554 Building Materials °5 tons°        2,500 cr
 *     557 Building Materials °50 tons°     100,000 cr
 *     561 Building Materials °10000 tons° 7,000,000 cr
 *     637 Exotic Building Materials       2,250,000 cr
 *
 * A build order costs nothing but CONSUMES material outfits: "Build Leviathan"
 * is OnPurchase `D561`, i.e. it eats one 10,000-ton materials package, and the
 * hull it yields is shïp extra-outfits:815 at 12,000,000 cr. "Build Corvette"
 * is `D637 D558 D557` — 2,250,000 + 200,000 + 100,000 = 2,550,000 cr of
 * materials for a hull worth 2,750,000. Those margins are the whole feature:
 * you pay real credits for materials and get a hull free from your own yard.
 *
 * So the four PriceMod-1 ranks exist to zero the SHIPYARD, and nothing else.
 * The author could not simply set the hull Costs to 0 — the hull price is what
 * the player later SELLS the built ship for (and what the bar's hire fee is
 * 10% of), so it has to stay real; PriceMod at the owning govt is the only
 * lever that makes the same hull free to its builder. Meanwhile the author did
 * NOT need PriceMod for the free items: the build orders are literally 0 cr in
 * the resource. Applying PriceMod to the outfitter as well would hand the
 * player every materials tier for nothing, turn a tuned 200,000 cr margin into
 * an unbounded credit press, and make every price the author typed into oütf
 * 554-561 and 637 dead data. Ships free, materials not, is the only reading
 * under which the plug-in's flagship feature works at all.
 *
 * The stock game says nothing against this. Twelve stock ränks carry a real
 * PriceMod (nova:128 at 85, 129 at 60, 130/137/140 at 80, 138/141/142/143 at
 * 50, 139 at 95, 144 at 75, 149 at 10), and the in-game text that grants them
 * is uniformly vague about scope: dësc nova:4210 "a slight discount at all
 * Rebel ports", nova:5066 "a bigger discount at Federation ports", nova:9011
 * "a discount when purchasing our goods". Not one of them names ships or
 * outfits, and the Knight of Red Branch's own knighting scene (dësc nova:9817)
 * does not mention money at all. No stock text contradicts the ruling, and the
 * one piece of hard data that can distinguish the two readings — Spica —
 * points at ships.
 *
 * WHERE {@link modifiedPrice} IS APPLIED:
 *
 *   shipyard   shipyard_rules.ts    shipListPrice -> shipPurchasePrice
 *                                   (the grid's "Ship Price" line and the
 *                                    credits actually deducted)
 *   bar/hire   escort_fees.ts       hirePrice (10% of the MODIFIED ship
 *                                   price, so a free ship hires for nothing;
 *                                   hire_escort.ts re-exports it)
 *
 * NOT APPLIED:
 *
 * - OUTFIT prices, buy AND sell-back, per the ruling above. outfitter_rules'
 *   outfitPrice / outfitResaleValue / sellRefund quote the oütf Cost as
 *   written, everywhere, and the outfitter builds no PriceMod at all. Dropping
 *   it from BOTH ends is what preserves the invariant a review round checked:
 *   within one shop, buying and immediately selling can never profit (resale
 *   is 50% of the same number the buy charged, and a same-visit sell refunds
 *   exactly what was paid). A discount on one end only would have minted
 *   credits, which is why the two must always move together.
 * - The ship TRADE-IN valuation (shipyard_rules' tradeInValue). The Bible pins
 *   that to "25% of the ORIGINAL cost of your current ship and upgrades", and
 *   a discount rank must not also devalue the property the player brings in.
 *   It cannot be farmed either: a trade-in only offsets a purchase and is
 *   clamped at zero, so it never pays out cash.
 * - COMMODITY prices in the trade centre. A commodity's price is not an item's
 *   Cost — it is set by the spöb's own six-level price table for that good,
 *   which is already the government's economy talking. (If this proves wrong
 *   in play, trade_center.ts is the one other place a price is quoted.)
 * - REFUELLING and REPAIR. Ranks have their own field for those, Flags 0x0800
 *   "ships allied with the affiliated govt will always repair or refuel the
 *   player for free" (rank_logic.ts's ranksGiveFreeRepair), which would be
 *   redundant if PriceMod already covered them.
 * - The hire POOL. shipyard_stock_rules' shipHireable gates on the ship's
 *   LIST price being nonzero, not the modified one, so a hull that is free
 *   here still has a pilot standing at the bar — offering it at 0 cr is the
 *   point.
 */

/** PriceMod 100: "prices are unchanged". */
export const UNMODIFIED_PRICE_MOD = 100;

/**
 * `listPrice` after a PriceMod of `priceMod` percent, floored to whole
 * credits and never negative. An absent or exactly-100 modifier returns the
 * list price untouched, so no rounding is invented for the overwhelmingly
 * common case.
 *
 * Flooring (not rounding) is what makes Extra Outfits' four compounding 1%
 * ranks land on a genuine 0: 12,000,000 cr at 1e-6 percent is 0.12 cr.
 */
export function modifiedPrice(listPrice: number,
    priceMod: number = UNMODIFIED_PRICE_MOD): number {
    if (priceMod === UNMODIFIED_PRICE_MOD) {
        return listPrice;
    }
    return Math.max(0, Math.floor(listPrice * priceMod / 100));
}

/**
 * The PriceMod percentage in force for a player standing at a stellar owned
 * by `govtId`. Reads the entity's COMMITTED active ranks; a venue holding a
 * mission-session working copy of the rank set (the outfitter does, so a rank
 * granted by an OnPurchase set string takes effect before commit) passes that
 * set to `rankPriceMod` directly instead.
 */
export function stellarPriceMod(entity: Entity | undefined,
    getRank: RankLookup, govtId: string | null | undefined): number {
    return rankPriceMod(entity?.components.get(ActiveRanksComponent),
        getRank, govtId);
}
