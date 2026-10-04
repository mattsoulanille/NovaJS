import "jasmine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildResourceFork, ResourceSpec } from "resource_fork/write";
import {
    comparePluginNames, IDSpaceHandler, isPluginPrefixConflictError,
    pluginBaseName, PluginPrefixConflictError, pluginPrefixFor,
    resolvePluginEntries,
} from "../src/id_space_handler.js";
import { NovaParse } from "../src/nova_parse.js";
import { resolveFixture } from "./fixtures.js";
import { ResourceBuilder } from "./resource_parsers/resource_builder.js";

// Issue #310. A plug-in's namespace prefix (its global ids, its private
// Require/Contribute flag bits and its private control bits) used to be the
// text before the FIRST dot of its name, so "X 1.0" and "X 1.1" shared one
// namespace: their new ids overwrote each other and their private bits
// merged. The prefix is now the full base name — a file's name minus one
// known extension, a directory's whole name — and two Plug-ins entries
// that still resolve to one prefix ("Foo.rez" beside "Foo.ndat", or names
// differing only in case) are a hard error naming both, which the game
// server refuses to start on. All fixtures are synthetic.

const VALID_CORE = resolveFixture(
    "IDSpaceHandlerTestFilesystem/Nova Files/Data File 1.ndat");

// Not in the fixture core's base sets (flags {0}, no control bits); the
// specs check that premise rather than assuming it.
const PRIVATE_FLAG = 7;
const PRIVATE_CONTROL_BIT = 5000;

/** An oütf written up to and including Contribute / Require. */
function buildOutf(contribute: bigint): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(0).int16(1).int16(1)                  // displayWeight, mass, techLevel
        .int16(-1).int16(0)                       // primary ModType/ModVal
        .int16(1).uint16(0).int32(1000)           // max, flags, cost
        .int16(-1).int16(0).int16(-1).int16(0)    // secondary mods x3
        .int16(-1).int16(0)
        .uint64(contribute).uint64(0n);           // contribute, require
    return b;
}

/** A crön whose OnStart sets one control bit; the rest is defaults. */
function buildCron(onStartBit: number): ResourceBuilder {
    const b = new ResourceBuilder();
    for (let i = 0; i < 11; i++) {
        b.int16(i === 10 ? -1 : 0);               // dates ... indNewsStr
    }
    b.uint16(0)                                   // flags
        .string("", 0xff)                         // enableOn
        .string(`b${onStartBit}`, 0xff)           // onStart
        .string("", 0x100);                       // onEnd
    return b;
}

function spec(type: string, id: number, name: string,
    b: ResourceBuilder): ResourceSpec {
    return { type, id, name, data: new Uint8Array(b.dataView().buffer) };
}

/** A plug-in defining oütf 900 (named `name`) and crön 900, both private. */
function pluginBytes(name: string): Buffer {
    return Buffer.from(buildResourceFork([
        spec("oütf", 900, name, buildOutf(1n << BigInt(PRIVATE_FLAG))),
        spec("crön", 900, name, buildCron(PRIVATE_CONTROL_BIT)),
    ]));
}

describe("pluginBaseName / pluginPrefixFor (issue #310)", () => {
    it("drops only one known extension, keeping every other dot", () => {
        expect(pluginBaseName("X 1.0.ndat")).toBe("X 1.0");
        expect(pluginBaseName("X 1.1.rez")).toBe("X 1.1");
        expect(pluginBaseName("Pack.npif")).toBe("Pack");
        expect(pluginBaseName("Classic.plug")).toBe("Classic");
        // Case-insensitive, like the volumes the data comes from.
        expect(pluginBaseName("Foo.REZ")).toBe("Foo");
        expect(pluginBaseName("Foo.Ndat")).toBe("Foo");
        // A classic Mac plug-in usually has no extension at all: a
        // version number is part of its name, not an extension.
        expect(pluginBaseName("HypergatePassv1.0")).toBe("HypergatePassv1.0");
        expect(pluginBaseName("X 1.0")).toBe("X 1.0");
        // Not a plug-in extension: kept.
        expect(pluginBaseName("Music.mp3")).toBe("Music.mp3");
        // Only the last extension.
        expect(pluginBaseName("Foo.rez.rez")).toBe("Foo.rez");
    });

    it("keeps a directory's whole name", () => {
        expect(pluginBaseName("Pack.rez", true)).toBe("Pack.rez");
        expect(pluginBaseName("ShipVariants v2.0", true))
            .toBe("ShipVariants v2.0");
        expect(pluginPrefixFor("Pack.rez", new Set(), { isDirectory: true }))
            .toBe("Pack.rez");
    });

    it("gives 'X 1.0' and 'X 1.1' different prefixes", () => {
        expect(pluginPrefixFor("X 1.0.ndat")).toBe("X 1.0");
        expect(pluginPrefixFor("X 1.1.ndat")).toBe("X 1.1");
        expect(pluginPrefixFor("X 1.0")).toBe("X 1.0");
    });

    it("re-keys a reserved name past a claimed one ignoring case", () => {
        spyOn(console, "warn");
        expect(pluginPrefixFor("nova.rez", new Set(["Nova-Plugin"])))
            .toBe("nova-plugin-plugin");
    });
});

