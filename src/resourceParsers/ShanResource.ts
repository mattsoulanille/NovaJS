import { Resource } from "resourceforkjs";
import { NovaResources } from "../ResourceHolderBase";
import { NovaResourceBase } from "./NovaResourceBase";



type ImageInfo = {
    ID: number,
    maskID: number,
    setCount: number,
    size: Array<number>,
    transparency: number;
};
function doImage(d: DataView, p: number, simple: boolean): ImageInfo {//10
    var o: ImageInfo = {
        ID: d.getInt16(p),
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


type ExitPoint = Array<Array<number>>;
type ExitPoints = {
    gun: ExitPoint,
    turret: ExitPoint,
    guided: ExitPoint,
    beam: ExitPoint,
    upCompress: Array<number>,
    downCompress: Array<number>
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

class ShanResource extends NovaResourceBase {
    baseImage: ImageInfo;
    altImage: ImageInfo;
    glowImage: ImageInfo;
    lightImage: ImageInfo;
    weapImage: ImageInfo;
    flags: Flags
    animDelay: number;
    weapDecay: number;
    framesPer: number;
    blink: Blink | null;
    shieldImage: ImageInfo;
    exitPoints: ExitPoints;
    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        var d = this.data;

        this.baseImage = doImage(d, 0, false);
        this.baseImage.transparency = d.getInt16(10);
        this.altImage = doImage(d, 12, false);
        this.glowImage = doImage(d, 22, true);
        this.lightImage = doImage(d, 30, true);
        this.weapImage = doImage(d, 38, true);

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

        this.shieldImage = doImage(d, 64, true);

        this.exitPoints = {
            gun: doPos(d, 72, 80, 144),
            turret: doPos(d, 88, 96, 152),
            guided: doPos(d, 104, 112, 160),
            beam: doPos(d, 120, 128, 168),
            upCompress: [d.getInt16(136), d.getInt16(138)],
            downCompress: [d.getInt16(140), d.getInt16(142)]
        };
    }
}


export { ShanResource };
