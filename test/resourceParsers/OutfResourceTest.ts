global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import "mocha";
import * as chaiAsPromised from "chai-as-promised";

import { readResourceFork, ResourceMap } from "resourceforkjs";

import { OutfResource } from "../../src/resourceParsers/OutfResource";
import { NovaResources } from "../../src/ResourceHolderBase";
import { defaultIDSpace } from "./DefaultIDSpace";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


describe("OutfResource", function() {

    var rf: ResourceMap;

    // Outfits don't depend on othe resources.
    var idSpace: NovaResources = defaultIDSpace;

    var w1: OutfResource;
    var blank: OutfResource;
    var armor: OutfResource;
    var shields: OutfResource;
    var armorRecharge: OutfResource;
    var shieldRecharge: OutfResource;
    var speedIncrease: OutfResource;
    var accelBoost: OutfResource;
    var turnRate: OutfResource;
    var afterburner: OutfResource;
    var four: OutfResource;
    var anotherFour: OutfResource;

    before(function(done) {
        readResourceFork("./test/resourceParsers/files/outf.ndat", false).then((result) => {
            rf = result;

            var outfs = rf.oütf;
            w1 = new OutfResource(outfs[128], idSpace);
            blank = new OutfResource(outfs[129], idSpace);
            armor = new OutfResource(outfs[130], idSpace);
            shields = new OutfResource(outfs[131], idSpace);
            armorRecharge = new OutfResource(outfs[132], idSpace);
            shieldRecharge = new OutfResource(outfs[133], idSpace);
            speedIncrease = new OutfResource(outfs[134], idSpace);
            accelBoost = new OutfResource(outfs[135], idSpace);
            turnRate = new OutfResource(outfs[136], idSpace);
            afterburner = new OutfResource(outfs[137], idSpace);
            four = new OutfResource(outfs[138], idSpace);
            anotherFour = new OutfResource(outfs[139], idSpace);
            done();
        });
    });

    it("should parse outfit functions", function() {
        expect(w1.functions).to.deep.equal([
            { "weapon": 142 }
        ]);
        expect(blank.functions).to.deep.equal([]);

        expect(armor.functions).to.deep.equal([
            { "armor boost": 42 }
        ]);

        expect(shields.functions).to.deep.equal([
            { "shield boost": 424 }
        ]);

        expect(armorRecharge.functions).to.deep.equal([
            { "armor recharge": 123 }
        ]);

        expect(shieldRecharge.functions).to.deep.equal([
            { "shield recharge": 234 }
        ]);

        expect(speedIncrease.functions).to.deep.equal([
            { "speed increase": 19 }
        ]);

        expect(accelBoost.functions).to.deep.equal([
            { "acceleration boost": 81 }
        ]);

        expect(turnRate.functions).to.deep.equal([
            { "turn rate change": 53 }
        ]);

        expect(afterburner.functions).to.deep.equal([
            { "afterburner": 144 }
        ]);

        expect(four.functions).to.deep.equal([
            { "weapon": 153 },
            { "acceleration boost": 14 },
            { "armor boost": 92 },
            { "shield boost": 525 }
        ]);

        expect(anotherFour.functions).to.deep.equal([
            { "shield recharge": 99 },
            { "jam 3": 23 },
            { "IFF": true },
            { "fuel increase": 1454 }
        ]);

    });

    it("should parse maximum allowed", function() {
        expect(w1.max).to.equal(12);
        expect(blank.max).to.equal(999);
        expect(armor.max).to.equal(124);
        expect(shields.max).to.equal(337);
        expect(armorRecharge.max).to.equal(32767);
    });
    it("should calculate pictID", function() {
        expect(w1.pictID).to.equal(6000);
        expect(anotherFour.pictID).to.equal(6011);
    });

    it("should parse mass", function() {
        expect(w1.mass).to.equal(12);
        expect(armor.mass).to.equal(5);
        expect(shields.mass).to.equal(1221);
    });

    it("should parse cost", function() {
        expect(w1.cost).to.equal(1312);
        expect(blank.cost).to.equal(0);
        expect(armor.cost).to.equal(9404);
        expect(shields.cost).to.equal(12345);
        expect(armorRecharge.cost).to.equal(1234567);
        expect(shieldRecharge.cost).to.equal(-534);

    });

    it("should parse displayWeight", function() {
        expect(w1.displayWeight).to.equal(14);
        expect(blank.displayWeight).to.equal(0);
        expect(armor.displayWeight).to.equal(423);

    });

});
