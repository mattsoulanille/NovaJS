import { Either } from "fp-ts/lib/Either.js";
import { ArgData, ArgsToData, ArgTypes, GetArg } from "./arg_types.js";
import { UnknownComponent } from "./component.js";
import { Query } from "./query.js";


type Transform<Args extends readonly any[], Result> =
    (...args: ArgsToData<Args>) => Either<undefined, ArgData<Result>>;

export type UnknownArgModifier = ArgModifier<readonly ArgTypes[], unknown>;
export type AnyArgModifier = ArgModifier<any, any>;

export class ArgModifier<Args extends readonly ArgTypes[], Result> {
    query: Query<Args>;
    transform: Transform<Args, Result>;
    /**
     * The components whose add / change / delete on an entity can change
     * what this modifier resolves to for that entity — the modifier's
     * contribution to its enclosing query's staleness set (see
     * `Query.referencedComponents`). `null` means unknown: the transform
     * can read arbitrary args (e.g. it holds a raw `GetArg` and the
     * factory declared nothing), so the query cache must conservatively
     * invalidate its results on every component event.
     *
     * Factories whose transform resolves args beyond the modifier
     * query's own (`Optional` fetches its wrapped arg through `GetArg`)
     * declare them via `extraComponents`. Passing `extraComponents:
     * null` explicitly marks the modifier as unknown.
     */
    readonly referencedComponents: ReadonlySet<UnknownComponent> | null;
    /**
     * The args the transform resolves through its raw `GetArg`, for
     * the ambiguity report (ambiguities.ts): with this declared, the
     * modifier reaches its query's other args plus these, instead of
     * "anything" (which is what an undeclared `GetArg` must be taken
     * to mean). `Optional(x)` declares `[x]`.
     */
    readonly reaches: readonly ArgTypes[] | undefined;
    constructor({ query, transform, extraComponents, reaches }: {
        query: Query<Args>, transform: Transform<Args, Result>,
        extraComponents?: ReadonlySet<UnknownComponent> | null,
        reaches?: readonly ArgTypes[],
    }) {
        this.query = query;
        this.transform = transform;
        this.reaches = reaches;
        if (extraComponents === null) {
            this.referencedComponents = null;
        } else if (extraComponents === undefined
            && query.args.includes(GetArg)) {
            // The transform gets a raw getArg and declared nothing about
            // what it fetches with it: assume it can read anything.
            this.referencedComponents = null;
        } else if (query.referencedComponents === null) {
            this.referencedComponents = null;
        } else if (extraComponents === undefined) {
            this.referencedComponents = query.referencedComponents;
        } else {
            this.referencedComponents = new Set(
                [...query.referencedComponents, ...extraComponents]);
        }
    }
}

export type ArgModifierResult<M> = M extends ArgModifier<any, infer Result> ? ArgData<Result> : never;
