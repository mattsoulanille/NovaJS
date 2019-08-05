import { GameState } from "../engine/GameState";


// Tracks stuff in the system the
// specified ship is in.
class ActiveSystemTracker {
    private system: string | undefined;
    private ship: string | undefined
    constructor() {

    }

    getActiveSystem(state: GameState, activeShip: string) {
        if (this.ship !== activeShip) {
            this.ship = activeShip;
        }

        if (this.system === undefined ||
            state.systems[this.system] === undefined ||
            state.systems[this.system].ships[this.ship] === undefined) {

            for (let systemID of Object.keys(state.systems)) {
                let system = state.systems[systemID];
                if (system.ships[this.ship] !== undefined) {
                    this.system = systemID
                }
            }
            throw new Error("Active ship not found");
        }
        return this.system;
    }

    getShip(state: GameState, ship: string) {
        let system = this.getActiveSystem(state, ship);
        return state.systems[system].ships[ship];
    }
}


export { ActiveSystemTracker }
