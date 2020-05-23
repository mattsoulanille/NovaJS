import { IMapKeys, ISystemState, MapKeys, ISpaceObjectState, IEngineState, EngineState, SystemState, SpaceObjectState } from "novajs/nova/src/proto/protobufjs_bundle";

export type ChildrenView<V = unknown, C extends string = string, T extends TreeView<V, C> = TreeView<V, C>> = {
    keySet?: MapKeys.IKeySet;
    keyDelta?: MapKeys.IKeyDelta;
    children: Map<string, T>;
    childFactory: () => T;
    factory: () => ChildrenView<V, C, T>;
}

export interface Family {
    // Necessary to make types work out nicely. Can't have
    // a getter and setter with different types.
    getChildrenView(): ChildrenView;
    setChildrenView(c: ChildrenView): void;
}
export interface TreeView<V = unknown, C extends string = string> {
    readonly familyTypes: Set<C>;
    readonly families: {
        // Not a map because there's a discrete set of keys
        [childType in C]: Family;
    };
    value: V;
    factory: () => TreeView<V, C>;
    changed: boolean;
    withoutChildren: () => TreeView<V, C>;
    //shallowCopyTo: (other: TreeView<V, C>) => void;
}

function getChildrenViewValues<State, Children extends string>(childrenView: ChildrenView<State, Children>) {
    return Object.fromEntries([...childrenView.children].map(([key, child]) => {
        return [key, child.value];
    }));
}


class ChildrenMap<V, C extends string, ChildView extends TreeView<V, C> = TreeView<V, C>> implements Map<string, ChildView> {

    constructor(private map: { [index: string]: V },
        private childFactory: () => ChildView) { }

    get(key: string): ChildView | undefined {
        const val = this.map[key];
        if (val) {
            const childView = this.childFactory();
            childView.value = this.map[key];
            return childView;
        }
        return undefined;
    }

    set(key: string, value: ChildView): this {
        this.map[key] = value.value;
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

    forEach(callbackfn: (value: ChildView, key: string,
        map: Map<string, ChildView>) => void, thisArg?: any): void {
        if (thisArg) {
            callbackfn = callbackfn.bind(thisArg);
        }

        for (const [key, val] of this) {
            callbackfn(val, key, this)
        }
    }

    *[Symbol.iterator](): IterableIterator<[string, ChildView]> {
        for (const key of this.keys()) {
            yield [key, this.get(key)!];
        }
    }

    *entries(): IterableIterator<[string, ChildView]> {
        yield* this[Symbol.iterator]();
    }
    *keys(): IterableIterator<string> {
        for (const key of Object.keys(this.map)) {
            yield key;
        }
    }
    *values(): IterableIterator<ChildView> {
        for (const [, val] of this) {
            yield val;
        }
    }
    [Symbol.toStringTag] = "ChildrenMap";
}


class MapChildrenView<V, C extends string, ChildView extends TreeView<V, C> = TreeView<V, C>>
    implements ChildrenView<V, C> {
    readonly children: ChildrenMap<V, C, ChildView>;
    constructor(private map: { [index: string]: V },
        private mapKeys: IMapKeys,
        public childFactory: () => ChildView) {
        //private setChildren: (children: { [id: string]: V }) => void) {

        this.children = new ChildrenMap(this.map, this.childFactory);
    }

    factory() {
        return new MapChildrenView({}, new MapKeys(), this.childFactory);
    }

    get keySet() {
        return this.mapKeys.keySet ?? undefined;
    }

    set keySet(keySet: MapKeys.IKeySet | undefined) {
        this.mapKeys.keySet = keySet;
        delete this.mapKeys.keyDelta;
    }

    get keyDelta() {
        return this.mapKeys.keyDelta ?? undefined;
    }

    set keyDelta(keyDelta: MapKeys.IKeyDelta | undefined) {
        this.mapKeys.keyDelta = keyDelta;
        delete this.mapKeys.keySet;
    }
}

type EngineChildren = "systems";
export class EngineView implements TreeView<IEngineState, EngineChildren> {
    readonly familyTypes = new Set<EngineChildren>(["systems"]);
    public changed = false;


    constructor(public value: IEngineState = new EngineState()) { }

    get systems() {
        return this.families.systems.getChildrenView().children;
    }

    private get valueSystems() {
        if (!this.value.systems) {
            this.value.systems = {};
        }
        return this.value.systems;
    }

