import { ShipData } from "novajs/novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { EntityBuilder } from "nova_ecs/entity";
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from "nova_ecs/plugins/movement_plugin";


export function makeShip(shipData: ShipData): EntityBuilder {
    return new EntityBuilder()
        .addComponent(MovementPhysicsComponent, {
            acceleration: shipData.physics.acceleration,
            maxVelocity: shipData.physics.speed,
            movementType: MovementType.INERTIAL, // TODO: Support more
            turnRate: shipData.physics.turnRate
        }).addComponent(MovementStateComponent, {
            accelerating: 0,
            position: new Position(0, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
}
