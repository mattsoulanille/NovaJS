import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";



// The general design pattern for these resource parsers is for all properties to be getters.
// This makes parsing happen just in time so that you don't, say, parse ALL of the pictures
// before you actually need them (thus delaying the game's startup time).
// This class is an exception, however, since none of its properties could easily
// be replaced with getters. 
class BaseResource {
    data: DataView;
    id: number;
    name: string;
    idSpace: NovaResources;
    private _globalID: string | null;
    private _prefix: string | null;

    constructor(resource: Resource, idSpace: NovaResources) {
        this.idSpace = idSpace;
        this.name = resource.name;
        this.id = resource.id;
        this.data = resource.data;
        this._globalID = null; // This is set by IDSpaceHandler in getIDSpaceUnsafe
        this._prefix = null;   // Same for this
    }
    get globalID(): string {
        if (this._globalID == null) {
            throw new Error("globalID of " + this.name + " was requested before it was set");
        }
        return this._globalID;
    }

    set globalID(id: string) {
        this._globalID = id;
    }

    get prefix(): string {
        if (this._prefix == null) {
            throw new Error("prefix of " + this.name + " was requested before it was set");
        }
        return this._prefix;
    }

    set prefix(id: string) {
        this._prefix = id;
    }

}


export { BaseResource }
