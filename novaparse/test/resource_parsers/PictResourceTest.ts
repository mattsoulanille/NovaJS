global.Promise = require("bluebird"); // For stacktraces

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { PNG } from "pngjs";
import { readResourceFork, ResourceMap } from "resourceforkjs";
import { NovaResources } from "../../src/resource_parsers/ResourceHolderBase";
import { PictResource } from "../../src/resource_parsers/PictResource";
import { comparePNGs, getPNG } from "./PNGCompare";
import { defaultIDSpace } from "./DefaultIDSpace";



before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});

//const expect = chai.expect;


describe("PictResource", function() {
    var ship: PictResource;
    var landed: PictResource;
    var statusBar: PictResource;
    var targetImage: PictResource;

    var shipPNG: PNG;
    var landedPNG: PNG;
    var statusBarPNG: PNG;
    var targetImagePNG: PNG;
    var rf: ResourceMap;

    // Picts don't depend on other resources.

    var idSpace: NovaResources = defaultIDSpace;

    before(async function() {
        debugger;
        shipPNG = await getPNG("novaparse/test/resource_parsers/files/picts/ship.png");
        landedPNG = await getPNG("novaparse/test/resource_parsers/files/picts/landed.png");
        statusBarPNG = await getPNG("novaparse/test/resource_parsers/files/picts/statusBar.png");
        targetImagePNG = await getPNG("novaparse/test/resource_parsers/files/picts/targetImage.png");

        rf = await readResourceFork("novaparse/test/resource_parsers/files/pict.ndat", false);

        var picts = rf.PICT;
        ship = new PictResource(picts[20158], idSpace);
        landed = new PictResource(picts[10034], idSpace);
        statusBar = new PictResource(picts[700], idSpace);
        targetImage = new PictResource(picts[3000], idSpace);
    });

    it("should parse pict into a png", function() {
        this.timeout(10000);
        comparePNGs(ship.png, shipPNG);
        comparePNGs(landed.png, landedPNG);
        comparePNGs(statusBar.png, statusBarPNG);
        comparePNGs(targetImage.png, targetImagePNG);
    });

});
