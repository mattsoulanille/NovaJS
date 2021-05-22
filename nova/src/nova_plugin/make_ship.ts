import { ShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from "nova_ecs/plugins/movement_plugin";
import { HealthComponent } from "./health_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { ShipComponent } from "./ship_plugin";


export function makeShip(shipData: ShipData): Entity {
    const ship: Entity = {
        components: new Map(),
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
        position: new Position(200, 200),
        rotation: new Angle(Math.random() * 2 * Math.PI),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    }).set(OutfitsStateComponent, new Map(
        Object.entries(shipData.outfits)
            .map(([id, count]) => [id, { count }])
    )).set(HealthComponent, {
        shield: {
            current: shipData.physics.shield,
            max: shipData.physics.shield,
            recharge: shipData.physics.shieldRecharge,
            changed: false,
            lastSent: 0,
        },
        armor: {
            current: shipData.physics.armor,
            max: shipData.physics.armor,
            recharge: shipData.physics.armorRecharge,
            changed: false,
            lastSent: 0,
        },
        ionization: {
            current: 0,
            max: shipData.physics.ionization,
            recharge: -shipData.physics.deionize,
            changed: false,
            lastSent: 0,
        }
    });

    return ship;
}
