import { Either } from "fp-ts/lib/Either";
import { ArgData, ArgsToData, ArgTypes } from "./arg_types";
import { Query } from "./query";


type GetArg = (arg: unknown) => Either<undefined, unknown>;

type Transform<Args extends any[], Result> = (getArg: GetArg, ...args: ArgsToData<Args>)
    => Either<undefined, Result>

export type UnknownModifier = Modifier<ArgTypes[], unknown>;

export class Modifier<Args extends ArgTypes[], Result> {
    query: Query<Args>;
    transform: Transform<Args, Result>;
    constructor({ query, transform }:
        { query: Query<Args>, transform: Transform<Args, Result> }) {
        this.query = query;
        this.transform = transform
    }
}

export type ModifierResult<M> = M extends Modifier<any, infer Result> ? ArgData<Result> : never;
