import { Either } from "fp-ts/lib/Either";
import { Draft } from "immer";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMap } from "./entity_map";
import { EcsEvent, EventData } from "./events";
import { Modifier, ModifierResult } from "./modifier";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";

export const Entities = Symbol('Entities');
export type EntitiesObject<T> = T extends typeof Entities ? EntityMap : never;

export const Components = Symbol('Components');
export type ComponentsObject<T> = T extends typeof Components
    ? ReadonlyMap<string, UnknownComponent> : never;

export const UUID = Symbol('UUID');
export type UUIDData<T> = T extends typeof UUID ? string : never;

export const GetEntity = Symbol('Get Entity');
export type GetEntityObject<T> = T extends typeof GetEntity ? Entity : never;

export const GetArg = Symbol('Get Arg');
export type GetArgFunction<T extends ArgTypes = ArgTypes> = (arg: T)
    => Either<undefined, ArgData<T>>;
export type GetArgSelector<T> = T extends typeof GetArg ? GetArgFunction : never;

// Types for args that are used to define a system or query. Passed in a tuple.
export type ArgTypes = Component<any, any, any, any>
    | Query
    | Resource<any, any, any, any>
    | EcsEvent<any, any>
    | typeof Entities
    | typeof Components
    | typeof UUID
    | typeof GetEntity
    | typeof GetArg
    | Modifier<readonly ArgTypes[], any>;

type AllowUndefined<T> = T extends undefined ? T : never;

export type ArgData<T> =
    Draft<ComponentData<T> | ResourceData<T>>
    | QueryResults<T>
    | EventData<T>
    | EntitiesObject<T>
    | ComponentsObject<T>
    | UUIDData<T>
    | GetEntityObject<T>
    | GetArgSelector<T>
    | ModifierResult<T>
    | AllowUndefined<T>;


export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? ArgsToData<QueryArgs>[] : never;
