import { Draft } from "immer";
import { Component, ComponentData } from "./component";
import { Entity } from "./entity";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";
import { CommandsInterface } from "./world";

export const Commands = Symbol();
export type CommandsObject<T> = T extends typeof Commands ? CommandsInterface : never;

export const UUID = Symbol();
export type UUIDData<T> = T extends typeof UUID ? string : never;

export const GetEntity = Symbol();
export type GetEntityObject<T> = T extends typeof GetEntity ? Entity : never;

export class OptionalClass<V extends Optionable> {
    constructor(readonly value: V) { };
    toString() {
        return `Optional(${this.value})`;
    }
}

export function Optional<V extends Optionable>(value: V) {
    return new OptionalClass(value);
}

// Types for args that are used to define a system or query. Passed in a tuple.
type ValueType = Component<any, any, any, any>
    | Query
    | Resource<any, any, any, any>
    | typeof Commands
    | typeof UUID
    | typeof GetEntity;

type Optionable = Component<any, any, any, any> | Resource<any, any>;
export type ArgTypes = ValueType | OptionalClass<Optionable>;

export type QueryArgTypes = Component<any, any, any, any>
    | OptionalClass<Component<any, any, any, any>>
    | typeof UUID
    | typeof GetEntity;

type DefiniteArgData<T> =
    Draft<ComponentData<T> | ResourceData<T>>
    | CommandsObject<T>
    | UUIDData<T>
    | GetEntityObject<T>;

type OptionalArgData<T> = T extends OptionalClass<infer V>
    ? DefiniteArgData<V> | undefined
    : never

// The type for recursive queries is not allowed in TypeScript,
// so separate them out here.
type QueryArgData<T> = DefiniteArgData<T> | OptionalArgData<T>;

// The data type corresponding to an argument type.
export type ArgData<T> = QueryArgData<T> | QueryResults<T>

export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

type QueryArgsToData<Args> = {
    [K in keyof Args]: QueryArgData<Args[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? QueryArgsToData<QueryArgs>[] : never;