    private get systemKeys() {
        if (!this.value.systemsKeys) {
            this.value.systemsKeys = new MapKeys();
        }
        return this.value.systemsKeys;
    }

    private set systemKeys(systemKeys) {
        this.value.systemsKeys = systemKeys;
    }

    get families() {
        const self = this;
        return {
            // TODO: Engine et al assign to systems, which is not okay
            // because that change doesn't get propogated.
            systems: {
                getChildrenView() {
                    return new MapChildrenView<ISystemState, SystemChildren, SystemView>(
                        self.valueSystems,
                        self.systemKeys,
                        () => new SystemView()
                        //(children) => { this.value.systems = children; }
                    )
                },
                setChildrenView(children: ChildrenView<ISystemState, SystemChildren>) {
                    self.value.systems = getChildrenViewValues(children);
                    self.systemKeys.keyDelta = children.keyDelta;
                    self.systemKeys.keySet = children.keySet;
                }
            }
        }
    }

    withoutChildren() {
        return this.factory();
    }

    factory() {
        return new EngineView(new EngineState());
    }
}

export type SystemChildren = "spaceObjects";
export class SystemView implements TreeView<ISystemState, SystemChildren> {
    readonly familyTypes = new Set<SystemChildren>(["spaceObjects"]);
    changed = false;

    constructor(public value: ISystemState = new SystemState()) { }

    get spaceObjects() {
        return this.families.spaceObjects.getChildrenView().children;
    }

    private get valueSpaceObjects() {
        if (!this.value.spaceObjects) {
            this.value.spaceObjects = {};
        }
        return this.value.spaceObjects;
    }


    private get spaceObjectsKeys() {
        if (!this.value.spaceObjectsKeys) {
            this.value.spaceObjectsKeys = new MapKeys();
        }
        return this.value.spaceObjectsKeys;
    }

    get families() {
        const self = this;
        return {
            spaceObjects: {
                getChildrenView() {
                    return new MapChildrenView<ISpaceObjectState, SpaceObjectChildren, SpaceObjectView>(
                        self.valueSpaceObjects,
                        self.spaceObjectsKeys,
                        () => new SpaceObjectView()
                    )
                },
                setChildrenView(children: ChildrenView<ISpaceObjectState, SpaceObjectChildren>) {
                    self.value.spaceObjects = getChildrenViewValues(children);
                    self.spaceObjectsKeys.keyDelta = children.keyDelta;
                    self.spaceObjectsKeys.keySet = children.keySet;
                }
            }
        }
    }

    withoutChildren() {
        return this.factory();
    }

    factory() {
        return new SystemView(new SystemState());
    }
}

// Don't instantiate children for it!
type SpaceObjectChildren = string;
export class SpaceObjectView
    implements TreeView<ISpaceObjectState, SpaceObjectChildren> {
    changed = false;
    families = {};
    familyTypes = new Set<string>();

    constructor(public value: ISpaceObjectState = new SpaceObjectState()) { }

    withoutChildren() {
        const newView = this.factory();
        const newVal = newView.value;

        Object.assign(newVal, this.value);
        // Children would then be deleted, but
        // SpaceObject does not have children.
        return newView;
    }

    factory() {
        return new SpaceObjectView(new SpaceObjectState());
    }
}


export function compareFamilies<V, C extends string, T extends TreeView<V, C>>(a: T, b: T, f: (a: ChildrenView, b: ChildrenView, familyType: C) => unknown) {
    for (const familyType of a.familyTypes) {
        const aFamilyChildren = a.families[familyType].getChildrenView();
        const bFamilyChildren = b.families[familyType].getChildrenView();
        f(aFamilyChildren, bFamilyChildren, familyType);
    }
}

export function compareChildren<V, C extends string, T extends TreeView<V, C>>(a: T, b: T, f: (a: TreeView | undefined, b: TreeView | undefined, familyType: C, childId: string) => unknown) {
    compareFamilies<V, C, T>(a, b, (aFamily, bFamily, familyType) => {
        const childrenIDs = new Set([
            ...aFamily.children.keys(),
            ...bFamily.children.keys()
        ]);

        for (const childId of childrenIDs) {
            const aChild = aFamily.children.get(childId);
            const bChild = bFamily.children.get(childId);
            f(aChild, bChild, familyType, childId);
        }
    });
}
