import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";
import { NovaResourceBase } from "./NovaResourceBase";

class SpobResource extends NovaResourceBase {
    position: number[];
    graphic: number;
    flags: number;
    tribute: number;
    techLevel: number;
    specialTech: number[];
    government: number;
    landingPictID: number;
    landingDescID: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = resource.data;
        this.position = [d.getInt16(0), d.getInt16(2)];
        this.graphic = d.getInt16(4) + 2000;
        if (this.graphic > 2058) {
            this.graphic -= 1;
        }
        this.flags = d.getUint32(6);

        this.tribute = d.getInt16(10);
        this.techLevel = d.getInt16(12);
        this.specialTech = [
            d.getInt16(14),
            d.getInt16(16),
            d.getInt16(18)
        ];
        this.government = d.getInt16(20);
        this.landingPictID = d.getUint16(24);
        this.landingDescID = this.id;
    }

}



export { SpobResource }
