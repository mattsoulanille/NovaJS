import { Gettable, Builder } from "../../nova_data_interface/Gettable";


class CachelessGettable<T> extends Gettable<T> {
    constructor(getFunction: Builder<T>) {
        super(getFunction);
    }

    async get(id: string) {
        return await this.getFunction(id, 0);
    }
}

export { CachelessGettable };



