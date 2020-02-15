import { ShipState } from "novajs/nova/src/proto/ship_state_pb"
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";


// For now, this just returns the default starter pilot.
// Consider OAuth in the future for saving pilots.

class PilotData {
    constructor() {

    }
    async getShip(): Promise<ShipState> {
        const shipState = new ShipState();
        shipState.setId("nova:128") // Shuttle

        const spaceObjectState = new SpaceObjectState();
        spaceObjectState.setAcceleration(10);
        spaceObjectState.setMaxvelocity(300);
        spaceObjectState.setMovementtype(SpaceObjectState.MovementType.INERTIAL);
        spaceObjectState.setTurnrate(1);

        shipState.setSpaceobjectstate(spaceObjectState);
        return shipState;
    }
}

export { PilotData }
