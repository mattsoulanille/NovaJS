import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { NovaDataType, NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { Gettable } from "novadatainterface/Gettable";
import { BaseResource } from "novadatainterface/BaseResource";

abstract class GameDataBase implements GameDataInterface {
    data: NovaDataInterface;
    constructor() {
        this.data = {};
        this.setupData();
    }

    setupData() {
        for (let val in NovaDataType) {
            let nval = Number(val);
            if (isNaN(nval)) {
                this.data[val] = this.makeGettable(nval);
            }
        }
    }

    abstract makeGettable(resourceType: NovaDataType): Gettable<BaseResource>;
}

export { GameDataBase }
