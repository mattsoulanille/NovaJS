import { BaseResource } from "./nova_resource_base.js";
import { NovaResources } from "./resource_holder_base.js";
import { Resource } from "resource_fork";
import { decode_macroman } from "resource_fork";
import { Reader } from "./reader.js";

/**
 * A dësc (description) resource.
 *
 * Field layout follows ResForge's dësc template (documented in the EVN Bible
 * pp. 22-23): a null-terminated Description string, then a Graphic ('PICT'
 * int16), a Movie Filename (C020), and a 16-bit Flags field. Because the
 * leading string is variable length, the trailing fields' offsets are not
 * fixed, so `Reader` (which only reads fixed-size fields) cannot handle the
 * string. The text is therefore read directly from the DataView up to its
 * null terminator, after which a `Reader` over the remaining bytes reads the
 * fixed-size trailing fields exactly like every other parser.
 *
 * Most dëscs in real data are truncated right after their text, so the
 * trailing fields fall back to their defaults.
 */
class DescResource extends BaseResource {
    /** 'PICT' id shown alongside the text in mission briefings; -1 = none. */
    graphic: number;
    /** QuickTime movie filename shown before the briefing; "" = none. */
    movieFile: string;
    /**
     * 16-bit flag set:
     *   0x0001 show movie after the description instead of before,
     *   0x0002 show movie at double size,
     *   0x0004 cinematic (blank background, fade screen).
     */
    flags: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);

        // Read the null-terminated Description string directly (Reader only
        // handles fixed-size fields; this leading field is variable length).
        const bytes: number[] = [];
        let i = 0;
        for (; i < this.data.byteLength; i++) {
            const byte = this.data.getUint8(i);
            if (byte === 0) {
                break;
            }
            bytes.push(byte);
        }
        this._text = decode_macroman(bytes);

        // Continue reading the fixed-size trailing fields from just past the
        // string's null terminator. `i` points at the terminator (or the end
        // of the data, in which case the Reader over an empty view yields the
        // fallbacks below for the truncated fields).
        const after = Math.min(i + 1, this.data.byteLength);
        const r = new Reader(new DataView(
            this.data.buffer,
            this.data.byteOffset + after,
            this.data.byteLength - after));

        this.graphic = r.int16(-1);
        this.movieFile = r.string(0x20);
        this.flags = r.uint16();
    }

    private _text: string;

    get text() {
        return this._text;
    }

    /**
     * Settable so IDSpaceHandler can rewrite the control-bit references
     * inside "{bXXX ...}" conditionals to their namespaced physical numbers
     * (see ncb_namespace.ts); nothing else writes it.
     */
    set text(text: string) {
        this._text = text;
    }

}

export { DescResource };
