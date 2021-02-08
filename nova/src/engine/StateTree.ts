import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { StateTreeMod, StateTreeModFactory } from "./StateTreeMod";
import * as t from 'io-ts';

type GettableDataType<T> = T extends Gettable<infer D> ? D : never;
type GetFactoryData<T extends NovaDataType> = GettableDataType<NovaDataInterface[T]>;

/**
 * Declares what mods a state tree has. Multiple instances with the same name
 * can be passed, and the union of listed mods will be used.
 */

//export type StateTreeDeclaration = GameDataStateTreeDeclaration | CustomStateTreeDeclaration;

export interface StateTreeDeclaration<DataType extends NovaDataType = NovaDataType> {
    name: string;
    dataType: DataType;
    mods: Set<StateTreeModFactory<GetFactoryData<DataType>>>;
}

export interface CustomStateTreeDeclaration<FactoryData = unknown> {
    name: string;
    factoryData: FactoryData;
    mods: Set<StateTreeModFactory<FactoryData>>;
}

// TODO: Use a FactoryQueueMap if this has too many cache misses?
type StateTreeFactory<FactoryData = unknown>
    = (id: string, uuid?: string) => StateTree<FactoryData>;
export type StateTreeFactories = Map<string /* StateTree name */, StateTreeFactory>;


export interface StateTreeDelta {
    name: string;
    modDeltas: { [name: string]: unknown };
    childrenDeltas: { [uuid: string]: StateTreeDelta };
    add?: { [uuid: string]: { name: string, id: string } };
    remove?: string[];
}

export const StateTreeDelta = t.recursion<StateTreeDelta>('StateTreeDelta', StateTreeDelta =>
    t.intersection([
        t.type({
            name: t.string,
            modDeltas: t.record(t.string, t.unknown),
            childrenDeltas: t.record(t.string, StateTreeDelta),
        }),
        t.partial({
            add: t.union([t.record(t.string, t.type({ name: t.string, id: t.string })), t.undefined]),
            remove: t.array(t.string),
        }),
    ])
);

export interface StateTree<FactoryData = unknown> {
    readonly name: string;
    readonly uuid: string;
    readonly factoryData?: FactoryData;
    mods: Map<string /* name */, StateTreeMod>;
    children: Map<string /* uuid */, StateTree>;
    parent?: StateTree;
    readonly buildPromise: Promise<void>;
    built: boolean;
    gameData: GameDataInterface;
    stateTreeFactories: StateTreeFactories;

    step({ time, delta, ownedUUIDs }: {
        time: number,
        delta?: StateTreeDelta,
        ownedUUIDs: Set<string>,
    }): StateTreeDelta | undefined;

    addChild(child: StateTree): void;
    removeChild(child: StateTree): void;
    destroy(): void;
}

class StateTreeBase<FactoryData = unknown> implements StateTree<FactoryData> {
    readonly name: string;
    readonly uuid: string;
    factoryData?: FactoryData;
    mods = new Map<string, StateTreeMod>();
    children = new Map<string, StateTree<unknown>>();
    parent?: StateTree;
    buildPromise: Promise<void> = Promise.reject('A superclass must build this.');
    built = false;
    gameData: GameDataInterface;
    stateTreeFactories: StateTreeFactories;

    constructor({ name, uuid, stateTreeFactories, gameData, parent }: {
        name: string,
        uuid: string,
        stateTreeFactories: StateTreeFactories,
        gameData: GameDataInterface,
        parent?: StateTree,
    }) {
        this.name = name;
        this.uuid = uuid;
        this.stateTreeFactories = stateTreeFactories;
        this.gameData = gameData;
        this.parent = parent;
    }

    protected buildMods({ modFactories, factoryData }: {
        modFactories: Set<StateTreeModFactory<unknown>>,
        factoryData: FactoryData,
    }): Map<string, StateTreeMod> | Promise<Map<string, StateTreeMod>> {
        this.factoryData = factoryData;

        const mods = [...modFactories].map(
            (factory) => {
                const modInstance = factory(factoryData, this.gameData, this.stateTreeFactories);
                return [modInstance.name, modInstance] as [string, StateTreeMod];
            });

        if (!mods.every(([, mod]) => mod.built)) {
            return Promise.all(mods.map(([, mod]) => mod.buildPromise))
                .then(() => new Map(mods));
        }

        return new Map(mods);
    }

