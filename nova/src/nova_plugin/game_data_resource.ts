import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Resource } from "nova_ecs/resource";


export const GameDataResource = new Resource<GameDataInterface>({
    name: 'GameData',
    multiplayer: false, // This is handled by a separate system
});
