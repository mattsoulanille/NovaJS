import { DefaultMap } from "./utils";

export class BinSet<T> {
    bits: number[] = [];

    constructor(readonly binSetCollection: BinSetCollection<T>) { }

    add(val: T) {
        this.binSetCollection.add(this, val);
    }

    delete(val: T) {
        this.binSetCollection.delete(this, val);
    }

    toSet(): Set<T> {
        return this.binSetCollection.toSet(this);
    }

    isSubsetOf(other: BinSet<T>) {
        return this.binSetCollection.subset(this, other);
    }
};

// JavaScript treats all numbers as 32 bit integers for bitwise ops.
const BITS_PER_NUMBER = 32;

export class BinSetCollection<T> {
    private bitMap: DefaultMap<T, number>;
    private currentBit = 0;

    constructor() {
        this.bitMap = new DefaultMap(() => this.currentBit++);
    }

    of(s: ReadonlySet<T>): BinSet<T> {
        const binSet = new BinSet(this);
        for (const val of s) {
            binSet.add(val);
        }

        return binSet;
    }

    private getIndexAndVal(val: T) {
        const bit = this.bitMap.get(val);
        const bitIndex = Math.floor(bit / BITS_PER_NUMBER);
        const bitVal = 1 << (bit % BITS_PER_NUMBER);
        return [bitIndex, bitVal];
    }

    add(s: BinSet<T>, val: T) {
        const [bitIndex, bitVal] = this.getIndexAndVal(val);
        s.bits[bitIndex] |= bitVal;
    }

    delete(s: BinSet<T>, val: T) {
        const [bitIndex, bitVal] = this.getIndexAndVal(val);
        s.bits[bitIndex] &= ~bitVal;
    }

    toSet(binSet: BinSet<T>): Set<T> {
        const s = new Set<T>();
        for (const val of this.bitMap.keys()) {
            const [bitIndex, bitVal] = this.getIndexAndVal(val);
            if (binSet.bits[bitIndex] & bitVal) {
                s.add(val);
            }
        }
        return s;
    }

    subset(a: BinSet<T>, b: BinSet<T>): boolean {
        if (a.binSetCollection !== b.binSetCollection) {
            throw new Error('Cannot compare BinSetVals across BinSets');
        }

        const len = Math.max(a.bits.length, b.bits.length);
        for (let i = 0; i < len; i++) {
            if (((a.bits[i] ?? 0) | (b.bits[i] ?? 0)) !== (b.bits[i] ?? 0)) {
                return false;
            }
        }
        return true;
    }
}

export const BinSetC = new BinSetCollection<any>();
