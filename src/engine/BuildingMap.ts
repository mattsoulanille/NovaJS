import { Stateful, RecursivePartial, StateIndexer } from "./Stateful";
import { StatefulMap, ObjectOf } from "./StatefulMap";



type EntriesType<V> = readonly (readonly [string, V])[] | null | undefined;

class BuildingMap<V extends Stateful<StateType>, StateType>
    extends StatefulMap<V, StateType> {
    private buildFromState: (state: StateType) => V;
    private getFullState: (maybeState: RecursivePartial<StateType>) => undefined | StateType;


    constructor(
        buildFromState: (state: StateType) => V,
        getFullState: (maybeState: RecursivePartial<StateType>) => StateType | undefined,
        entries?: EntriesType<V>) {

        super(entries)
        this.buildFromState = buildFromState;
        this.getFullState = getFullState;
    }

    /**
     * See StatefulMap.ts. In addition, `setState` builds any objects
	 * for which the following are true:
     * 1. The object is not in the map
     * 2. The object's entry in `stateObject` is complete (not a partial)
     */
    setState(stateObject: RecursivePartial<ObjectOf<StateType>>): StateIndexer<ObjectOf<StateType>> {
        let missing = super.setState(stateObject);

        for (let key of Object.keys(missing)) {
            let val = missing[key];

            // Check for keys with {} values.
            // They indicate places where this map does not
            // have the object corresponding to the key
            if (val && (Object.keys(val).length === 0)) {
                let state = stateObject[key];
                if (state == undefined) {
                    // Impossible
                    throw new Error("Appeared in missing state"
                        + " but not in original state object");
                }

                // Extract a full state from the partial state
                // if possible. Then, use it to build the
                // missing object.
                let fullState = this.getFullState(state)
                if (fullState !== undefined) {
                    // Build the object from the full state
                    this.set(key, this.buildFromState(fullState));

                    // Delete its entry in `missing` because we
                    // are no longer missing it.
                    delete missing[key];
                }
                else {
                    // If we don't have a full state, leave
                    // the entry as {} in missing so that the
                    // server will send us the full state.
                }
            }
        }
        return missing;
    }
}


export { BuildingMap }
