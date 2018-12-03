import { PictData, DefaultPictData } from "novadatainterface/PictData";
import { BaseData } from "novadatainterface/BaseData";
import { BaseParse } from "./BaseParse";
import { PictResource, PNGError } from "../resourceParsers/PictResource";
import { PNG } from "pngjs";


async function PictParse(pict: PictResource, notFoundFunction: (m: string) => void): Promise<PictData> {
    var base: BaseData = await BaseParse(pict, notFoundFunction);


    var png: Buffer
    try {
        png = PNG.sync.write(pict.png);
    }
    catch (e) {
        if (e instanceof PNGError) {
            notFoundFunction("PICT " + base.id + " failed to parse");
            png = DefaultPictData.PNG;
        }
        else {
            throw e;
        }
    }


    return {
        ...base,
        PNG: png
    }
};

export { PictParse };
