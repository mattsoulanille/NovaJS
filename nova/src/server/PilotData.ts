import { ShipState } from "../engine/ShipState";

// For now, this just returns the default starter pilot.
// Consider OAuth in the future for saving pilots.

class PilotData {
    constructor() {

    }
    async getShip(): Promise<ShipState> {
        return {
            accelerating: 0,
            acceleration: 10,
            id: "nova:128",
            maxVelocity: 300,
            movementType: "inertial",
            position: { x: 0, y: 0 },
            rotation: 0,
            turnBack: false,
            turning: 0,
            turnRate: 1,
            velocity: { x: 0, y: 0 }
        }
    }
}

export { PilotData }
