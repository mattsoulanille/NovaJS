
var novaParse = require("../novaParse.js");
var chai = require("chai");
var assert = chai.assert;
var expect = chai.expect;


describe("novaParse", function() {
    var np;


    before(async function() {
	np = new novaParse("./test/testFilesystem/");
	await np.read();
    });



    it("should properly handle overwriting of data by plug-ins", function() {
	expect(np.ids.resources.wëap['nova:128'].name).to.equal("Overwrites nova files");
	expect(np.ids.resources.wëap['plug pack:153'].name).to.equal("Overwritten by pp2");
	expect(np.ids.resources.wëap['nova:129'].name).to.equal("Overwritten by plugin2");

	expect(np.ids.resources.wëap['Plugin 1:150'].name).to.equal("Also doesn\'t get overwritten");
	expect(np.ids.resources.wëap['Plugin 2:150'].name).to.equal("this one also not overwritten");
    });

    it("should assign the right global id to each resource", function() {
	debugger;
	expect(np.ids.resources.wëap['nova:128'].globalID).to.equal("nova:128");
	expect(np.ids.resources.wëap['nova:129'].globalID).to.equal("nova:129");
	expect(np.ids.resources.wëap['Plugin 2:150'].globalID).to.equal("Plugin 2:150");
	expect(np.ids.resources.wëap['Plugin 1:150'].globalID).to.equal("Plugin 1:150");
	expect(np.ids.resources.wëap['plug pack:153'].globalID).to.equal("plug pack:153");
    });
    


});
