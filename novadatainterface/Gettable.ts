type Builder<T> = (id: string) => Promise<T>;

class Gettable<T> {
    protected data: { [key: string]: Promise<T> };
    protected getFunction: Builder<T>

    constructor(getFunction: Builder<T>) {
        this.data = {};
        this.getFunction = getFunction;
    }

    async get(id: string) {
        if (!(id in this.data)) {
            this.data[id] = this.getFunction(id);
        }
        return await this.data[id];
    }
}

export { Gettable, Builder };

