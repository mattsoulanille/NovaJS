import "jasmine";
import { GovtResource } from "../../src/resource_parsers/govt_resource.js";
import { GovtParse } from "../../src/parsers/govt_parse.js";
import { StrNResource } from "../../src/resource_parsers/strn_resource.js";
import { getEmptyNovaResources, NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { defaultIDSpace } from "../resource_parsers/default_id_space.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";
import {
    buildFlagNamespaceMapFrom, FIRST_PRIVATE_PHYSICAL_BIT, FlagResourceRef,
} from "../../src/flag_namespace.js";

/**
 * A gövt resource with every field set to a distinct, recognizable value.
 * Mirrors the byte layout exercised in govt_resource_test.ts so this test
 * focuses on the projection onto the data-interface GovtData shape.
 */
function buildGovt(interfaceId = 130): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(1003)                             // voiceType
        .uint16(0x0243)                       // flags
        .uint16(0x0091)                       // flags2
        .int16(-5)                            // scanFine
        .int16(200)                           // crimeTol
        .int16(15)                            // smugPenalty
        .int16(30)                            // disabPenalty
        .int16(45)                            // boardPenalty
        .int16(60)                            // killPenalty
        .int16(5)                             // shootPenalty
        .int16(-20)                           // initialRec
        .int16(300)                           // maxOdds
        .array([1, 2, -1, -1], v => b.int16(v))   // classes
        .array([3, -1, -1, -1], v => b.int16(v))  // allies
        .array([4, 5, 6, -1], v => b.int16(v))    // enemies
        .int16(150)                           // skillMult
        .uint16(0x8001)                       // scanMask
        .string("Vell-os", 16)                // commName
        .string("VL", 16)                     // targetCode
        .uint64(0x0000000100000002n)          // require
        .array([10, 20, 30, 40], v => b.int16(v)) // inhJam
        .string("the Vell-os", 64)            // mediumName
        .uint32(0x00ff8800)                   // color
        .uint32(0x00123456)                   // shipColor
        .int16(interfaceId)                   // interface
        .int16(9001)                          // newsPic
        .skip(16);                            // unused
    return b;
}

function parseGovt() {
    const resource = new GovtResource(
        buildGovt().resource("gövt", 128, "Vell-os"), defaultIDSpace);
    // IDSpaceHandler sets these in the real pipeline; BaseParse requires them.
    resource.globalID = "nova:128";
    resource.prefix = "nova";
    return GovtParse(resource, () => { });
}

/** Builds a STR# resource holding the given strings. */
function makeStrN(idSpace: NovaResources, id: number, strings: string[]) {
    const b = new ResourceBuilder();
    b.uint16(strings.length);
    for (const s of strings) {
        b.pstring(s);
    }
    idSpace["STR#"][id] = new StrNResource(
        b.resource("STR#", id, `strings ${id}`), idSpace);
}

/**
 * Parses a gövt of the given local id against a FRESH id space (the shared
 * defaultIDSpace is module-global; greeting fixtures must not leak into the
 * other suites), optionally seeded with one STR# resource.
 */
function parseGovtWithGreetings(govtId: number,
    strn?: { id: number, strings: string[] }) {
    const idSpace = getEmptyNovaResources();
    if (strn) {
        makeStrN(idSpace, strn.id, strn.strings);
    }
    const resource = new GovtResource(
        buildGovt().resource("gövt", govtId, "Vell-os"), idSpace);
    resource.globalID = `nova:${govtId}`;
    resource.prefix = "nova";
    return GovtParse(resource, () => { });
}

