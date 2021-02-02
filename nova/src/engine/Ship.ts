import { SpaceObject } from "./SpaceObject";
import { GameDataInterface } from "../../../novadatainterface/GameDataInterface";
import { Stateful } from "./Stateful";
import { ShipState } from "novajs/nova/src/proto/ship_state_pb";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import { Steppable } from "./Steppable";

export class Ship implements Stateful<ShipState>, Steppable {
    readonly gameData: GameDataInterface;
    private id = "nova:128";
    private spaceObject = new SpaceObject();

    constructor({ gameData, state }: { gameData: GameDataInterface, state: ShipState }) {
        this.gameData = gameData;
        this.setState(state);
    }

    getState(): ShipState {
        const state = new ShipState();
        state.setSpaceobjectstate(this.spaceObject.getState());
        // TODO: equipmentState
        state.setId(this.id);
        return state;
    }
    setState(state: ShipState): void {
        if (state.hasSpaceobjectstate()) {
            this.spaceObject.setState(state.getSpaceobjectstate()!);
        }
        this.id = state.getId();
    }

    step(milliseconds: number): void {
        this.spaceObject.step(milliseconds);
    }

    static async fromID(id: string, gameData: GameDataInterface): Promise<ShipState> {
        const data = await gameData.data.Ship.get(id);
        const spaceObjectState = new SpaceObjectState();

        // TODO: Support more movement types
        spaceObjectState.setMovementtype(SpaceObjectState.MovementType.INERTIAL);
        spaceObjectState.setMaxvelocity(data.physics.speed);
        spaceObjectState.setAcceleration(data.physics.acceleration);
        spaceObjectState.setTurnrate(data.physics.turnRate);

        const shipState = new ShipState();
        shipState.setId(id);
        shipState.setSpaceobjectstate(spaceObjectState);

        return shipState;
    }

    static makeFactory(gameData: GameDataInterface): (s: ShipState) => Ship {
        return function(state: ShipState) {
            return new Ship({ gameData, state });
        }
    }
}
