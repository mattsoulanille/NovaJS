var chai = require("chai");
var expect = chai.expect;
var assert = chai.assert;

var resourceFork = require('resourceforkjs').resourceFork;

var outf = require("../parsers/outf.js");

describe("outf", function() {

    var w1;
    var blank;
    var armor;
    var shields;
    var armorRecharge;
    var shieldRecharge;
    var speedIncrease;
    var accelBoost;
    var turnRate;
    var afterburner;
    var four;
    var anotherFour;

    before(async function() {
	var rf = new resourceFork("./test/files/outf.ndat", false);
	await rf.read();

	var outfs = rf.resources.oütf;
	w1 = new outf(outfs[128]);
	blank = new outf(outfs[129]);
	armor = new outf(outfs[130]);
	shields = new outf(outfs[131]);
	armorRecharge = new outf(outfs[132]);
	shieldRecharge = new outf(outfs[133]);
	speedIncrease = new outf(outfs[134]);
	accelBoost = new outf(outfs[135]);
	turnRate = new outf(outfs[136]);
	afterburner = new outf(outfs[137]);
	four = new outf(outfs[138]);
	anotherFour = new outf(outfs[139]);
    });

    it("should parse outfit functions", function() {
	expect(w1.functions).to.deep.equal([
	    {"weapon":142}
	]);
	expect(blank.functions).to.deep.equal([]);
	
	expect(armor.functions).to.deep.equal([
	    {"armor boost" : 42}
	]);

	expect(shields.functions).to.deep.equal([
	    {"shield boost" : 424}
	]);

	expect(armorRecharge.functions).to.deep.equal([
	    {"armor recharge" : 123}
	]);

	expect(shieldRecharge.functions).to.deep.equal([
	    {"shield recharge" : 234}
	]);

	expect(speedIncrease.functions).to.deep.equal([
	    {"speed increase" : 19}
	]);

	expect(accelBoost.functions).to.deep.equal([
	    {"acceleration boost" : 81}
	]);

	expect(turnRate.functions).to.deep.equal([
	    {"turn rate change" : 53}
	]);

	expect(afterburner.functions).to.deep.equal([
	    {"afterburner" : 144}
	]);

	expect(four.functions).to.deep.equal([
	    {"weapon" : 153},
	    {"acceleration boost" : 14},
	    {"armor boost" : 92},
	    {"shield boost" : 525}
	]);

	expect(anotherFour.functions).to.deep.equal([
	    {"shield recharge" : 99},
	    {"jam 3" : 23},
	    {"IFF" : true},
	    {"fuel increase" : 1454}
	]);
	
	
    });




});
