import { GameDataInterface } from "nova_data_interface/GameDataInterface";
import { Resource } from "nova_ecs/resource";


export const GameDataResource = new Resource<GameDataInterface>('GameData');
