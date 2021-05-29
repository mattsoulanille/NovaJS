import { BaseData, getDefaultBaseData } from "./BaseData";

export interface CicnData extends BaseData { }

export function getDefaultCicnData(): CicnData {
    return getDefaultBaseData();
}
