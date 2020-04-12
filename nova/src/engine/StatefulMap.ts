import * as jspb from "google-protobuf";
import { Stateful } from "./Stateful";
import { MapKeys } from "novajs/nova/src/proto/map_keys_pb";
import { setDifference } from "novajs/nova/src/common/SetUtils";
import { Subject } from "rxjs";

export interface MapState<State> {
    map: jspb.Map<string, State>;
    mapKeys: MapKeys;
}

interface Delta {
    add: Set<string>;
    remove: Set<string>;
}

export class StatefulMap<T extends Stateful<State>, State> extends Map<string, T> implements Stateful<MapState<State>> {

    public desync = new Subject<string>();

    constructor(private factory: () => T,
        private warn: (m: string) => unknown = console.warn) {
        super();
    }

    getState(): MapState<State> {
        const entries = [...this.entries()];
        const states: Array<[string, State]> = entries.map(
            ([key, value]: [string, T]) => {
                return [key, value.getState()];
            });

        const mapKeys = new MapKeys();
        const keySet = new MapKeys.KeySet();
        keySet.setKeyList([...this.keys()]);
        mapKeys.setKeyset(keySet);

        return {
            map: new jspb.Map<string, State>(states),
            mapKeys
        };
    }

    setState({ map, mapKeys }: MapState<State>): void {
        let delta: Delta | undefined;
        if (mapKeys.hasKeyset()) {
            const keys = new Set(this.keys());
            const newKeys = new Set(mapKeys.getKeyset()!.getKeyList());

            delta = {
                add: setDifference(newKeys, keys),
                remove: setDifference(keys, newKeys),
            }
        } else if (mapKeys.hasKeydelta()) {
            const keyDelta = mapKeys.getKeydelta()!;
            delta = {
                add: new Set(keyDelta.getAddList()),
                remove: new Set(keyDelta.getRemoveList()),
            };
        }

        if (delta) {
            for (let addKey of delta.add) {
                this.set(addKey, this.factory());
            }

            for (let removeKey of delta.remove) {
                this.delete(removeKey);
            }
        }

        map.forEach((state, key) => {
            if (this.has(key)) {
                this.get(key)!.setState(state);
            } else if (delta && delta.remove.has(key)) {
                this.warn(`StatefulMap given state with key '${key}' `
                    + `but that key is being removed.`);
            } else {
                // Assume we desynced and are missing a valid key
                this.warn(`Probable desync. Missing key '${key}'`);
                this.desync.next(key);
            }
        });
    }
}




/*
export function setMapStates<Obj extends Stateful<State>, State>({ objects, states, keys, factory }:
    {
        objects: Map<string, Obj>,
        states: jspb.Map<string, State>,
        keys: MapKeys
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

    if (keys.hasKeylist()) {
        for (const uuid of objects.keys()) {
            if (!keys.includes(uuid)) {
                // Delete objects that are not in the keys list
                objects.delete(uuid);
            }
        }
    }

*/
