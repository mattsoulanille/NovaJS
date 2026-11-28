import "jasmine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildResourceFork } from "resource_fork/write";
import {
    describePluginOverrideReport, IDSpaceHandler, PluginOverrideReport,
} from "../src/id_space_handler.js";
import { NovaParse } from "../src/nova_parse.js";
import { resolveFixture } from "./fixtures.js";

// The plug-in override load log (Matthew, 2026-11-27: "Yeah, that's worth
// logging"). His "Planet Rico" plug-in reuses stock spöb 516 for Gravit
// Station; the "singularity" folder's Singularity1.plug overrides spöb 516
// too and, loading later, silently won. Replacing a STOCK resource is what
// plug-ins are for, so it is only counted; a plug-in replacing what
// ANOTHER plug-in file wrote gets one line naming both copies and both
// files. All fixtures are synthetic.

const FIXTURE = resolveFixture("IDSpaceHandlerTestFilesystem");
const FIXTURE_PLUGINS = path.join(FIXTURE, "Plug-ins");

function quietParse(dataPath: string): NovaParse {
    const np = new NovaParse(dataPath, false);
    np.resourceNotFoundFunction = () => { };
    np.flagNamespaceWarn = () => { };
    np.controlBitNamespaceWarn = () => { };
    np.pluginOverrideLog = () => { };
    return np;
}

