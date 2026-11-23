/**
 * Encodes resources into the classic Mac resource-fork format that
 * parse.ts reads (Inside Macintosh: More Macintosh Toolbox, "Resource
 * Manager", "Format of a Resource Fork"). Test fixtures use it to build
 * plug-in files with exactly the resources (and defects) a spec needs,
 * instead of checking in opaque binaries.
 */
import { encode_macroman } from "./parse.js";

export interface ResourceSpec {
    /** Four-character type, e.g. "wëap" (MacRoman-encodable). */
    type: string;
    /** Signed 16-bit resource id. */
    id: number;
    name?: string;
    data: ArrayLike<number>;
}

export interface BuildResourceForkOptions {
    /**
     * Where resource data starts. The default, 16, puts it right after the
     * header (the most compact legal fork). The Mac Resource Manager itself
     * writes 256: the 16-byte header, then 240 reserved bytes (112 for the
     * system, 128 for the application), then the data. EV Nova's own pilot
     * files use 256, so writers that hand a file to the original game do too.
     */
    dataOffset?: number;
}

export function buildResourceFork(resources: ResourceSpec[],
    options: BuildResourceForkOptions = {}): ArrayBuffer {
    // Resource data: a 4-byte length then the bytes, in input order.
    const dataOffsets: number[] = [];
    const dataBytes: number[] = [];
    for (const { data } of resources) {
        dataOffsets.push(dataBytes.length);
        pushUint32(dataBytes, data.length);
        for (let i = 0; i < data.length; i++) {
            dataBytes.push(data[i] & 0xff);
        }
    }

    // Group by type, keeping first-appearance order of types.
    const byType = new Map<string, number[]>();
    resources.forEach((resource, index) => {
        let list = byType.get(resource.type);
        if (!list) {
            list = [];
            byType.set(resource.type, list);
        }
        list.push(index);
    });

    // Name list: Pascal strings, offsets relative to the list start.
    const nameBytes: number[] = [];
    const nameOffsets = resources.map(({ name }) => {
        if (!name) {
            return 0xffff;
        }
        const encoded = encode_macroman(name);
        if (encoded.length > 255) {
            throw new Error(`Resource name "${name}" is too long`);
        }
        const offset = nameBytes.length;
        nameBytes.push(encoded.length);
        for (const byte of encoded) {
            nameBytes.push(byte);
        }
        return offset;
    });

    // Type list: count-1, then 8 bytes per type (type, count-1, offset of
    // its reference list relative to the type list), then the reference
    // lists (12 bytes per resource).
    const typeList: number[] = [];
    pushUint16(typeList, byType.size - 1);
    let refListOffset = 2 + 8 * byType.size;
    for (const [type, indices] of byType) {
        const encoded = encode_macroman(type);
        if (encoded.length !== 4) {
            throw new Error(`Resource type "${type}" must be 4 bytes`);
        }
        typeList.push(...encoded);
        pushUint16(typeList, indices.length - 1);
        pushUint16(typeList, refListOffset);
        refListOffset += 12 * indices.length;
    }
    for (const indices of byType.values()) {
        for (const index of indices) {
            pushInt16(typeList, resources[index].id);
            pushUint16(typeList, nameOffsets[index]);
            typeList.push(0); // attributes
            const dataOffset = dataOffsets[index];
            typeList.push((dataOffset >> 16) & 0xff);
            pushUint16(typeList, dataOffset & 0xffff);
            pushUint32(typeList, 0); // handle (runtime only)
        }
    }

    // Map: a copy of the header, next-map handle (4), file ref (2),
    // attributes (2), then the type list and name list offsets.
    const headerLength = 16;
    const typeListOffset = 28;
    const nameListOffset = typeListOffset + typeList.length;
    const mapLength = nameListOffset + nameBytes.length;
    const dataOffset = options.dataOffset ?? headerLength;
    if (dataOffset < headerLength) {
        throw new Error(`dataOffset must be at least ${headerLength}`);
    }
    const mapOffset = dataOffset + dataBytes.length;

    const header: number[] = [];
    pushUint32(header, dataOffset);
    pushUint32(header, mapOffset);
    pushUint32(header, dataBytes.length);
    pushUint32(header, mapLength);

    const map: number[] = [...header, 0, 0, 0, 0, 0, 0, 0, 0];
    pushUint16(map, typeListOffset);
    pushUint16(map, nameListOffset);

    // Copied with set(), not spread: a whole data file (megabytes) is far
    // past the engine's argument-count limit.
    const out = new Uint8Array(mapOffset + map.length + typeList.length
        + nameBytes.length);
    out.set(header, 0);
    out.set(dataBytes, dataOffset);
    out.set(map, mapOffset);
    out.set(typeList, mapOffset + map.length);
    out.set(nameBytes, mapOffset + map.length + typeList.length);
    return out.buffer;
}

function pushUint16(out: number[], value: number) {
    out.push((value >> 8) & 0xff, value & 0xff);
}

function pushInt16(out: number[], value: number) {
    pushUint16(out, value & 0xffff);
}

function pushUint32(out: number[], value: number) {
    out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff,
        (value >>> 8) & 0xff, value & 0xff);
}
