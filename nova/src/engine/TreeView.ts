import { EngineState, IEngineState, IMapKeys, ISpaceObjectState, ISystemState, MapKeys, SpaceObjectState, SystemState } from "novajs/nova/src/proto/protobufjs_bundle";
import { copyState } from "./CopyState";

export type FamilyType = {
    treeType: TreeType,
    treeView: TreeView<TreeType>
}

export type TreeType = {
    protobuf: unknown,
    localData: unknown,
    families: { [family: string]: TreeType }
}


export type TreeTypeProtobuf<T extends TreeType>
    = T extends { protobuf: (infer P) } ? P : never;

export type TreeTypeFamilies<T extends TreeType>
    = T extends { families: (infer F) } ? F : never;

export type TreeTypeLocalData<T extends TreeType>
    = T extends { localData: (infer D) } ? D : never;

type ValueOf<T> = T[keyof T];

export type FamilyTreeTypes<T extends TreeType> =
    ValueOf<TreeTypeFamilies<T>>;

export type AllTreeTypes<T extends TreeType> = T
    | ValueOf<{
        [family in keyof TreeTypeFamilies<T>]:
        AllTreeTypes<TreeTypeFamilies<T>[family]>
    }>

export interface ChildrenView<T extends TreeType> extends Map<string, TreeView<T>> {
    keySet?: MapKeys.IKeySet;
    keyDelta?: MapKeys.IKeyDelta;
    //children: Map<string, TreeView<T>>;
    childFactory: () => TreeView<T>;
    factory: () => ChildrenView<T>;
}

export interface TreeView<T extends TreeType> {
    readonly familyTypes: Set<keyof TreeTypeFamilies<T>>;
    readonly families: {
        // Not a map because there's a discrete set of keys
        [familyType in keyof TreeTypeFamilies<T>]:
        ChildrenView<TreeTypeFamilies<T>[familyType]>;
    };
    protobuf: TreeTypeProtobuf<T>;
    localData: TreeTypeLocalData<T>;
    factory: () => TreeView<T>;
    changed: boolean;
    withoutChildren: () => TreeView<T>;
    shallowCopyFrom: (other: TreeView<T>) => void;
}

function getChildrenViewValues<T extends TreeType>(childrenView: ChildrenView<T>) {
    return Object.fromEntries([...childrenView].map(([key, child]) => {
        return [key, child.protobuf];
    }));
}


class MapChildrenView<T extends TreeType> implements ChildrenView<T> {
    constructor(
        private map: { [index: string]: TreeTypeProtobuf<T> },
        private mapKeys: IMapKeys,
        public childFactory: () => TreeView<T>) {

        this.mapKeys.keySet =
            this.mapKeys.keySet ?? new MapKeys.KeySet();
        this.mapKeys.keySet.keys = this.mapKeys.keySet.keys ?? [];
    }


    // Not necessarily equal to the keys in the map
    get keySet() {
        return this.mapKeys.keySet ?? undefined;
    }
    set keySet(keySet: MapKeys.IKeySet | undefined) {
        this.mapKeys.keySet = keySet;
    }

    get keyDelta() {
        return this.mapKeys.keyDelta ?? undefined;
    }
    set keyDelta(keyDelta: MapKeys.IKeyDelta | undefined) {
        this.mapKeys.keyDelta = keyDelta;
    }


    factory() {
        return new MapChildrenView(
            {}, new MapKeys(), this.childFactory);
    }

    get(key: string): TreeView<T> | undefined {
        const val = this.map[key];
        if (val) {
            const childView = this.childFactory();
            childView.protobuf = this.map[key];
            return childView;
        }
        return undefined;
    }

    set(key: string, value: TreeView<T>): this {
        this.map[key] = value.protobuf;
        return this;
    }

    delete(key: string): boolean {
        const exists = this.has(key);
        delete this.map[key];
        return exists;
    }

    get size() {
        return Object.keys(this.map).length;
    }

    has(key: string): boolean {
        return Boolean(this.map[key]);
    }

    clear(): void {
        for (const key of this.keys()) {
            this.delete(key);
        }
    }

    forEach(callbackfn: (value: TreeView<T>, key: string,
        map: Map<string, TreeView<T>>) => void, thisArg?: any): void {
        if (thisArg) {
            callbackfn = callbackfn.bind(thisArg);
        }

        for (const [key, val] of this) {
            callbackfn(val, key, this)
        }
    }

    *[Symbol.iterator](): IterableIterator<[string, TreeView<T>]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)!];
        }
    }

    *entries(): IterableIterator<[string, TreeView<T>]> {
        yield* this[Symbol.iterator]();
    }
    *keys(): IterableIterator<string> {
        for (const key of Object.keys(this.map)) {
            yield key;
        }
    }
    *values(): IterableIterator<TreeView<T>> {
        for (const [, val] of this) {
            yield val;
        }
    }
    [Symbol.toStringTag] = "ChildrenMap";
}


export type IEngineView = TreeView<EngineTreeType>;

type EngineTreeType = {
    protobuf: IEngineState,
    localData: {},
    families: {
        systems: SystemTreeType
    }
}

export class EngineView implements IEngineView {
    readonly familyTypes =
        new Set<keyof TreeTypeFamilies<EngineTreeType>>(["systems"]);
    public changed = false;
    localData = {};

    constructor(public protobuf: IEngineState = new EngineState()) { }

    // get systems() {
    //     return this.families.systems.children;
    // }

    private get valueSystems() {
        if (!this.protobuf.systems) {
            this.protobuf.systems = {};
        }
        return this.protobuf.systems;
    }

