import { NovaResources, getEmptyNovaResources } from "../src/ResourceHolderBase";
import { readNovaFile } from "../src/readNovaFile";

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("readNovaFile", function() {

    var shipPath = "./test/resourceParsers/files/ship.ndat";

    var localIDSpace: NovaResources = getEmptyNovaResources();

    before(function(done) {
        readNovaFile(shipPath, localIDSpace).then(function() {
            done();
        });
    });

    it("should parse resources", function() {
        expect(localIDSpace["shïp"][128].name).to.equal("contrived ship test");

    })

});

