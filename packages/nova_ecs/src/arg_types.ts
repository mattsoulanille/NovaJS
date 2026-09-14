import { Either } from "fp-ts/lib/Either.js";
import { Component, ComponentData, UnknownComponent } from "./component.js";
import { Entity } from "./entity.js";
import { EntityMap } from "./entity_map.js";
import { EcsEvent, EventData } from "./events.js";
import { ArgModifier, ArgModifierResult } from "./arg_modifier.js";
import { Query } from "./query.js";
import { ReadOnlyArg } from "./read_only.js";
import { Resource, ResourceData } from "./resource.js";
import { World } from "./world.js";

export const Entities = new Resource<EntityMap>('Entities');

export const Components = Symbol('Components');
export type ComponentsObject<T> = T extends typeof Components
    ? ReadonlyMap<string, UnknownComponent> : never;

export const UUID = Symbol('UUID');
export type UUIDData<T> = T extends typeof UUID ? string : never;

export const GetEntity = Symbol('Get Entity');
export type GetEntityObject<T> = T extends typeof GetEntity ? Entity : never;

/**
 * Resolves to a function that sets `component` on the current entity to
 * the given data — the write half of `GetEntity`, for systems (providers)
 * whose only reason to take the entity is to store a component. The
 * ambiguity report counts it as a write to that one component, not as a
 * reach of every component on the entity (#261).
 */
export class SetComponentArg<T> {
    constructor(readonly component: Component<T>) {}
}

/** An arg that can set `component` on the current entity, and nothing else. */
export function SetComponent<T>(component: Component<T>): SetComponentArg<T> {
    return new SetComponentArg(component);
}

/**
 * What `SetComponent(x)` resolves to: a setter already bound to `x`. It
 * takes the data alone — the component is fixed by the arg, so there is
 * no way to name a different one and write past the declaration.
 */
export type SetComponentFunction<T> = (data: T) => void;
export type SetComponentObject<T>
    = T extends SetComponentArg<infer Data> ? SetComponentFunction<Data> : never;

export const GetArg = Symbol('Get Arg');
export type GetArgFunction = <T extends ArgTypes = ArgTypes>(arg: T)
    => Either<undefined, ArgData<T>>;
export type GetArgSelector<T> = T extends typeof GetArg ? GetArgFunction : never;

export const Emit = new Resource<EmitFunction>('Emit');
export const EmitNow = new Resource<EmitFunction>('EmitNow');
export type EmitFunction = <Data>(event: EcsEvent<Data>, data: Data,
    entities?: (string | Entity)[]) => void;

export const GetWorld = new Resource<World>('GetWorld');

export const RunQuery = new Resource<RunQueryFunction>('RunQuery');
export type RunQueryFunction = <T extends readonly ArgTypes[] = ArgTypes[]>(query: Query<T>, uuid?: string) => ArgsToData<T>[];

// Types for args that are used to define a system or query. Passed in a tuple.
export type ArgTypes = Component<any>
    | Query
    | Resource<any>
    | EcsEvent<any>
    | typeof Components
    | typeof UUID
    | typeof GetEntity
    | SetComponentArg<any>
    | typeof GetArg
    | ArgModifier<readonly ArgTypes[], any>
    | ReadOnlyArg<ArgTypes, any>;

type AllowUndefined<T> = T extends undefined ? T : never;

/** `ReadOnly(x)` resolves to what `x` resolves to. */
type ReadOnlyData<T> = T extends ReadOnlyArg<ArgTypes, infer Data> ? Data : never;

export type ArgData<T> =
    ComponentData<T>
    | ResourceData<T>
    | QueryResults<T>
    | EventData<T>
    | ComponentsObject<T>
    | UUIDData<T>
    | GetEntityObject<T>
    | SetComponentObject<T>
    | GetArgSelector<T>
    | ArgModifierResult<T>
    | ReadOnlyData<T>
    | AllowUndefined<T>;

export type ArgsToData<Args> = {
    [K in keyof Args]: ArgData<Args[K]>
}

export type QueryArgs<Q> = Q extends Query<infer QueryArgs> ? QueryArgs : never;

export type QueryResults<Q> =
    Q extends Query<infer QueryArgs> ? ArgsToData<QueryArgs>[] : never;

export type ComponentsOnly<C> = C extends Component<any> ? C : never;
