import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { FactoryQueue } from "../../src/common/FactoryQueue";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});


class NumberHolder {
    constructor(public value: number) {

    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

let count = 0;
async function buildFunction() {
    await sleep(50);
    count += 1;
    return new NumberHolder(count);
}

describe("FactoryQueue", function() {

    this.beforeEach(() => {
        count = 0;
    });

    it("Should build items only as needed", async function() {
        const c = new FactoryQueue(buildFunction, 1);
        await c.buildingPromise;

        count.should.equal(1);
        c.count.should.equal(1);

        let item1 = c.dequeueIfAvailable();
        if (item1 === null) {
            fail("item Should not be null");
        }
        else {
            item1.value.should.equal(1);
        }

        // After we take an item, it should build another.
        await c.buildingPromise;
        count.should.equal(2);
        c.count.should.equal(1);

        let item2 = c.dequeueIfAvailable();
        if (item2 === null) {
            fail("item Should not be null");
        }
        else {
            item2.value.should.equal(2);
            c.enqueue(item2);
        }

        // Should be available, but we don't know
        // which one we get.
        let item3 = c.dequeueIfAvailable();
        if (item3 === null) {
            fail("item Should not be null");
            throw new Error("fail");
        }

        await c.buildingPromise;
        c.enqueue(item3);
        // We took 2 items, so it built a third
        // Then we put one back.
        c.count.should.equal(2);
        count.should.equal(3);
    })

    it("Should build items at the same time", async function() {
        const c = new FactoryQueue(buildFunction, 50);
        const count = 100000;
        c.buildToCount(count);
        const items: NumberHolder[] = Array(count);

        for (let i = 0; i < count; i++) {
            items[i] = await c.dequeue();
        }

        for (let i = 0; i < count; i++) {
            items[i].value.should.equal(i + 1);
        }

    });

});

