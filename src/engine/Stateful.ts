
// See https://stackoverflow.com/questions/41980195/recursive-partialt-in-typescript-2-1


// Allows any subset of object properties all the way down
// through all subobjects.o
type RecursivePartial<T> = {
    [P in keyof T]?:
    //    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    //    T[P] extends object ? RecursivePartial<T[P]> :
    RecursivePartial<T[P]>
};

// A tree of the form of T but with each
// non-object value replaced with {}
type ReplaceWithEmptyObjects<T> =
    T extends any[] ? {} :
    T extends object ? {
        [P in keyof T]: ReplaceWithEmptyObjects<T[P]>
    } : {}

//    T[P] extends any[] ? {} :
//T[P] extends object ? ReplaceWithEmptyObjects<T[P]> : {}

type test = ReplaceWithEmptyObjects<number[]>

// Indexes a subtree of the state tree
type StateIndexer<T> = RecursivePartial<ReplaceWithEmptyObjects<T>>;


interface Stateful<StateType> {
    getState(toGet?: StateIndexer<StateType>): StateType
    setState(state: RecursivePartial<StateType>): StateIndexer<StateType>
}

export { Stateful, StateIndexer, RecursivePartial }
