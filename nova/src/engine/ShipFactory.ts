import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { ShipState, SpaceObjectState } from "novajs/nova/src/proto/protobufjs_bundle";
import { ShipData } from "novajs/novadatainterface/ShipData";

export class ShipFactory {
    constructor(private gameData: GameDataInterface) { }


    async fromId(id: string) {
        return this.fromData(await this.gameData.data.Ship.get(id));
    }

    fromCached(id: string) {
        const cached = this.gameData.data.Ship.getCached(id);
        if (!cached) {
            return undefined;
        }
        return this.fromData(cached);
    }

    private fromData(data: ShipData) {
        const spaceObject = new SpaceObjectState();
        spaceObject.shipState = new ShipState();
        spaceObject.shipState.id = data.id;
        spaceObject.acceleration = data.physics.acceleration;
        spaceObject.maxVelocity = data.physics.speed;
        spaceObject.movementType = SpaceObjectState.MovementType.INERTIAL;
        spaceObject.turnRate = data.physics.turnRate;
        return spaceObject;
    }
}
