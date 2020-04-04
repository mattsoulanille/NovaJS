import * as jspb from "google-protobuf";
import { Stateful } from "./Stateful";

export function setMapStates<Obj extends Stateful<State>, State>({ objects, states, keys, factory }:
    {
        objects: Map<string, Obj>,
        states: jspb.Map<string, State>,
        keys: string[],
        factory: (state: State) => Obj
    }) {

    // For some reason, states.entries is not iterable
    // Hence the forEach instead of a for loop.
    states.forEach((state, uuid) => {
        if (objects.has(uuid)) {
            // Update existing objects
            objects.get(uuid)?.setState(state);
        } else {
            // Create objects that don't exist
            objects.set(uuid, factory(state));
        }
    });

    for (const uuid of objects.keys()) {
        if (!keys.includes(uuid)) {
            // Delete objects that are not in the keys list
            objects.delete(uuid);
        }
    }
}

export function getMapStatesToProto<Obj extends Stateful<State>, State>({ fromMap, toMap, addKey }: {
    fromMap: Map<string, Obj>,
    toMap: jspb.Map<string, State>,
    addKey: (key: string) => void
}) {
    for (const [key, obj] of fromMap) {
        toMap.set(key, obj.getState());
        addKey(key);
    }
}