describe("GovtParse Require flag namespacing", () => {
    it("emits the raw Require (decimal) without a flag map", async () => {
        const govt = await parseGovt();
        expect(govt.require).toEqual(String(0x0000000100000002n));
    });

    it("resolves Require through the writing plug-in's namespace", async () => {
        // buildGovt's Require is bits 1 and 32. With 32 in the base set and
        // bit 1 private to "arpia", the plug-in's permit outfit (which also
        // contributes raw bit 1) must land on the same physical bit.
        const permit: FlagResourceRef = {
            type: "oütf",
            resource: { globalID: "arpia:493", writerPrefix: "arpia", contribute: 1n << 1n, require: 0n },
        };
        const resource = new GovtResource(
            buildGovt().resource("gövt", 202, "Gas Giant"), defaultIDSpace);
        resource.globalID = "arpia:202";
        resource.prefix = "arpia";
        resource.writerPrefix = "arpia";
        const gasGiant: FlagResourceRef = {
            type: "gövt",
            resource: { globalID: "arpia:202", writerPrefix: "arpia", require: resource.require },
        };
        const map = buildFlagNamespaceMapFrom(
            [permit, gasGiant], new Set([32]), ["arpia"]);

        const govt = await GovtParse(resource, () => { }, map);
        const expected = (1n << 32n) | (1n << BigInt(FIRST_PRIVATE_PHYSICAL_BIT));
        expect(govt.require).toEqual(expected.toString());
        // Same encoding as a mïsn's Require: decimal, parseable by BigInt.
        expect(BigInt(govt.require)).toEqual(expected);
        expect(map.resolve("arpia", 1n << 1n))
            .toEqual(1n << BigInt(FIRST_PRIVATE_PHYSICAL_BIT));
    });
});

describe("GovtParse comm greetings (STR# 7000 + govt offset)", () => {
    it("reads the greetings of the first government from STR# 7000",
        async () => {
            const govt = await parseGovtWithGreetings(128,
                { id: 7000, strings: ["Greetings, pilot.", "State your business."] });
            expect(govt.commGreetings)
                .toEqual(["Greetings, pilot.", "State your business."]);
        });

    it("offsets the STR# id by the government's local id (gövt 130 -> 7002)",
        async () => {
            const govt = await parseGovtWithGreetings(130,
                { id: 7002, strings: ["We are the Vell-os."] });
            expect(govt.commGreetings).toEqual(["We are the Vell-os."]);
        });

    it("ignores a STR# at the wrong offset for this government", async () => {
        // 7000 belongs to gövt 128, not to gövt 130.
        const govt = await parseGovtWithGreetings(130,
            { id: 7000, strings: ["Wrong government."] });
        expect(govt.commGreetings).toEqual([]);
    });

    it("filters blank and \"*\" placeholder entries", async () => {
        const govt = await parseGovtWithGreetings(128, {
            id: 7000,
            strings: ["Hello.", "", "*", "   ", " * ", "Goodbye."],
        });
        expect(govt.commGreetings).toEqual(["Hello.", "Goodbye."]);
    });

    it("resolves to an empty list when the government has no STR#",
        async () => {
            const govt = await parseGovtWithGreetings(128);
            expect(govt.commGreetings).toEqual([]);
        });
});

