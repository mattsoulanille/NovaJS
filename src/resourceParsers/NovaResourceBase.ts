import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";



// The general design pattern for these resource parsers is for all properties to be getters.
// This makes parsing happen just in time so that you don't, say, parse ALL of the pictures
// before you actually need them (thus delaying the game's startup time).
// This class is an exception, however, since none of its properties could easily
// be replaced with getters. 
class NovaResourceBase {
    data: DataView;
    id: number;
    name: string;
    idSpace: NovaResources;
    globalID: string | null;
    prefix: string | null;

    constructor(resource: Resource, idSpace: NovaResources) {
        this.idSpace = idSpace;
        this.name = resource.name;
        this.id = resource.id;
        this.data = resource.data;
        this.globalID = null; // This is set by IDSpaceHandler in getIDSpaceUnsafe
        this.prefix = null;   // Same for this
    }
}


export { NovaResourceBase }
