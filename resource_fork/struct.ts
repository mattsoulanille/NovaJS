type CodeMap = {
    x: null, // pad byte
    c: string, // char
    b: number, // signed char
    B: number, // unsigned char
    '?': boolean, // _Bool
    h: number, // short
    H: number, // unsigned short
    i: number, // int
    I: number, // unsigned int
    l: number, // long
    L: number, // unsigned long
    q: bigint, // long long
    Q: bigint, // unsigned long long
//    n: number, // ssize_t
//    N: number, // size_t
//    e: number, // IEEE 754 binary16 "half precision"
    f: number, // float
    d: number, // double
//    s: string, // char[]
//    p: string, // char[]
//    P: number, // void*
}

const decodeFuncs: {
    [K in keyof CodeMap]: (d: DataView, position: number, littleEndian: boolean)
        => [CodeMap[K], number]
} = {
    x: (_d, p) => [null, p + 1],
    c: (d, p) => [String.fromCharCode(d.getUint8(p)), p + 1],
    b: (d, p) => [d.getInt8(p), p + 1],
    B: (d, p) => [d.getUint8(p), p + 1],
    '?': (d, p) => [d.getUint8(p) > 0, p + 1],
    h: (d, p, e) => [d.getInt16(p, e), p + 2],
    H: (d, p, e) => [d.getUint16(p, e), p + 2],
    i: (d, p, e) => [d.getInt32(p, e), p + 4],
    I: (d, p, e) => [d.getUint32(p, e), p + 4],
    l: (d, p, e) => [d.getInt32(p, e), p + 4],
    L: (d, p, e) => [d.getUint32(p, e), p + 4],
    q: (d, p, e) => [d.getBigInt64(p, e), p + 8],
    Q: (d, p, e) => [d.getBigUint64(p, e), p + 8],
//    n: (d, p, e) => [d.get, p + ],
//    N: (d, p, e) => [d.get, p + ],
//    e: (d, p, e) => [d.get, p + ],
    f: (d, p, e) => [d.getFloat32(p, e), p + 4],
    d: (d, p, e) => [d.getFloat64(p, e), p + 8],
//    s: (d, p, e) => [d.get, p + ],
//    p: (d, p, e) => [d.get, p + ],
//    P: (d, p, e) => [d.get, p + ],
}

type CodeChar = keyof CodeMap;
//type Code = `${CodeChar | ''}${Code}`
//type Code<N> = `${CodeChar[]}`;

type TupleToString<T> = T extends [infer First, ...infer Rest]
    ? First extends string
    ? `${First}${TupleToString<Rest>}`
    : never : '';

type Asdf = TupleToString<['foo', 'bar', 'baz']>;

//type CodeString = TupleToString<CodeChar[]>
//type StructCode = `${'<' | '>'}${CodeString}`;

type StructCodeToArray<T> = T extends `${'<' | '>'}${infer Code}` ? Decode<Code> : never;

// TODO: This type combinatorially explodes.
type Decode<T> = T extends `${infer C}${infer Rest}`
    ? C extends CodeChar
    ? CodeMap[C] extends null ? Decode<Rest>
    : [CodeMap[C], ...Decode<Rest>] : [] : [];

//type CodeStringVerify<T extends string> = T extends `${infer C}${infer Rest}`
//    ? C extends CodeChar ? [CodeMap[C], ...CodeStringVerify<Rest>] : [] : [];

type StructCode<T extends string> = T extends `${'<' | '>'}${infer Code}` ?
    Decode<Code> extends any[] ? T : never : never;

//type ToTuple<T> = T extends `${infer A}

// type Is<T extends U, U> = T;
// type Decode2<T> = T extends `${Is<infer C, Code>}${infer Rest}`
//     ? [CodeMap[C], ...Decode2<Rest>] : [];

//type foof = Decode2<'xcbBhiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiQqqqqqqqqqqqqQQQQQ'>
//type foo = Decode2<'xcbBhiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii?'>
//type bar = Decode<string>;

//type StructCode<T> = Decode<T> extends never ? never : T;

// https://stackoverflow.com/questions/67184269/truly-recursive-template-literal-for-comma-separated-strings-in-typescript
export function unpack<T extends string>(code: T extends StructCode<T> ? T : never,
                                         data: DataView, position = 0): [StructCodeToArray<T>, number] {

    const littleEndian = code[0] === '<';
    const result: Array<CodeMap[keyof CodeMap]> = [];
    for (let i = 1; i < code.length; i++) {
        const c = code[i] as keyof CodeMap;
        const decodeFunc = decodeFuncs[c];
        if (!decodeFunc) {
            throw new Error(`No decoder for code '${c}'`);
        }
        const [r, newPosition] = decodeFunc(data, position, littleEndian);
        position = newPosition;
        if (r !== null) {
            result.push(r);
        }
    }
    return [result as StructCodeToArray<T>, position];
}
