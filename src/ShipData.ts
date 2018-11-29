import { Animation, DefaultAnimation } from "./Animation";
import { BaseData, DefaultBaseData } from "./BaseData";

interface ShipData extends BaseData {
    pictID: string;
    desc: string;
    animation: Animation;
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
    outfits: { [index: string]: number }
    freeMass: number;
    initialExplosion: string | null;
    finalExplosion: string | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
};


var DefaultShip: ShipData = {
    ...DefaultBaseData,
    pictID: "default",
    desc: "default",
    animation: DefaultAnimation,
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
    outfits: {},
    freeMass: 0,
    initialExplosion: null,
    finalExplosion: null,
    largeExplosion: false,
    deathDelay: 1,
    displayWeight: 1
}


export { ShipData, DefaultShip };
