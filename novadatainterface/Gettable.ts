export type Builder<T> = (id: string, priority: number) => Promise<T>;

export type GettableData<G> = G extends Gettable<infer T> ? T : never;

export class Gettable<T> {
    protected data: { [key: string]: Promise<T> } = {};
    gotten: { [key: string]: T | Error } = {};

    constructor(protected getFunction: Builder<T>) { }

    async get(id: string, priority: number = 0) {
        if (id in this.gotten) {
            const val = this.gotten[id];
            if (val instanceof Error) {
                throw val;
            }
            return val;
        }

        if (!(id in this.data)) {
            this.data[id] = this.getFunction(id, priority);
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
