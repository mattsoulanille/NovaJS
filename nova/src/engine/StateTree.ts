import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { Gettable } from "novajs/novadatainterface/Gettable";
import { NovaDataInterface, NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { StateTreeMod, StateTreeModFactory } from "./StateTreeMod";
import * as t from 'io-ts';
import { setDifference, setUnion } from "../common/SetUtils";

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
    id: string;
    modDeltas?: { [name: string]: unknown };
    childrenDeltas?: { [uuid: string]: StateTreeDelta };
    remove?: string[];
}

export const StateTreeDelta = t.recursion<StateTreeDelta>('StateTreeDelta', StateTreeDelta =>
    t.intersection([
        t.type({
            name: t.string,
            id: t.string,
        }),
        t.partial({
            remove: t.array(t.string),
            modDeltas: t.record(t.string, t.unknown),
            childrenDeltas: t.record(t.string, StateTreeDelta),
        }),
    ])
);

export interface StateTree<FactoryData = unknown> {
    readonly name: string;
    readonly uuid: string;
    readonly id: string;
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

    applyDelta(delta: StateTreeDelta): void;
    getState(): StateTreeDelta;
    addChild(child: StateTree): void;
    removeChild(child: StateTree): void;
}

class StateTreeBase<FactoryData = unknown> implements StateTree<FactoryData> {
    readonly name: string;
    readonly uuid: string;
    id = "no id";
    factoryData?: FactoryData;
    mods = new Map<string, StateTreeMod>();
    children = new Map<string, StateTree<unknown>>();
    private lastChildren = new Set<string>();
    parent?: StateTree;
    buildPromise: Promise<void> = Promise.resolve();
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

    getState(): StateTreeDelta {
        return {
            name: this.name,
            id: this.id,
            modDeltas: Object.fromEntries([...this.mods.entries()]
                .map(([name, mod]) => [name, mod.getState()])),
            childrenDeltas: Object.fromEntries([...this.children.entries()]
                .map(([uuid, child]) => [uuid, child.getState()]))
        }
    }

    applyDelta(delta: StateTreeDelta) {
        if (delta.name !== this.name) {
            console.warn(`Can not apply delta for ${delta.name} to ${this.name}`);
            return;
        }
        if (delta.id !== this.id) {
            console.warn(`Can not apply delta for ${delta.id} to ${this.id}`);
            return;
        }

        // Apply the delta only if it's built. If not, wait
        // for it to be built.
        if (!this.built) {
            this.buildPromise = this.buildPromise.then(() => {
                this.applyDelta(delta);
            });
            return;
        }

        // Remove children
        for (const remove of delta?.remove ?? []) {
            this.children.delete(remove);
        }

        // Create children that we don't have.
        for (const [uuid, childDelta] of Object.entries(delta.childrenDeltas ?? {})) {
            if (!this.children.has(uuid)) {
                const factory = this.stateTreeFactories.get(childDelta.name);
                if (factory) {
                    const child = factory(childDelta.id, uuid);
                    this.children.set(uuid, child);
                } else {
                    console.warn(`Factory for StateTree ${childDelta.name} not found`);
                }
            }
        }

        // Apply mod deltas
        for (const [name, modDelta] of Object.entries(delta.modDeltas ?? {})) {
            this.mods.get(name)?.applyDelta(modDelta);
        }

        // Apply children deltas
        for (const [uuid, childDelta] of Object.entries(delta.childrenDeltas ?? {})) {
            this.children.get(uuid)?.applyDelta(childDelta);
        }

        // Add / remove the children from the delta so the set difference between
        // children and lastChildren is the children added by local operations only and
        // the set difference between lastChildren and children is the children removed
        // by local operations only.
        this.lastChildren = setUnion(
            setDifference(this.lastChildren, new Set(delta.remove ?? [])),
            new Set(Object.keys(delta.childrenDeltas ?? {})))
    }

    step({ time, ownedUUIDs }: {
        time: number;
        ownedUUIDs: Set<string>;
    }): StateTreeDelta | undefined {
        // Only step once it's built
        if (!this.built) {
            this.buildPromise = this.buildPromise.then(() => {
                this.step({ time, ownedUUIDs });
            });
            return;
        }

        const delta: StateTreeDelta = {
            name: this.name,
            id: this.id,
            modDeltas: {},
            childrenDeltas: {},
        };

        // Step mods
        const makeDelta = ownedUUIDs.has(this.uuid);
        for (const [name, mod] of this.mods) {
            const modDelta = mod.step({ time, makeDelta });
            if (modDelta) {
                delta.modDeltas![name] = modDelta;
            }
        }

        // Step children
        for (const [uuid, child] of this.children) {
            const childDelta = child.step({ time, ownedUUIDs });
            if (childDelta) {
                delta.childrenDeltas![uuid] = childDelta;
            }
        }

        const children = new Set(this.children.keys());
        const addedChildren = setDifference(children, this.lastChildren);
        const removedChildren = setDifference(this.lastChildren, children);
        this.lastChildren = new Set([...this.children.keys()]);

        for (const newChildUUID of addedChildren) {
            // TODO: Filter with ownedUUIDs?
            const newChild = this.children.get(newChildUUID);
            delta.childrenDeltas![newChildUUID] = newChild!.getState();
        }

        if (removedChildren.size > 0) {
            delta.remove = [...removedChildren];
        }

        // If nothing changed, don't return a delta
        if (Object.keys(delta.modDeltas!).length === 0 &&
            Object.keys(delta.childrenDeltas!).length === 0 &&
            !delta.remove) {
            return;
        }

        return delta;
    }

    addChild(child: StateTree) {
        this.children.set(child.uuid, child);
        child.parent = this;
    }

    removeChild(child: StateTree) {
        this.children.delete(child.uuid);
        child.parent = undefined;
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
        super({ name: declaration.name, uuid, stateTreeFactories, gameData, parent });
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
