import { PictData } from "novadatainterface/PictData";
import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { PictResource, PNGError } from "../resource_parsers/PictResource";
import { PNG } from "pngjs";
import { bufferToArrayBuffer } from "./buffer_to_array_buffer";

export interface PictImageMulti {
    pict: PictData;
    image: ArrayBuffer;
}

export async function PictImageMultiParse(pict: PictResource, notFoundFunction: (m: string) => void): Promise<PictImageMulti> {
    var base: BaseData = await BaseParse(pict, notFoundFunction);

    let png: ArrayBuffer;
    try {
        const buf = PNG.sync.write(pict.png);
        png = bufferToArrayBuffer(buf);
    }
    catch (e) {
        if (e instanceof PNGError) {
            notFoundFunction("PICT " + base.id + " failed to parse");
            png = new ArrayBuffer(0);
        }
        else {
            throw e;
        }
    }

    return {
        pict: base,
        image: png
    }
}
