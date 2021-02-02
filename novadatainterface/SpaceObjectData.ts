import { BaseData, getDefaultBaseData } from "./BaseData";
import { Animation, getDefaultAnimation } from "./Animation";
import { DamageType } from "./WeaponData";


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
        turnRate: 3,
        mass: 100
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
