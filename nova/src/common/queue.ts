export interface Queue<Item> {
    readonly count: number;
    enqueue(i: Item): void;
    dequeue(): Item | null;
    emptyTo(f: (i: Item) => void): void;
}


export class QueueImpl<Item> implements Queue<Item> {
    private items: (Item | undefined)[] = [];
    private startIndex = 0;
    private endIndex = 0;

    get count() {
        return this.endIndex - this.startIndex;
    }

    // Returns an item to the queue
    enqueue(i: Item) {
        this.items[this.endIndex] = i;
        this.endIndex++;
    }

    // Gets an item from the collection
    dequeue(): Item | null {
        if (this.endIndex === this.startIndex) {
            // Then it's empty.
            return null;
        }
        else {
            const item = this.items[this.startIndex];
            if (item === undefined) {
                throw new Error("Item was undefined");
            }
            delete this.items[this.startIndex];
            this.startIndex++;
            return item;
        }
    }

    emptyTo(f: (i: Item) => void) {
        for (let i = 0; i < this.count; i++) {
            const item = this.dequeue();
            if (item) {
                f(item);
            } else {
                throw new Error("Queue ran out of items in emptyTo. Perhaps the callback interacted with the queue?");
            }
        }
    }
}
