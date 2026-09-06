import { Resource } from "nova_ecs/resource";
import { DisplayAssetDataInterface } from "../../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";

export const SimulationGameDataResource =
    new Resource<SimulationGameDataInterface>('SimulationGameData');

export const DisplayAssetDataResource =
    new Resource<DisplayAssetDataInterface>('DisplayAssetData');
