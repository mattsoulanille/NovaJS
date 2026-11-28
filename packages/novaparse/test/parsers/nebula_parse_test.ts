import "jasmine";
import { PNG } from "pngjs";
import {
    NebulaParse, nebulaPictIds, pictFrameSize,
} from "../../src/parsers/nebula_parse.js";
import { NebuResource } from "../../src/resource_parsers/nebu_resource.js";
import { PictResource } from "../../src/resource_parsers/pict_resource.js";
import { getEmptyNovaResources } from "../../src/resource_parsers/resource_holder_base.js";
import { ResourceBuilder } from "../resource_parsers/resource_builder.js";
import { STOCK_DATA_MISSING, stockNovaParse } from "../stock_data.js";

/** A PICT whose only meaningful bytes are its picFrame. */
function pict(id: number, width: number, height: number,
    idSpace = getEmptyNovaResources()): PictResource {
    const b = new ResourceBuilder();
    b.uint16(0).int16(10).int16(20).int16(10 + height).int16(20 + width);
    const resource = new PictResource(b.resource("PICT", id), idSpace);
    resource.globalID = `nova:${id}`;
    resource.prefix = "nova";
    return resource;
}

function nebu(id: number, idSpace = getEmptyNovaResources()): NebuResource {
    const b = new ResourceBuilder();
    b.int16(430).int16(45).int16(251).int16(298)
        .string("b300", 0xff).string("b301 !b302", 0xff).skip(0x10);
    const resource = new NebuResource(b.resource("nëbu", id, "Haze"), idSpace);
    resource.globalID = `nova:${id}`;
    resource.prefix = "nova";
    resource.writerPrefix = "nova";
    return resource;
}

describe("NebulaParse", () => {
    it("numbers a nebula's seven PICT slots 9500 + 7 * (id - 128)", () => {
        // "the first nebula's PICTs are 9500-96, the second's are 9507-13"
        expect(nebulaPictIds(128)).toEqual([9500, 9501, 9502, 9503, 9504, 9505, 9506]);
        expect(nebulaPictIds(129)[0]).toBe(9507);
        expect(nebulaPictIds(129)[6]).toBe(9513);
        // The 32nd and last nebula ends at 9723: 32 x 7 = 224 PICTs from
        // 9500, so the Bible's "9500-9724" overstates the end by one.
        expect(nebulaPictIds(159)[6]).toBe(9723);
    });

    it("reads a PICT's size from its picFrame", () => {
        expect(pictFrameSize(pict(9500, 63, 75))).toEqual({ width: 63, height: 75 });
    });

    it("carries the position, size and NCB fields, and the slots that exist "
        + "in slot order", async () => {
            const idSpace = getEmptyNovaResources();
            // Slots 0 and 2 of nebula 129 (PICTs 9507 and 9509); slot 1 missing.
            idSpace.PICT[9507] = pict(9507, 17, 25, idSpace);
            idSpace.PICT[9509] = pict(9509, 65, 98, idSpace);
            // Nebula 128's PICT must not be picked up by nebula 129.
            idSpace.PICT[9500] = pict(9500, 63, 75, idSpace);
            const data = await NebulaParse(nebu(129, idSpace), () => { });
            expect(data.id).toBe("nova:129");
            expect(data.name).toBe("Haze");
            expect(data.position).toEqual([430, 45]);
            expect(data.size).toEqual([251, 298]);
            expect(data.activeOn).toBe("b300");
            expect(data.onExplore).toBe("b301 !b302");
            expect(data.images).toEqual([
                { id: "nova:9507", width: 17, height: 25 },
                { id: "nova:9509", width: 65, height: 98 },
            ]);
        });

    it("has no images when none of its PICTs exist", async () => {
        const data = await NebulaParse(nebu(140), () => { });
        expect(data.images).toEqual([]);
    });

    describe("on the stock data", () => {
        /**
         * The four stock nebulae, measured with this parser: each fills
         * slots 0-2 only, at a quarter, a half and the whole of its size —
         * except L-1551, whose slots are a half, the whole and DOUBLE its
         * size. So the slot number is not a map scale; the display picks
         * by pixel size (nova spaceport/starmap_nebulae.ts).
         */
        const STOCK: { [id: string]: [string, number[], number[], number[][]] } = {
            "nova:128": ["Holpa Nebula", [430, 45], [251, 298],
                [[63, 75], [126, 149], [251, 298]]],
            "nova:129": ["Obatta Nebula", [60, 40], [65, 90],
                [[17, 25], [33, 49], [65, 98]]],
            "nova:130": ["Rochak Dust Field", [263, 145], [109, 95],
                [[28, 24], [55, 48], [109, 95]]],
            "nova:131": ["L-1551", [-138, -226], [146, 71],
                [[73, 36], [146, 71], [292, 141]]],
        };

        it("has the four nebulae, ungated, with three pictures each whose "
            + "frames match their decoded size", async () => {
                const np = await stockNovaParse();
                if (!np) {
                    pending(STOCK_DATA_MISSING);
                    return;
                }
                expect([...(await np.ids).Nebula].sort())
                    .toEqual(Object.keys(STOCK).sort());
                for (const [id, [name, position, size, images]] of Object.entries(STOCK)) {
                    const nebula = await np.data.Nebula.get(id);
                    expect(nebula.name).toBe(name);
                    expect(nebula.position).toEqual(position as [number, number]);
                    expect(nebula.size).toEqual(size as [number, number]);
                    expect(nebula.activeOn).toBe("");
                    expect(nebula.onExplore).toBe("");
                    expect(nebula.images.map(i => [i.width, i.height]))
                        .withContext(id).toEqual(images);
                    const first = 9500 + 7 * (Number(id.split(":")[1]) - 128);
                    expect(nebula.images.map(i => i.id))
                        .toEqual([0, 1, 2].map(k => `nova:${first + k}`));
                    for (const image of nebula.images) {
                        const png = PNG.sync.read(Buffer.from(
                            await np.data.PictImage.get(image.id)));
                        expect([png.width, png.height]).withContext(image.id)
                            .toEqual([image.width, image.height]);
                    }
                }
            });
    });
});
