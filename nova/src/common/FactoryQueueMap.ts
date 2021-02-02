import { FactoryQueue } from "./FactoryQueue";

class FactoryQueueMap<Item extends { id: string }> {

    readonly items = new Map<string, FactoryQueue<Item>>();
    private _minimum!: number;

    constructor(private readonly buildFunction: (id: string) => Promise<Item>, minimum: number) {
        this.minimum = minimum;
    }

    get minimum() {
        return this._minimum;
    }

    set minimum(n: number) {
        this._minimum = n;
        for (let val of this.items.values()) {
            val.minimum = n;
        }
    }

    getQueue(id: string): FactoryQueue<Item> {
        if (!this.items.has(id)) {
            this.items.set(id, new FactoryQueue<Item>(
                () => {
                    return this.buildFunction(id);
                },
                this.minimum)
            );
        }
        return this.items.get(id)!;
    }

    dequeueFrom(id: string): Promise<Item> {
        return this.getQueue(id).dequeueGuaranteed();
    }

    dequeueFromIfAvailable(id: string): Item | null {
        return this.getQueue(id).dequeue();
    }

    enqueue(i: Item) {
        this.getQueue(i.id).enqueue(i);
    }
}

export { FactoryQueueMap }
