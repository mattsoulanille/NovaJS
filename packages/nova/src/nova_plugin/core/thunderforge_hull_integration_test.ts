import "jasmine";
import { ConvexHull } from "novadatainterface/sprite_sheet_data";
import { getIntegrationGameData } from "../../communication/simulation_test_fixture.js";

/**
 * The Aurora Thunderforge (shïp/shän nova:380) is the only stock ship
 * whose hull is split across two sprite layers: rlëD nova:1130 holds just
 * the fore and aft sections, and the huge drum spinning between them is
 * the ALT image, rlëD nova:1330 — six animation sets of 64 headings,
 * cycled by the clock (shän flag 0x0008).
 *
 * Collision reads hulls off the base sheet alone (`hullFromAnimation`),
 * so before the alt layer was folded into hull generation shots flew
 * clean through the visible middle of the ship. Worse, the base sheet is
 * two DISCONNECTED blobs and traceOutline keeps only the largest
 * connected region, so the hull covered one end of the ship and nothing
 * else.
 *
 * Pinned against the real game data, not a fixture.
 */
describe("Aurora Thunderforge hull", () => {
    const THUNDERFORGE_ID = "nova:380";
    // Frames in one full rotation (shän FramesPer).
    const HEADINGS = 64;

    /**
     * Points inside the spinning drum, in the centred y-up frame the
     * hulls use. Every one of these is a fully opaque pixel of the alt
     * sprite at all 64 headings in all six animation sets, and none of
     * them was inside any base-only hull.
     */
    const DRUM_POINTS: Array<[number, number]> = [
        [0, 0], [2, 0], [4, 4], [6, 6], [8, 2], [2, 10],
    ];

    function inPolygon(polygon: ConvexHull, [x, y]: [number, number]) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            if ((yi > y) !== (yj > y) &&
                x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    it("covers the spinning central section at every heading", async () => {
        const gameData = await getIntegrationGameData();
        const ship = await gameData.data.Ship.get(THUNDERFORGE_ID);
        const spriteSheet = await gameData.data.SpriteSheet.get(
            ship.animation.images.baseImage.id);

        expect(ship.animation.images.altImage).toBeDefined();
        expect(spriteSheet.hulls.length).toBe(HEADINGS);

        const uncovered: string[] = [];
        for (let heading = 0; heading < HEADINGS; heading++) {
            const hull = spriteSheet.hulls[heading];
            for (const point of DRUM_POINTS) {
                if (!hull.some(component => inPolygon(component, point))) {
                    uncovered.push(`${heading}@${point}`);
                }
            }
        }
        expect(uncovered).toEqual([]);
    });

    it("stays a decomposition of a few valid convex components", async () => {
        // The same budget the Raven spec pins: unioning the alt layer must
        // not blow past MAX_HULL_COMPONENTS.
        const gameData = await getIntegrationGameData();
        const ship = await gameData.data.Ship.get(THUNDERFORGE_ID);
        const spriteSheet = await gameData.data.SpriteSheet.get(
            ship.animation.images.baseImage.id);

        for (const hull of spriteSheet.hulls) {
            expect(hull.length).toBeGreaterThan(0);
            expect(hull.length).toBeLessThanOrEqual(8);
            for (const component of hull) {
                expect(component.length).toBeGreaterThanOrEqual(3);
            }
        }
    });

    it("leaves ships without an alt layer alone", async () => {
        // The Raven has no alt image, so its base sheet must still be the
        // whole story. (Guards against the overlay map attaching itself to
        // a sheet that shares nothing with a shän that has one.)
        const gameData = await getIntegrationGameData();
        const raven = await gameData.data.Ship.get("nova:164");
        expect(raven.animation.images.altImage).toBeUndefined();
        const spriteSheet = await gameData.data.SpriteSheet.get(
            raven.animation.images.baseImage.id);
        expect(spriteSheet.hulls.length).toBeGreaterThan(0);
    });
});
