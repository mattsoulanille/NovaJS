import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";

class BoomResource extends BaseResource {
    animationRate: number;
    sound: number | null;
    graphic: number;
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);

        var d = this.data;
        this.animationRate = d.getInt16(0);
        this.sound = d.getInt16(2);
        if (this.sound != -1) {
            this.sound += 300;
        }
        else {
            this.sound = null;
        }

        this.graphic = d.getInt16(4);
        if (this.graphic != -1) {
            this.graphic += 400;
        }
        else {
            throw new Error("Boom id " + this.id + " had no graphic");
        }

    }
}

export { BoomResource }
