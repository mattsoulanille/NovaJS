import "jasmine";
import { NovaDataType } from "novadatainterface/nova_data_interface";
import { getDefaultJunkData } from "novadatainterface/junk_data";
import { JunkResource } from "../../src/resource_parsers/junk_resource.js";
import { JunkParse } from "../../src/parsers/junk_parse.js";
import { defaultIDSpace } from "../resource_parsers/default_id_space.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";
import { STOCK_DATA_MISSING, stockNovaParse } from "../stock_data.js";

/** A jünk with no trade stellars, so JunkParse resolves no spöb ids. */
function parseJunk(scanMask: number) {
    const b = new ResourceBuilder();
    b.array(new Array(16).fill(-1), v => b.int16(v)) // soldAt + boughtAt
        .int16(1500)                                  // basePrice
        .uint16(0)                                    // flags
        .uint16(scanMask)                             // scanMask
        .string("contraband", 0x40)                   // lcName
        .string("Contra", 0x40)                       // abbrev
        .string("", 0xff)                             // buyOn
        .string("", 0xff);                            // sellOn
    const resource = new JunkResource(
        b.resource("jünk", 128, "Contraband"), defaultIDSpace);
    resource.globalID = "nova:128";
    resource.prefix = "nova";
    return JunkParse(resource, () => { });
}

describe("JunkParse", () => {
    it("carries ScanMask through to JunkData (EVN Bible ~:1168)",
        async () => {
            expect((await parseJunk(0xa004)).scanMask).toBe(0xa004);
            expect((await parseJunk(0)).scanMask).toBe(0);
        });

    it("defaults ScanMask to 0 (legal everywhere)", () => {
        expect(getDefaultJunkData().scanMask).toBe(0);
    });

    describe("over the stock data", () => {
        it("reads the stock contraband masks", async () => {
            const np = await stockNovaParse();
            if (!np) {
                pending(STOCK_DATA_MISSING);
                return;
            }
            const junk = np.data[NovaDataType.Junk];
            // Bio-weapons: illegal to nearly every government.
            expect((await junk.get("nova:137")).scanMask).toBe(0xf597);
            // Stuffed Knup-Knups: three distinct govt classes.
            expect((await junk.get("nova:132")).scanMask).toBe(0xa004);
            // Guinness Barrels: one bit, the Roughnecks' 0x0002.
            expect((await junk.get("nova:129")).scanMask).toBe(0x0002);

            const ids = (await np.ids).Junk;
            const masked = [];
            for (const id of ids) {
                if ((await junk.get(id)).scanMask !== 0) {
                    masked.push(id);
                }
            }
            expect(ids.length).toBe(23);
            expect(masked.length).toBe(21);
        });
    });
});
