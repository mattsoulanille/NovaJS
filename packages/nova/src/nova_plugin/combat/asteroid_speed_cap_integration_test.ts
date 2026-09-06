import "jasmine";
import { getIntegrationGameData } from "../../communication/simulation_test_fixture.js";
import { MAX_ASTEROID_SPEED } from "./asteroid_plugin.js";

/**
 * MAX_ASTEROID_SPEED is hardcoded on purpose (the sim must not vary
 * with the developer's installed plug-ins), so this pins the
 * derivation against the real stock data it was read off: the top speed
 * of the fastest stock ship that is not the Escape Pod.
 */
describe("MAX_ASTEROID_SPEED derivation", () => {
    // shïp nova:895, Speed 2000 -> 600 px/s. A lifeboat, not a ship
    // anyone flies, and fast enough to make the cap meaningless.
    const ESCAPE_POD_ID = "nova:895";
    const MANTA_ID = "nova:315";

    it("equals the fastest stock ship's speed, escape pod excluded",
        async () => {
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;

            let fastest: { id: string, name: string, speed: number } | undefined;
            for (const id of ids.Ship) {
                if (id === ESCAPE_POD_ID) {
                    continue;
                }
                const { name, physics } = await gameData.data.Ship.get(id);
                if (!fastest || physics.speed > fastest.speed) {
                    fastest = { id, name, speed: physics.speed };
                }
            }

            expect(fastest).toBeDefined();
            // The Manta, shïp Speed 660, converted by ship_parse with
            // ShipSpeedConversionFactor (FPS / 100 = 0.3) into px/s:
            // 660 * 0.3 = 198, the same units asteroid drift uses.
            expect(fastest!.id).toBe(MANTA_ID);
            expect(fastest!.name).toBe("Manta");
            expect(fastest!.speed).toBe(MAX_ASTEROID_SPEED);

            // And the pod really is the outlier that had to be excluded.
            const pod = await gameData.data.Ship.get(ESCAPE_POD_ID);
            expect(pod.physics.speed).toBeGreaterThan(MAX_ASTEROID_SPEED);
        });
});
