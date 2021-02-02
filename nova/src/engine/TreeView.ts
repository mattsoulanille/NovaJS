import { EngineState, IEngineState, IMapKeys, ISpaceObjectState, ISystemState, MapKeys, SpaceObjectState, SystemState, IEngineStateValue, ISystemStateValue, ISpaceObjectStateValue, SpaceObjectStateValue, SystemStateValue, EngineStateValue } from "novajs/nova/src/proto/protobufjs_bundle";

export type TreeType<S = unknown, L = unknown,
    F extends { [family: string]: TreeType }
    = { [family: string]: TreeType },
    P = unknown> = {
        sharedData: S;
        localData: L;
        families: F;
        protobuf: P;
    };


export type TreeTypeSharedData<T extends TreeType>
    = T extends { sharedData: (infer S) } ? S : never;

export type TreeTypeFamilies<T extends TreeType>
    = T extends { families: (infer F) } ? F : never;

export type TreeTypeLocalData<T extends TreeType>
    = T extends { localData: (infer D) } ? D : never;

export type TreeTypeProtobuf<T extends TreeType>
    = T extends { protobuf: (infer P) } ? P : never;


export type TreeTypeFunctions<T extends TreeType> = {
    // It would be nice if serialize and deserialize could
    // be abstracted into TreeViewImpl, but that makes
    // serialization very rigid. Things like projectiles
    // would have to have protobufs even though we don't
    // acutally serialize them. There's also the problem of
    // `Protobuf` vs `IProtobuf` which I ran into when trying
    // to implement a generic serializer / deserializer given a
    // known protobuf structure. `Protobuf`'s children are always
    // the interface type instead of the actual protobuf type, and
    // the interface type has elements that are 'value' | null | undefined,
    // which causes issues when I try to specify that all protobufs used
    // have a key for each family which has non-null values.

    serialize(sharedData: TreeTypeSharedData<T>,
        families: TreeViewFamilies<T>): TreeTypeProtobuf<T>;

    deserialize(protobuf?: TreeTypeProtobuf<T>): {
        sharedData: TreeTypeSharedData<T>,
        families: TreeViewFamilies<T>,
    };

    // Encodes what kind of families this node has.
    // Not the instances of families themselves.
    families: {
        [F in keyof TreeTypeFamilies<T>]:
        TreeTypeFunctions<TreeTypeFamilies<T>[F]>
    };

    localDataFactory(): TreeTypeLocalData<T>;
}

type ValueOf<T> = T[keyof T];

export type FamilyTreeTypes<T extends TreeType> =
    ValueOf<TreeTypeFamilies<T>>;

export type AllTreeTypes<T extends TreeType> = T
    | ValueOf<{
        [family in keyof TreeTypeFamilies<T>]:
        AllTreeTypes<TreeTypeFamilies<T>[family]>
    }>

export interface ChildrenView<T extends TreeType> extends Map<string, TreeView<T>> {
    childFactory(proto?: TreeTypeProtobuf<T>): TreeView<T>;
    factory(): ChildrenView<T>;
    serialize(): { [id: string]: TreeTypeProtobuf<T> };
    // If keyDelta is set, then getMapKeys will return MapKeys
    // with keyDelta set instead of a KeySet. This is used
    // to represent changes between states. 
    getMapKeys(): MapKeys;
    keyDelta: MapKeys.KeyDelta | undefined;
}

type TreeViewFamilies<T extends TreeType> = {
    // Not a map because there's a discrete set of keys
    [familyType in keyof TreeTypeFamilies<T>]:
    ChildrenView<TreeTypeFamilies<T>[familyType]>;
};

export interface TreeView<T extends TreeType> {
    readonly familyTypes: Set<keyof TreeTypeFamilies<T>>;
    readonly families: TreeViewFamilies<T>;
    sharedData: TreeTypeSharedData<T>;
    localData: TreeTypeLocalData<T>;
    factory: (proto?: TreeTypeProtobuf<T>) => TreeView<T>;
    changed: boolean;
    withoutChildren: () => TreeView<T>;
    shallowCopyFrom: (other: TreeView<T>) => void;
    serialize(): TreeTypeProtobuf<T>;
}

class MapChildrenView<T extends TreeType> extends Map<string, TreeView<T>> implements ChildrenView<T> {
    // keyDelta is only set if this is part of a diff
    // instead of a full state. When set, it overrides
    // getMapKeys.
    keyDelta = undefined;

    constructor(
        map: { [index: string]: TreeTypeProtobuf<T> },
        public childFactory: (protobuf?: TreeTypeProtobuf<T>)
            => TreeView<T>) {
        super();

        for (const [key, val] of Object.entries(map)) {
            this.set(key, this.childFactory(val));
        }
    }

    factory() {
        return new MapChildrenView(
            {}, this.childFactory);
    }

    serialize() {
        const out: { [id: string]: TreeTypeProtobuf<T> } = {};
        for (const [key, value] of this) {
            out[key] = value.serialize();
        }
        return out;
    }

