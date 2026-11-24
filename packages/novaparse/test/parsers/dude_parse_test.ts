import "jasmine";
import { DudeResource } from "../../src/resource_parsers/dude_resource.js";
import { DudeParse } from "../../src/parsers/dude_parse.js";
import { getEmptyNovaResources, NovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";
import { StrNResource } from "../../src/resource_parsers/strn_resource.js";
import { DudeData, getDefaultDudeHailInfo } from "novadatainterface/dude_data";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { STOCK_DATA_MISSING, stockNovaParse } from "../stock_data.js";

/** An id space stubbed with just the globalIDs the parser resolves. */
function makeIdSpace(): NovaResources {
    const idSpace = getEmptyNovaResources();
    const stub = (globalID: string) => ({ globalID }) as never;
    idSpace.shïp[200] = stub("nova:200");
    idSpace.shïp[201] = stub("nova:201");
    idSpace.gövt[150] = stub("nova:150");
    return idSpace;
}

/** A düde pointing at ships 200, 201, and a missing 202. */
function buildDude(govt: number, infoTypes = 0x8000): ResourceBuilder {
    const b = new ResourceBuilder();
    b.int16(3)                                  // aiType (warship)
        .int16(govt)                            // govt
        .uint16(0x0041)                         // flags (food | money)
        .uint16(infoTypes)                      // infoTypes
        .array([200, 201, 202, ...Array(13).fill(-1)],
            (v: number) => b.int16(v))          // ship ids
        .array([40, 35, 25, ...Array(13).fill(0)],
            (v: number) => b.int16(v));         // probabilities
    return b;
}

function parseDude(govt = 150, infoTypes = 0x8000) {
    const idSpace = makeIdSpace();
    // STR# 7503: specific advice for InfoTypes 0x4003.
    const strn = new ResourceBuilder();
    strn.uint16(3).pstring("Watch for pirates near Sol.").pstring("*")
        .pstring("Buy low, sell high.");
    idSpace["STR#"][7503] = new StrNResource(
        strn.resource("STR#", 7503, "advice"), idSpace);
    const resource = new DudeResource(
        buildDude(govt, infoTypes).resource("düde", 128, "Test Dude"),
        idSpace);
    resource.globalID = "nova:128";
    resource.prefix = "nova";
    return DudeParse(resource, () => { });
}

describe("DudeParse", () => {
    it("carries the BaseData fields", async () => {
        const dude = await parseDude();
        expect(dude.id).toBe("nova:128");
        expect(dude.name).toBe("Test Dude");
    });

    it("projects the AI type", async () => {
        const dude = await parseDude();
        expect(dude.aiType).toBe(3);
    });

    it("resolves the govt to a global id", async () => {
        const dude = await parseDude();
        expect(dude.govt).toBe("nova:150");
    });

    it("maps govt -1 (independent) to null", async () => {
        const dude = await parseDude(-1);
        expect(dude.govt).toBeNull();
    });

    it("degrades a missing govt to independent", async () => {
        const dude = await parseDude(180);
        expect(dude.govt).toBeNull();
    });

    it("resolves ship classes to global ids with weights, dropping " +
        "missing ships", async () => {
            const dude = await parseDude();
            expect(dude.ships).toEqual([
                { id: "nova:200", weight: 40 },
                { id: "nova:201", weight: 35 },
                // shïp 202 is not in the id space: dropped.
            ]);
        });

    it("stays JSON-serializable", async () => {
        const dude = await parseDude();
        expect(() => JSON.stringify(dude)).not.toThrow();
    });

    describe("hail info (InfoTypes, EVN Bible ~:832-839)", () => {
        it("decodes the three plain bits", async () => {
            expect((await parseDude(150, 0xb000)).hailInfo).toEqual({
                goodPrices: true,
                disasterInfo: true,
                genericGovtHail: true,
                specificAdvice: [],
            });
            expect((await parseDude(150, 0x1000)).hailInfo).toEqual({
                ...getDefaultDudeHailInfo(), goodPrices: true,
            });
        });

        it("has nothing to say for InfoTypes 0", async () => {
            expect((await parseDude(150, 0)).hailInfo)
                .toEqual(getDefaultDudeHailInfo());
        });

        it("resolves 0x4xxx to STR# 7500 + xxx, dropping '*' lines",
            async () => {
                const info = (await parseDude(150, 0x4003)).hailInfo;
                expect(info.specificAdvice).toEqual(
                    ["Watch for pirates near Sol.", "Buy low, sell high."]);
                expect(info.genericGovtHail).toBe(false);
            });

        it("leaves the advice empty when its STR# is missing", async () => {
            spyOn(console, "warn");
            const info = (await parseDude(150, 0x4004)).hailInfo;
            expect(info.specificAdvice).toEqual([]);
            expect(console.warn).toHaveBeenCalled();
        });

        it("reads the stock InfoTypes", async () => {
            const np = await stockNovaParse();
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            const dudes: DudeData[] = [];
            for (const id of (await np.ids).Dude) {
                dudes.push(await np.data[NovaDataType.Dude].get(id));
            }
            const count = (test: (d: DudeData) => boolean) =>
                dudes.filter(test).length;
            expect(dudes.length).toBe(147);
            expect(count(d => d.hailInfo.goodPrices
                || d.hailInfo.disasterInfo || d.hailInfo.genericGovtHail
                || d.hailInfo.specificAdvice.length > 0)).toBe(130);
            expect(count(d => d.hailInfo.goodPrices)).toBe(26);
            expect(count(d => d.hailInfo.disasterInfo)).toBe(24);
            expect(count(d => d.hailInfo.genericGovtHail)).toBe(119);
            expect(count(d => d.hailInfo.specificAdvice.length > 0)).toBe(0);
        });
    });
});
