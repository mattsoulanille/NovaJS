import { Either } from "fp-ts/lib/Either";
import { Component, ComponentData, UnknownComponent } from "./component";
import { Entity } from "./entity";
import { EntityMap } from "./entity_map";
import { EcsEvent, EventData } from "./events";
import { ArgModifier, ArgModifierResult } from "./arg_modifier";
import { Query } from "./query";
import { Resource, ResourceData } from "./resource";
import { World } from "./world";

export const Entities = new Resource<EntityMap>('Entities');

export const Components = Symbol('Components');
export type ComponentsObject<T> = T extends typeof Components
    ? ReadonlyMap<string, UnknownComponent> : never;

export const UUID = Symbol('UUID');
export type UUIDData<T> = T extends typeof UUID ? string : never;

export const GetEntity = Symbol('Get Entity');
export type GetEntityObject<T> = T extends typeof GetEntity ? Entity : never;

export const GetArg = Symbol('Get Arg');
export type GetArgFunction = <T extends ArgTypes = ArgTypes>(arg: T)
    => Either<undefined, ArgData<T>>;
export type GetArgSelector<T> = T extends typeof GetArg ? GetArgFunction : never;

export const Emit = new Resource<EmitFunction>('Emit');
export type EmitFunction = <Data>(event: EcsEvent<Data, any>, data: Data,
    entities?: string[]) => void;

export const GetWorld = new Resource<World>('GetWorld');

export const RunQuery = new Resource<RunQueryFunction>('RunQuery');
export type RunQueryFunction = <T extends readonly ArgTypes[] = ArgTypes[]>(query: Query<T>, uuid?: string) => ArgsToData<T>[];

// Types for args that are used to define a system or query. Passed in a tuple.
export type ArgTypes = Component<any>
    | Query
    | Resource<any>
    | EcsEvent<any, any>
    | typeof Components
    | typeof UUID
    | typeof GetEntity
    | typeof GetArg
    | ArgModifier<readonly ArgTypes[], any>;

type AllowUndefined<T> = T extends undefined ? T : never;

export type ArgData<T> =
    ComponentData<T>
    | ResourceData<T>
    | QueryResults<T>
    | EventData<T>
    | ComponentsObject<T>
    | UUIDData<T>
    | GetEntityObject<T>
    | GetArgSelector<T>
    | ArgModifierResult<T>
    | AllowUndefined<T>;

export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

export type QueryArgs<Q> = Q extends Query<infer QueryArgs> ? QueryArgs : never;

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? ArgsToData<QueryArgs>[] : never;

export type ComponentsOnly<C> = C extends Component<any> ? C : never;
