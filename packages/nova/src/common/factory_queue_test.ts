import 'jasmine';
import { FactoryQueue } from './factory_queue.js';

class NumberHolder {
    constructor(public value: number) { }
}

function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

describe("FactoryQueue", function() {
    let count: number;
    async function buildFunction() {
        count += 1;
        let myCount = count;
        await sleep(0);
        return new NumberHolder(myCount);
    }

    beforeEach(() => {
        count = 0;
    });

    it("builds items only as needed", async function() {
        const c = new FactoryQueue(buildFunction, 1);
        await c.buildingPromise;

        expect(count).toEqual(1);
        expect(c.count).toEqual(1);

        const item1 = c.dequeue();
        expect(item1).toBeDefined();
        expect(item1?.value).toBe(1);

        // After we take an item, it should build another.
        await c.buildingPromise;
        expect(count).toEqual(2);
        expect(c.count).toEqual(1);

        const item2 = c.dequeue();
        expect(item2).toBeDefined();
        expect(item2?.value).toBe(2);

        // Should be available, but we don't know
        // which one we get.
        c.enqueue(item2!);
        const item3 = c.dequeue();
        expect(item3).toBeDefined();

        await c.buildingPromise;
        c.enqueue(item3!);
        // We took 2 items, so it built a third
        // Then we put one back.
        expect(c.count).toEqual(2);
        expect(count).toEqual(3);
    });

    it("builds items at the same time", async function() {
        // The old version of this spec asserted the exact dequeue order
        // (value i + 2), which is not what a FactoryQueue promises: the
        // 50 prebuilt items come out first, and the item the first empty
        // dequeue() built synchronously is enqueued after the whole batch.
        // What it promises is that buildToCount builds its deficit
        // concurrently, and that dequeueGuaranteed hands out every item
        // exactly once.
        const minimum = 50;
        const count = 10000;
        let built = 0;
        let inFlight = 0;
        let maxInFlight = 0;
        async function concurrentBuild() {
            built += 1;
            const myCount = built;
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await sleep(0);
            inFlight -= 1;
            return new NumberHolder(myCount);
        }

        const c = new FactoryQueue(concurrentBuild, minimum);
        const promise = c.buildToCount(count);
        const items: NumberHolder[] = Array(count);
        for (let i = 0; i < count; i++) {
            items[i] = await c.dequeueGuaranteed();
        }
        await promise;

        // The deficit after the prebuild was built in one concurrent batch
        // (plus, depending on timer ordering, the stopgap item the first
        // empty dequeue() built synchronously, hence >=).
        expect(maxInFlight).toBeGreaterThanOrEqual(count - minimum);
        // Every item was handed out once, and nothing was invented.
        const values = items.map(item => item.value);
        expect(new Set(values).size).toBe(count);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...values)).toBeLessThanOrEqual(built);
    });
});

