var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var novaData = require("../parsing/novaData.js");

describe("novaData", function() {

    var nd;
    this.timeout(10000);
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	nd = new novaData(np);
	await nd.build();

    });

    it("should parse spriteSheets", async function() {
	var s = await nd.spriteSheets.get("nova:2000");
    });

    it("should parse ships", async function() {
	var s = await nd.ships.get("nova:128");
    });
});
