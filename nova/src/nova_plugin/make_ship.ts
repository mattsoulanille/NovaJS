import { ShipData } from "nova_data_interface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { ShipComponent } from "./ship_plugin";

export function makeShip(shipData: ShipData): Entity {
    const ship: Entity = {
        components: new Map(),
        name: shipData.name,
    }

    // Set initial movement state for consistency.
    ship.components.set(ShipComponent, {
        id: shipData.id
    }).set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(600 * (Math.random() - 0.5),
            (600 * (Math.random() - 0.5))),
        rotation: new Angle(Math.random() * 2 * Math.PI),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });

    return ship;
}
