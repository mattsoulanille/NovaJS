import { Animation, DefaultAnimation } from "./Animation";
import { BaseData, DefaultBaseData } from "./BaseData";
import { SpaceObjectProperties, SpaceObjectData, DefaultSpaceObjectProperties, DefaultSpaceObjectData } from "./SpaceObjectData";


type ShipProperties = SpaceObjectProperties & {
    freeMass: number;
}

const DefaultShipProperties: ShipProperties = {
    ...DefaultSpaceObjectProperties,
    freeMass: 0
}

interface ShipData extends SpaceObjectData {
    properties: ShipProperties;
    pictID: string;
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
    properties: DefaultShipProperties,
    pictID: "default",
    desc: "default",
    outfits: {},
    initialExplosion: null,
    finalExplosion: null,
    largeExplosion: false,
    deathDelay: 1,
    displayWeight: 1
}


export { ShipData, DefaultShipData, ShipProperties, DefaultShipProperties };
