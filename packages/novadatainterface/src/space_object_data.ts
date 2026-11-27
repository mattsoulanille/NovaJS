import { BaseData, getDefaultBaseData } from "./base_data.js";
import { Animation, getDefaultAnimation } from "./animation.js";
import { DamageType } from "./weapon_data.js";


export interface SpaceObjectPhysics {
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
    inertialess: boolean;
};

export function getDefaultSpaceObjectPhysics(): SpaceObjectPhysics {
    return {
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
        // Turn 60: a whole 6 degrees a frame, so a default hull flies at
        // the rate it states (a ship turns whole degrees a frame,
        // reference E6B wave 52; the old 3 rad/s flew as 2.618).
        turnRate: Math.PI,
        mass: 100,
        inertialess: false,
    }
}

export interface SpaceObjectData extends BaseData {
    physics: SpaceObjectPhysics,
    animation: Animation,
    vulnerableTo: Array<DamageType>
}

export function getDefaultSpaceObjectData(): SpaceObjectData {
    return {
        ...getDefaultBaseData(),
        physics: getDefaultSpaceObjectPhysics(),
        animation: getDefaultAnimation(),
        vulnerableTo: <Array<DamageType>>["normal"]
    }
}
