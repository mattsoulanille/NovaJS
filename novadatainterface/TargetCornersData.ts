import { BaseData, getDefaultBaseData } from "./BaseData";


export interface TargetCornersData extends BaseData {
    images: {
        neutral: string,
        hostile: string,
        friendly: string,
        disabled: string
    }
}

export function getDefaultTargetCornersData(): TargetCornersData {
    return {
        ...getDefaultBaseData(),
        images: {
            neutral: "default",
            hostile: "default",
            friendly: "default",
            disabled: "default"
        }
    }
}
