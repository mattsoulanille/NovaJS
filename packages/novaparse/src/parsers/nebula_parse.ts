import { NebulaData, NebulaImage } from "novadatainterface/nebula_data";
import { NebuResource } from "../resource_parsers/nebu_resource.js";
import { BaseResource } from "../resource_parsers/nova_resource_base.js";
import { BaseParse } from "./base_parse.js";

/** The first nëbu's first PICT: "the first nebula's PICTs are 9500-96". */
export const NEBULA_FIRST_PICT = 9500;
/** "Each nebula can have up to seven PICT resources associated with it". */
export const NEBULA_PICTS_PER_NEBULA = 7;

/** The PICT ids of a nëbu's seven slots, from its resource number. */
export function nebulaPictIds(nebulaId: number): number[] {
    const first = NEBULA_FIRST_PICT + NEBULA_PICTS_PER_NEBULA * (nebulaId - 128);
    return Array.from({ length: NEBULA_PICTS_PER_NEBULA }, (_, i) => first + i);
}

/**
 * A PICT's pixel size from its QuickDraw picFrame (bytes 2..9: top, left,
 * bottom, right), without decoding the picture. 0x0 when the header is
 * cut short.
 */
export function pictFrameSize(pict: BaseResource): { width: number, height: number } {
    const data = pict.data;
    if (data.byteLength < 10) {
        return { width: 0, height: 0 };
    }
    const top = data.getInt16(2);
    const left = data.getInt16(4);
    const bottom = data.getInt16(6);
    const right = data.getInt16(8);
    return {
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

/**
 * Maps a parsed nëbu onto NebulaData. The pictures are looked up in the
 * nëbu's OWN id space — a plug-in's nebula finds its plug-in's PICTs, and a
 * stock one stock's, the same rule as every other derived PICT (përs
 * HailPict, shïp target renders). The ActiveOn / OnExplore expressions
 * arrive already rewritten into physical bits by the control-bit
 * namespacing (ncb_namespace.ts NCB_FIELDS), like every other NCB field.
 */
export async function NebulaParse(nebu: NebuResource,
    notFoundFunction: (m: string) => void): Promise<NebulaData> {
    const base = await BaseParse(nebu, notFoundFunction);
    const images: NebulaImage[] = [];
    for (const pictId of nebulaPictIds(nebu.id)) {
        const pict = nebu.idSpace.PICT[pictId];
        if (!pict) {
            continue;
        }
        images.push({ id: pict.globalID, ...pictFrameSize(pict) });
    }
    return {
        ...base,
        position: [nebu.xPos, nebu.yPos],
        size: [nebu.xSize, nebu.ySize],
        activeOn: nebu.activeOn,
        onExplore: nebu.onExplore,
        images,
    };
}
