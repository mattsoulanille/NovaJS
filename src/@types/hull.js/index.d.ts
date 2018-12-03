// Type definitions for convex-hull                                             
// Project: convex-hull                                                         
// Definitions by: Matthew Soulanille <https://github.com/mattsoulanille>       

// https://stackoverflow.com/questions/52489261/typescript-can-i-define-an-n-length-tuple-type

//type Tuple<TItem, TLength extends number> = [TItem, ...TItem[]] & { length: TLength };

//declare function ch<L extends number>(points: Array<Tuple<number, L>>): Array<Tuple<number, L>>;

// Not correct. Allows for different dimensions. Above is correct but doesn't compile for some reason.

declare function ch<L extends number>(points: Array<[number, number]>, concavity: number): Array<[number, number]>;

declare module "hull.js" {
    export = ch;
}

