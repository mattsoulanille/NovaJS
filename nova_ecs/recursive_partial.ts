import { Either, isRight } from 'fp-ts/Either';
import * as t from 'io-ts';

// Copied from https://github.com/gcanti/io-ts/blob/master/src/index.ts
// May break if io-ts changes. Probably a terrible idea!
function isTypeC(codec: t.Any): codec is t.TypeC<t.Props> {
    return (codec as any)._tag === 'InterfaceType';
}

function MakeOptional(T: t.Any) {
    return t.union([T, t.undefined]);
}

function MakeRecursivePartial<T extends t.Any>(ioType: T):
    t.Type<RecursivePartial<t.TypeOf<typeof ioType>>,
        RecursivePartial<t.TypeOf<typeof ioType>>,
        unknown> {

    if (isTypeC(ioType)) {
        //const optional: { [K in keyof T]?: T[K] } = {};
        const optional: { [index: string]: t.Any } = {};
        for (let [key, value] of Object.entries(ioType.props)) {
            optional[key] = MakeOptional(MakeRecursivePartial(value));
        }
        return t.type(optional) as any;
    }
    else if (ioType instanceof t.DictionaryType) {
        return t.record(
            ioType.domain,
            MakeOptional(MakeRecursivePartial(ioType.codomain))) as any;

    }
    else if ((ioType instanceof t.IntersectionType)
        || (ioType instanceof t.UnionType)) {

        let newTypes: t.Any[] = [];
        for (let i in [...ioType.types]) {
            newTypes[i] = MakeRecursivePartial(ioType.types[i])
        }
        if (newTypes.length < 2) {
            throw Error("Intersection of less than 2 types");
        }
        // It complains about not having enough entries
        // if you don't cast to `any`, but we know
        // there are at least 2 in `newTypes`
        if (ioType instanceof t.IntersectionType) {
            return t.intersection(newTypes as any);
        }
        else {
            return t.union(newTypes as any);
        }
    }
    else {
        return ioType;
    }
}

function clearUndefined(v: unknown) {
    if (v instanceof Object) {
        for (let [key, value] of Object.entries(v)) {
            if (value === undefined) {
                delete (v as any)[key];
            }
            else {
                clearUndefined((v as any)[key]);
            }
        }
    }
}

function MakeRecursivePartialParser<T extends t.Any>(T: T): (v: unknown) => Either<t.Errors, RecursivePartial<t.TypeOf<typeof T>>> {
    const decoder = MakeRecursivePartial(T)
    return (v: unknown) => {
        const decoded = decoder.decode(v);
        if (isRight(decoded)) {
            const value = decoded.right;
            clearUndefined(value);
            return t.success(value);
        }
        else {
            return decoded;
        }
    }
}

export function RecursivePartial<T extends t.Any>(ioType: T): t.Type<
    RecursivePartial<t.TypeOf<typeof ioType>>,
    RecursivePartial<t.TypeOf<typeof ioType>>,
    unknown> {

    const parser = MakeRecursivePartialParser(ioType);
    const io_ts_type = MakeRecursivePartial(ioType);
    type TStatic = RecursivePartial<t.TypeOf<typeof ioType>>;

    return new t.Type<
        TStatic,
        TStatic,
        unknown>(
            "RecursivePartial<" + ioType.name + ">",
            function(u: unknown): u is TStatic {
                return io_ts_type.is(u).valueOf();
            },
            function(input: unknown) {
                return parser(input)
            },
            t.identity
        );
}

export type RecursivePartial<T> =
    T extends object ? {
        [P in keyof T]?: RecursivePartial<T[P]>
        //    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
        //    T[P] extends object ? RecursivePartial<T[P]> :
    } :
    T;


export function getRecursiveDelta<T extends Record<string, unknown>>(a: T, b: T): RecursivePartial<T> {
    const delta = {} as RecursivePartial<T>;

    for (const key in b) {
        if (a[key] === b[key]) {
            continue;
        }



    }
}


export function applyRecursiveDelta<T extends Record<string, unknown>>(data: T, delta: RecursivePartial<T>) {
    for (const key in delta) {
        if (data[key] instanceof Object &&
            delta[key] instanceof Object) {
            applyRecursiveDelta((data as any)[key], delta[key]);
        }
        else {
            data[key] = delta[key] as T[typeof key];
        }
    }
}


