import { BaseResource } from "./BaseResource";
import { Animation } from "./Animation";

interface ShipResource extends BaseResource {
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
    initialExplosion: BaseResource | null;
    finalExplosion: BaseResource | null;
    largeExplosion: boolean;
    deathDelay: number;
    displayWeight: number;
};


export { ShipResource };
