import { Stateful, StateIndexer, RecursivePartial, PartialState } from "./Stateful";
import { isEmptyObject } from "./EmptyObject";



type ObjectOf<T> = { [index: string]: T };
type Defined<T> = T extends undefined ? never : T;

//type NotArray<T> = T extends any[] ? never : T;
//type Extract<V> = V extends Stateful<(infer T)> ? T : never;

class StatefulMap<V extends Stateful<StateType>, StateType>
    extends Map<string, V>
    implements Stateful<ObjectOf<StateType>> {

	/**
	 * Maps this Map to an object with keys from this map and values 
	 * from applying `func`.
	 */
    private mapToObject<R>(func: (val: V, key?: string) => R): { [key: string]: R } {

        const output: { [key: string]: R } = {};
        for (let [key, val] of this) {
            output[key] = func(val, key);
        }
        return output;
    }

	/**
	 * Gets the states of all objects in `missing`
	 */
    private getSubstate(toGet: StateIndexer<ObjectOf<StateType>>): RecursivePartial<ObjectOf<StateType>> {
        const state: RecursivePartial<ObjectOf<StateType>> = {};
        for (let key of Object.keys(toGet)) {
            const substateToGet = toGet[key];
            const ourVal = this.get(key);
            if (ourVal === undefined) {
                throw new Error("Missing object of key " + key);
            }
            if (substateToGet === undefined) {
                throw new Error("Impossible: Object didn't have key from Object.keys");
            }
            else {
                state[key] = ourVal.getState(substateToGet)
            }
        }
        return state;
    }

	/**
	 * Gets the state, an object whose keys are the keys of this map
	 * and whose values are the result of calling each of this map's values'
	 * getState function.
	 */
    getState(toGet?: StateIndexer<ObjectOf<StateType>>): PartialState<ObjectOf<StateType>> {
        if (toGet && Object.entries(toGet).length > 0) {
            // An empty `toGet` object means get everything
            // since you wouldn't be asking for the state of nothing.
            return this.getSubstate(toGet)
        }
        else {
            return this.mapToObject((val: V) => {
                return val.getState();
            });
        }
    }

	/**
	 * Sets the state of the objects in the map whose keys appear in 
	 * `stateObject` to their corresponding new state in `stateObject`.
	 * If `stateObject` contains a key that this map does not contain,
	 * that key is included in the [[MissingObjects]] return value.
	 */
    setState(stateObject: PartialState<ObjectOf<StateType>>): StateIndexer<ObjectOf<StateType>> {
        // Sets the state of each key in `stateObject`
        const missing: StateIndexer<ObjectOf<StateType>> = {};
        for (let key of Object.keys(stateObject)) {
            const ourVal: V | undefined = this.get(key);
            if (ourVal != undefined) {
                const state = stateObject[key];
                if (state == undefined) {
                    throw new Error("Impossible");
                }

                const childMissing = ourVal.setState(state);
                if (Object.entries(childMissing).length !== 0) {
                    // Then the child is missing some objects. Include it
                    missing[key] = childMissing
                }
                // Otherwise, the child is not missing anything, so we don't include it
                // If we did include it, it would look like we were missing the whole child.
            }
            else {
                // This is okay since ReplaceWithEmptyObjects<T> always extends object
                // TypeScript should really detect this.
                missing[key] = {} as any;
            }
        }

        return missing;

    }
}

export { StatefulMap, ObjectOf }
