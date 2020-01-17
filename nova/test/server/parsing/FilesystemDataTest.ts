import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { FilesystemData } from "../../../src/server/parsing/FilesystemData";


before(function() {
    chai.should();
    chai.use(chaiAsPromised);

});

const expect = chai.expect;


describe("FilesystemData", function() {

    var fsData = new FilesystemData("nova/test/filesystemDataTestDir/");


    it("Should parse JSON from the filesystem", async function() {
        expect(await fsData.data.Ship.get("test:1337")).to.deep.equal({
            "name": "testShip",
            "id": "test:1337",
            "prefix": "test",
            "shield": 123
        });
    });

    it("Should find all IDs", async function() {
        var ids = await fsData.ids;
        ids.Ship.should.include("test:1337");
        ids.Outfit.should.include("blaster");
    });
});
