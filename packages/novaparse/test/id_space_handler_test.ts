import "jasmine";
import { comparePluginNames, IDSpaceHandler } from "../src/id_space_handler.js";
import { NovaParse } from "../src/nova_parse.js";
import { NovaResources } from "../src/resource_parsers/resource_holder_base.js";
import { resolveFixture } from "./fixtures.js";


describe("IDSpaceHandler", () => {
    let idSpace: NovaResources;
    beforeEach(async () => {
        const dataPath = resolveFixture("IDSpaceHandlerTestFilesystem");
        const handler = new IDSpaceHandler(dataPath);
        idSpace = await handler.getIDSpace();
    });

    it("should properly handle overwriting of data by plug-ins", () => {
        //debugger;
        //console.log(idSpace);
        expect(idSpace.wëap['nova:128'].name).toEqual("Overwrites nova files");
        expect(idSpace.wëap['plug pack:153'].name).toEqual("Overwritten by pp2");
        expect(idSpace.wëap['nova:129'].name).toEqual("Overwritten by plugin2");

        expect(idSpace.wëap['Plugin 1:150'].name).toEqual("Also doesn\'t get overwritten");
        expect(idSpace.wëap['Z last plug:150'].name).toEqual("this one also not overwritten");
    });

    it("should assign the right global id to each resource", () => {
        expect(idSpace.wëap['nova:128'].globalID).toEqual("nova:128");
        expect(idSpace.wëap['nova:129'].globalID).toEqual("nova:129");
        expect(idSpace.wëap['Z last plug:150'].globalID).toEqual("Z last plug:150");
        expect(idSpace.wëap['Plugin 1:150'].globalID).toEqual("Plugin 1:150");
        expect(idSpace.wëap['plug pack:153'].globalID).toEqual("plug pack:153");
    });

    /*
    it("Should assign the same pictID to ships with the same baseImage", () => {
        expect(idSpace.resources.shïp["nova:128"].pictID).toEqual(5000);
        expect(idSpace.resources.shïp["nova:129"].pictID).toEqual(5000);
        expect(idSpace.resources.shïp["nova:130"].pictID).toEqual(5002);
    });
    */

    it("records which plug-in WROTE each resource, even for overrides", () => {
        // `prefix` is where the resource lives; `writerPrefix` is who wrote
        // it. They differ exactly for a plug-in's override of a core id —
        // which is what the per-plug-in Require/Contribute namespacing (and
        // later, plug-in control bits) key off.
        expect(idSpace.wëap['nova:300'].prefix).toEqual("nova");
        expect(idSpace.wëap['nova:300'].writerPrefix).toEqual("nova");

        expect(idSpace.wëap['nova:128'].prefix).toEqual("nova");
        expect(idSpace.wëap['nova:128'].writerPrefix).toEqual("plug pack");
        expect(idSpace.wëap['nova:129'].prefix).toEqual("nova");
        expect(idSpace.wëap['nova:129'].writerPrefix).toEqual("Z last plug");

        expect(idSpace.wëap['Plugin 1:150'].writerPrefix).toEqual("Plugin 1");
        expect(idSpace.wëap['plug pack:153'].writerPrefix).toEqual("plug pack");
    });

    it("loads plug-ins in name order, explicitly sorted", async () => {
        // The Plug-ins directory holds "Z last plug.ndat", "Plugin 1.ndat"
        // and the "plug pack" subdirectory. Sorted case-insensitively by
        // name that is plug pack, Plugin 1, Z last plug — and this order is
        // what the flag namespace allocation follows, so it must not depend
        // on readdir.
        const dataPath = resolveFixture("IDSpaceHandlerTestFilesystem");
        const handler = new IDSpaceHandler(dataPath);
        expect(await handler.getPluginPrefixOrder())
            .toEqual(["plug pack", "Plugin 1", "Z last plug"]);
        // The last-loaded plug-in's override wins: "Z last plug" and
        // "Plugin 1" both redefine the stock wëap 129.
        expect(idSpace.wëap['nova:129'].writerPrefix).toEqual("Z last plug");
    });

    it("orders plug-in names case-insensitively, with a stable tie-break",
        () => {
            // Case-insensitive, so a lowercase name does not automatically
            // sort after every uppercase one (the original game's data
            // lives on a case-insensitive volume). Names that differ only
            // in case still get a total order, and it does not depend on
            // the host locale.
            expect(["zzoverride.rez", "Zealot.rez", "arpia", "Bravo"]
                .sort(comparePluginNames))
                .toEqual(["arpia", "Bravo", "Zealot.rez", "zzoverride.rez"]);
            expect(comparePluginNames("Alpha", "Alpha")).toBe(0);
            expect(comparePluginNames("Alpha", "alpha")).toBeLessThan(0);
            expect(comparePluginNames("alpha", "Alpha")).toBeGreaterThan(0);
        });

    it("builds the flag namespace map from the loaded data", async () => {
        const dataPath = resolveFixture("IDSpaceHandlerTestFilesystem");
        const handler = new IDSpaceHandler(dataPath);
        const map = await handler.getFlagMap();
        // The fixture's stock hulls contribute bit 0 and nothing in it uses
        // any other flag bit, so there is nothing to allocate.
        expect(map.report.baseSet).toEqual([0]);
        expect(map.report.namespaces).toEqual([]);
        expect(map.namespaceOrder).toEqual(["nova"]);
        expect(map.resolve("plug pack", 1n)).toBe(1n);
        // Built twice from the same data: identical.
        const again = await new IDSpaceHandler(dataPath).getFlagMap();
        expect(again.report).toEqual(map.report);
    });

    it("should defer errors to when a specific idSpace is requested", async () => {
        const broken = new IDSpaceHandler("./not/a/real/path/");
        const brokenSpace = broken.getIDSpace("nova");
        await expectAsync(brokenSpace).toBeRejected();
    });
});

