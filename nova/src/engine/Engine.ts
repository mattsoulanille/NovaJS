import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { v4 } from "uuid";
import { CustomStateTreeDeclaration, StateTree, StateTreeDeclaration, StateTreeDelta, StateTreeFactories, StateTreeNode, StateTreeRoot } from "./StateTree";

const rootDeclaration: CustomStateTreeDeclaration<null> = {
    name: 'root',
    factoryData: null,
    mods: new Set(),
};

export class Engine {
    private stateTreeDeclarations = new Map<string, StateTreeDeclaration>();
    stateTreeFactories: StateTreeFactories;
    rootNode: StateTree;

    constructor(stateTreeDeclarations: Iterable<StateTreeDeclaration>, gameData: GameDataInterface) {
        // Merge all declarations for the same tree node into a single declaration.
        for (const { name, dataType, mods } of stateTreeDeclarations) {
            if (!this.stateTreeDeclarations.has(name)) {
                this.stateTreeDeclarations.set(name, { name, dataType, mods: new Set() });
            }
            const declaration = this.stateTreeDeclarations.get(name)!;

            for (const modFactory of mods.values()) {
                declaration.mods.add(modFactory);
            }
        }

        this.stateTreeFactories = new Map(
            [...this.stateTreeDeclarations.entries()]
                .map(([name, declaration]) => [
                    name,
                    (id, uuid = v4()) => new StateTreeNode({
                        declaration,
                        id,
                        uuid,
                        gameData,
                        stateTreeFactories: this.stateTreeFactories,
                    })
                ]));


        this.rootNode = new StateTreeRoot({
            declaration: rootDeclaration,
            gameData,
            stateTreeFactories: this.stateTreeFactories,
        });
    }

    step({ time, delta, ownedUUIDs }: {
        time: number,
        delta?: StateTreeDelta,
        ownedUUIDs: Set<string>,
    }) {
        return this.rootNode.step({ time, delta, ownedUUIDs });
    }
}
