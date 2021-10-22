import { Either } from "fp-ts/lib/Either";
import { ArgData, ArgsToData, ArgTypes } from "./arg_types";
import { Query } from "./query";


type Transform<Args extends readonly any[], Result> =
    (...args: ArgsToData<Args>) => Either<undefined, ArgData<Result>>;

export type UnknownArgModifier = ArgModifier<readonly ArgTypes[], unknown>;
export type AnyArgModifier = ArgModifier<any, any>;

export class ArgModifier<Args extends readonly ArgTypes[], Result> {
    query: Query<Args>;
    transform: Transform<Args, Result>;
    constructor({ query, transform }:
        { query: Query<Args>, transform: Transform<Args, Result> }) {
        this.query = query;
        this.transform = transform
    }
}

export type ArgModifierResult<M> = M extends ArgModifier<any, infer Result> ? ArgData<Result> : never;
