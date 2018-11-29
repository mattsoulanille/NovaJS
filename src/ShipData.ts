import { Animation, DefaultAnimation } from "./Animation";
import { BaseData, DefaultBaseData } from "./BaseData";


type ShipProperties = {
    [index: string]: number | boolean,
    shield: number;
    shieldRecharge: number;
    armor: number;
    armorRecharge: number;
    energy: number;
    energyRecharge: number;
    ionization: number;
    deionize: number
    speed: number;
    acceleration: number;
    turnRate: number;
    mass: number;
    freeMass: number;
}

const DefaultShipProperties: ShipProperties = {
    shield: 100,
    shieldRecharge: 10,
    armor: 100,
    armorRecharge: 0,
    energy: 200,
    energyRecharge: 10,
    ionization: 100,
    deionize: 10,
    speed: 300,
    acceleration: 300,
    turnRate: 3,
    mass: 100,
    freeMass: 0
}

interface ShipData extends BaseData {
    properties: ShipProperties;
    pictID: string;
    desc: string;
    animation: Animation;
    outfits: { [index: string]: number }
    initialExplosion: string | null;
    finalExplosion: string | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
};


const DefaultShip: ShipData = {
    ...DefaultBaseData,
    properties: DefaultShipProperties,
    pictID: "default",
    desc: "default",
    animation: DefaultAnimation,
    outfits: {},
    initialExplosion: null,
    finalExplosion: null,
    largeExplosion: false,
    deathDelay: 1,
    displayWeight: 1
}


export { ShipData, DefaultShip, ShipProperties, DefaultShipProperties };
