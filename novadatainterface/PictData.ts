import { BaseData, getDefaultBaseData } from "./BaseData";

export interface PictData extends BaseData { }

export function getDefaultPictData(): PictData {
    return getDefaultBaseData();
}
