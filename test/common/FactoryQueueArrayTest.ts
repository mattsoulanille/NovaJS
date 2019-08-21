import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { FactoryQueueArray } from "../../src/common/FactoryQueueArray";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});


class NumberStringHolder {
    constructor(public num: number, public id: string) {

    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

let count = 0;
async function buildFunction(str: string) {
    await sleep(50);
    count += 1;
    return new NumberStringHolder(count, str);
}

describe("FactoryQueueArray", function() {

    this.beforeEach(() => {
        count = 0;
    });

    it("Should make FactoryQueues as needed", async function() {
        const c = new FactoryQueueArray(buildFunction, 1);

        let someItem = await c.dequeueFrom("someID");
        let anotherItem = await c.dequeueFrom("anotherID");
        someItem.id.should.equal("someID");
        anotherItem.id.should.equal("anotherID");
    })

    it("Should return items to their respective queues", async function() {
        const c = new FactoryQueueArray(buildFunction, 0);

        let someItem = await c.dequeueFrom("someID");
        let anotherItem = await c.dequeueFrom("anotherID");

        c.enqueue(someItem);
        c.enqueue(anotherItem);
        (await c.dequeueFrom("someID")).should.equal(someItem);
        (await c.dequeueFrom("anotherID")).should.equal(anotherItem);

    });


});
