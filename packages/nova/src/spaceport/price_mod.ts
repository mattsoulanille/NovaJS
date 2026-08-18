import { Entity } from 'nova_ecs/entity';
import { ActiveRanksComponent } from '../nova_plugin/ncb_plugin.js';
import { RankLookup, rankPriceMod } from '../nova_plugin/rank_logic.js';

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
 * three shops cannot disagree about it.
 *
 * Every price the player is shown and every price the player is charged goes
 * through {@link modifiedPrice}:
 *
 *   shipyard   shipyard_rules.ts    shipListPrice -> shipPurchasePrice
 *                                   (the grid's "Ship Price" line and the
 *                                    credits actually deducted)
 *   outfitter  outfitter_rules.ts   outfitPrice, outfitResaleValue,
 *                                   sellRefund, maxBuyCount, canBuyOutfit
 *   bar/hire   escort_fees.ts       hirePrice (10% of the MODIFIED ship
 *                                   price, so a free ship hires for nothing;
 *                                   hire_escort.ts re-exports it)
 *
 * NOT modified: the ship TRADE-IN valuation (shipyard_rules' tradeInValue).
 * The Bible pins that to "25% of the ORIGINAL cost of your current ship and
 * upgrades", and a discount rank must not also devalue the property the
 * player brings in. It cannot be farmed either: a trade-in only offsets a
 * purchase and is clamped at zero, so it never pays out cash.
 *
 * Sell-back IS modified, and has to be. The outfitter's resale is 50% of the
 * price; if buying at a 1% world cost ~nothing while selling back still paid
 * 50% of the list price, the Spica Shipyard would be an infinite-credit
 * machine. Scaling both by the same modifier keeps the invariant that matters
 * — within one shop, buying and immediately selling never profits — and keeps
 * the same-visit full refund honest (you get back exactly what you paid).
 *
 * ALSO NOT MODIFIED, deliberately:
 *
 * - COMMODITY prices in the trade centre. The Bible's PriceMod is "the prices
 *   of items and ships", and a commodity's price is not an item's Cost — it is
 *   set by the spöb's own six-level price table for that good, which is
 *   already the government's economy talking. (If this proves wrong in play,
 *   trade_center.ts is the one other place a price is quoted.)
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
