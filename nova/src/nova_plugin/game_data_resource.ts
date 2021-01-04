import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { Resource } from "../ecs/resource";


export const GameDataResource = new Resource<GameDataInterface>({
    name: 'GameData',
    multiplayer: false, // This is handled by a separate system
});
