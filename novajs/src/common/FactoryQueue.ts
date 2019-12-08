
// Order is not preserved
class FactoryQueue<Item> {

    private items: (Item | undefined)[];
    private startIndex: number;
    private endIndex: number;
    buildingPromise: Promise<unknown>;


    constructor(private readonly buildFunction: () => Promise<Item>, public minimum = 0) {

        this.startIndex = 0;
        this.endIndex = 0;
        this.items = [];
        this.buildingPromise = this.buildToCountNoCheck(minimum);
    }

    private async prebuild(c: number) {
        let promises: Promise<Item>[] = Array(c);
        for (let i = 0; i < c; i++) {
            promises[i] = this.buildFunction();
        }

        let items = await Promise.all(promises);
        for (let item of items) {
            this.enqueue(item);
        }
    }

    private async buildToCountNoCheck(c: number) {
        let deficit = c - this.count;
        if (deficit > 0) {
            await this.prebuild(deficit);
        }
    }

    buildToCount(c: number): Promise<unknown> {
        this.buildingPromise =
            this.buildingPromise.then(() => {
                return this.buildToCountNoCheck(c)
            });
        return this.buildingPromise;
    }

    get count() {
        return this.endIndex - this.startIndex;
    }

    // Returns an item to the collection
    enqueue(i: Item) {
        this.items[this.endIndex] = i;
        this.endIndex++;
    }

    // Gets an item from the collection
    async dequeue(): Promise<Item> {
        let maybeItem = this.dequeueIfAvailable();
        if (maybeItem !== null) {
            return maybeItem;
        }
        else {
            await this.buildToCount(1);
            return await this.dequeue();
        }
    }


    dequeueIfAvailable(): Item | null {
        if (this.endIndex === this.startIndex) {
            // Then it's empty.
            this.buildToCount(this.minimum);
            return null;
        }
        else {
            const item = this.items[this.startIndex];
            if (item === undefined) {
                throw new Error("Item was undefined");
            }
            delete this.items[this.startIndex];
            this.startIndex++;
            this.buildToCount(this.minimum);
            return item;
        }
    }
}

export { FactoryQueue }

