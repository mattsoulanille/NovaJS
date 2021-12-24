import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resourceforkjs";
import { PICTParse } from "./PICTParse";
import { PNG } from "pngjs";

class PNGError extends Error { };

class PictResource extends BaseResource {
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
    }

    get png(): PNG {
        var PICT: PICTParse;
        try {
            PICT = new PICTParse(this.data);
        }
        catch (e) {
            throw new PNGError("PICT id " + this.id + " failed to parse: " + e);
        }
        return PICT.PNG;
    }
}

export { PictResource, PNGError };

