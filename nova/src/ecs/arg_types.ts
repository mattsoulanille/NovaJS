import { Draft } from "immer";
import { Component, ComponentData } from "./component";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";
import { CommandsInterface } from "./world";

export const Commands = Symbol();
export type CommandsObject<T> = T extends typeof Commands ? CommandsInterface : never;

export const UUID = Symbol();
export type UUIDData<T> = T extends typeof UUID ? string : never;

export class OptionalClass<V> {
    constructor(readonly value: V) { };
}
export type OptionalValue<O> = O extends OptionalClass<infer V> ? V : never;

export function Optional<V>(value: V) {
    return new OptionalClass(value);
}

// Types for args that are used to define a system or query. Passed in a tuple.
type ValueType = Component<any, any>
    | Query
    | Resource<any, any>
    | typeof Commands
    | typeof UUID;

//export type ArgTypes = ValueType | OptionalClass<ValueType>;
export type ArgTypes = ValueType;


// The type for recursive queries is not allowed in TypeScript,
// so separate them out here.
type QueryArgData<T> = Draft<ComponentData<T> | ResourceData<T>> | CommandsObject<T> | UUIDData<T>;

// The data type corresponding to an argument type.
type ArgData<T> = QueryArgData<T> | Draft<QueryResults<T>>

export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

type QueryArgsToData<Args> = {
    [K in keyof Args]: QueryArgData<Args[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? QueryArgsToData<QueryArgs>[] : never;
