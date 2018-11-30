global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { assert } from "chai";
import { NovaParse } from "../src/NovaParse";
import { NovaResourceType } from "../src/ResourceHolderBase";
import { NovaDataInterface, NovaDataType, NovaIDNotFoundError } from "novadatainterface/NovaDataInterface";
import { ShipData } from "../../NovaDataInterface/ShipData";
import { BaseData } from "../../NovaDataInterface/BaseData";
import { ShipResource } from "../src/resourceParsers/ShipResource";
import { TurnRateConversionFactor, FPS } from "../src/parsers/Constants";
import { OutfitData } from "../../NovaDataInterface/OutiftData";
import { ExplosionData } from "../../NovaDataInterface/ExplosionData";
import { WeaponData } from "../../NovaDataInterface/WeaponData";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

const expect = chai.expect;


async function expectNovaError(parseFunction: () => Promise<BaseData>, messageVal: string | null = null) {
    try {
        var d = await parseFunction();
    }
    catch (e) {
        expect(e).to.be.an.instanceOf(NovaIDNotFoundError);
        if (messageVal !== null) {
            expect(e.message).to.equal(messageVal);
        }
    }
}


describe("NovaParse", function() {

    var np: NovaParse;

    var s1: ShipData;
    var s2: ShipData;

    before(async function() {
        np = new NovaParse("./test/novaParseTestFilesystem");
        s1 = await np.data[NovaDataType.Ship].get("nova:128");
        s2 = await np.data[NovaDataType.Ship].get("nova:129");
    });

    it("Should produce the correct error when the ID is not available", async function() {
        np.data[NovaDataType.Ship].get("totally unavailable id")
            .should.be.rejectedWith(NovaIDNotFoundError);
    });

    /*
    it("Ship should error on missing graphics", async function() {
        np.data[NovaDataType.Ship].get("nova:131")
            .should.be.rejectedWith(NovaIDNotFoundError);
    });
*/
    it("Should parse Ship", async function() {


        // Should parse the right Pict for ships that don't have a pict but share their baseImage with another ship


        s2.pictID.should.equal(s1.pictID);



        await np.data[NovaDataType.Ship].get("nova:130")
            .should.be.rejectedWith(NovaIDNotFoundError, "No matching dësc for shïp of id nova:130");


        s1.pictID.should.equal("nova:5000");
        s1.desc.should.equal("a contrived description");

        s1.properties.shield.should.equal(17);
        s1.properties.shieldRecharge.should.equal(18 * FPS / 1000);
        s1.properties.armor.should.equal(19);
        s1.properties.armorRecharge.should.equal(20 * FPS / 1000);
        s1.properties.energy.should.equal(21);
        s1.properties.energyRecharge.should.equal(FPS / 22);
        s1.properties.ionization.should.equal(23);
        s1.properties.deionize.should.equal(24 / 100 * FPS);
        s1.properties.speed.should.equal(12);
        s1.properties.acceleration.should.equal(11);
        s1.properties.turnRate.should.equal(13 * TurnRateConversionFactor);
        s1.properties.mass.should.equal(6);

        s1.displayWeight.should.equal(128);
        s1.deathDelay.should.equal(67 / 30);
        s1.largeExplosion.should.equal(true);

    });

    it("Should parse the right pict ID for ships with the same baseImage", async function() {
        // Ships with the same baseImage as a previous ship that don't have a pictID defined for them get
        // the same pictID as the previous ship's

        var s200 = await np.data[NovaDataType.Ship].get("nova:200");
        // Even though it shares baseImage with s1, it should use its own pict.
        s200.pictID.should.equal("nova:5072");
    });

    it("Should parse animations for ships", async function() {

        var anim = s1.animation;
        anim.exitPoints.should.deep.equal({
            gun: [[3, 10, 1], [-3, 10, -2], [3, 10, 3], [-3, 10, -4]],
            turret: [[0, 0, 5], [0, 0, 6], [0, 0, 7], [0, 0, 8]],
            guided: [[0, 0, 9], [0, 0, 10], [0, 0, 11], [0, 0, 12]],
            beam: [[0, 0, 13], [0, 0, 14], [0, 0, 15], [0, 0, 16]],
            upCompress: [100, 71],
            downCompress: [81, 91]
        });

        anim.id.should.equal("nova:128");
        anim.images.baseImage.should.deep.equal({
            id: 'nova:1000',
            imagePurposes:
                {
                    normal: { start: 0, length: 36 },
                    left: { start: 36, length: 36 },
                    right: { start: 72, length: 36 }
                }
        });

        // s1 has no alt image
        anim.images.should.not.haveOwnProperty("altImage");
    });

    it("Should parse which explosion a ship has", async function() {
        assert.propertyVal(s1, "initialExplosion", "nova:168");
        assert.propertyVal(s1, "finalExplosion", "nova:169");
        assert.propertyVal(s2, "initialExplosion", "nova:132");
        assert.propertyVal(s2, "finalExplosion", "nova:133");
    });

    it("Should parse explosions", async function() {
        let e132: ExplosionData = await np.data.Explosion.get("nova:132");
        e132.animation.images.should.deep.equal({
            baseImage: {
                id: "nova:1600",
                imagePurposes: {
                    normal: { start: 0, length: 108 }
                }
            }
        });

        e132.rate.should.equal(0.83);
    });

    it("Should parse ship outfits including weapons", async function() {
        s1.outfits.should.deep.equal({
            "nova:150": 26,
            "nova:151": 38,
            "nova:130": 50,
            "nova:131": 58
        });
    });

    it("Should parse outfit properties", async function() {
        let o131: OutfitData = await np.data.Outfit.get("nova:131");
        o131.properties.should.deep.equal({
            cargo: 123,
            shield: 55,
            armor: 45,
            energyRecharge: FPS / 100
        });
    });

    it("Should parse weapons (INCOMPLETE TEST)", async function() {
        var w132: WeaponData = await np.data.Weapon.get("nova:132");

        if (w132.type !== "ProjectileWeaponData") {
            assert.fail("Expected w132 to be a projectile weapon");
        }
        else {
            // Now it is known that w132 is a projectileWeapon.

        }



    });



});

