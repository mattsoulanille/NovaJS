global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import { assert } from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { ShipResource } from "../../src/resource_parsers/ShipResource";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;

describe("ShipResource", function() {


    // Ships don't depend on other resources.
    var idSpace = defaultIDSpace;

    var rf: ResourceMap;
    var s1: ShipResource;
    before(async function() {
        rf = await readResourceFork("novaparse/test/resource_parsers/files/ship.ndat", false);
        var ships = rf.shïp;
        s1 = new ShipResource(ships[128], idSpace);
    });

    it("should parse longName", function() {
        expect(s1.longName).to.equal("a long name of ship");
    });

    it("should parse shortName", function() {
        expect(s1.shortName).to.equal("the short name");
    });

    it("should parse subtitle", function() {
        expect(s1.subtitle).to.equal("the subtitle");
    });

    it("should parse commName", function() {
        expect(s1.commName).to.equal("the comm name");
    });

    it("should parse cost", function() {
        expect(s1.cost).to.equal(1);
    });

    it("should parse deathDelay", function() {
        expect(s1.deathDelay).to.equal(67);
    });

    it("should parse deathDelay", function() {
        expect(s1.deathDelay).to.equal(67);
    });

    it("should parse initialExplosion", function() {
        assert.propertyVal(s1, "initialExplosion", 168);
    });

    it("should parse finalExplosion", function() {
        assert.propertyVal(s1, "finalExplosion", 169);
    });

    it("should parse finalExplosionSparks", function() {
        expect(s1.finalExplosionSparks).to.equal(true);
    });

    it("should parse displayOrder", function() {
        expect(s1.displayOrder).to.equal(3);
    });

    it("should parse mass", function() {
        expect(s1.mass).to.equal(4147);
    });

    it("should parse length", function() {
        expect(s1.length).to.equal(8);
    });

    it("should parse inherentAI", function() {
        expect(s1.inherentAI).to.equal(1);
    });

    it("should parse crew", function() {
        expect(s1.crew).to.equal(16);
    });

    it("should parse strength", function() {
        expect(s1.strength).to.equal(10);
    });

    it("should parse inherentGovt", function() {
        expect(s1.inherentGovt).to.equal(128);
    });

    it("should parse flags", function() {
        // write me
        //expect(s1.flags).to.equal(6);
    });

    it("should parse podCount", function() {
        // escape pods
        expect(s1.podCount).to.equal(9);
    });

    it("should parse techLevel", function() {
        expect(s1.techLevel).to.equal(2);
    });


    it("should parse buyRandom", function() {
        expect(s1.buyRandom).to.equal(4);
    });

    it("should parse hireRandom", function() {
        expect(s1.hireRandom).to.equal(5);
    });

    it("should parse cargoSpace", function() {
        expect(s1.cargoSpace).to.equal(14);
    });

    it("should parse freeSpace", function() {
        expect(s1.freeSpace).to.equal(3841);
    });

    it("should parse acceleration", function() {
        expect(s1.acceleration).to.equal(11);
    });

    it("should parse speed", function() {
        expect(s1.speed).to.equal(12);
    });

    it("should parse turnRate", function() {
        expect(s1.turnRate).to.equal(13);
    });

    it("should parse shield", function() {
        expect(s1.shield).to.equal(17);
    });

    it("should parse shieldRecharge", function() {
        expect(s1.shieldRecharge).to.equal(18);
    });

    it("should parse armor", function() {
        expect(s1.armor).to.equal(19);
    });

    it("should parse armorRecharge", function() {
        expect(s1.armorRecharge).to.equal(20);
    });

    it("should parse energy", function() {
        expect(s1.energy).to.equal(21);
    });

    it("should parse energyRecharge", function() {
        expect(s1.energyRecharge).to.equal(22);
    });

    it("should parse skillVariation", function() {
        expect(s1.skillVariation).to.equal(5);
    });

    it("should parse availabilityNCB", function() {
        expect(s1.availabilityNCB).to.equal("b13");
    });

    it("should parse appearOn", function() {
        expect(s1.appearOn).to.equal("b123 & (b232 | !b42)");
    });

    it("should parse onPurchase", function() {
        expect(s1.onPurchase).to.equal("b1 b2 !b3 ^b4");
    });

    it("should parse deionize", function() {
        expect(s1.deionize).to.equal(24);
    });

    it("should parse ionization", function() {
        expect(s1.ionization).to.equal(23);
    });

    it("should parse keyCarried", function() {
        expect(s1.keyCarried).to.equal(137);
    });

    // I don't know what defaultItems2 is

    it("should parse outfits", function() {
        expect(s1.outfits).to.deep.equal(
            [
                { id: 149, 'count': 50 },
                { id: 151, 'count': 52 },
                { id: 153, 'count': 54 },
                { id: 155, 'count': 56 },
                { id: 157, 'count': 58 },
                { id: 159, 'count': 60 },
                { id: 161, 'count': 62 },
                { id: 163, 'count': 64 }
            ]
        );
    });

    it("should parse weapons", function() {
        expect(s1.weapons).to.deep.equal(
            [
                { id: 225, 'count': 26, 'ammo': 27 },
                { id: 128, 'count': 29, 'ammo': 30 },
                { id: 131, 'count': 32, 'ammo': 33 },
                { id: 134, 'count': 35, 'ammo': 36 },
                { id: 137, 'count': 38, 'ammo': 39 },
                { id: 140, 'count': 41, 'ammo': 42 },
                { id: 143, 'count': 44, 'ammo': 45 },
                { id: 146, 'count': 47, 'ammo': 48 }
            ]
        );
    });


    it("should parse maxGuns", function() {
        expect(s1.maxGuns).to.equal(65);
    });

    it("should parse maxTurrets", function() {
        expect(s1.maxTurrets).to.equal(66);
    });

});
