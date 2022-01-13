export type Builder<T> = (id: string, priority: number) => Promise<T>;

export type GettableData<G> = G extends Gettable<infer T> ? T : never;

export class Gettable<T> {
    protected data: { [key: string]: Promise<T> } = {};
    gotten: { [key: string]: T } = {};

    constructor(protected getFunction: Builder<T>,
        protected warn: (message: unknown) => void = console.warn) { }

    async get(id: string, priority: number = 0) {
        if (id in this.gotten) {
            return this.gotten[id];
        }

        if (!(id in this.data)) {
            this.data[id] = this.getFunction(id, priority);
        }

        try {
            const val = await this.data[id];
            this.gotten[id] = val;
            return val;
        } catch (e) {
            delete this.data[id];
            throw e;
        }
    }

    getCached(id: string): T | undefined {
        const cached = this.gotten[id];
        if (!cached) {
            this.get(id).catch(error => this.warn(error));
            return undefined;
        } else {
            return cached;
        }
    }
}
