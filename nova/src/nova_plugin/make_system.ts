import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { World } from "nova_ecs/world";
import { makePlanet } from "./make_planet";


export async function makeSystem(systemId: string, gameData: GameDataInterface) {
    const system = await gameData.data.System.get(systemId);
    const world = new World(systemId);

    for (const planetId of system.planets) {
        const planetData = await gameData.data.Planet.get(planetId);
        const planet = makePlanet(planetData);
        planet.components.set(MultiplayerData, { owner: 'server' });
        world.entities.set(`planet ${planetId}`, planet);
    }

    return world;
}
