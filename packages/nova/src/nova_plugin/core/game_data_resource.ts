import { Resource } from "nova_ecs/resource";
import { DisplayAssetDataInterface } from "../../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";

export const SimulationGameDataResource =
    new Resource<SimulationGameDataInterface>('SimulationGameData');

export const DisplayAssetDataResource =
    new Resource<DisplayAssetDataInterface>('DisplayAssetData');

/**
 * The weapon ids whose closure this world has staged (loadEntityGameData,
 * loadOutfitsGameData, loadWeaponsGameData, npc_spawn's stageShip — every
 * path funnels through primeWeaponEntries). A dev-build diagnostic, not
 * simulation state: WeaponEntries.get reads it to warn when it builds an
 * entry for a weapon no staged entity carries (#279), the unstaged-closure
 * pattern that made a spec pass or fail with the warmth of the shared
 * game-data cache (#240). Lives in core because combat reads it and spawn
 * (which stages) depends on combat — the reverse edge would be a cycle.
 */
export const StagedWeaponIds = new Resource<Set<string>>('StagedWeaponIds');
