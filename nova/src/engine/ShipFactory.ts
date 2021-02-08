import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { ShipState, SpaceObjectState, SpaceObjectStateValue } from "novajs/nova/src/proto/protobufjs_bundle";
import { ShipData } from "novadatainterface/ShipData";

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
        const value = new SpaceObjectStateValue();;
        spaceObject.value = value;
        value.shipState = new ShipState();
        value.shipState.id = data.id;
        value.acceleration = data.physics.acceleration;
        value.maxVelocity = data.physics.speed;
        value.movementType = SpaceObjectStateValue.MovementType.INERTIAL;
        value.turnRate = data.physics.turnRate;
        return spaceObject;
    }
}
