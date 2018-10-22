var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var novaParse = require("novaParse");
var shipParse = require("../parsing/shipParse.js");

describe("shipParse", function() {

    var nd;
    var shuttle;
    var sp = new shipParse({});
    this.timeout(10000);
    before(async function() {
	var np = new novaParse("./Nova\ Data");
	await np.read();
	shuttle = await sp.parse(np.ids.resources.shïp["nova:128"]);
    });

    it("should parse name", function() {
	expect(shuttle.name).to.equal("Shuttle");
    });

});
