global.Promise = require("bluebird"); // For stacktraces
import { IDSpaceHandler } from "../src/IDSpaceHandler";

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";
import { NovaResources } from "../src/ResourceHolderBase";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("IDSpaceHandler", function() {

    var dataPath = "./test/testFilesystem/";

    var handler = new IDSpaceHandler(dataPath);
    var idSpace: NovaResources;


    before(function(done) {
        handler.getIDSpace().then((space) => {
            idSpace = space;
            done();
        });
    });

    it("should properly handle overwriting of data by plug-ins", function() {
        debugger;
        expect(idSpace.resources.wëap['nova:128'].name).to.equal("Overwrites nova files");
        expect(idSpace.resources.wëap['plug pack:153'].name).to.equal("Overwritten by pp2");
        expect(idSpace.resources.wëap['nova:129'].name).to.equal("Overwritten by plugin2");

        expect(idSpace.resources.wëap['Plugin 1:150'].name).to.equal("Also doesn\'t get overwritten");
        expect(idSpace.resources.wëap['Plugin 2:150'].name).to.equal("this one also not overwritten");
    });


});