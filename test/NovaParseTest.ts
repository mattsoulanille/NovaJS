global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { assert } from "chai";
import { NovaParse } from "../src/NovaParse";
import { NovaResourceType } from "../src/ResourceHolderBase";
import { NovaDataInterface, NovaDataType, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("NovaParse", function() {

    var np: NovaParse;

    before(async function() {
        np = new NovaParse("./test/novaParseTestFilesystem");
    });

    it("Should produce the correct error when the ID is not available", function() {
        np.data[NovaDataType.Ship].get("totally unavailable id").then(function() {
            assert.fail("Expected an exception");
        }, function(e) {
            expect(e).to.be.an.instanceOf(NovaIDNotFoundError);
        })
    });

    // it("Should parse Ship", async function() {
    //     var s = await np.data[NovaDataType.Ship].get("ship:128");
    //     console.log(s);
    // });



});

