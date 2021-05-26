import { ShipData } from "novadatainterface/ShipData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from "nova_ecs/plugins/movement_plugin";
import { ArmorComponent, IonizationComponent, ShieldComponent } from "./health_plugin";
import { OutfitsStateComponent } from "./outfit_plugin";
import { ShipComponent } from "./ship_plugin";
import { Stat } from "./stat";
import { TargetComponent } from "./target_plugin";


// TODO: Use providers instead?
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
    )).set(ShieldComponent, new Stat({
        current: shipData.physics.shield,
        max: shipData.physics.shield,
        recharge: shipData.physics.shieldRecharge,
    })).set(ArmorComponent, new Stat({
        current: shipData.physics.armor,
        max: shipData.physics.armor,
        recharge: shipData.physics.armorRecharge,
    })).set(IonizationComponent, new Stat({
        current: 0,
        max: shipData.physics.ionization,
        recharge: -shipData.physics.deionize,
    })).set(TargetComponent, { target: undefined });

    return ship;
}
