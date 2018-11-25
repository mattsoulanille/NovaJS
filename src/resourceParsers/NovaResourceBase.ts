import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";



class NovaResourceBase {
    data: DataView;
    id: number;
    name: string;
    idSpace: NovaResources;
    constructor(resource: Resource, idSpace: NovaResources) {
        this.idSpace = idSpace;
        this.name = resource.name;
        this.id = resource.id;
        this.data = resource.data;
    }
    get globalID(): string {
        return this.idSpace.prefix + ":" + this.id;
    }
}


export { NovaResourceBase }
