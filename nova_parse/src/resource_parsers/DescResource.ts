import { BaseResource } from "./NovaResourceBase";
import { NovaResources } from "./ResourceHolderBase";
import { Resource } from "resourceforkjs";


// https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String

function ab2str(data: DataView) {
    var arr: Array<number> = [];

    for (var i = 0; i < data.byteLength; i += 1) {
        var num = data.getUint8(i);
        if (num == 0) {
            // Got a null, so no more string
            break;
        }
        arr.push(data.getUint8(i));
    }

    return String.fromCharCode.apply(null, arr);
}


class DescResource extends BaseResource {
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
    }

    get text() {
        return ab2str(this.data);
    }

}

export { DescResource };
