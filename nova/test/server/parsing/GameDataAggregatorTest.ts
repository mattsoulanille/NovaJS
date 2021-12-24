import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { GameDataInterface } from "../../../../nova_data_interface/GameDataInterface";
import { NovaDataInterface } from "../../../../nova_data_interface/NovaDataInterface";
import { Gettable } from "../../../../nova_data_interface/Gettable";
import { BaseData } from "../../../../nova_data_interface/BaseData";
import { GameDataAggregator } from "../../../src/server/parsing/GameDataAggregator";

import { NovaIDs, DefaultNovaIDs } from "../../../../nova_data_interface/NovaIDs";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

const expect = chai.expect;

/*
class TestGameData implements GameDataInterface {
    ids: Promise<NovaIDs>;
    data: NovaDataInterface;
    constructor(dataType: string) {
        this.ids = Promise.resolve(DefaultNovaIDs);
        this.data = {

		};
        this.data[dataType] = new Gettable<BaseData>(async function(id: string) {
            return {
                name: "Got the " + dataType + " of id " + id,
                id: id,
                prefix: "tacos"
            }
        });
        this.ids
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
*/
