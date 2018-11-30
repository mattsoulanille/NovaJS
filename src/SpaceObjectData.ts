import { BaseData, DefaultBaseData } from "./BaseData";
import { Animation, DefaultAnimation } from "./Animation";
import { DamageType } from "./WeaponData";



type SpaceObjectProperties = {
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

const DefaultSpaceObjectProperties: SpaceObjectProperties = {
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

interface SpaceObjectData extends BaseData {
    properties: SpaceObjectProperties,
    animation: Animation,
    vulnerableTo: Array<DamageType>
}

const DefaultSpaceObjectData: SpaceObjectData = {
    ...DefaultBaseData,
    properties: DefaultSpaceObjectProperties,
    animation: DefaultAnimation,
    vulnerableTo: <Array<DamageType>>["normal"]
}


export { SpaceObjectData, DefaultSpaceObjectData, SpaceObjectProperties, DefaultSpaceObjectProperties }
