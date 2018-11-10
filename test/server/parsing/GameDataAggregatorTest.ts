import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { GameDataInterface } from "../../../src/server/parsing/GameDataInterface";
import { NovaDataInterface } from "../../../src/server/parsing/NovaDataInterface";
import { Gettable } from "../../../src/common/Gettable";
import { BaseResource } from "../../../src/server/parsing/BaseResource";
import { GameDataAggregator } from "../../../src/server/parsing/GameDataAggregator";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

const expect = chai.expect;


class TestGameData implements GameDataInterface {
    data: NovaDataInterface
    constructor(dataType: string) {
        this.data = {};
        this.data[dataType] = new Gettable<BaseResource>(async function(id: string) {
            return {
                name: "Got the " + dataType + " of id " + id,
                id: id,
                prefix: "tacos"
            }
        });
    }
}



describe("GameDataAggregator", function() {

    var aggregator: GameDataAggregator;

    before(function() {
        aggregator = new GameDataAggregator([new TestGameData("Ship"), new TestGameData("System")], () => { });
    });


    it("Should allow lookups", async function() {
        expect((await aggregator.data["Ship"].get("123")).name).to.equal("Got the Ship of id 123");
        expect((await aggregator.data["System"].get("456")).name).to.equal("Got the System of id 456");
    });

    it("Should provide a default when the lookup fails", async function() {
        expect((await aggregator.data["Outfit"].get("123")).name).to.equal("default");
    });
});
