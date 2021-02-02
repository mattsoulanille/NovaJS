import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { Position } from "./Position";
import { MovementType, ObjectType, SpaceObject, vectorFactory } from "./State";
import { Angle } from "./Vector";

export class SpaceObjectFactory {
    constructor(private gameData: GameDataInterface) { }

    async shipFromId(id: string): Promise<SpaceObject> {
        const shipData = await this.gameData.data.Ship.get(id);
        const ship = SpaceObjectFactory.base();
        ship.id = id;
        ship.objectType = ObjectType.SHIP;

        ship.acceleration = shipData.physics.acceleration;
        ship.maxVelocity = shipData.physics.speed;
        ship.turnRate = shipData.physics.turnRate;

        ship.shield = shipData.physics.shield;
        ship.maxShield = shipData.physics.shield;
        ship.shieldRecharge = shipData.physics.shieldRecharge;
        ship.armor = shipData.physics.armor;
        ship.maxArmor = shipData.physics.armor;
        ship.armorRecharge = shipData.physics.armorRecharge;
        // Don't initialize the ship's ionization to the max value.
        ship.maxIonization = shipData.physics.ionization;
        ship.deionize = shipData.physics.deionize;

        return ship;
    }

    static base(): SpaceObject {
        return {
            id: "",
            objectType: ObjectType.NONE,

            // Physics
            position: new Position(0, 0),
            velocity: vectorFactory(),
            maxVelocity: 100,
            rotation: new Angle(0),
            turning: 0,
            turnBack: false,
            turnRate: 2,
            movementType: MovementType.INERTIAL,
            acceleration: 10,
            accelerating: 0,

            // Combat
            shield: 0,
            maxShield: 0,
            shieldRecharge: 0,
            armor: 0,
            maxArmor: 0,
            armorRecharge: 0,
            ionization: 0,
            maxIonization: 0,
            deionize: 0,
        }
    }
}
