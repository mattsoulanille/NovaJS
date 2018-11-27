global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { assert } from "chai";
import { NovaParse } from "../src/NovaParse";
import { NovaResourceType } from "../src/ResourceHolderBase";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";


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

    it("Should read ship", function() {
        np.data[NovaDataType.Ship].get("nova:128");

    });



});

