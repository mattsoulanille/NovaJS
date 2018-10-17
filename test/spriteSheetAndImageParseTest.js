var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
const spriteSheetAndImageParse = require("../parsing/spriteSheetAndImageParse.js");


describe("novaData", function() {

    var sp = new spriteSheetAndImageParse();
    var earth;
    this.timeout(10000);
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	earth = await sp.parse(np.ids.resources.rlëD["nova:2000"]);
    });

    it("should have properties spriteSheet and png", async function() {
	expect(earth).to.have.property("spriteSheet");
	expect(earth).to.have.property("png");
    });

});
