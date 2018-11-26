import { Animation } from "./Animation";
import { BaseData } from "./BaseData";

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
    initialExplosion: BaseData | null;
    finalExplosion: BaseData | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
};


export { ShipData };
