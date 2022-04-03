import { Resource } from "resource_fork";
import { NovaResources } from "./ResourceHolderBase";
import { BaseResource } from "./NovaResourceBase";
import { ExitPoint, ExitPoints } from "../../../novadatainterface/Animation";



type ImageInfo = {
    ID: number,
    maskID: number,
    setCount: number,
    size: Array<number>,
    transparency: number;
};
function doImage(d: DataView, p: number, simple: boolean): ImageInfo | null {//10
    var id = d.getInt16(p);

    if (id <= 0) {
        return null;
    }

    var o: ImageInfo = {
        ID: id,
        maskID: d.getInt16(p + 2),
        setCount: 0,
        size: [],
        transparency: 0
    };

    if (!simple) {
        o.setCount = d.getInt16(p + 4);
        p += 2;
    }

    o.size = [d.getInt16(p + 4), d.getInt16(p + 6)];

    return o;
};

// Can not return null
function doImageRequired(d: DataView, p: number, simple: boolean): ImageInfo {
    var result = doImage(d, p, simple);
    if (result == null) {
        throw new Error("Required image was null");
    }
    else {
        return result;
    }
};


function doPos(d: DataView, px: number, py: number, pz: number): ExitPoint {
    var o: ExitPoint = [];
    for (var i = 0; i < 4; i++) {
        o[i] = [d.getInt16(2 * i + px), d.getInt16(2 * i + py), d.getInt16(2 * i + pz)];
    }
    return o;
}



type Flags = {
    extraFramePurpose: string,
    displayEngineGlowWhenTurning: boolean,
    stopAnimationWhenDisabled: boolean,
    hideAltSpritesWhenDisabled: boolean,
    hideLightsWhenDisabled: boolean,
    unfoldWhenFiring: boolean,
    adjustForOffset: boolean
}

type Blink = {
    mode: string,
    a: number,
    b: number,
    c: number,
    d: number
}

type ShanImages = {
    [index: string]: ImageInfo | null,
    baseImage: ImageInfo, // All Shans must have a base image
    altImage: ImageInfo | null,
    glowImage: ImageInfo | null,
    lightImage: ImageInfo | null,
    weapImage: ImageInfo | null,
    shieldImage: ImageInfo | null
}

class ShanResource extends BaseResource {
    images: ShanImages;
    flags: Flags;
    animDelay: number;
    weapDecay: number;
    framesPer: number;
    blink: Blink | null;
    exitPoints: ExitPoints;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = this.data;

        this.images = {
            baseImage: doImageRequired(d, 0, false),
            altImage: doImage(d, 12, false),
            glowImage: doImage(d, 22, true),
            lightImage: doImage(d, 30, true),
            weapImage: doImage(d, 38, true),
            shieldImage: doImage(d, 64, true)
        };

        if (this.images.baseImage) {
            this.images.baseImage.transparency = d.getInt16(10);
        }


        var flagN = d.getInt16(46);
        this.flags = {
            extraFramePurpose: "unknown",
            displayEngineGlowWhenTurning: false,
            stopAnimationWhenDisabled: (flagN & 0x10) > 0,
            hideAltSpritesWhenDisabled: (flagN & 0x20) > 0,
            hideLightsWhenDisabled: (flagN & 0x40) > 0,
            unfoldWhenFiring: (flagN & 0x80) > 0,
            adjustForOffset: (flagN & 0x100) > 0
        };

        if (flagN & 0x1)
            this.flags.extraFramePurpose = "banking";
        if (flagN & 0x2)
            this.flags.extraFramePurpose = "folding";
        if (flagN & 0x4)
            this.flags.extraFramePurpose = "keyCarried";
        if (flagN & 0x8)
            this.flags.extraFramePurpose = "animation";

        if ((flagN & 0x3) == 3) {
            this.flags.extraFramePurpose = "banking";
            this.flags.displayEngineGlowWhenTurning = true;
        }

        this.animDelay = d.getInt16(48);
        this.weapDecay = d.getInt16(50);
        this.framesPer = d.getInt16(52);

        this.blink = null;
        var modeN = d.getInt16(54);
        if (modeN !== -1 && modeN !== 0) {
            this.blink = {
                mode: "unknown",
                a: d.getInt16(56),
                b: d.getInt16(58),
                c: d.getInt16(60),
                d: d.getInt16(62)
            };
            switch (modeN) {
                case 1:
                    this.blink.mode = "square";
                    break;
                case 2:
                    this.blink.mode = "triangle";
                    break;
                case 3:
                    this.blink.mode = "random";
                    break;
            }
        }


        // upCompress and downCompress values are assumed to be 100 if they are 0
        this.exitPoints = {
            gun: doPos(d, 72, 80, 144),
            turret: doPos(d, 88, 96, 152),
            guided: doPos(d, 104, 112, 160),
            beam: doPos(d, 120, 128, 168),
            upCompress: [d.getInt16(136) || 100, d.getInt16(138) || 100],
            downCompress: [d.getInt16(140) || 100, d.getInt16(142) || 100]
        };
    }
}


export { ShanResource };
