import { OutfitData } from 'novadatainterface/outfit_data';
import {
    DISCOVERY_LANDED, MapOutfitSystem, mapOutfitSystems, SystemAdjacency,
} from '../nova_plugin/player/discovery.js';
import {
    defaultDiscoveryStore, DiscoveryStore,
} from '../nova_plugin/player/discovery_store.js';
import { systemIsInhabited } from '../nova_plugin/core/landable.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * oütf ModType 16 "map" items, and the two ways the original hands them out.
 *
 * WHAT A MAP TEACHES. "This map will automatically update your ship's
 * computer with information about the location AND CONTENTS of the systems
 * surrounding this one" (the stock dësc of oütf nova:204/433/434). Contents
 * is everything, so a mapped system goes straight to discovery level 2 —
 * ports, services and traded goods included, exactly as if the player had
 * landed there. That is what makes a 1000 cr map worth buying.
 *
 * THE SIX STOCK MAPS, with their ModVals:
 *   nova:204  "Map; Sol/Kel'ar Iy only"    1    1000 cr, SpecialTech 80
 *   nova:237  "Map"                        3    1000 cr, TechLevel 999
 *   nova:272  "Dr Ralph's Exploration Map" 10   0 cr, TechLevel 9999 (dev)
 *   nova:342  "Area Map - Vell-os"         2    0 cr, never purchasable
 *   nova:433  "Map; Fed/Pol"               2    1000 cr, SpecialTech 81
 *   nova:434  "Map; Reb/Pir/Aur"           3    1000 cr, SpecialTech 82
 *
 * BUYING ONE IS A ONE-SHOT. The outfitter applies the map from the system
 * the player is docked in and then takes the item back off the ship
 * (outfitter.ts applyBuy): a map is information, not equipment, and the
 * original's own data says so — every purchasable map is Max 1, and shïp
 * DefaultItems explicitly may not include "fake IDs, maps, etc." (Bible
 * :2548).
 *
 * THE VELL-OS ABILITY IS THE EXCEPTION, and it is built out of the same
 * parts. Buying the Vell-os power oütf nova:251 "Vell-os Area Map" sets
 * control bit 450 (its OnPurchase). Bit 450 enables crön nova:381 "Vell-os
 * Area Map cron" (Random 100, Duration 0, both holdoffs 0), whose OnEnd is
 * `G342` — so the pilot is handed a fresh nova:342 "Area Map - Vell-os"
 * (radius 2) over and over. A map GRANTED that way is never bought, so it
 * stays in the player's outfits, and NovaJS re-applies it on every system
 * entry (starmap_plugin) rather than once a day: the pilot's ability maps
 * two jumps around wherever they arrive, which is what the power is for.
 */

/**
 * Reveals everything within one map outfit's reach, in `discovery` (the
 * client's store unless the caller — a display world — holds another).
 * Returns the systems.
 */
export function applyMapOutfit(modVal: number, fromSystem: string,
    universe: MissionUniverse,
    discovery: DiscoveryStore = defaultDiscoveryStore()): string[] {
    const infos = universe.systemInfos;
    const systems: MapOutfitSystem[] = infos.map(info => ({
        id: info.id,
        govt: info.govt,
        inhabited: systemIsInhabited(universe.systemPlanets(info.id),
            id => universe.getPlanet(id)),
    }));
    const adjacency: SystemAdjacency =
        new Map(infos.map(info => [info.id, info.links]));
    const revealed = mapOutfitSystems(modVal, fromSystem, systems, adjacency,
        govtId => universe.getGovt(govtId)?.classes ?? []);
    discovery.markMany(revealed, DISCOVERY_LANDED);
    return revealed;
}

/**
 * Applies every map outfit the player is carrying, from `fromSystem`. Used
 * on system entry, where the only maps still aboard are ones a set string
 * granted (the Vell-os ability; see the module comment). Returns the
 * systems revealed, deduplicated.
 */
export function applyOwnedMapOutfits(outfitIds: Iterable<string>,
    fromSystem: string, universe: MissionUniverse,
    getOutfit: (id: string) => OutfitData | undefined,
    discovery: DiscoveryStore = defaultDiscoveryStore()): string[] {
    const revealed = new Set<string>();
    for (const id of outfitIds) {
        const modVal = getOutfit(id)?.map;
        if (modVal === undefined || modVal === null) {
            continue;
        }
        for (const systemId of applyMapOutfit(modVal, fromSystem, universe,
            discovery)) {
            revealed.add(systemId);
        }
    }
    return [...revealed];
}
