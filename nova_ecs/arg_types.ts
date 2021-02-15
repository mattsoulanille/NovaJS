import { Draft } from "immer";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMap } from "./entity_map";
import { Modifier, ModifierResult } from "./modifier";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";

export const Entities = Symbol();
export type EntitiesObject<T> = T extends typeof Entities ? EntityMap : never;

export const Components = Symbol();
export type ComponentsObject<T> = T extends typeof Components
    ? ReadonlyMap<string, UnknownComponent> : never;

export const UUID = Symbol();
export type UUIDData<T> = T extends typeof UUID ? string : never;

export const GetEntity = Symbol();
export type GetEntityObject<T> = T extends typeof GetEntity ? Entity : never;

// Types for args that are used to define a system or query. Passed in a tuple.
export type ArgTypes = Component<any, any, any, any>
    | Query
    | Resource<any, any, any, any>
    | typeof Entities
    | typeof Components
    | typeof UUID
    | typeof GetEntity
    | Modifier<ArgTypes[], any>;

type OnlyUndefined<T> = T extends undefined ? T : never;

type DefiniteArgData<T> =
    Draft<ComponentData<T> | ResourceData<T>>
    | EntitiesObject<T>
    | ComponentsObject<T>
    | UUIDData<T>
    | GetEntityObject<T>
    | ModifierResult<T>
    | OnlyUndefined<T>;

// The data type corresponding to an argument type.
export type ArgData<T> = DefiniteArgData<T> | QueryResults<T>

export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

export type QueryArgsToData<Args> = {
    [K in keyof Args]: DefiniteArgData<Args[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? QueryArgsToData<QueryArgs>[] : never;
