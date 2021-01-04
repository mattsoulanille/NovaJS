import { ShipData } from "novajs/novadatainterface/ShipData";
import { v4 } from "uuid";
import { Angle } from "../ecs/datatypes/angle";
import { Position } from "../ecs/datatypes/position";
import { Vector } from "../ecs/datatypes/vector";
import { Entity } from "../ecs/entity";
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from "../ecs/plugins/movement_plugin";


export function makeShip(shipData: ShipData, uuid = v4()): Entity {
    return new Entity({ uuid })
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
