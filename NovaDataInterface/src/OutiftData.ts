import { BaseData, DefaultBaseData } from "./BaseData";
import { ShipPhysics } from "./ShipData";


type OutfitPhysics = Partial<ShipPhysics> & { freeMass: number };

interface OutfitData extends BaseData {
    weapons: { [index: string]: number }, // globalID : count

    // how it changes the physics of the ship it's attached to. Idea: What if these were allowed to be functions?
    physics: OutfitPhysics,
    pict: string, // id of picture
    price: number,
    desc: string,
    displayWeight: number,
    max: number
}

const DefaultOutfitData: OutfitData = {
    ...DefaultBaseData,
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

export { OutfitData, OutfitPhysics, DefaultOutfitData };