    getMapKeys(): MapKeys {
        const keys = new MapKeys();
        if (this.keyDelta) {
            keys.keyDelta = this.keyDelta;
            return keys;
        }

        keys.keySet = new MapKeys.KeySet();
        keys.keySet.keys = [...this.keys()];
        return keys;
    }
}

export class TreeViewImpl<T extends TreeType> implements TreeView<T> {
    familyTypes: Set<keyof TreeTypeFamilies<T>>;
    families: TreeViewFamilies<T>;
    sharedData: TreeTypeSharedData<T>;
    localData: TreeTypeLocalData<T>;
    // Indicates a change that could not be predicted.
    // Not just any change. Set by the Engine.
    // Change corresponds to just this element and not
    // its children.
    changed = false;

    constructor(private treeTypeFunctions: TreeTypeFunctions<T>,
        protobuf?: TreeTypeProtobuf<T>) {
        this.localData = treeTypeFunctions.localDataFactory();

        this.familyTypes
            = new Set(Object.keys(treeTypeFunctions.families));

        const { families, sharedData }
            = treeTypeFunctions.deserialize(protobuf);

        this.families = families;
        this.sharedData = sharedData;
    }

    serialize(): TreeTypeProtobuf<T> {
        return this.treeTypeFunctions.serialize(
            this.sharedData, this.families);
    }

    factory(proto?: TreeTypeProtobuf<T>) {
        return new TreeViewImpl(this.treeTypeFunctions, proto);
    }

    withoutChildren() {
        const view = this.factory();
        view.shallowCopyFrom(this);
        return view;
    }

    shallowCopyFrom(other: TreeView<T>) {
        this.sharedData = other.sharedData;
        this.localData = other.localData;
        this.changed = other.changed;
    }
}


type SpaceObjectTreeType = TreeType<ISpaceObjectStateValue, {}, {}, ISpaceObjectState>;

const SpaceObjectTreeFunctions: TreeTypeFunctions<SpaceObjectTreeType> = {
    localDataFactory() {
        return {};
    },
    deserialize(protobuf?: ISpaceObjectState) {
        return {
            families: {},
            sharedData: protobuf?.value ?? new SpaceObjectStateValue()
        }
    },
    serialize(sharedData: ISpaceObjectStateValue, _families: {}) {
        const proto = new SpaceObjectState();
        proto.value = sharedData;
        return proto;
    },
    families: {},
}

export type SpaceObjectView = TreeView<SpaceObjectTreeType>;
export function spaceObjectViewFactory(protobuf?: TreeTypeProtobuf<SpaceObjectTreeType>): SpaceObjectView {
    return new TreeViewImpl(SpaceObjectTreeFunctions, protobuf);
}

type SystemTreeType = TreeType<ISystemStateValue, {}, { spaceObjects: SpaceObjectTreeType }, ISystemState>;

const SystemTreeFunctions: TreeTypeFunctions<SystemTreeType> = {
    localDataFactory() {
        return {};
    },
    deserialize(protobuf?: ISystemState) {
        return {
            families: {
                spaceObjects:
                    new MapChildrenView(protobuf?.spaceObjects ?? {}, spaceObjectViewFactory)
            },
            sharedData: protobuf?.value ?? new SystemStateValue()
        }
    },
    serialize(sharedData: ISystemStateValue,
        families: TreeViewFamilies<SystemTreeType>
    ) {
        const proto = new SystemState();
        proto.value = sharedData;
        proto.spaceObjects = families.spaceObjects.serialize();
        proto.spaceObjectsKeys = families.spaceObjects.getMapKeys();
        return proto;
    },
    families: {
        spaceObjects: SpaceObjectTreeFunctions
    }
}

export type SystemView = TreeView<SystemTreeType>;
export function systemViewFactory(protobuf?: TreeTypeProtobuf<SystemTreeType>): SystemView {
    return new TreeViewImpl(SystemTreeFunctions, protobuf);
}

type EngineTreeType = TreeType<IEngineStateValue, {}, { systems: SystemTreeType }, IEngineState>;
const EngineTreeFunctions: TreeTypeFunctions<EngineTreeType> = {
    localDataFactory() {
        return {}
    },
    deserialize(protobuf?: IEngineState) {
        return {
            families: {
                systems:
                    new MapChildrenView(protobuf?.systems ?? {}, systemViewFactory)
            },
            sharedData: protobuf?.value ?? new EngineStateValue()
        }
    },
    serialize(sharedData: IEngineState,
        families: TreeViewFamilies<EngineTreeType>
    ) {
        const proto = new EngineState();
        proto.value = sharedData;
        proto.systems = families.systems.serialize();
        proto.systemsKeys = families.systems.getMapKeys();
        return proto;
    },
    families: {
        systems: SystemTreeFunctions
    }
}

export type EngineView = TreeView<EngineTreeType>;
export function engineViewFactory(protobuf?: TreeTypeProtobuf<EngineTreeType>): EngineView {
    return new TreeViewImpl(EngineTreeFunctions, protobuf);
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
