import { BaseData, getDefaultBaseData } from "./BaseData";

export interface StatusBarColors {
    brightText: number;
    dimText: number;
    brightRadar: number;
    dimRadar: number;
    shield: number;
    armor: number;
    fuelFull: number;
    fuelPartial: number;
}

// Civilian colors
export function getDefaultStatusBarColors(): StatusBarColors {
    return {
        brightText: 16777215,
        dimText: 8947848,
        brightRadar: 16777215,
        dimRadar: 8947848,
        shield: 12517376,
        armor: 10921638,
        fuelFull: 4938864,
        fuelPartial: 2634559
    };
}

export interface StatusBarDataArea {
    position: [number, number];
    size: [number, number];
}

export interface StatusBarDataAreas {
    radar: StatusBarDataArea;
    shield: StatusBarDataArea;
    armor: StatusBarDataArea;
    fuel: StatusBarDataArea;
    navigation: StatusBarDataArea;
    weapons: StatusBarDataArea;
    targeting: StatusBarDataArea;
    cargo: StatusBarDataArea;
}

export function getDefaultStatusBarDataAreas(): StatusBarDataAreas {
    return {
        radar: {
            position: [8, 8],
            size: [176, 176]
        },
        shield: {
            position: [35, 199],
            size: [149, 7]
        },
        armor: {
            position: [35, 216],
            size: [149, 7]
        },
        fuel: {
            position: [35, 234],
            size: [149, 7]
        },
        navigation: {
            position: [8, 254],
            size: [176, 32]
        },
        weapons: {
            position: [8, 300],
            size: [176, 15]
        },
        targeting: {
            position: [8, 330],
            size: [176, 112]
        },
        cargo: {
            position: [8, 458],
            size: [176, 94]
        }
    }
}

export interface StatusBarData extends BaseData {
    image: string,
    colors: StatusBarColors,
    dataAreas: StatusBarDataAreas
}

export function getDefaultStatusBarData(): StatusBarData {
    return {
        ...getDefaultBaseData(),
        image: "default",
        colors: getDefaultStatusBarColors(),
        dataAreas: getDefaultStatusBarDataAreas()
    }
}
