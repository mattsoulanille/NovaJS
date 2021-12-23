import { BaseResource } from "./NovaResourceBase";
import { NovaResources, NovaResourceType } from "./ResourceHolderBase";
import { Resource } from "resourceforkjs";


// These take up little space and take little time to parse, so
// they can be stored directly.
class SpinResource extends BaseResource {
    spriteID: number;
    maskID: number;
    spriteSize: Array<number>;
    spriteTiles: Array<number>;
    imageType: NovaResourceType;
    usedFor: string;
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);

        var d = this.data;
        this.spriteID = d.getInt16(0);
        this.maskID = d.getInt16(2);
        this.spriteSize = [];
        this.spriteSize[0] = d.getInt16(4);
        this.spriteSize[1] = d.getInt16(6);
        this.spriteTiles = [];
        this.spriteTiles[0] = d.getInt16(8);
        this.spriteTiles[1] = d.getInt16(10);
        this.imageType = NovaResourceType.rlëD; // for now until picts can be used properly
        this.usedFor = "Unknown";


        // What the resource is used for (Not sure if this is ever used)
        if (this.spriteID >= 400 && this.spriteID <= 463) {
            this.usedFor = "Explosion";
        }
        if (this.spriteID == 500) {
            this.usedFor = "Cargo box";
        }
        if (this.spriteID >= 501 && this.spriteID <= 504) {
            this.usedFor = "Mineral";
        }
        if (this.spriteID >= 600 && this.spriteID <= 605) {
            this.usedFor = "Main menu button";
        }
        if (this.spriteID == 606) {
            this.usedFor = "Main screen logo";
        }
        if (this.spriteID == 607) {
            this.usedFor = "Main screen rollover image";
        }
        if (this.spriteID >= 608 && this.spriteID <= 610) {
            this.usedFor = "Main screen sliding button";
        }
        if (this.spriteID == 650) {
            this.usedFor = "Target cursor";
        }
        if (this.spriteID == 700) {
            this.usedFor = "Starfield";
        }
        if (this.spriteID >= 800 && this.spriteID <= 815) {
            this.usedFor = "Asteriod";
        }
        if (this.spriteID >= 1000 && this.spriteID <= 1255) {
            this.usedFor = "Stellar object";
        }
        if (this.spriteID >= 3000 && this.spriteID <= 3255) {
            this.usedFor = "Weapon";
        }

    }
}


export { SpinResource }
