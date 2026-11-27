import { Entity } from 'nova_ecs/entity';
import { getDefaultGameDate } from 'novadatainterface/player_start_data';
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import {
    CronStatesComponent, dayNumber, GameDateComponent,
} from '../nova_plugin/player/index.js';
import {
    CronLookup, numericId, playerContribute,
} from '../nova_plugin/missions/index.js';
import {
    ActiveRanksComponent, ControlBitsComponent, RankLookup,
} from '../nova_plugin/ncb/index.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/index.js';
import { stellarPriceMod } from './price_mod.js';
import { ShipyardContext, ShipyardStellar } from './shipyard_stock_rules.js';

/**
 * Reading a {@link ShipyardContext} off the landed player's entity.
 *
 * Both ship shops — the shipyard's grid and the bar's hire-escort pool —
 * gate on the same four things (the docked stellar's tech rules, the
 * player's control bits, the player's Contribute set, and the game
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
    /** Crön lookup, for the Contribute of the player's active crons. */
    getCron: CronLookup;
    /**
     * Control bits to use instead of the entity's own — the bar hands in
     * its MissionSession working copy, so a bit set by a mission accepted
     * this visit already counts.
     */
    bits?: ReadonlySet<number>;
}

/**
 * The player's Contribute set (missions/player_contribute.ts): their
 * current hull's, every owned outfit's, their active ranks' and their
 * active crons'.
 */
export function playerContributeOf(entity: Entity | undefined,
    sources: ShipGateSources): bigint {
    const outfits = entity?.components.get(OutfitsStateComponent);
    return playerContribute({
        ship: sources.currentShipData?.contribute,
        outfits: [...outfits ?? []].filter(([, { count }]) => count > 0)
            .map(([id]) => sources.getOutfit(id)?.contribute),
        ranks: entity?.components.get(ActiveRanksComponent),
        getRank: sources.getRank,
        cronStates: entity?.components.get(CronStatesComponent),
        getCron: sources.getCron,
    });
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
