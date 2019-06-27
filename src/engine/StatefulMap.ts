import { Stateful, MissingObjects, RecursivePartial } from "./Stateful";



type StateObject<T> = { [index: string]: T };

//type NotArray<T> = T extends any[] ? never : T;

class StatefulMap<V extends Stateful<T>, T>
    extends Map<string, V>
    implements Stateful<StateObject<T>> {

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
    private getMissing(missing: MissingObjects): StateObject<T> {
        const state: StateObject<T> = {};
        for (let key of Object.keys(missing)) {
            const ourVal = this.get(key);
            if (ourVal === undefined) {
                throw new Error("Missing object of key " + key);
            }
            else {
                state[key] = ourVal.getState(missing[key])
            }
        }
        return state;
    }

	/**
	 * Gets the state, an object whose keys are the keys of this map
	 * and whose values are the result of calling each of this map's values'
	 * getState function.
	 */
    getState(missing?: MissingObjects): StateObject<T> {
        if (missing && Object.entries(missing).length > 0) {
            // An empty missing object means everything is missing
            return this.getMissing(missing)
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
	 * that key is included in the [[MissingObjects]] retnnnurn value.
	 */
    setState(stateObject: RecursivePartial<StateObject<T>>): MissingObjects {
        // Sets the state of each key in `stateObject`
        const missing: MissingObjects = {};
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
                missing[key] = {};
            }
        }
        return missing;
    }
}

export { StatefulMap }
