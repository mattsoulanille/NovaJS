import 'jasmine';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';

/**
 * Against the real Nova Files: a mined asteroid's resource-boxes are drawn
 * with the mini-asteroid spïns 501-504 by röid family, never with spïn 500
 * "Boxes" (a ship's jettisoned-cargo crate). The stock spïns are named
 * "Micro Metal" (501, rlëD 502), "Micro Ice" (502, rlëD 504), "Micro
 * Silicates" (503, rlëD 506), "Micro Metal [rich]" (504, rlëD 508).
 */
describe('asteroid debris sprites (real data)', () => {
    it('draws Metal asteroid debris as Micro Metal, not the cargo box', async () => {
        const gameData = await getIntegrationGameData();
        const metal = await gameData.data.Asteroid.get('nova:128');
        expect(metal.name).toBe('Metal Small');
        expect(metal.yieldType).toBe('cargo:4');
        expect(metal.debrisAnimation?.images.baseImage.id).toBe('nova:502');
    }, 60_000);

    it('draws Ice and Crystal debris by röid family', async () => {
        const gameData = await getIntegrationGameData();
        const ice = await gameData.data.Asteroid.get('nova:132');
        expect(ice.name).toBe('Ice Small');
        expect(ice.debrisAnimation?.images.baseImage.id).toBe('nova:504');
        const crystal = await gameData.data.Asteroid.get('nova:140');
        expect(crystal.name).toBe('Crystal Small');
        expect(crystal.debrisAnimation?.images.baseImage.id).toBe('nova:508');
        // Nothing mined is ever a crate.
        for (const id of ['nova:128', 'nova:132', 'nova:140']) {
            const roid = await gameData.data.Asteroid.get(id);
            expect(roid.debrisAnimation?.images.baseImage.id).not.toBe('nova:500');
        }
    }, 60_000);
});
