import { PlanetData } from "novadatainterface/PlanetData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { PlanetComponent } from "./planet_plugin";

export function makePlanet(planetData: PlanetData): Entity {
    const planet: Entity = {
        components: new Map(),
        name: planetData.name,
    };

    planet.components.set(PlanetComponent, {
        id: planetData.id,
    });

    planet.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(planetData.position[0],
            planetData.position[1]),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });

    return planet;
}
