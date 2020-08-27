import produce, { Draft, createDraft, Patch } from 'immer';
import { IEngineDeltaValue, ISpaceObjectDeltaValue, ISystemDeltaValue, SpaceObjectDeltaValue, SystemDeltaValue, EngineDeltaValue, IShipDelta, MapKeys, SystemDelta, IMapKeys } from "novajs/nova/src/proto/protobufjs_bundle";
import { Writer } from "protobufjs";



const spaceObjectDeltaFunctions = makeDeltaFunctions({});

const systemDeltaFunctions = makeDeltaFunctions({
    spaceObjects: spaceObjectDeltaFunctions
});

const engineDeltaFunctions = makeDeltaFunctions({
    systems: systemDeltaFunctions
});

interface DeltaFunctions<Value, Delta> {
    apply(value: Value, delta: Delta): Value;
    get(before: Value, after: Value): Delta;
}




type TreeProtobufFamilies = {
    [FamilyName: string]: {
        keySetProp: string,
        treeProtobuf: TreeProtobuf
    }
}

type Values<T> = T[keyof T];
type GetKeySetProp<T extends TreeProtobufFamilies> = Values<T>['keySetProp'];
type TreeProtobuf<Value = unknown, Families extends TreeProtobufFamilies = {}> =
    { [F in keyof Families]?: {
        [C: string]:
        Families[F]['treeProtobuf'] | null | undefined
    }
    }
    & { [K in GetKeySetProp<Families>]?: IMapKeys | null | undefined }
    & { value?: Value | null | undefined };

type SpaceObjectTreeProtobuf = TreeProtobuf<ISpaceObjectDeltaValue>;
type SystemTreeProtobuf = TreeProtobuf<ISystemDeltaValue, {
    spaceObjects: {
        keySetProp: "spaceObjectsKeys",
        treeProtobuf: SpaceObjectTreeProtobuf
    }
}>

const s: SystemTreeProtobuf = new SystemDelta();
const s2 = new SystemDelta();
s2.spaceObjects

type Family<S extends StateTree = StateTree> = Map<string, S>;

interface StateTree<V = unknown, F extends { [familyName: string]: Family } = {}> {
    readonly value: V;
    readonly families: F;
}

function makeDeltaFunctions<
    Value,
    Families extends TreeProtobufFamilies,
    Protobuf extends TreeProtobuf<Value, Families>,

    >(protobufClass: { new(): Protobuf }, familyDeltaFunctions: {
        [K in keyof Families]:
        DeltaFunctions<StateTree<Families[K]['treeProtobuf']['value']>,
            Families[K]['treeProtobuf']>
    })
    : DeltaFunctions<StateTree<Value,
        { [familyName in keyof Families]: Map<string, StateTree> }>, Protobuf> {

    type StateTreeFamilies = {
        [familyName in keyof Families]: Map<string, StateTree>
    };
    type Tree = StateTree<Value, StateTreeFamilies>;

    function apply(base: Tree, protobuf: Protobuf): Tree {
        return produce(base, draft => {
            // Apply this node's value change if any.
            if (protobuf.value) {
                draft.value = createDraft(protobuf.value);
            }

            // Recurse on children for all families.
            for (const familyName in familyDeltaFunctions) {
                const { apply } = familyDeltaFunctions[familyName];
                const family = base.families[familyName];
                const protoFamily = protobuf[familyName];

                // TODO: Figure out how to loop over the protobuf instead of
                // the state tree in a type-safe manner. It's not type-safe
                // to do that right now because protoFamily could be IMapKeys
                // for all the type checker knows.
                for (const [childName, child] of family.entries()) {
                    const protoChild = protoFamily?.[childName];
                    if (protoChild) {
                        apply(child, protoChild)
                    }
                }
            }
        });
    }

    function translate(patches: Patch[]): Protobuf {

    }


    function get(before: Tree, after: Tree): Protobuf {
        const protobuf = new protobufClass();
        if (before.value !== after.value) {
            protobuf.value = after.value;
        }
        return protobuf;
    }
    return { apply, get }
}


type UnionToIntersection<U> =
    (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;

type MapFromObj<O> = UnionToIntersection<Values<{
    [K in keyof O]: Map<K, O[K]>
}>>;


// /**
//  * Maps name to keys
//  */
// type ProtobufFamilyKeys = {
//     [FamilyName: string]: string
// }



// type ProtobufType<Families extends ProtobufFamilies> = {
//     [K in keyof Families]: 
// }

// type TreeProtobuf<T extends TreeProtobuf> = {
// 	value: 
// }


// type ObjectDescriptor<Value extends ProtobufLike<Value>,
//     Families extends Map<string, ObjectDescriptor<every>> = Map<string, never>>
//     = {
//         value: Value,
//         families: Families
//     }

// type SpaceObjectDescriptor = ObjectDescriptor<typeof SpaceObjectDeltaValue, {}>;
// const spaceObjectDescriptor: SpaceObjectDescriptor = {
//     value: SpaceObjectDeltaValue
//     families: {}
// }

// type SystemDescriptor = ObjectDescriptor<typeof SystemDeltaValue,
//     { spaceObjects: SpaceObjectDescriptor }>;
// const systemDescriptor: SystemDescriptor = {
//     value: SystemDeltaValue,
//     families: {
//         spaceObjects: spaceObjectDescriptor,
//     }
// }

// type EngineDescriptor = ObjectDescriptor<typeof EngineDeltaValue,
//     { systems: SystemDescriptor }>;
// const engineDescriptor: EngineDescriptor = {
//     value: EngineStateValue,
//     families: {
//         systems: systemDescriptor
//     }
// }





// function spaceObjectDelta(state: SpaceObjectState, change:
//     type WithValue<T extends WithValue<T>> = {
//     value: WithValue
// }

// //only used for things whose descendents also use genericApplyDelta
// // i.e. once you get to generic you can't get back to special
// function genericApplyDelta<T extends { value:}>(input: T, delta: DeltaType<T>, childFuncs_curried: input:?, delta: DeltaType<?>) => ?): T{



//     return changed;
// }








// export function makeDeltaFunctions<T extends TreeType, D extends ObjectDescriptor>(descriptor: D) {



//     for (let [familyName, familyDescriptor] of descriptor.families.entries()) {

//     }

//     function applyDelta(pbuf: ProtobufType<F>): T {
//         const dec = pbuf;





//     }

//     function getDelta(a: T, b: T): ProtobufType {

//     }

//     return { applyDelta, getDelta }
// }

// const x: ISpaceObjectStateValue


// type Delta<T, C extends Delta<unknown, unknown>> = { value: T, children: Array<C> };


// interface delta_able {

//     applyDelta(




// }




// function applyDelta(before: object, change: { value: undefined | object) {
//     after = {};
//     for (key in before) {
//         if key in dolta





// }











//     export type TreeType<S = unknown, L = unknown,
//         F extends { [family: string]: TreeType }
//         = { [family: string]: TreeType }> = {
//             sharedData: S;
//             localData: L;
//             families: F;
//         };

//     export type SpaceObjectTreeType = TreeType<ISpaceObjectStateValue, {}, {}>;
//     export type SystemTreeType = TreeType<ISystemStateValue, {}, { spaceObjects: SpaceObjectTreeType }>;
//     export type EngineTreeType = TreeType<IEngineStateValue, {}, { systems: SystemTreeType }>;
