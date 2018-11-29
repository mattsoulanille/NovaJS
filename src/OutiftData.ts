import { BaseData } from "./BaseData";


interface OutfitData extends BaseData {
    weapons: { [index: string]: number }, // globalID : count
    properties: { [index: string]: number | boolean }, // how it changes the properties of the ship it's attached to.
    pict: string, // id of picture
    mass: number,
    price: number,
    desc: string,
    displayWeight: number,
    max: number
}

export { OutfitData };
