import { Either } from "fp-ts/lib/Either";
import { ArgData, ArgsToData, ArgTypes, GetArgFunction } from "./arg_types";
import { Query } from "./query";


type Transform<Args extends readonly any[], Result> =
    (...args: ArgsToData<Args>) => Either<undefined, ArgData<Result>>;

export type UnknownModifier = Modifier<ArgTypes[], unknown>;

export class Modifier<Args extends readonly ArgTypes[], Result> {
    query: Query<Args>;
    transform: Transform<Args, Result>;
    constructor({ query, transform }:
        { query: Query<Args>, transform: Transform<Args, Result> }) {
        this.query = query;
        this.transform = transform
    }
}

export type ModifierResult<M> = M extends Modifier<any, infer Result> ? ArgData<Result> : never;
