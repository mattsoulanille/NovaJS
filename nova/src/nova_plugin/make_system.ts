import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Entities, GetWorld } from "nova_ecs/arg_types";
import { AsyncSystem } from "nova_ecs/async_system";
import { MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { Resource } from "nova_ecs/resource";
import { SingletonComponent, World } from "nova_ecs/world";
import { GameDataResource } from "./game_data_resource";
import { makePlanet } from "./make_planet";
import { SystemPlugin } from "./system_plugin";


export const SystemIdResource = new Resource<string>('SystemIdResource');
const AddedPlanetsResource = new Resource<{ val: boolean }>('AddedPlanetsResource');

const MakePlanetsSystem = new AsyncSystem({
    name: 'MakePlanetsSystem',
    args: [GameDataResource, SystemIdResource, Entities, GetWorld,
        AddedPlanetsResource, SingletonComponent] as const,
    exclusive: true,
    async step(gameData, systemId, entities, world, addedPlanets) {
        if (addedPlanets.val) {
            world.removeSystem(MakePlanetsSystem);
            return;
        }
        const systemData = await gameData.data.System.get(systemId);
        for (const planetId of systemData.planets) {
            const planetData = await gameData.data.Planet.get(planetId);
            const planet = makePlanet(planetData);
            planet.components.set(MultiplayerData, { owner: 'server' });
            entities.set(`planet ${planetId}`, planet);
        }
        addedPlanets.val = true;
    }
});

export function makeSystem(systemId: string, gameData: GameDataInterface) {
    //const system = await gameData.data.System.get(systemId);
    const world = new World(systemId);

    world.resources.set(AddedPlanetsResource, { val: false });
    world.resources.set(GameDataResource, gameData);
    world.resources.set(SystemIdResource, systemId);
    world.addSystem(MakePlanetsSystem);
    world.addPlugin(SystemPlugin);

    return world;
}
