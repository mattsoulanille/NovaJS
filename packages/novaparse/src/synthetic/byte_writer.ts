import { encode_macroman } from "resource_fork/parse";

/**
 * Big-endian byte builder for Nova resource data, the writing twin of
 * resource_parsers/reader.ts: a resource is emitted field by field in the
 * exact order its parser reads it (which is the TMPL order documented in
 * docs/tmpl/tmpl_offsets.txt), so a writer function reads like the
 * template and the parser is its oracle.
 *
 * Every method is a pure function of its arguments — no clock, no
 * randomness, no host-dependent encoding — because the synthetic data set
 * built with it is checked in and must regenerate byte-identically on
 * every machine (see data_set.ts).
 */
export class ByteWriter {
    private readonly bytes: number[] = [];

    int8(value: number): this {
        this.bytes.push(value & 0xff);
        return this;
    }

    uint8(value: number): this {
        return this.int8(value);
    }

    int16(value: number): this {
        if (!Number.isInteger(value) || value < -32768 || value > 65535) {
            throw new Error(`${value} does not fit in 16 bits`);
        }
        this.bytes.push((value >> 8) & 0xff, value & 0xff);
        return this;
    }

    uint16(value: number): this {
        return this.int16(value);
    }

    int32(value: number): this {
        if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) {
            throw new Error(`${value} does not fit in 32 bits`);
        }
        this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff,
            (value >>> 8) & 0xff, value & 0xff);
        return this;
    }

    uint32(value: number): this {
        return this.int32(value);
    }

    /** A 64-bit flag set (TMPL QB64), e.g. Contribute/Require. */
    uint64(value: bigint): this {
        for (let shift = 56n; shift >= 0n; shift -= 8n) {
            this.bytes.push(Number((value >> shift) & 0xffn));
        }
        return this;
    }

    /**
     * A null-terminated MacRoman string in a fixed-size field (TMPL Cnnn
     * and the NovaTools nnnn NCB type). Always emits `byteLength` bytes;
     * the text must leave room for its terminator.
     */
    string(value: string, byteLength: number): this {
        const encoded = encode_macroman(value);
        if (encoded.length >= byteLength) {
            throw new Error(`"${value}" does not fit in ${byteLength} bytes`);
        }
        this.bytes.push(...encoded);
        for (let i = encoded.length; i < byteLength; i++) {
            this.bytes.push(0);
        }
        return this;
    }

    /** A null-terminated MacRoman string of whatever length it needs. */
    cstring(value: string): this {
        this.bytes.push(...encode_macroman(value), 0);
        return this;
    }

    /** A Pascal string (TMPL PSTR): a length byte then the MacRoman text. */
    pstring(value: string): this {
        const encoded = encode_macroman(value);
        if (encoded.length > 255) {
            throw new Error(`"${value}" is too long for a Pascal string`);
        }
        this.bytes.push(encoded.length, ...encoded);
        return this;
    }

    /** `count` zero bytes: padding, reserved and unused fields. */
    zeros(count: number): this {
        for (let i = 0; i < count; i++) {
            this.bytes.push(0);
        }
        return this;
    }

    raw(values: ArrayLike<number>): this {
        for (let i = 0; i < values.length; i++) {
            this.bytes.push(values[i] & 0xff);
        }
        return this;
    }

    /** `count` int16s: `values` in order, then `fill` for the rest. */
    int16s(count: number, values: readonly number[], fill: number): this {
        if (values.length > count) {
            throw new Error(`${values.length} values for a ${count}-entry field`);
        }
        for (let i = 0; i < count; i++) {
            this.int16(i < values.length ? values[i] : fill);
        }
        return this;
    }

    /** Zero-pads (never truncates) the data to `byteLength`. */
    padTo(byteLength: number): this {
        if (this.bytes.length > byteLength) {
            throw new Error(`${this.bytes.length} bytes written for a `
                + `${byteLength}-byte resource`);
        }
        return this.zeros(byteLength - this.bytes.length);
    }

    /** The data so far must be exactly `byteLength` long. */
    expect(byteLength: number): this {
        if (this.bytes.length !== byteLength) {
            throw new Error(`${this.bytes.length} bytes written for a `
                + `${byteLength}-byte resource`);
        }
        return this;
    }

    get length(): number {
        return this.bytes.length;
    }

    toArray(): number[] {
        return [...this.bytes];
    }
}
