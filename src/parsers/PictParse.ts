import { PictData, DefaultPictData } from "novadatainterface/PictData";
import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { PictResource, PNGError } from "../resourceParsers/PictResource";
import { PNG } from "pngjs";
import { DefaultPictImageData } from "novadatainterface/PictImage";


type PictImageMulti = {
    pict: PictData,
    image: Buffer
}

async function PictImageMultiParse(pict: PictResource, notFoundFunction: (m: string) => void): Promise<PictImageMulti> {
    var base: BaseData = await BaseParse(pict, notFoundFunction);


    var png: Buffer
    try {
        png = PNG.sync.write(pict.png);
    }
    catch (e) {
        if (e instanceof PNGError) {
            notFoundFunction("PICT " + base.id + " failed to parse");
            png = DefaultPictImageData;
        }
        else {
            throw e;
        }
    }



    return {
        pict: base,
        image: png
    }
};

export { PictImageMultiParse, PictImageMulti };
