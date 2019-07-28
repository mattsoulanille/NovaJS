
// See https://stackoverflow.com/questions/41980195/recursive-partialt-in-typescript-2-1


// Allows any subset of object properties all the way down
// through all subobjects.o

type RecursivePartial<T> =
    T extends object ? {
        [P in keyof T]?: RecursivePartial<T[P]>
        //    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
        //    T[P] extends object ? RecursivePartial<T[P]> :
    } :
    T;



// type RecursivePartial<T> =
//     T extends any[] ? T :
//     T extends object ? {
//         [P in keyof T]?: RecursivePartial<T[P]>
//     } :
//     T;

// see https://stackoverflow.com/questions/41476063/typescript-remove-key-from-type-subtraction-type
// Gets the union of keys of T that are strings
type GetStringKeys<T> = {
    [P in keyof T]:
    P extends string ? P : never
}[keyof T];

// Recursively includes only the string keys in the object
type OnlyStringKeys<T> =
    T extends object ? Pick<{
        [P in keyof T]: OnlyStringKeys<T[P]>
    }, GetStringKeys<T>> :
    T;


//type test = OnlyStringKeys<{ "a": 4, 123: 5, "c": { "x": 3, "y": 5, 42: "hi" } }>;
//const t: test = { "a": 4, c: { x: 3, y: 5 } };

// TODO: Recursively require that T not use symbols
// A tree of the form of T but with each
// non-object value replaced with {}

// Totally a hack but we don't have exact types yet.
// Note that EmptyObject =/= {} since {} only requires 
// that all the keys it specifies have the corresponding
// values, and it specifies no keys, so it is the any object.
type EmptyObject = { [index: string]: never };
type ReplaceWithEmptyObjects<T> =
    T extends object ? {
        [P in keyof T]: ReplaceWithEmptyObjects<T[P]>
    } : EmptyObject;

// type T1 = keyof any; // string | number | symbol
// type T2 = keyof ReplaceWithEmptyObjects<any>; // string | number
// type T3 = keyof EmptyObject; // string | number
// type T4 = keyof OnlyStringKeys<any> // string | number | symbol ?????


// type ST = any;//{ [index: string]: unknown };
// type Ta = keyof ReplaceWithEmptyObjects<ST>;
// type Tb = keyof RecursivePartial<ST>;
// type T5 = keyof ReplaceWithEmptyObjects<ST[string]>;
// type T6 = keyof ReplaceWithEmptyObjects<ST>[string];

// type T7 = keyof RecursivePartial<ReplaceWithEmptyObjects<ST[string]>>;
// type T8 = keyof RecursivePartial<ReplaceWithEmptyObjects<ST>[string]>;


//    T[P] extends any[] ? {} :
//T[P] extends object ? ReplaceWithEmptyObjects<T[P]> : {}

// Indexes a subtree of the state tree
type StateIndexer<T> = RecursivePartial<ReplaceWithEmptyObjects<T>>;
type PartialState<StateType> = RecursivePartial<StateType>;

// type StateIndexer<T> =
//     T extends any[] ? {} :
//     T extends object ? {} | {
//         [P in keyof T]?: StateIndexer<T[P]>
//     } : {}

// type PartialState<T> = RecursivePartial<T>;

//type StateIndexer = { [index: string]: StateIndexer };
//type PartialState = { [index: string]: unknown };

interface Stateful<T> {
    getState(toGet?: StateIndexer<T>): PartialState<T>
    setState(state: PartialState<T>): StateIndexer<T>
}



export { Stateful, StateIndexer, RecursivePartial, ReplaceWithEmptyObjects, PartialState, OnlyStringKeys }