    private get systemKeys() {
        if (!this.protobuf.systemsKeys) {
            this.protobuf.systemsKeys = new MapKeys();
        }
        return this.protobuf.systemsKeys;
    }

    private set systemKeys(systemKeys) {
        this.protobuf.systemsKeys = systemKeys;
    }

    get families() {
        const self = this;
        return {
            // TODO: Engine et al assign to systems, which is not okay
            // because that change doesn't get propogated.
            get systems() {
                return new MapChildrenView<SystemTreeType>(
                    self.valueSystems,
                    self.systemKeys,
                    () => new SystemView()
                    //(children) => { this.value.systems = children; }
                )
            },
            set systems(children: ChildrenView<SystemTreeType>) {
                self.protobuf.systems = getChildrenViewValues(children);
                self.systemKeys.keyDelta = children.keyDelta;
                self.systemKeys.keySet = children.keySet;
            }
        }
    }


    shallowCopyFrom(_other: TreeView<EngineTreeType>) {
        // Nothing to copy
        return;
    }

    withoutChildren() {
        return this.factory();
    }

    factory() {
        return new EngineView(new EngineState());
    }
}

export type ISystemView = TreeView<SystemTreeType>;

type SystemTreeType = {
    protobuf: ISystemState;
    localData: {};
    families: {
        spaceObjects: SpaceObjectTreeType
    }
}

export class SystemView implements ISystemView {
    readonly familyTypes =
        new Set<keyof TreeTypeFamilies<SystemTreeType>>(["spaceObjects"]);
    changed = false;
    localData = {};

    constructor(public protobuf: ISystemState = new SystemState()) { }

    // get spaceObjects() {
    //     return this.families.spaceObjects.children;
    // }

    private get valueSpaceObjects() {
        if (!this.protobuf.spaceObjects) {
            this.protobuf.spaceObjects = {};
        }
        return this.protobuf.spaceObjects;
    }


    private get spaceObjectsKeys() {
        if (!this.protobuf.spaceObjectsKeys) {
            this.protobuf.spaceObjectsKeys = new MapKeys();
        }
        return this.protobuf.spaceObjectsKeys;
    }

    get families() {
        const self = this;
        return {
            get spaceObjects() {
                return new MapChildrenView<SpaceObjectTreeType>(
                    self.valueSpaceObjects,
                    self.spaceObjectsKeys,
                    () => new SpaceObjectView()
                )
            },
            set spaceObjects(children: ChildrenView<SpaceObjectTreeType>) {
                self.protobuf.spaceObjects = getChildrenViewValues(children);
                self.spaceObjectsKeys.keyDelta = children.keyDelta;
                self.spaceObjectsKeys.keySet = children.keySet;
            }
        }
    }

    shallowCopyFrom(_other: TreeView<SystemTreeType>) {
        // Nothing to copy
        return;
    }

    withoutChildren() {
        return this.factory();
    }

    factory() {
        return new SystemView(new SystemState());
    }
}


export type ISpaceObjectView = TreeView<SpaceObjectTreeType>;

// Don't instantiate children for it!
type SpaceObjectTreeType = {
    protobuf: ISpaceObjectState;
    localData: {};
    families: {};
};

export class SpaceObjectView
    implements TreeView<SpaceObjectTreeType> {
    changed = false;
    families = {};
    familyTypes = new Set<never>();
    localData = {};

    constructor(public protobuf: ISpaceObjectState = new SpaceObjectState()) { }

    shallowCopyFrom(other: TreeView<SpaceObjectTreeType>) {
        copyState(
            other.protobuf,
            this.protobuf,
            [
                "accelerating",
                "acceleration",
                "changes",
                "equipmentState",
                "maxVelocity",
                "movementType",
                "planetState",
                "position",
                "rotation",
                "shipState",
                "turnBack",
                "turning",
                "turnRate",
                "velocity"
            ],
            true
        );
    }

    withoutChildren() {
        const newView = this.factory();
        const newVal = newView.protobuf;

        Object.assign(newVal, this.protobuf);
        // Children would then be deleted, but
        // SpaceObject does not have children.
        return newView;
    }

    factory() {
        return new SpaceObjectView(new SpaceObjectState());
    }
}

export function compareFamilies<T extends TreeType>(
    a: TreeView<T>, b: TreeView<T>,
    f: (ac: ChildrenView<FamilyTreeTypes<T>>,
        bc: ChildrenView<FamilyTreeTypes<T>>,
        familyType: keyof TreeTypeFamilies<T>) => unknown) {

    for (const familyType of a.familyTypes) {
        const aFamilyChildren = a.families[familyType];
        const bFamilyChildren = b.families[familyType];
        f(aFamilyChildren, bFamilyChildren, familyType);
    }
}

export function compareChildren<T extends TreeType>(
    a: TreeView<T>,
    b: TreeView<T>,
    f: (af: TreeView<FamilyTreeTypes<T>> | undefined,
        bf: TreeView<FamilyTreeTypes<T>> | undefined,
        familyType: keyof TreeTypeFamilies<T>,
        childId: string) => unknown) {

    compareFamilies(a, b, (aFamily, bFamily, familyType) => {
        const childrenIDs = new Set([
            ...aFamily.keys(),
            ...bFamily.keys()
        ]);

        for (const childId of childrenIDs) {
            const aChild = aFamily.get(childId);
            const bChild = bFamily.get(childId);
            f(aChild, bChild, familyType, childId);
        }
    });
}
