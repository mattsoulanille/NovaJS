import "jasmine";
import { FactoryQueueMap } from "./factory_queue_map";
class NumberStringHolder {
    constructor(public num: number, public id: string) { }
}

function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

describe("FactoryQueueMap", function() {
    let count: number;
    async function buildFunction(str: string) {
        await sleep(0);
        count += 1;
        return new NumberStringHolder(count, str);
    }

    beforeEach(() => {
        count = 0;
    });

    it("makes FactoryQueues as needed", async function() {
        const c = new FactoryQueueMap(buildFunction, 1, v => v.id);

        let someItem = await c.dequeueFrom("someID");
        let anotherItem = await c.dequeueFrom("anotherID");
        expect(someItem.id).toEqual("someID");
        expect(anotherItem.id).toEqual("anotherID");
    })

    it("returns items to their respective queues", async function() {
        const c = new FactoryQueueMap(buildFunction, 0, v => v.id);

        let someItem = await c.dequeueFrom("someID");
        let anotherItem = await c.dequeueFrom("anotherID");

        c.enqueue(someItem);
        c.enqueue(anotherItem);
        expect(await c.dequeueFrom("someID")).toEqual(someItem);
        expect(await c.dequeueFrom("anotherID")).toEqual(anotherItem);
    });
});
