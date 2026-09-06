import "jasmine";
import { isConvex } from "novaparse/hull/convex_decomposition";
import { getIntegrationGameData } from "../../communication/simulation_test_fixture.js";

// The Raven is noticeably non-convex (a deep notch between its prongs),
// so it regression-tests the approximate convex decomposition on real
// game data: a single convex hull would cover the notch.
describe("Raven hull decomposition", () => {
    const RAVEN_ID = "nova:164";

    it("decomposes every frame into a few convex components", async () => {
        const gameData = await getIntegrationGameData();
        const ship = await gameData.data.Ship.get(RAVEN_ID);
        const spriteSheet = await gameData.data.SpriteSheet.get(
            ship.animation.images.baseImage.id);

        expect(spriteSheet.hulls.length).toBeGreaterThan(0);
        for (const hull of spriteSheet.hulls) {
            expect(hull.length).toBeGreaterThan(1);
            expect(hull.length).toBeLessThanOrEqual(8);
            for (const convexHull of hull) {
                expect(convexHull.length).toBeGreaterThanOrEqual(3);
                expect(isConvex(convexHull, 1e-6)).toBeTrue();
            }
        }
    });
});
