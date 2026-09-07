/**
 * ============================================================================
 * Avro binary primitives
 * ============================================================================
 *
 * The byte-level half of the in-house Avro codec (avro_binary.ts): a
 * growable writer and a bounds-checked reader for the primitive
 * encodings the Avro specification defines —
 *
 *   int / long   zig-zag, then base-128 varint, little end first
 *   float        4 bytes IEEE 754, little-endian
 *   double       8 bytes IEEE 754, little-endian
 *   string       long byte length, then UTF-8
 *   bytes        long byte length, then the bytes
 *
 * — plus the varint COUNT that arrays, maps and the dynamic encoding
 * (dynamic_encoding.ts) use. Numbers stay JavaScript doubles: a long is
 * carried exactly up to ±2^53 (Number.MAX_SAFE_INTEGER, the range io-ts
 * `t.Int` and WireTick admit) without BigInt, by splitting the value at
 * the 2^32 boundary the bit operators stop at.
 *
 * Reads are bounds-checked: a truncated or hostile buffer throws a
 * RangeError, which decodeWire (wire_codec.ts) reports as a decode
 * failure like any other.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const TWO_32 = 2 ** 32;
const TWO_53 = 2 ** 53;

/** The UTF-8 byte length of `text`, as TextEncoder will produce it. */
function utf8Length(text: string): number {
    let length = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            length += 1;
        } else if (code < 0x800) {
            length += 2;
        } else if (code >= 0xd800 && code <= 0xdbff
            && i + 1 < text.length) {
            const next = text.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                // A surrogate pair: one 4-byte sequence.
                length += 4;
                i++;
                continue;
            }
            // A lone high surrogate encodes as U+FFFD (3 bytes).
            length += 3;
        } else {
            length += 3;
        }
    }
    return length;
}

export class ByteWriter {
    private buffer: Uint8Array;
    private view: DataView;
    length = 0;

    constructor(capacity = 256) {
        this.buffer = new Uint8Array(capacity);
        this.view = new DataView(this.buffer.buffer);
    }

    private ensure(extra: number) {
        const needed = this.length + extra;
        if (needed <= this.buffer.length) {
            return;
        }
        let capacity = this.buffer.length * 2;
        while (capacity < needed) {
            capacity *= 2;
        }
        const grown = new Uint8Array(capacity);
        grown.set(this.buffer.subarray(0, this.length));
        this.buffer = grown;
        this.view = new DataView(grown.buffer);
    }

    writeByte(byte: number) {
        this.ensure(1);
        this.buffer[this.length++] = byte;
    }

    /** A non-negative safe integer as a base-128 varint. */
    writeVarint(value: number) {
        if (!(value >= 0 && value < TWO_53) || !Number.isInteger(value)) {
            throw new RangeError(`not a non-negative safe integer: ${value}`);
        }
        this.ensure(10);
        let n = value;
        if (n < TWO_32) {
            while (n >= 0x80) {
                this.buffer[this.length++] = (n & 0x7f) | 0x80;
                n >>>= 7;
            }
            this.buffer[this.length++] = n;
            return;
        }
        while (n >= 0x80) {
            this.buffer[this.length++] = (n % 0x80) | 0x80;
            n = Math.floor(n / 0x80);
        }
        this.buffer[this.length++] = n;
    }

    /**
     * An Avro int or long: zig-zag, then varint. Safe integers only.
     * The zig-zagged value of a safe integer needs 54 bits, one more
     * than a double carries exactly, so it is formed and shifted as two
     * 32-bit halves.
     */
    writeZigZag(value: number) {
        if (!Number.isSafeInteger(value)) {
            throw new RangeError(`not a safe integer: ${value}`);
        }
        if (value >= 0 && value < 0x40000000) {
            // The common case: fits in 31 bits after zig-zag.
            let n = value * 2;
            this.ensure(5);
            while (n >= 0x80) {
                this.buffer[this.length++] = (n & 0x7f) | 0x80;
                n >>>= 7;
            }
            this.buffer[this.length++] = n;
            return;
        }
        // zigzag(n) = 2n for n >= 0, and 2|n| - 1 for n < 0.
        const magnitude = value < 0 ? -value : value;
        let lo = (magnitude % TWO_32) * 2;
        let hi = Math.floor(magnitude / TWO_32) * 2;
        if (lo >= TWO_32) {
            lo -= TWO_32;
            hi += 1;
        }
        if (value < 0) {
            if (lo === 0) {
                lo = TWO_32 - 1;
                hi -= 1;
            } else {
                lo -= 1;
            }
        }
        lo >>>= 0;
        hi >>>= 0;
        this.ensure(10);
        while (hi !== 0 || lo >= 0x80) {
            this.buffer[this.length++] = (lo & 0x7f) | 0x80;
            lo = ((lo >>> 7) | ((hi & 0x7f) << 25)) >>> 0;
            hi >>>= 7;
        }
        this.buffer[this.length++] = lo;
    }