    step({ time, delta, ownedUUIDs }: {
        time: number;
        delta?: StateTreeDelta;
        ownedUUIDs: Set<string>;
    }): StateTreeDelta | undefined {
        // Remove children
        for (const remove of delta?.remove ?? []) {
            this.children.get(remove)?.destroy();
            this.children.delete(remove);
        }

        // Add children
        for (const [uuid, addDelta] of Object.entries(delta?.add ?? {})) {
            const factory = this.stateTreeFactories.get(addDelta.name);
            if (factory) {
                this.children.set(uuid, factory(addDelta.id, uuid));
            } else {
                console.warn(`Factory for ${addDelta.name} not found.`);
            }
        }

        if (!this.built) {
            return;
        }

        const newDelta: StateTreeDelta = {
            name: this.name,
            modDeltas: {},
            childrenDeltas: {},
        };

        const makeDelta = ownedUUIDs.has(this.uuid);
        for (const [name, mod] of this.mods) {
            const modDelta = mod.step({ time, delta: delta?.modDeltas[name], makeDelta });
            if (modDelta) {
                newDelta.modDeltas[name] = modDelta;
            }
        }

        for (const [uuid, child] of this.children) {
            const childDelta = delta?.childrenDeltas[uuid];
            const newChildDelta = child.step({ time, delta: childDelta, ownedUUIDs });
            if (newChildDelta) {
                newDelta.childrenDeltas[uuid] = newChildDelta;
            }
        }

        if (Object.keys(newDelta.modDeltas).length === 0 &&
            Object.keys(newDelta.childrenDeltas).length === 0) {
            return;
        }

        return newDelta;
    }
    addChild(child: StateTree) {
        this.children.set(child.uuid, child);
        child.parent = this;
    }

    removeChild(child: StateTree) {
        this.children.delete(child.uuid);
        child.parent = undefined;
    }

    destroy() {
        for (const child of this.children.values()) {
            child.destroy();
        }
        for (const mod of this.mods.values()) {
            mod.destroy();
        }
    }
}

export class StateTreeRoot extends StateTreeBase<null> {
    factoryData = null;

    constructor({ declaration, gameData, stateTreeFactories }: {
        declaration: CustomStateTreeDeclaration<null>,
        gameData: GameDataInterface,
        stateTreeFactories: StateTreeFactories,
    }) {
        super({ name: 'root', uuid: 'root', gameData, stateTreeFactories });
        this.buildPromise = this.build(declaration);
    }

    async build(declaration: CustomStateTreeDeclaration<null>) {
        const mods = this.buildMods({
            modFactories: declaration.mods as Set<StateTreeModFactory<unknown>>,
            factoryData: this.factoryData,
        });

        this.mods = mods instanceof Promise ? await mods : mods;
        this.built = true;
    }
}

/**
 * A node in the state tree of the universe.
 */
export class StateTreeNode<DataType extends NovaDataType = NovaDataType>
    extends StateTreeBase<GetFactoryData<DataType>> {
    readonly id: string;

    constructor({ declaration, id, stateTreeFactories, gameData, parent, uuid }: {
        declaration: StateTreeDeclaration<NovaDataType>,
        id: string,
        uuid: string,
        stateTreeFactories: StateTreeFactories,
        gameData: GameDataInterface,
        parent?: StateTree,

    }) {
        super({ name, uuid, stateTreeFactories, gameData, parent });
        this.id = id;

        this.buildPromise = this.build({
            declaration,
            gameData,
        });
    }

    protected async build({ declaration, gameData }: {
        declaration: StateTreeDeclaration<NovaDataType>,
        gameData: GameDataInterface,
    }) {
        const gettable = gameData.data[declaration.dataType];
        const factoryData = (gettable.getCached(this.id) ??
            await gettable.get(this.id)) as GetFactoryData<DataType>;

        this.factoryData = factoryData;

        const mods = this.buildMods({
            modFactories: declaration.mods as Set<StateTreeModFactory<unknown>>,
            factoryData,
        });

        this.mods = mods instanceof Promise ? await mods : mods;
        this.built = true;
    }
}
