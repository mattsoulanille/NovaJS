import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";



class NovaResourceBase {
    data: DataView;
    id: number;
    name: string;
    idSpace: NovaResources;
    globalID: string | null;

    constructor(resource: Resource, idSpace: NovaResources) {
        this.idSpace = idSpace;
        this.name = resource.name;
        this.id = resource.id;
        this.data = resource.data;
        this.globalID = null; // This is set by IDSpaceHandler in getIDSpaceUnsafe
    }
}


export { NovaResourceBase }
