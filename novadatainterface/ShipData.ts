import { Animation, getDefaultAnimation } from "./Animation";
import { BaseData, getDefaultBaseData } from "./BaseData";
import { SpaceObjectPhysics, SpaceObjectData, getDefaultSpaceObjectPhysics, getDefaultSpaceObjectData } from "./SpaceObjectData";


export interface ShipPhysics extends SpaceObjectPhysics {
    freeMass: number;
    freeCargo: number;
}

export function getDefaultShipPhysics(): ShipPhysics {
    return {
        ...getDefaultSpaceObjectPhysics(),
        freeMass: 0,
        freeCargo: 0
    }
}

export interface ShipData extends SpaceObjectData {
    physics: ShipPhysics;
    pict: string;
    desc: string;
    outfits: { [index: string]: number }
    initialExplosion: string | null;
    finalExplosion: string | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
};

export function getDefaultShipData(): ShipData {
    return {
        ...getDefaultSpaceObjectData(),
        physics: getDefaultShipPhysics(),
        pict: "default",
        desc: "default",
        outfits: {},
        initialExplosion: null,
        finalExplosion: null,
        largeExplosion: false,
        deathDelay: 1,
        displayWeight: 1
    }
}
