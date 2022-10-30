import { Gettable, Builder } from "../../novadatainterface/Gettable";


class CachelessGettable<T> extends Gettable<T> {
    constructor(getFunction: Builder<T>) {
        super(getFunction);
    }

    override async get(id: string) {
        return await this.getFunction(id, 0);
    }
}

export { CachelessGettable };



