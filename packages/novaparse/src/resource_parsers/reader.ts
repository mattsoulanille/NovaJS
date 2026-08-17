// From the browser-safe module (no fs), so the pilot parser can bundle
// for the browser through this reader.
import { decode_macroman } from "resource_fork/parse";

/**
 * Sequential reader for Nova resource data. Big-endian by default.
 *
 * Nova resources are fixed-layout structs, so parsers read fields in the
 * exact order they appear in the resource (which matches ResForge's TMPL
 * templates and the EVN Bible). Reading sequentially instead of via absolute
 * offsets keeps each parser trivially checkable against the template.
 *
 * The Windows `.plt` pilot format stores the same structs with little-endian
 * fields, so multi-byte reads honor an optional `littleEndian` flag. Strings
 * are byte streams and are unaffected.
 *
 * EV Nova tolerates resources shorter than the full template (fields past
 * the end of the data take their default values), so all reads past the end
 * of the resource return the given fallback instead of throwing.
 */
export class Reader {
    private pos = 0;
    private readonly littleEndian: boolean;

    constructor(private data: DataView,
        options: { littleEndian?: boolean } = {}) {
        this.littleEndian = options.littleEndian ?? false;
    }

    /** Bytes remaining after the cursor. */
    get remaining(): number {
        return this.data.byteLength - this.pos;
    }

    private advance(bytes: number): number | null {
        if (this.remaining < bytes) {
            // A truncated field is treated the same as a missing one.
            this.pos = this.data.byteLength;
            return null;
        }
        const at = this.pos;
        this.pos += bytes;
        return at;
    }

    int8(fallback = 0): number {
        const at = this.advance(1);
        return at === null ? fallback : this.data.getInt8(at);
    }

    uint8(fallback = 0): number {
        const at = this.advance(1);
        return at === null ? fallback : this.data.getUint8(at);
    }

    int16(fallback = 0): number {
        const at = this.advance(2);
        return at === null ? fallback : this.data.getInt16(at, this.littleEndian);
    }

    uint16(fallback = 0): number {
        const at = this.advance(2);
        return at === null ? fallback : this.data.getUint16(at, this.littleEndian);
    }

    int32(fallback = 0): number {
        const at = this.advance(4);
        return at === null ? fallback : this.data.getInt32(at, this.littleEndian);
    }

    uint32(fallback = 0): number {
        const at = this.advance(4);
        return at === null ? fallback : this.data.getUint32(at, this.littleEndian);
    }

    /**
     * A 64-bit flag set (TMPL QB64), such as Contribute/Require.
     */
    uint64(fallback = 0n): bigint {
        const at = this.advance(8);
        return at === null ? fallback : this.data.getBigUint64(at, this.littleEndian);
    }

    /**
     * A fixed-size field (TMPL Cnnn or the NovaTools nnnn NCB type) holding a
     * null-terminated MacRoman string. Always consumes `byteLength` bytes.
     */
    string(byteLength: number, fallback = ""): string {
        const at = this.advance(byteLength);
        if (at === null) {
            return fallback;
        }
        const bytes: number[] = [];
        for (let i = 0; i < byteLength; i++) {
            const byte = this.data.getUint8(at + i);
            if (byte === 0) {
                break;
            }
            bytes.push(byte);
        }
        return decode_macroman(bytes);
    }

    /**
     * A Pascal string (TMPL PSTR): a length byte followed by that many
     * bytes of MacRoman text.
     */
    pstring(fallback = ""): string {
        const lengthAt = this.advance(1);
        if (lengthAt === null) {
            return fallback;
        }
        const length = Math.min(this.data.getUint8(lengthAt), this.remaining);
        const at = this.advance(length)!;
        const bytes: number[] = [];
        for (let i = 0; i < length; i++) {
            bytes.push(this.data.getUint8(at + i));
        }
        return decode_macroman(bytes);
    }

    /** Skip padding / unused fields (TMPL Fnnn, FBYT, FWRD, FLNG). */
    skip(bytes: number): this {
        this.advance(bytes);
        return this;
    }

    /** Read `count` fields with `read`, e.g. `r.array(4, () => r.int16(-1))`. */
    array<T>(count: number, read: () => T): T[] {
        return Array.from({ length: count }, read);
    }
}
