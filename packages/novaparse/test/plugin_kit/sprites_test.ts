import "jasmine";
import { Resource } from "resource_fork";
import { discShipGraphics } from "../../src/plugin_kit/sprites.js";
import { RledResource } from "../../src/resource_parsers/rled_resource.js";
import { ShanResource } from "../../src/resource_parsers/shan_resource.js";
import { getEmptyNovaResources } from "../../src/resource_parsers/resource_holder_base.js";

function resource(type: string, id: number, bytes: number[]): Resource {
    return new Resource(type, id, "Disc", new DataView(new Uint8Array(bytes).buffer));
}

describe("plugin_kit disc sprites", () => {
    const { rled, shan } = discShipGraphics(2000, [31, 0, 0], 24, 36);

    it("decodes as a 24x24, 36-frame sheet whose pixels are one exact colour", () => {
        const sheet = new RledResource(resource("rlëD", 2000, rled), getEmptyNovaResources());
        expect(sheet.size).toEqual([24, 24]);
        const frames = sheet.frames;
        expect(frames.length).toBe(36);
        const colours = new Set<string>();
        let opaque = 0;
        const f = frames[17];
        for (let i = 0; i < f.data.length; i += 4) {
            if (f.data[i + 3] === 0) continue;
            opaque++;
            colours.add(`${f.data[i]},${f.data[i + 1]},${f.data[i + 2]}`);
        }
        expect(colours.size).toBe(1);
        // Disc of diameter 22: about pi * 11^2 pixels.
        expect(opaque).toBeGreaterThan(360);
        expect(opaque).toBeLessThan(400);
    });

    it("has a shän whose base image is the sheet", () => {
        const s = new ShanResource(resource("shän", 700, shan), getEmptyNovaResources());
        expect(s.images.baseImage.ID).toBe(2000);
        expect(s.images.baseImage.size).toEqual([24, 24]);
        expect(s.framesPer).toBe(36);
    });
});
