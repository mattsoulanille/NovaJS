import { BaseData } from "./BaseData";

//interface NovaDataInterface { [index: string]: Gettable<BaseResource> }
interface Animation extends BaseData {
    images: {
        [index: string]: {
            id: string,
            imagePurposes: { [index: string]: { start: number, length: number } }
        }
    };
    exitPoints?: Array<Array<number>>;
}


export { Animation };
