import { StateTree } from "../engine/StateTree";
import * as PIXI from "pixi.js";
import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";


/*
export interface StateDisplayer {
    new(): StateDisplayer<State>;
    container: PIXI.Container;
    display: (state: State) => void;
}
*/

interface ModDisplayer<State> {
    readonly container: PIXI.Container;
    display(state: State, time: number): void;
}


interface DisplayNodeConstructor {
    new(): DisplayNode;
}

interface DisplayNode {

}

/**
 * Displays a state tree and all its children.
 */
export class StateTreeDisplay {
    readonly container = new PIXI.Container();
    private displayNodes = new Map<string /* uuid */, DisplayNode>();

    constructor(private gameData: GameDataInterface,
        private displayNodeConstructors: Map<string /* name */, DisplayNodeConstructor>) { }

    display(stateTree: StateTree, time: number) {
        // Must pass in time for certain renderers, such as particles.
        if (!this.displayNodes.has(stateTree.uuid)) {
            this.displayNodes.set(stateTree.uuid, new );
        }
        const displayNode = this.displayNodes.get(stateTree.uuid)!;



        for (const child of stateTree.children.values()) {
            this.display(child, time);
        }
    }
}
