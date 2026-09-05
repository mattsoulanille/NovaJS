import "jasmine";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildResourceFork, ResourceSpec } from "resource_fork/write";
import { NovaParse } from "../src/nova_parse.js";
import { resolveFixture } from "./fixtures.js";
import { ResourceBuilder } from "./resource_parsers/resource_builder.js";

// The #45 guard WITHOUT the real plug-in. nova's stellar_clearance_test pins
// the arpia travel permit against the installed arpia data, but that spec
// self-pends on a machine without Plug-ins, so it cannot be relied on as
// coverage. These are the same shapes rebuilt from bytes, run through the
// whole NovaParse pipeline (id space -> flag map -> GovtParse /
// OutfitParse) rather than the flag map alone, which flag_namespace_test
// and govt_parse_test already cover. Each pins one half of the fix:
//
//   - a plug-in gövt Requiring a bit the plug-in's own oütf Contributes:
//     GovtParse must resolve the Require through the writer's namespace
//     (before the fix it emitted the raw mask, which could never intersect
//     the outfit's renumbered Contribute);
//   - a STOCK gövt Requiring a bit a plug-in oütf Contributes: gövt must be
//     in FLAG_RESOURCE_TYPES so the bit joins the base set (left out of the
//     scan, the plug-in is renumbered to a private bit while the stock
//     Require's bit was never allocated at all, and resolving it throws).

const VALID_CORE = resolveFixture(
    "IDSpaceHandlerTestFilesystem/Nova Files/Data File 1.ndat");

const PLUGIN = "arpia-standin";
// Neither is in the fixture core's base set (which is {0}); the specs
// check that premise rather than assuming it.
const PRIVATE_BIT = 7;
const STOCK_BIT = 5;

/** A gövt written field by field in the order GovtResource reads them, up
 * to and including Require; the rest takes Reader's defaults. */
function buildGovt(name: string, require: bigint): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(-1)                                   // voiceType
        .uint16(0)                                // flags
        .uint16(0)                                // flags2
        .int16(0)                                 // scanFine
        .int16(0)                                 // crimeTol
        .int16(0)                                 // smugPenalty
        .int16(0)                                 // disabPenalty
        .int16(0)                                 // boardPenalty
        .int16(0)                                 // killPenalty
        .int16(0)                                 // shootPenalty
        .int16(0)                                 // initialRec
        .int16(0)                                 // maxOdds
        .array([-1, -1, -1, -1], v => b.int16(v)) // classes
        .array([-1, -1, -1, -1], v => b.int16(v)) // allies
        .array([-1, -1, -1, -1], v => b.int16(v)) // enemies
        .int16(100)                               // skillMult
        .uint16(0)                                // scanMask
        .string(name, 16)                         // commName
        .string("XX", 16)                         // targetCode
        .uint64(require);                         // require
    return b;
}

/** An oütf written up to and including Contribute / Require. */
function buildOutf(contribute: bigint): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(0)                                    // displayWeight
        .int16(1)                                 // mass
        .int16(1)                                 // techLevel
        .int16(-1).int16(0)                       // primary ModType/ModVal
        .int16(1)                                 // max
        .uint16(0)                                // flags
        .int32(1000)                              // cost
        .int16(-1).int16(0)                       // secondary ModType/ModVal x3
        .int16(-1).int16(0)
        .int16(-1).int16(0)
        .uint64(contribute)                       // contribute
        .uint64(0n);                              // require
    return b;
}

function spec(type: string, id: number, name: string,
    b: ResourceBuilder): ResourceSpec {
    return { type, id, name, data: new Uint8Array(b.dataView().buffer) };
}

describe("gövt Require through the whole NovaParse pipeline", () => {
    let tmpDir: string;
    let np: NovaParse;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "novaparse-govt-require-"));
        fs.mkdirSync(path.join(tmpDir, "Nova Files"));
        fs.mkdirSync(path.join(tmpDir, "Plug-ins"));
        fs.copyFileSync(VALID_CORE, path.join(tmpDir, "Nova Files", "Data File 1.ndat"));
        // A second core file: a stock gövt with a travel permit.
        fs.writeFileSync(path.join(tmpDir, "Nova Files", "Data File 2.ndat"),
            Buffer.from(buildResourceFork([
                spec("gövt", 128, "Federation",
                    buildGovt("Federation", 1n << BigInt(STOCK_BIT))),
            ])));
        // The plug-in: its own permit gövt + keycard, and a permit outfit
        // for the stock gövt.
        fs.writeFileSync(path.join(tmpDir, "Plug-ins", PLUGIN + ".ndat"),
            Buffer.from(buildResourceFork([
                spec("gövt", 202, "Gas Giant",
                    buildGovt("Gas Giant", 1n << BigInt(PRIVATE_BIT))),
                spec("oütf", 493, "Keycard",
                    buildOutf(1n << BigInt(PRIVATE_BIT))),
                spec("oütf", 494, "Federation Permit",
                    buildOutf(1n << BigInt(STOCK_BIT))),
            ])));

        np = new NovaParse(tmpDir, false);
        np.resourceNotFoundFunction = () => { };
        np.flagNamespaceWarn = () => { };
        np.controlBitNamespaceWarn = () => { };
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("lets a plug-in's own Contribute outfit satisfy the plug-in's gövt",
        async () => {
            const map = await np.flagMap;
            // The premise: the raw bit is private to the plug-in, so it is
            // renumbered. (Were it in the base set, both sides would keep
            // the raw bit and this spec would pass without the fix.)
            expect(map.baseSet.has(PRIVATE_BIT)).toBeFalse();

            const govt = await np.data.Govt.get(`${PLUGIN}:202`);
            const outfit = await np.data.Outfit.get(`${PLUGIN}:493`);
            expect(govt.name).toEqual("Gas Giant");
            expect(outfit.name).toEqual("Keycard");

            // Decimal encoding, like a mïsn's Require; parseable by BigInt.
            const require = BigInt(govt.require);
            const contribute = BigInt(outfit.contribute);
            expect(require).not.toBe(0n);
            // Renumbered to a plug-in-private physical bit at or past 64 ...
            expect(require & ((1n << 64n) - 1n)).toBe(0n);
            expect(require).toBe(map.resolve(PLUGIN, 1n << BigInt(PRIVATE_BIT)));
            // ... and to the SAME bit the outfit contributes, so holding
            // the outfit satisfies the Require.
            expect(require).toBe(contribute);
            expect((require & contribute) === require).toBeTrue();

            // Nothing stock contributes the bit, but the plug-in itself
            // does, so its Require is not reported as unsatisfiable.
            expect(map.report.unsatisfiable).toEqual([]);
        });

    it("puts a stock gövt's Require bit in the base set, where a plug-in "
        + "outfit's Contribute shares it", async () => {
            const map = await np.flagMap;
            expect(map.baseSet.has(STOCK_BIT)).toBeTrue();

            const govt = await np.data.Govt.get("nova:128");
            const outfit = await np.data.Outfit.get(`${PLUGIN}:494`);
            expect(govt.name).toEqual("Federation");
            expect(outfit.name).toEqual("Federation Permit");

            // Base bits keep their raw number on both sides.
            expect(BigInt(govt.require)).toBe(1n << BigInt(STOCK_BIT));
            expect(BigInt(outfit.contribute)).toBe(1n << BigInt(STOCK_BIT));
        });
});
