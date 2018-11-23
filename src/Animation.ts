import { BaseResource } from "./BaseResource";

//interface NovaDataInterface { [index: string]: Gettable<BaseResource> }
interface Animation extends BaseResource {
    images: {
        [index: string]: {
            id: string,
            imagePurposes: { [index: string]: { start: number, length: number } }
        }
    };
    exitPoints?: Array<Array<number>>;
}


export { Animation };