// `novaPlugins: null` is the explicit opt-out used by the integration test
// fixture so that test results don't depend on which plug-ins a developer
// happens to have installed. It must load the base "Nova Files" data exactly
// as usual while skipping the Plug-ins directory entirely — including the
// plug-in overwrites of core ids.
describe("IDSpaceHandler with plug-in loading disabled", () => {
    const dataPath = resolveFixture("IDSpaceHandlerTestFilesystem");
    let noPlugins: NovaResources;

    beforeEach(async () => {
        noPlugins = await new IDSpaceHandler(dataPath,
            { novaFiles: "Nova Files", novaPlugins: null }).getIDSpace();
    });

    it("still loads the core Nova Files resources", () => {
        expect(noPlugins.wëap['nova:300'].name)
            .toEqual("will not be overwritten");
        expect(noPlugins.wëap['nova:300'].globalID).toEqual("nova:300");
    });

    it("omits every plug-in-namespaced resource", () => {
        expect(noPlugins.wëap['plug pack:150']).toBeUndefined();
        expect(noPlugins.wëap['plug pack:153']).toBeUndefined();
        expect(noPlugins.wëap['Plugin 1:150']).toBeUndefined();
        expect(noPlugins.wëap['Z last plug:150']).toBeUndefined();

        // Nothing outside the "nova:" namespace survives at all.
        expect(Object.keys(noPlugins.wëap).sort())
            .toEqual(['nova:128', 'nova:129', 'nova:300']);
    });

    it("keeps the ORIGINAL core values that plug-ins would have overwritten",
        async () => {
            // With plug-ins these two read "Overwrites nova files" and
            // "Overwritten by plugin2" (see the suite above).
            expect(noPlugins.wëap['nova:128'].name)
                .toEqual("will be overwritten (source nova files)");
            expect(noPlugins.wëap['nova:129'].name)
                .toEqual("a weap to overwrite");

            const withPlugins = await new IDSpaceHandler(dataPath).getIDSpace();
            expect(withPlugins.wëap['nova:128'].name)
                .toEqual("Overwrites nova files");
        });

    it("does not change the default, which still loads plug-ins", async () => {
        const defaulted = await new IDSpaceHandler(dataPath).getIDSpace();
        expect(defaulted.wëap['Plugin 1:150'].name)
            .toEqual("Also doesn't get overwritten");
    });
});

describe("NovaParse with plug-in loading disabled", () => {
    const dataPath = resolveFixture("IDSpaceHandlerTestFilesystem");

    it("exposes only Nova Files ids", async () => {
        const noPlugins = new NovaParse(dataPath, false,
            { novaFiles: "Nova Files", novaPlugins: null });
        const ids = await noPlugins.ids;

        expect(ids.Weapon).toContain("nova:300");
        for (const id of ids.Weapon) {
            expect(id.startsWith("nova:")).toBeTrue();
        }
    });

    it("loads plug-in ids by default", async () => {
        const withPlugins = new NovaParse(dataPath, false);
        const ids = await withPlugins.ids;
        expect(ids.Weapon).toContain("Plugin 1:150");
    });
});
