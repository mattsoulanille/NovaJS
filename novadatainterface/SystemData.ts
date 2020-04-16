import { BaseData, getDefaultBaseData } from "./BaseData";


export interface SystemData extends BaseData {
    position: [number, number],
    links: Array<string>,
    planets: Array<string>
}

export function getDefaultSystemData(): SystemData {
    return {
        ...getDefaultBaseData(),
        position: [0, 0],
        links: [],
        planets: []
    };
}
