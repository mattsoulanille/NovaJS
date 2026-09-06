import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { dayNumber } from '../nova_plugin/player/calendar.js';
import { numericId } from '../nova_plugin/missions/mission_logic.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { GameDateComponent } from '../nova_plugin/player/player_state_plugin.js';
import { RankLookup, rankContribute } from '../nova_plugin/ncb/rank_logic.js';
import { stellarPriceMod } from './price_mod.js';
import { ShipyardContext, ShipyardStellar } from './shipyard_stock_rules.js';

/**
 * Reading a {@link ShipyardContext} off the landed player's entity.
 *
 * Both ship shops — the shipyard's grid and the bar's hire-escort pool —
 * gate on the same four things (the docked stellar's tech rules, the
 * player's control bits, the player's 64-bit Contribute set, and the game
 * day). This module assembles that context once so the two venues can
 * never read it differently; the gates themselves live in
 * shipyard_stock_rules.ts.
 *
 * It also resolves the ränk PriceMod in force at the stellar (price_mod.ts),
 * which is not a gate but belongs here for the same reason: the shipyard's
 * ship prices and the bar's hire fees must be bent by the same number.
 */

/** What the caller must supply beyond the player entity itself. */
export interface ShipGateSources {
    /** The docked stellar's tech rules, or undefined for "no stellar". */
    planet?: ShipyardStellar;
    /** The docked stellar's GLOBAL id ("nova:128"), or null. */
    stellarId?: string | null;
    /** The ShipData of the hull the player is currently flying. */
    currentShipData?: ShipData;
    /** Outfit lookup, for the Contribute of everything the player owns. */
    getOutfit(id: string): OutfitData | undefined;
    /** Rank lookup, for the Contribute of the player's active ranks. */
    getRank: RankLookup;
    /**
     * Control bits to use instead of the entity's own — the bar hands in
     * its MissionSession working copy, so a bit set by a mission accepted
     * this visit already counts.
     */
    bits?: ReadonlySet<number>;
}

/**
 * The player's 64-bit Contribute set: their active ranks' Contribute, or'd
 * with their current hull's, or'd with every owned outfit's (EVN Bible,
 * shïp/oütf Contribute).
 */
export function playerContributeOf(entity: Entity | undefined,
    sources: ShipGateSources): bigint {
    let contribute = rankContribute(
        entity?.components.get(ActiveRanksComponent), sources.getRank);
    contribute |= sources.currentShipData
        ? BigInt(sources.currentShipData.contribute ?? '0x0') : 0n;
    const outfits = entity?.components.get(OutfitsStateComponent);
    if (outfits) {
        for (const [id, { count }] of outfits) {
            if (count > 0) {
                contribute |= BigInt(
                    sources.getOutfit(id)?.contribute ?? '0x0');
            }
        }
    }
    return contribute;
}

/** The full stock-gate context for the player standing at this stellar. */
export function shipGateContext(entity: Entity | undefined,
    sources: ShipGateSources): ShipyardContext {
    return {
        planet: sources.planet,
        bits: sources.bits
            ?? entity?.components.get(ControlBitsComponent) ?? new Set(),
        contribute: playerContributeOf(entity, sources),
        day: dayNumber(entity?.components.get(GameDateComponent)
            ?? getDefaultGameDate()),
        stellarId: sources.stellarId ? numericId(sources.stellarId) : null,
        // The ränk PriceMod of this stellar's OWNING govt (price_mod.ts),
        // resolved here so the shipyard's grid prices and the bar's hire
        // fees are bent by exactly the same number.
        priceMod: stellarPriceMod(entity, sources.getRank,
            sources.planet?.govt),
    };
}
