import { BaseData, getDefaultBaseData } from "./BaseData";
import { ShipPhysics } from "./ShipData";


export type OutfitPhysics = Partial<ShipPhysics> & { freeMass: number };

export interface OutfitData extends BaseData {
    weapons: { [index: string]: number }, // globalID : count

    // how it changes the physics of the ship it's attached to. Idea: What if these were allowed to be functions?
    physics: OutfitPhysics,
    pict: string, // id of picture
    price: number,
    desc: string,
    displayWeight: number,
    max: number
}

export function getDefaultOutfitData(): OutfitData {
    return {
        ...getDefaultBaseData(),
        weapons: {},
        physics: {
            freeMass: 0
        },
        pict: "default",
        price: 0,
        desc: "default outfit",
        displayWeight: 0,
        max: 0
    }
}
