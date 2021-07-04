import { FactoryQueue } from "./factory_queue";


export class FactoryQueueMap<Item> {
    readonly items = new Map<string, FactoryQueue<Item>>();
    private _minimum!: number;

    constructor(private readonly buildFunction: (id: string) => Promise<Item>, minimum: number, private getId: (item: Item) => string) {
        this.minimum = minimum;
    }

    get minimum() {
        return this._minimum;
    }

    set minimum(n: number) {
        this._minimum = n;
        for (const val of this.items.values()) {
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
        this.getQueue(this.getId(i)).enqueue(i);
    }
}