describe("GovtParse", () => {
    it("carries the BaseData fields", async () => {
        const govt = await parseGovt();
        expect(govt.id).toBe("nova:128");
        expect(govt.name).toBe("Vell-os");
        expect(govt.prefix).toBe("nova");
    });

    it("projects class/ally/enemy groupings, dropping unused entries", async () => {
        const govt = await parseGovt();
        expect(govt.classes).toEqual([1, 2]);
        expect(govt.allies).toEqual([3]);
        expect(govt.enemies).toEqual([4, 5, 6]);
    });

    it("projects combat/skill fields", async () => {
        const govt = await parseGovt();
        expect(govt.maxOdds).toBe(300);
        expect(govt.skillMult).toBe(150);
        expect(govt.crimeTol).toBe(200);
    });

    it("projects inhJam as a four-tuple", async () => {
        const govt = await parseGovt();
        expect(govt.inhJam).toEqual([10, 20, 30, 40]);
    });

    it("projects legal-record penalties", async () => {
        const govt = await parseGovt();
        expect(govt.scanFine).toBe(-5);
        expect(govt.smugglePenalty).toBe(15);
        expect(govt.disablePenalty).toBe(30);
        expect(govt.boardPenalty).toBe(45);
        expect(govt.killPenalty).toBe(60);
        expect(govt.shootPenalty).toBe(5);
        expect(govt.initialRecord).toBe(-20);
        expect(govt.scanMask).toBe(0x8001);
    });

    it("decodes Flags1 into named booleans", async () => {
        const govt = await parseGovt();
        // 0x0243 = xenophobic | attacksPlayerIfCriminal | neverAttacksPlayer
        //          | warshipsTakeBribes
        expect(govt.flags.xenophobic).toBe(true);
        expect(govt.flags.attacksPlayerIfCriminal).toBe(true);
        expect(govt.flags.neverAttacksPlayer).toBe(true);
        expect(govt.flags.warshipsTakeBribes).toBe(true);
        expect(govt.flags.alwaysAttacksPlayer).toBe(false);
        expect(govt.flags.largerBribes).toBe(false);
    });

    it("decodes Flags2 into named booleans", async () => {
        const govt = await parseGovt();
        // 0x0091 = noAssistOrMercy | roadsideAssistance | prefersWormholes
        expect(govt.flags2.noAssistOrMercy).toBe(true);
        expect(govt.flags2.roadsideAssistance).toBe(true);
        expect(govt.flags2.prefersWormholes).toBe(true);
        expect(govt.flags2.minorMapBoundaries).toBe(false);
        expect(govt.flags2.doesntUseHypergates).toBe(false);
    });

    it("projects strings and colors", async () => {
        const govt = await parseGovt();
        expect(govt.commName).toBe("Vell-os");
        expect(govt.targetCode).toBe("VL");
        expect(govt.mediumName).toBe("the Vell-os");
        expect(govt.color).toBe(0x00ff8800);
        expect(govt.shipColor).toBe(0x00123456);
        expect(govt.voiceType).toBe(1003);
    });

    it("serializes the 64-bit require mask as a decimal string (JSON-safe)", async () => {
        const govt = await parseGovt();
        expect(typeof govt.require).toBe("string");
        expect(govt.require).toBe(0x0000000100000002n.toString());
        // GovtData must survive JSON round-tripping over the HTTP data route.
        expect(() => JSON.stringify(govt)).not.toThrow();
    });
});

/**
 * gövt Interface -> the status bar's ïntf resource. EVN Bible, gövt section:
 * "ID of an ïntf resource to use when the player is flying a ship whose
 * inherent attributes govt or inherent combat govt is equal to this govt
 * type. Values less than 128 will be interpreted as 128" — the sub-128 case
 * parses to null, which the display reads as "use the default bar".
 */
describe("GovtParse status bar (gövt Interface)", () => {
    /** Parses the fixture gövt with `interfaceId` written into Interface. */
    function parseWithInterface(interfaceId: number, seedIntf?: number) {
        const idSpace = getEmptyNovaResources();
        if (seedIntf !== undefined) {
            idSpace["ïntf"][seedIntf] = {
                globalID: `nova:${seedIntf}`,
            } as NovaResources["ïntf"][number];
        }
        const resource = new GovtResource(
            buildGovt(interfaceId).resource("gövt", 128, "Vell-os"), idSpace);
        resource.globalID = "nova:128";
        resource.prefix = "nova";
        return GovtParse(resource, () => { });
    }

    it("resolves the Interface id to a global ïntf id", async () => {
        expect((await parseWithInterface(130, 130)).statusBar).toBe("nova:130");
    });

    it("is null when the named ïntf resource is missing", async () => {
        expect((await parseWithInterface(130)).statusBar).toBeNull();
    });

    it("is null for values below 128 (the engine's default bar)", async () => {
        expect((await parseWithInterface(0, 0)).statusBar).toBeNull();
    });
});
