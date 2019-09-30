import { isEmptyObject } from "./EmptyObject";
import { PartialState, StateIndexer } from "./Stateful";

type ValuesToGetters<T> = {
    [P in Exclude<keyof T, symbol | number>]?: (toGet: StateIndexer<T[P]>) => PartialState<T[P]>
}
type ValuesToSetters<T> = {
    [P in Exclude<keyof T, symbol | number>]?: (newVal: PartialState<T[P]>) => StateIndexer<T[P]> | void
}


//function objectMap<T extends Object, R>(o: T, f: (val: ) => 

// type Test<T> = {
//     [P in keyof T]:
//     T[P] extends any[] ? { [index: string]: string } :
//     T[P] extends object ? Test<T[P]> :
//     { [index: string]: string }
// }
// type T2 = keyof {};




function getStateFromGetters<StateType extends { [index: string]: unknown }>(
    toGet: StateIndexer<StateType>,
    getters: ValuesToGetters<StateType>): PartialState<StateType> {

    const empty = isEmptyObject(toGet);
    // This cast is okay since StateType is known to extend object and not any[]
    // so {} is assignable to PartialState<StateType> 
    const outputState: PartialState<StateType> = {} as any;
    for (let key of Object.keys(getters)) {

        let toGetForKey = toGet[key];
        //let toGetForKey = toGet[key];
        if (empty) {
            // Get everything
            toGetForKey = {}
        }
        else {
            // Only get what is requested
            toGetForKey = toGet[key];
        }
        if (toGetForKey !== undefined) {
            // These casts are okay since both `outputState` and
            // `getters` have index type {[index: string] : ...}

            let getter = getters[key];
            if (getter !== undefined) {
                (outputState as any)[key] = getter(toGetForKey as any);
            }

        }
    }
    return outputState;

}

//{ [index: string]: unknown }
function setStateFromSetters<StateType extends { [index: string]: unknown }>(
    toSet: PartialState<StateType>,
    setters: ValuesToSetters<StateType>): StateIndexer<StateType> {

    // This case is okay since StateType is an object, not an array.
    const outputIndexer: StateIndexer<StateType> = {} as any;


    for (let key of Object.keys(setters)) {


        // This cast is okay since RecursivePartial<StateType> is known to be an object
        // indexable by keyof StateType, which key is a member of

        let toSetForKey = toSet[key];
        if (toSetForKey !== undefined) {

            // This cast is okay since toSetForKey is an element of
            // PartialState of StateType, so setters[key] will accept it
            let setter = setters[key];
            if (setter !== undefined) {

                let v = setter(toSetForKey as any);
                if (v !== undefined && !isEmptyObject(v)) {
                    // (outputIndexer as any) is okay since key is in keyof StateType
                    (outputIndexer as any)[key] = v;
                }
            }
        }
    }
    return outputIndexer;


}

export { ValuesToGetters, ValuesToSetters, getStateFromGetters, setStateFromSetters };
