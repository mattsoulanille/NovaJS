import { Communicator } from "./communication/Communicator";
import { Engine } from "./engine/Engine";


export class GameLoop {
    constructor(public engine: Engine, public communicator: Communicator) {
        communicator.deltas.subscribe((delta) => {
            engine.applyDelta(delta);
        });
    }

    step(time: number): void {
        const deltaToSend = this.engine.step({ time, ownedUUIDs: this.communicator.ownedUuids });
        if (deltaToSend) {
            this.communicator.sendDelta(deltaToSend);
        }
    }
}
