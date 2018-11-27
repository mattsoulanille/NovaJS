import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "../ResourceHolderBase";
import { Resource } from "resourceforkjs";
import { PICTParse } from "./PICTParse";

class PictResource extends BaseResource {
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
    }


    get png() {
        var PICT: PICTParse;
        try {
            PICT = new PICTParse(this.data);
        }
        catch (e) {
            throw new Error("PICT id " + this.id + " failed to parse: " + e.message);
        }
        return PICT.PNG;
    }


}

export { PictResource };