describe("plug-in override report", () => {
    it("counts stock overrides and names each cross-plug-in replacement "
        + "with both files, in load order", async () => {
            // The fixture: "Plugin 1.ndat" and "Z last plug.ndat" both
            // override stock wëap 129 (Z loads later and wins); the folder
            // "plug pack" holds pp1/pp2, which both define its own wëap 153;
            // "Plugin 1" and "Z last plug" each ADD a wëap 150, which live in
            // their own namespaces and never meet.
            const report = await new IDSpaceHandler(FIXTURE).getOverrideReport();
            expect(report.stockOverrides).toBe(2);
            expect(report.fileOrder).toEqual(["plug pack/pp1.ndat",
                "plug pack/pp2.ndat", "Plugin 1.ndat", "Z last plug.ndat"]);
            // Compact: the folder's clash between its own files is one
            // line for the folder; the cross-plug-in one names the pair.
            expect(describePluginOverrideReport(report)).toEqual([
                "plug-ins override 2 stock resources; 2 resources replaced by"
                + " a later-loaded plug-in:",
                `plug pack/ (between its own files): 1 (wëap 153`
                + ` "Will be overwritten" -> "Overwritten by pp2")`,
                `wëap: Plugin 1.ndat -> Z last plug.ndat: 1 (129`
                + ` "will be overwritten" -> "Overwritten by plugin2")`,
            ]);
            // Full: one line per resource.
            expect(describePluginOverrideReport(report, { full: true })).toEqual([
                "plug-ins override 2 stock resources; 2 resources replaced by"
                + " a later-loaded plug-in:",
                `wëap 153 "Will be overwritten" (plug pack/pp1.ndat) replaced`
                + ` by "Overwritten by pp2" (plug pack/pp2.ndat)`,
                `wëap 129 "will be overwritten" (Plugin 1.ndat) replaced by`
                + ` "Overwritten by plugin2" (Z last plug.ndat)`,
            ]);
            expect(report.clashes.map(c => c.id)).not.toContain("150");
        });

    it("reports nothing when no plug-in replaces anything", async () => {
        const handler = new IDSpaceHandler(FIXTURE,
            { novaFiles: "Nova Files", novaPlugins: null });
        const report = await handler.getOverrideReport();
        expect(report).toEqual({ stockOverrides: 0, clashes: [], fileOrder: [] });
        expect(describePluginOverrideReport(report)).toEqual([]);
    });

    it("compacts to one line per plug-in pair and type, with a count, up"
        + " to three examples and load order", () => {
        const clash = (type: string, id: number, replacedFile: string,
            byFile: string, replacedName: string, byName = replacedName) =>
            ({ type, id: String(id), replacedName, replacedFile, byName, byFile });
        const report: PluginOverrideReport = {
            stockOverrides: 9,
            // Recorded in load order of the WINNING writes.
            clashes: [
                clash("oütf", 140, "Adv", "arpia/Data 1", "Etheric"),
                clash("vers", 1, "arpia/Data 1", "arpia/Data 2", ""),
                clash("shïp", 448, "arpia/Data 1", "arpia/Variants", "Hayai"),
                clash("oütf", 134, "Adv", "extra/Part 1", "IR"),
                clash("oütf", 132, "arpia/Data 1", "extra/Part 1", "HBT"),
                clash("oütf", 135, "Adv", "extra/Part 1", "IR M"),
                clash("oütf", 136, "Adv", "extra/Part 1", "Radar"),
                clash("oütf", 137, "Adv", "extra/Part 1", "Radar M"),
                clash("wëap", 9, "Adv", "extra/Part 1", "W"),
                clash("spöb", 516, "Planet Rico", "singularity/S1.plug",
                    "Gravit Station", "Wormhole"),
            ],
            fileOrder: ["Adv", "arpia/Data 1", "arpia/Data 2",
                "arpia/Variants", "extra/Part 1", "Planet Rico",
                "singularity/S1.plug"],
        };
        expect(describePluginOverrideReport(report)).toEqual([
            "plug-ins override 9 stock resources; 10 resources replaced by a"
            + " later-loaded plug-in:",
            `oütf: Adv -> arpia/Data 1: 1 (140 "Etheric")`,
            // Two files of one folder: ONE line for the folder, every type.
            `arpia/ (between its own files): 2 (vers 1 "", shïp 448 "Hayai")`,
            // Sorted by the later file, then the earlier, then the type.
            `oütf: Adv -> extra/Part 1: 4 (134 "IR", 135 "IR M", 136 "Radar", ...)`,
            `wëap: Adv -> extra/Part 1: 1 (9 "W")`,
            `oütf: arpia/Data 1 -> extra/Part 1: 1 (132 "HBT")`,
            `spöb: Planet Rico -> singularity/S1.plug: 1 (516 "Gravit Station"`
            + ` -> "Wormhole")`,
        ]);
        // Stock overrides alone: the count, no per-resource lines.
        expect(describePluginOverrideReport(
            { stockOverrides: 3, clashes: [], fileOrder: ["A"] }))
            .toEqual(["plug-ins override 3 stock resources"]);
    });

    describe("in a Plug-ins directory laid out like Planet Rico's", () => {
        let tmpDir: string;
        let plugins: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaparse-override-"));
            fs.mkdirSync(path.join(tmpDir, "Nova Files"));
            fs.copyFileSync(path.join(FIXTURE, "Nova Files", "Data File 1.ndat"),
                path.join(tmpDir, "Nova Files", "Data File 1.ndat"));
            plugins = path.join(tmpDir, "Plug-ins");
            fs.mkdirSync(path.join(plugins, "singularity"), { recursive: true });
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it("logs the folder plug-in's win over the top-level one ONCE, "
            + "through pluginOverrideLog", async () => {
                // Both override stock wëap 129; "singularity" sorts after
                // "Planet Rico", so its file loads later and wins.
                fs.copyFileSync(path.join(FIXTURE_PLUGINS, "Plugin 1.ndat"),
                    path.join(plugins, "Planet Rico.ndat"));
                fs.copyFileSync(path.join(FIXTURE_PLUGINS, "Z last plug.ndat"),
                    path.join(plugins, "singularity", "Singularity1.ndat"));
                const np = quietParse(tmpDir);
                const lines: string[] = [];
                np.pluginOverrideLog = m => lines.push(m);
                const report = await np.overrideReport;
                expect(report.clashes).toEqual([{
                    type: "wëap", id: "129",
                    replacedName: "will be overwritten",
                    replacedFile: "Planet Rico.ndat",
                    byName: "Overwritten by plugin2",
                    byFile: "singularity/Singularity1.ndat",
                }]);
                expect(lines).toEqual(["NovaParse: plug-ins override 1 stock"
                    + " resource; 1 resource replaced by a later-loaded"
                    + " plug-in:\n    "
                    + "wëap: Planet Rico.ndat -> singularity/Singularity1.ndat:"
                    + ` 1 (129 "will be overwritten" -> "Overwritten by`
                    + ` plugin2")`]);
                const idSpace = await np.idSpace;
                if (idSpace instanceof Error) {
                    throw idSpace;
                }
                expect(idSpace.wëap["nova:129"].name)
                    .toBe("Overwritten by plugin2");
            });

        it("logs every resource when NOVA_PLUGIN_OVERRIDE_LOG=full",
            async () => {
                fs.copyFileSync(path.join(FIXTURE_PLUGINS, "Plugin 1.ndat"),
                    path.join(plugins, "Planet Rico.ndat"));
                fs.copyFileSync(path.join(FIXTURE_PLUGINS, "Z last plug.ndat"),
                    path.join(plugins, "singularity", "Singularity1.ndat"));
                const saved = process.env.NOVA_PLUGIN_OVERRIDE_LOG;
                process.env.NOVA_PLUGIN_OVERRIDE_LOG = "full";
                const lines: string[] = [];
                try {
                    const np = quietParse(tmpDir);
                    np.pluginOverrideLog = m => lines.push(m);
                    await np.overrideReport;
                } finally {
                    if (saved === undefined) {
                        delete process.env.NOVA_PLUGIN_OVERRIDE_LOG;
                    } else {
                        process.env.NOVA_PLUGIN_OVERRIDE_LOG = saved;
                    }
                }
                expect(lines).toEqual(["NovaParse: plug-ins override 1 stock"
                    + " resource; 1 resource replaced by a later-loaded"
                    + " plug-in:\n    "
                    + `wëap 129 "will be overwritten" (Planet Rico.ndat)`
                    + ` replaced by "Overwritten by plugin2"`
                    + " (singularity/Singularity1.ndat)"]);
            });

        it("skips a folder inside a plug-in folder with a plain warning",
            async () => {
                // One level only (the original loads no folders at all,
                // wave 58). It used to be read as a file and fail with the
                // resource-fork "FAILED to load" banner.
                fs.mkdirSync(path.join(plugins, "singularity", "deep"));
                fs.copyFileSync(path.join(FIXTURE_PLUGINS, "Z last plug.ndat"),
                    path.join(plugins, "singularity", "deep", "Nested.ndat"));
                const warn = spyOn(console, "warn");
                const error = spyOn(console, "error");
                const report = await new IDSpaceHandler(tmpDir)
                    .getOverrideReport();
                expect(report).toEqual(
                    { stockOverrides: 0, clashes: [], fileOrder: [] });
                expect(warn).toHaveBeenCalledOnceWith(jasmine.stringMatching(
                    /skipped the folder .*singularity.deep: only files directly inside a plug-in folder load/));
                expect(error).not.toHaveBeenCalled();
            });

        it("leaves out vers (a file's version stamp, not game data)",
            async () => {
                const vers = (id: number) => ({
                    type: "vers", id, name: "",
                    data: new Uint8Array([0x01, 0x00, 0x80, 0x00, 0, 0,
                        1, 0x31, 1, 0x31]),
                });
                for (const name of ["A.ndat", "B.ndat"]) {
                    fs.writeFileSync(path.join(plugins, name),
                        Buffer.from(buildResourceFork([vers(1), vers(2)])));
                }
                const report = await new IDSpaceHandler(tmpDir)
                    .getOverrideReport();
                expect(report).toEqual({ stockOverrides: 0, clashes: [],
                    fileOrder: ["A.ndat", "B.ndat"] });
            });
    });
});
