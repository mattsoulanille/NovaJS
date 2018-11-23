type Builder<T> = (id: string) => Promise<T>;

class Gettable<T> {
    private data: { [key: string]: Promise<T> };
    private getFunction: Builder<T>

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

export { Gettable };

