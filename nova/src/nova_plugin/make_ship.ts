import { ShipData } from "novajs/novadatainterface/ShipData";
import { Angle } from "novajs/nova_ecs/datatypes/angle";
import { Position } from "novajs/nova_ecs/datatypes/position";
import { Vector } from "novajs/nova_ecs/datatypes/vector";
import { Entity, EntityBuilder } from "novajs/nova_ecs/entity";
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from "novajs/nova_ecs/plugins/movement_plugin";
import { ShipComponent } from "./ship_component";


export function makeShip(shipData: ShipData): Entity {
    const ship: Entity = {
        components: new Map(),
        multiplayer: true,
        name: shipData.name,
    }
    ship.components.set(ShipComponent, {
        id: shipData.id
    }).set(MovementPhysicsComponent, {
        acceleration: shipData.physics.acceleration,
        maxVelocity: shipData.physics.speed,
        movementType: MovementType.INERTIAL, // TODO: Support more
        turnRate: shipData.physics.turnRate
    }).set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(0, 0),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });

    return ship;
}
