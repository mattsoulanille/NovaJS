import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { StateTreeFactories } from "./StateTree";

export type StateTreeModFactory<FactoryData = unknown, Delta = unknown>
    = (factoryData: FactoryData, gameData: GameDataInterface,
        stateTreeFactories: StateTreeFactories) => StateTreeMod<Delta>;

export interface StateTreeMod<Delta = unknown> {
    name: string;
    buildPromise: Promise<void>;
    built: boolean;
    applyDelta(delta: Delta): void;
    step(args: {
        time: number,
        makeDelta: boolean,
    }): Delta | undefined;

    // Returns a delta that, when applied to a new object,
    // puts that object in this object's state.
    getState(): Delta;
}