    writeFloat(value: number) {
        this.ensure(4);
        this.view.setFloat32(this.length, value, true);
        this.length += 4;
    }

    writeDouble(value: number) {
        this.ensure(8);
        this.view.setFloat64(this.length, value, true);
        this.length += 8;
    }

    /** An Avro string: its byte length as a long, then UTF-8. */
    writeString(text: string) {
        const byteLength = utf8Length(text);
        this.writeZigZag(byteLength);
        this.ensure(byteLength);
        textEncoder.encodeInto(text, this.buffer.subarray(this.length, this.length + byteLength));
        this.length += byteLength;
    }

    /** Avro bytes: the length as a long, then the bytes. */
    writeBytes(bytes: Uint8Array) {
        this.writeZigZag(bytes.length);
        this.ensure(bytes.length);
        this.buffer.set(bytes, this.length);
        this.length += bytes.length;
    }

    /** A copy of what has been written. */
    bytes(): Uint8Array {
        return this.buffer.slice(0, this.length);
    }

    /**
     * A VIEW of what has been written, valid until the next write:
     * for a caller that copies it out at once (OPAQUE.write), sparing
     * the copy `bytes()` makes.
     */
    written(): Uint8Array {
        return this.buffer.subarray(0, this.length);
    }
}

export class ByteReader {
    private readonly view: DataView;
    position = 0;

    constructor(readonly bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    get remaining(): number {
        return this.bytes.length - this.position;
    }

    private need(count: number) {
        if (this.position + count > this.bytes.length) {
            throw new RangeError(`truncated: needed ${count} bytes at offset `
                + `${this.position} of ${this.bytes.length}`);
        }
    }

    readByte(): number {
        this.need(1);
        return this.bytes[this.position++]!;
    }

    /** A base-128 varint, up to 2^53. */
    readVarint(): number {
        let value = 0;
        let scale = 1;
        for (let i = 0; i < 10; i++) {
            const byte = this.readByte();
            value += (byte & 0x7f) * scale;
            if ((byte & 0x80) === 0) {
                if (value >= TWO_53) {
                    throw new RangeError('varint beyond the safe integer range');
                }
                return value;
            }
            scale *= 0x80;
        }
        throw new RangeError('varint longer than 10 bytes');
    }

    /**
     * An Avro int or long, as a safe integer. Accumulated as two 32-bit
     * halves (see writeZigZag); a value outside the safe range is
     * refused rather than rounded.
     */
    readZigZag(): number {
        let lo = 0;
        let hi = 0;
        let shift = 0;
        for (let i = 0; i < 10; i++) {
            const byte = this.readByte();
            const bits = byte & 0x7f;
            if (shift < 32) {
                lo = (lo | (bits << shift)) >>> 0;
                if (shift > 25) {
                    // The chunk straddles the halves.
                    hi = (hi | (bits >>> (32 - shift))) >>> 0;
                }
            } else {
                hi = (hi | (bits << (shift - 32))) >>> 0;
            }
            if ((byte & 0x80) === 0) {
                const negative = (lo & 1) === 1;
                // Shift the pair right by one: the magnitude, minus one
                // for a negative value.
                const halfLo = ((lo >>> 1) | ((hi & 1) << 31)) >>> 0;
                const halfHi = hi >>> 1;
                const magnitude = halfHi * TWO_32 + halfLo;
                const value = negative ? -magnitude - 1 : magnitude;
                if (!Number.isSafeInteger(value)) {
                    throw new RangeError('long beyond the safe integer range');
                }
                return value;
            }
            shift += 7;
        }
        throw new RangeError('varint longer than 10 bytes');
    }

    /**
     * A length (an Avro long) that must be backed by at least one byte
     * per item, so a hostile count cannot make the reader allocate
     * ahead of the bytes it will fail on.
     */
    readCount(): number {
        const count = this.readZigZag();
        if (count < 0 || count > this.remaining) {
            throw new RangeError(`count ${count} exceeds the ${this.remaining} bytes left`);
        }
        return count;
    }

    readFloat(): number {
        this.need(4);
        const value = this.view.getFloat32(this.position, true);
        this.position += 4;
        return value;
    }

    readDouble(): number {
        this.need(8);
        const value = this.view.getFloat64(this.position, true);
        this.position += 8;
        return value;
    }

    readString(): string {
        const length = this.readCount();
        const text = textDecoder.decode(
            this.bytes.subarray(this.position, this.position + length));
        this.position += length;
        return text;
    }

    /** A copy of the length-prefixed bytes. */
    readBytes(): Uint8Array {
        const length = this.readCount();
        const bytes = this.bytes.slice(this.position, this.position + length);
        this.position += length;
        return bytes;
    }
}
