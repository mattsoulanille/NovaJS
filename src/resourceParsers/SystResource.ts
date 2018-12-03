import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";

class SystResource extends BaseResource {
    position: number[];
    links: Set<number>;
    spobs: number[];
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;

        this.position = [d.getInt16(0), d.getInt16(2)];

        this.links = new Set();
        for (let i = 0; i < 16; i++) {
            var link = d.getInt16(4 + i * 2);
            if (link >= 128) {
                this.links.add(link);
            }
        }

        this.spobs = [];
        for (let i = 0; i < 16; i++) {
            var spob = d.getInt16(36 + i * 2);
            if (spob >= 128) {
                this.spobs.push(spob);
            }
        }
    }
}

export { SystResource }
