import { createDraft, Draft } from "immer";
import {
    EngineDelta,
    IEngineDelta,
    IMapKeys,
    ISpaceObjectDelta,
    ISystemDelta,
    IVector,
    MapKeys,
    SpaceObjectDelta,
    SpaceObjectDeltaValue,
    SystemDelta,
    Vector as VectorProto
} from "novajs/nova/src/proto/protobufjs_bundle";
import { setDifference } from "../common/SetUtils";
import { EngineFactory } from "./EngineFactory";
import { SpaceObjectFactory } from "./SpaceObjectFactory";
import { Engine, SpaceObject, System, vectorFactory } from "./State";
import { SystemFactory } from "./SystemFactory";
import { Vector } from "./Vector";


export interface DeltaFunctions<State, Delta> {
    stateFactory: () => State;
    deltaFactory: () => Delta;
    apply: (state: Draft<State>, delta: Delta) => void;
    create: (previous: State, current: State) => Delta;
}

type ProtoPartial<T> = {
    [K in keyof T]?: T[K] | null | undefined
}

type OnlyKeys<T, K extends keyof T> = {
    [Key in K]: T[K]
}


// Need supertypes:
// https://github.com/microsoft/TypeScript/issues/9252
function copy<K extends keyof A & keyof B,
    A extends ProtoPartial<OnlyKeys<B, K>>,
    B>(keys: Array<K>, fromObj: A, toObj: B) {
    for (let key of keys) {
        const val = fromObj[key];
        if (val !== null && val !== undefined) {
            toObj[key] = val as unknown as B[K];
        }
    }
}

function copyChanges<K extends keyof A & keyof B,
    A extends ProtoPartial<OnlyKeys<B, K>>,
    B>(keys: Array<K>, before: B, after: B, deltaObj: A) {
    for (let key of keys) {
        if (before[key] !== after[key]) {
            deltaObj[key] = after[key] as unknown as A[K];
        }
    }
}


const vectorDeltaFunctions: DeltaFunctions<Vector, IVector> = {
    deltaFactory() {
        return new VectorProto();
    },
    stateFactory: vectorFactory,
    apply(state, delta) {
        copy(['x', 'y'], delta, state);
    },
    create(previous: Vector, current: Vector) {
        const proto = this.deltaFactory();
        copyChanges(['x', 'y'], previous, current, proto);
        return proto;
    }
}

const spaceObjectDeltaFunctions: DeltaFunctions<SpaceObject, ISpaceObjectDelta> = {
    deltaFactory() {
        return new SpaceObjectDelta();
    },
    stateFactory: SpaceObjectFactory.base,
    apply(state, delta) {
        if (delta.value) {
            copy(["maxVelocity",
                "rotation",
                "turning",
                "turnBack",
                "turnRate",
                "movementType",
                "acceleration",
                "accelerating"],
                delta.value, state);
            if (delta.value.position) {
                vectorDeltaFunctions.apply(state.position, delta.value.position);
            }
            if (delta.value.velocity) {
                vectorDeltaFunctions.apply(state.velocity, delta.value.velocity);
            }
        }
    },
    create(previous: SpaceObject, current: SpaceObject) {
        const proto = this.deltaFactory();
        proto.value = new SpaceObjectDeltaValue();
        copyChanges(["maxVelocity",
            "rotation",
            "turning",
            "turnBack",
            "turnRate",
            "movementType",
            "acceleration",
            "accelerating"],
            previous, current, proto.value);
        return proto;
    }
};

function removeOldKeys(keys: IMapKeys, objects: Map<string, unknown>) {
    let toRemove: Iterable<string>;
    if (keys.keySet) {
        if (!keys.keySet.keys) {
            console.warn("Missing keyset keys");
            return;
        }
        toRemove = setDifference(new Set(objects.keys()),
            new Set(keys.keySet.keys));

    } else if (keys.keyDelta) {
        if (!keys.keyDelta.remove) {
            return;
        }
        toRemove = keys.keyDelta.remove;
    } else {
        console.warn("Missing keyset and keydelta");
        return;
    }

    for (const key of toRemove) {
        objects.delete(key);
    }
}

function makeMapDeltaFunctions<State, Delta>(deltaFunctions: DeltaFunctions<State, Delta>):
    DeltaFunctions<Map<string, State>,
        { keys: IMapKeys | null | undefined, map: { [key: string]: Delta } | null | undefined }> {
    return {
        deltaFactory() {
            return {
                keys: new MapKeys(),
                map: {}
            }
        },
        stateFactory() {
            return new Map<string, State>();
        },
        apply(state, delta) {
            if (delta.keys) {
                removeOldKeys(delta.keys, state);
            }
            if (delta.map) {
                for (const [key, deltaVal] of Object.entries(delta.map)) {
                    if (!state.has(key)) {
                        state.set(key, createDraft(deltaFunctions.stateFactory()));
                    }
                    const stateVal = state.get(key)!;

                    deltaFunctions.apply(stateVal, deltaVal);
                }
            }
        },
        create(previous, current) {
            const keys = new MapKeys();
            keys.keyDelta = new MapKeys.KeyDelta();
            const previousKeys = new Set(previous.keys());
            const currentKeys = new Set(current.keys());

            keys.keyDelta.add = [...setDifference(currentKeys, previousKeys)];
            keys.keyDelta.remove = [...setDifference(previousKeys, currentKeys)];

            const map: { [key: string]: Delta } = {};

            for (let [key, currentVal] of current) {
                const previousVal = previous.get(key) ?? deltaFunctions.stateFactory();
                const delta = deltaFunctions.create(previousVal, currentVal);
                map[key] = delta;
            }

            return { keys, map }
        }
    }
}

const spaceObjectMapDeltaFunctions = makeMapDeltaFunctions(spaceObjectDeltaFunctions);
const systemDeltaFunctions: DeltaFunctions<System, ISystemDelta> = {
    deltaFactory() {
        return new SystemDelta();
    },
    stateFactory: SystemFactory.base,
    apply(state, delta) {
        spaceObjectMapDeltaFunctions.apply(state.spaceObjects,
            { map: delta.spaceObjects, keys: delta.spaceObjectsKeys });
    },
    create(previous, current) {
        const delta = this.deltaFactory();
        const { map, keys } = spaceObjectMapDeltaFunctions.create(
            previous.spaceObjects, current.spaceObjects);

        delta.spaceObjects = map;
        delta.spaceObjectsKeys = keys;
        return delta;
    }
};

const systemMapDeltaFunctions = makeMapDeltaFunctions(systemDeltaFunctions);
export const engineDeltaFunctions: DeltaFunctions<Engine, IEngineDelta> = {
    deltaFactory() {
        return new EngineDelta();
    },
    stateFactory: EngineFactory.base,
    apply(state, delta) {
        systemMapDeltaFunctions.apply(state.systems,
            { map: delta.systems, keys: delta.systemsKeys });
    },
    create(previous, current) {
        const delta = this.deltaFactory();
        const { map, keys } = systemMapDeltaFunctions.create(
            previous.systems, current.systems);

        delta.systems = map;
        delta.systemsKeys = keys;
        return delta;
    }
}
