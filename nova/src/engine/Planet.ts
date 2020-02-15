import { SpaceObject } from "./SpaceObject";

import { GameDataInterface } from "../../../novadatainterface/GameDataInterface";
import { Stateful } from "./Stateful";
import { PlanetState } from "novajs/nova/src/proto/planet_state_pb";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import { Position } from "./Position";
import { Steppable } from "./Steppable";

export class Planet implements Stateful<PlanetState>, Steppable {
    readonly gameData: GameDataInterface;
    private id = "nova:128";
    private spaceObject = new SpaceObject();

    constructor({ gameData, state }: { gameData: GameDataInterface, state: PlanetState }) {
        this.gameData = gameData;
        this.setState(state);
    }

    getState(): PlanetState {
        const state = new PlanetState();
        state.setId(this.id);
        state.setSpaceobjectstate(this.spaceObject.getState());
        // TODO: EquipmentState
        return state;
    }
    setState(state: PlanetState): void {
        if (state.hasSpaceobjectstate()) {
            this.spaceObject.setState(state.getSpaceobjectstate()!);
        }
        this.id = state.getId();
        // TODO: EquipmentState
    }

    step(milliseconds: number): void {
        this.spaceObject.step(milliseconds);
    }

    static async fromID(id: string, gameData: GameDataInterface): Promise<PlanetState> {
        const data = await gameData.data.Planet.get(id);
        const spaceObjectState = new SpaceObjectState();
        spaceObjectState.setMovementtype(SpaceObjectState.MovementType.STATIONARY);
        spaceObjectState.setPosition(
            new Position(data.position[0], data.position[1]).getState());

        const planetState = new PlanetState();
        planetState.setSpaceobjectstate(spaceObjectState);
        return planetState;
    }

    static makeFactory(gameData: GameDataInterface): (s: PlanetState) => Planet {
        return function(state: PlanetState) {
            return new Planet({ gameData, state });
        }
    }
}
