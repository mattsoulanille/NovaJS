import 'jasmine';
import { FactoryQueue } from './factory_queue';

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

    // TODO: Fix this test. The test is broken.
    xit("builds items at the same time", async function() {
        const c = new FactoryQueue(buildFunction, 50);
        const count = 10000;
        const promise = c.buildToCount(count);
        const items: NumberHolder[] = Array(count);

        for (let i = 0; i < count; i++) {
            items[i] = await c.dequeueGuaranteed();
        }
        await promise;

        for (let i = 0; i < count; i++) {
            expect(items[i].value).toBe(i + 2);
        }
    });
});

