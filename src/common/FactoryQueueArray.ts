import { FactoryQueue } from "./FactoryQueue";

class FactoryQueueArray<Item extends { id: string }> {

    readonly items: { [index: string]: FactoryQueue<Item> };
    private _minimum!: number;

    constructor(private readonly buildFunction: (id: string) => Promise<Item>, minimum: number) {
        this.items = {};
        this.minimum = minimum;

    }

    get minimum() {
        return this._minimum;
    }

    set minimum(n: number) {
        this._minimum = n;
        for (let val of Object.values(this.items)) {
            val.minimum = n;
        }
    }

    getQueue(id: string): FactoryQueue<Item> {
        if (!(this.items[id] instanceof FactoryQueue)) {
            this.items[id] = new FactoryQueue<Item>(
                () => {
                    return this.buildFunction(id);
                },
                this.minimum);
        }
        return this.items[id];
    }

    dequeueFrom(id: string): Promise<Item> {
        return this.getQueue(id).dequeue();
    }

    dequeueFromIfAvailable(id: string): Item | null {
        return this.getQueue(id).dequeueIfAvailable();
    }

    enqueue(i: Item) {
        this.getQueue(i.id).enqueue(i);
    }
}

export { FactoryQueueArray }
