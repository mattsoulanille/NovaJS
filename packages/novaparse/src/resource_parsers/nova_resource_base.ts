import { Resource } from "resource_fork";
import { NovaResources } from "./resource_holder_base.js";



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
    private _writerPrefix: string | null;

    constructor(resource: Resource, idSpace: NovaResources) {
        this.idSpace = idSpace;
        this.name = resource.name;
        this.id = resource.id;
        this.data = resource.data;
        this._globalID = null; // This is set by IDSpaceHandler in getIDSpaceUnsafe
        this._prefix = null;   // Same for this
        this._writerPrefix = null; // And this
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

    /**
     * The id prefix of the plug-in (or "nova" for the base data) whose file
     * this resource was read from. Differs from `prefix` exactly when a
     * plug-in overrides a stock resource: the resource then lives at
     * "nova:<id>" (prefix "nova") but was written by the plug-in. Anything
     * that must resolve in the writing plug-in's namespace — the
     * Require/Contribute flag bits today, plug-in control bits next —
     * keys off this rather than `prefix`.
     */
    get writerPrefix(): string {
        if (this._writerPrefix == null) {
            throw new Error("writerPrefix of " + this.name + " was requested before it was set");
        }
        return this._writerPrefix;
    }

    /** `writerPrefix`, or null if it was never set (hand-made resources). */
    get writerPrefixIfSet(): string | null {
        return this._writerPrefix;
    }

    set writerPrefix(id: string) {
        this._writerPrefix = id;
    }

}


export { BaseResource }
