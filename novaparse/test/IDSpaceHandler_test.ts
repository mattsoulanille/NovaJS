import "jasmine";
import path from "path";
import { IDSpaceHandler } from "../src/IDSpaceHandler";
import { NovaResources } from "../src/resource_parsers/ResourceHolderBase";


describe("IDSpaceHandler", function() {
    let idSpace: NovaResources;
    beforeEach(async function() {
        const dataPath = path.join(__dirname, "IDSpaceHandlerTestFilesystem");
        const handler = new IDSpaceHandler(dataPath);
        idSpace = await handler.getIDSpace();
    });

    it("should properly handle overwriting of data by plug-ins", function() {
        //debugger;
        //console.log(idSpace);
        expect(idSpace.wëap['nova:128'].name).toEqual("Overwrites nova files");
        expect(idSpace.wëap['plug pack:153'].name).toEqual("Overwritten by pp2");
        expect(idSpace.wëap['nova:129'].name).toEqual("Overwritten by plugin2");

        expect(idSpace.wëap['Plugin 1:150'].name).toEqual("Also doesn\'t get overwritten");
        expect(idSpace.wëap['A first plug:150'].name).toEqual("this one also not overwritten");
    });

    it("should assign the right global id to each resource", function() {
        expect(idSpace.wëap['nova:128'].globalID).toEqual("nova:128");
        expect(idSpace.wëap['nova:129'].globalID).toEqual("nova:129");
        expect(idSpace.wëap['A first plug:150'].globalID).toEqual("A first plug:150");
        expect(idSpace.wëap['Plugin 1:150'].globalID).toEqual("Plugin 1:150");
        expect(idSpace.wëap['plug pack:153'].globalID).toEqual("plug pack:153");
    });

    /*
    it("Should assign the same pictID to ships with the same baseImage", function() {
        expect(idSpace.resources.shïp["nova:128"].pictID).toEqual(5000);
        expect(idSpace.resources.shïp["nova:129"].pictID).toEqual(5000);
        expect(idSpace.resources.shïp["nova:130"].pictID).toEqual(5002);
    });
    */

    it("should defer errors to when a specific idSpace is requested", async function() {
        const broken = new IDSpaceHandler("./not/a/real/path/");
        const brokenSpace = broken.getIDSpace("nova");
        await expectAsync(brokenSpace).toBeRejected();
    });
});
