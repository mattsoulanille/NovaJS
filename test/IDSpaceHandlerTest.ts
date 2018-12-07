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

    var dataPath = "./test/IDSpaceHandlerTestFilesystem/";

    var handler = new IDSpaceHandler(dataPath);
    var idSpace: NovaResources;


    before(function(done) {
        handler.getIDSpace().then((space) => {
            idSpace = space;
            done();
        });
    });

    it("should properly handle overwriting of data by plug-ins", function() {
        //debugger;
        //console.log(idSpace);
        expect(idSpace.wëap['nova:128'].name).to.equal("Overwrites nova files");
        expect(idSpace.wëap['plug pack:153'].name).to.equal("Overwritten by pp2");
        expect(idSpace.wëap['nova:129'].name).to.equal("Overwritten by plugin2");

        expect(idSpace.wëap['Plugin 1:150'].name).to.equal("Also doesn\'t get overwritten");
        expect(idSpace.wëap['A first plug:150'].name).to.equal("this one also not overwritten");
    });

    it("should assign the right global id to each resource", function() {
        expect(idSpace.wëap['nova:128'].globalID).to.equal("nova:128");
        expect(idSpace.wëap['nova:129'].globalID).to.equal("nova:129");
        expect(idSpace.wëap['A first plug:150'].globalID).to.equal("A first plug:150");
        expect(idSpace.wëap['Plugin 1:150'].globalID).to.equal("Plugin 1:150");
        expect(idSpace.wëap['plug pack:153'].globalID).to.equal("plug pack:153");
    });

    /*
    it("Should assign the same pictID to ships with the same baseImage", function() {
        expect(idSpace.resources.shïp["nova:128"].pictID).to.equal(5000);
        expect(idSpace.resources.shïp["nova:129"].pictID).to.equal(5000);
        expect(idSpace.resources.shïp["nova:130"].pictID).to.equal(5002);
    });
    */



});
