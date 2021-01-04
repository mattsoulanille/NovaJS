import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { v4 } from "uuid";
import { CustomStateTreeDeclaration, StateTree, StateTreeDeclaration, StateTreeDelta, StateTreeFactories, StateTreeNode, StateTreeRoot } from "./StateTree";
import { STATE_TREE_DECLARATIONS } from "./StateTreeDeclarations";

const rootDeclaration: CustomStateTreeDeclaration<null> = {
    name: 'root',
    factoryData: null,
    mods: new Set(),
};

export class Engine {
    private stateTreeDeclarations = new Map<string, StateTreeDeclaration>();
    stateTreeFactories: StateTreeFactories;
    rootNode: StateTree;

    constructor(gameData: GameDataInterface) {
        // Merge all declarations for the same tree node into a single declaration.
        for (const { name, dataType, mods } of STATE_TREE_DECLARATIONS) {
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

    applyDelta(delta: StateTreeDelta) {
        this.rootNode.applyDelta(delta);
    }

    step({ time, ownedUUIDs }: {
        time: number,
        ownedUUIDs: Set<string>,
    }) {
        return this.rootNode.step({ time, ownedUUIDs });
    }

    private getNodeRecursive(uuid: string, node: StateTree): StateTree | undefined {
        if (node.uuid === uuid) {
            return node;
        }

        for (const child of node.children.values()) {
            const result = this.getNodeRecursive(uuid, child);
            if (result) {
                return result;
            }
        }

        return undefined;
    }

    getNode(uuid: string): StateTree | undefined {
        // TODO: Make this log(n)?
        return this.getNodeRecursive(uuid, this.rootNode);
    }

    removeNode(uuid: string) {
        const node = this.getNode(uuid);
        node?.parent?.removeChild(node);
    }
}