describe("Plug-ins namespaces from full base names (issue #310)", () => {
    let tmpDir: string;
    let plugins: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaparse-prefix-"));
        fs.mkdirSync(path.join(tmpDir, "Nova Files"));
        plugins = path.join(tmpDir, "Plug-ins");
        fs.mkdirSync(plugins);
        fs.copyFileSync(VALID_CORE,
            path.join(tmpDir, "Nova Files", "Data File 1.ndat"));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function quietParse(): NovaParse {
        const np = new NovaParse(tmpDir, false);
        np.resourceNotFoundFunction = () => { };
        np.flagNamespaceWarn = () => { };
        np.controlBitNamespaceWarn = () => { };
        return np;
    }

    it("gives 'X 1.0' and 'X 1.1' distinct ids, flag and control-bit "
        + "namespaces", async () => {
            fs.writeFileSync(path.join(plugins, "X 1.0.ndat"),
                pluginBytes("from 1.0"));
            fs.writeFileSync(path.join(plugins, "X 1.1.ndat"),
                pluginBytes("from 1.1"));
            const handler = new IDSpaceHandler(tmpDir);
            const idSpace = await handler.getIDSpace();

            // Global ids: both survive, neither overwrites the other.
            expect(idSpace.oütf["X 1.0:900"]?.name).toBe("from 1.0");
            expect(idSpace.oütf["X 1.1:900"]?.name).toBe("from 1.1");
            expect(idSpace.oütf["X 1:900"]).toBeUndefined();
            expect(idSpace.oütf["X 1.0:900"].writerPrefix).toBe("X 1.0");
            expect(await handler.getPluginPrefixOrder())
                .toEqual(["X 1.0", "X 1.1"]);

            // Require/Contribute flags: one private bit each, separated.
            const flags = await handler.getFlagMap();
            expect(flags.baseSet.has(PRIVATE_FLAG)).toBeFalse();
            expect(flags.namespaceOrder).toEqual(["nova", "X 1.0", "X 1.1"]);
            expect(flags.physicalBit("X 1.0", PRIVATE_FLAG))
                .not.toBe(flags.physicalBit("X 1.1", PRIVATE_FLAG));

            // Control bits: likewise.
            const bits = await handler.getControlBitMap();
            expect(bits.baseSet.has(PRIVATE_CONTROL_BIT)).toBeFalse();
            expect(bits.namespaceOrder).toEqual(["nova", "X 1.0", "X 1.1"]);
            expect(bits.physicalBit("X 1.0", PRIVATE_CONTROL_BIT))
                .not.toBe(bits.physicalBit("X 1.1", PRIVATE_CONTROL_BIT));
        });

    it("refuses Foo.rez beside Foo.ndat, naming both", async () => {
        fs.writeFileSync(path.join(plugins, "Foo.rez"), pluginBytes("rez"));
        fs.writeFileSync(path.join(plugins, "Foo.ndat"), pluginBytes("ndat"));

        const rejection = resolvePluginEntries(plugins);
        await expectAsync(rejection).toBeRejectedWithError(
            PluginPrefixConflictError, /"Foo\.ndat" and "Foo\.rez"/);
        const error = await rejection.catch(e => e);
        expect(error.conflicts).toEqual([["Foo.ndat", "Foo.rez"]]);
        expect(error.pluginsPath).toBe(plugins);

        // The whole load fails, not just one of the two: nothing is
        // served from a data set in which one silently overwrote the other.
        const np = quietParse();
        await expectAsync(np.pluginPrefixCheck)
            .toBeRejectedWithError(PluginPrefixConflictError);
        await expectAsync(np.ids).toBeRejectedWithError(
            PluginPrefixConflictError, /Foo\.rez/);
    });

    it("refuses names that differ only in case", async () => {
        fs.writeFileSync(path.join(plugins, "foo.rez"), pluginBytes("lower"));
        fs.writeFileSync(path.join(plugins, "Foo.NDAT"), pluginBytes("upper"));
        await expectAsync(resolvePluginEntries(plugins)).toBeRejectedWithError(
            PluginPrefixConflictError, /"Foo\.NDAT" and "foo\.rez"/);
        expect(isPluginPrefixConflictError(
            await resolvePluginEntries(plugins).catch(e => e))).toBeTrue();
    });

    it("refuses a folder beside a file of the same base name", async () => {
        fs.mkdirSync(path.join(plugins, "Foo"));
        fs.writeFileSync(path.join(plugins, "Foo", "a.ndat"), pluginBytes("dir"));
        fs.writeFileSync(path.join(plugins, "Foo.rez"), pluginBytes("file"));
        await expectAsync(resolvePluginEntries(plugins)).toBeRejectedWithError(
            PluginPrefixConflictError, /"Foo" and "Foo\.rez"/);
    });

    it("refuses two reserved names that re-key to one namespace", async () => {
        spyOn(console, "warn");
        fs.writeFileSync(path.join(plugins, "nova.rez"), pluginBytes("a"));
        fs.writeFileSync(path.join(plugins, "nova.ndat"), pluginBytes("b"));
        await expectAsync(resolvePluginEntries(plugins)).toBeRejectedWithError(
            PluginPrefixConflictError, /"nova\.ndat" and "nova\.rez"/);
    });

    it("leaves the load order exactly the sorted entry names", async () => {
        const names = ["zzoverride.rez", "X 1.1.ndat", "arpia", "X 1.0",
            "x 1.0 extras.rez", "Bravo.ndat"];
        for (const name of names) {
            if (name === "arpia") {
                fs.mkdirSync(path.join(plugins, name));
            } else {
                fs.writeFileSync(path.join(plugins, name), Buffer.alloc(0));
            }
        }
        const entries = await resolvePluginEntries(plugins);
        expect(entries.map(e => e.name))
            .toEqual([...names].sort(comparePluginNames));
        expect(entries.map(e => e.name)).toEqual(["arpia", "Bravo.ndat",
            "X 1.0", "x 1.0 extras.rez", "X 1.1.ndat", "zzoverride.rez"]);
        expect(entries.map(e => e.prefix)).toEqual(["arpia", "Bravo",
            "X 1.0", "x 1.0 extras", "X 1.1", "zzoverride"]);
    });
});
