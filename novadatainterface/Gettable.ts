type Builder<T> = (id: string) => Promise<T>;

class Gettable<T> {
    protected data: { [key: string]: Promise<T> } = {};
    protected gotten: { [key: string]: T | Error } = {};

    constructor(protected getFunction: Builder<T>) { }

    async get(id: string) {
        if (!(id in this.data)) {
            this.data[id] = this.getFunction(id);
        }

        try {
            const val = await this.data[id];
            this.gotten[id] = val;
            return val;
        } catch (e) {
            this.gotten[id] = e;
            throw e;
        }
    }

    getCached(id: string): T | undefined {
        const cached = this.gotten[id];
        if (cached instanceof Error) {
            throw cached;
        } else if (!cached) {
            this.get(id);
            return undefined;
        } else {
            return cached;
        }
    }
}

export { Gettable, Builder };

