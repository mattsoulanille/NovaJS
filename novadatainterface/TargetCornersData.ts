import { BaseData, DefaultBaseData } from "./BaseData";




interface TargetCornersData extends BaseData {
    images: {
        neutral: string,
        hostile: string,
        friendly: string,
        disabled: string
    }
}

const DefaultTargetCornersData: TargetCornersData = {
    ...DefaultBaseData,
    images: {
        neutral: "default",
        hostile: "default",
        friendly: "default",
        disabled: "default"
    }
}

export { TargetCornersData, DefaultTargetCornersData }
