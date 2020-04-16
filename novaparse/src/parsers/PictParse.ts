import { PictData } from "novajs/novadatainterface/PictData";
import { BaseData } from "novajs/novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { PictResource, PNGError } from "../resource_parsers/PictResource";
import { PNG } from "pngjs";
import { Defaults } from "novajs/novadatainterface/Defaults";


export interface PictImageMulti {
    pict: PictData;
    image: Buffer;
}

export async function PictImageMultiParse(pict: PictResource, notFoundFunction: (m: string) => void): Promise<PictImageMulti> {
    var base: BaseData = await BaseParse(pict, notFoundFunction);

    var png: Buffer
    try {
        png = PNG.sync.write(pict.png);
    }
    catch (e) {
        if (e instanceof PNGError) {
            notFoundFunction("PICT " + base.id + " failed to parse");
            png = Defaults.PictImage;
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
