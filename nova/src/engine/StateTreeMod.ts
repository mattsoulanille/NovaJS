import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { StateTreeFactories } from "./StateTree";

export type StateTreeModFactory<FactoryData = unknown, Delta = unknown>
    = (factoryData: FactoryData, gameData: GameDataInterface,
        stateTreeFactories: StateTreeFactories) => StateTreeMod<Delta>;

export interface StateTreeMod<Delta = unknown> {
    name: string;
    buildPromise: Promise<void>;
    built: boolean;
    step(args: {
        time: number,
        delta?: Delta
        makeDelta: boolean,
    }): Delta | undefined;
    destroy(): void;
}
