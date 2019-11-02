import { Animation, DefaultAnimation } from "./Animation";
import { BaseData, DefaultBaseData } from "./BaseData";
import { SpaceObjectPhysics, SpaceObjectData, DefaultSpaceObjectPhysics, DefaultSpaceObjectData } from "./SpaceObjectData";


type ShipPhysics = SpaceObjectPhysics & {
    freeMass: number;
    freeCargo: number;
}

const DefaultShipPhysics: ShipPhysics = {
    ...DefaultSpaceObjectPhysics,
    freeMass: 0,
    freeCargo: 0
}

interface ShipData extends SpaceObjectData {
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


const DefaultShipData: ShipData = {
    ...DefaultSpaceObjectData,
    physics: DefaultShipPhysics,
    pict: "default",
    desc: "default",
    outfits: {},
    initialExplosion: null,
    finalExplosion: null,
    largeExplosion: false,
    deathDelay: 1,
    displayWeight: 1
}


export { ShipData, DefaultShipData, ShipPhysics, DefaultShipPhysics };
