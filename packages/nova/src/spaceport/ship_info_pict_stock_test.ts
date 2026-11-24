import 'jasmine';
import { ShipData } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';

/**
 * The shipyard shows a ship in three different sizes of artwork, and the
 * "More Info" dialog must use the largest of them rather than reusing the
 * browse-pane render. Pinned against the real Nova game data.
 *
 * Stock tiers for shïp 128 (Shuttle):
 *   - info   PICT 20128, 600x400 — the painted scene (ship staged against
 *            a station/planet), reached through the ship dësc's Graphic
 *            field, NOT a fixed offset from the browse pict.
 *   - browse PICT 5000 (5000 + id - 128), 200x200 — the grid thumbnail
 *            and the preview beside it.
 *   - target PICT 3000 (3000 + id - 128), 128x64 — the HUD target render.
 * See ui_screenshots/original_macos_screenshots/shipyard/*_info.png.
 */
describe('ship info pict against real Nova data', () => {
    async function ship(id: string): Promise<ShipData> {
        const gameData = await getIntegrationGameData();
        return await gameData.data.Ship.get(id);
    }

    it('gives the Shuttle a dedicated info pict, distinct from its browse pict',
        async () => {
            const shuttle = await ship('nova:128');
            expect(shuttle.name).toBe('Shuttle');
            expect(shuttle.infoPict).toBe('nova:20128');
            expect(shuttle.pict).toBe('nova:5000');
            // The whole point of the fix: these are different pictures.
            expect(shuttle.infoPict).not.toBe(shuttle.pict);
        });

    it('resolves both picts for several stock ships', async () => {
        // 129 Heavy Shuttle and 133 Starbridge both appear in the
        // reference shipyard screenshots.
        for (const [id, name, info] of [
            ['nova:129', 'Heavy Shuttle', 'nova:20129'],
            ['nova:133', 'Starbridge', 'nova:20133'],
            ['nova:136', 'Terrapin', 'nova:20136'],
        ] as const) {
            const data = await ship(id);
            expect(data.name).withContext(id).toBe(name);
            expect(data.infoPict).withContext(id).toBe(info);
            expect(data.pict).withContext(id).toBeTruthy();
            expect(data.infoPict).withContext(id).not.toBe(data.pict);
        }
    });

    it('leaves infoPict null for a ship whose dësc defines no graphic',
        async () => {
            // shïp 188 is a second "Shuttle" entry whose dësc Graphic is
            // -1; the dialog falls back to its browse pict. shïp 185
            // "Wraith (Adult)" uses 0 for the same purpose.
            const variant = await ship('nova:188');
            expect(variant.infoPict).toBeNull();
            expect(variant.pict).toBeTruthy();

            const wraith = await ship('nova:185');
            expect(wraith.infoPict).toBeNull();
        });

    it('shares one info pict across a ship and its variants', async () => {
        // 20 stock scenes are reused this way — a base ship and its
        // second-hand / refitted variants all point at the base's art,
        // which is why the id is read from the dësc rather than derived
        // from the ship's own id.
        for (const id of ['nova:128', 'nova:361', 'nova:362']) {
            expect((await ship(id)).infoPict).withContext(id)
                .toBe('nova:20128');
        }
        expect((await ship('nova:361')).name)
            .toBe('Shuttle;Second-Hand - poor');
    });

    it('gives each Vell-os ship its own scene, offset from its ship id',
        async () => {
            // A reminder that the graphic is NOT id-derivable: shïp 381-383
            // carry PICT 20173-20175, not 20381-20383.
            for (const [id, info] of [
                ['nova:381', 'nova:20173'],
                ['nova:382', 'nova:20174'],
                ['nova:383', 'nova:20175'],
            ] as const) {
                expect((await ship(id)).infoPict).withContext(id).toBe(info);
            }
        });

    it('pins how much of the stock fleet defines an info pict', async () => {
        const gameData = await getIntegrationGameData();
        const ids = (await gameData.ids).Ship;
        const ships = await Promise.all(
            ids.map(id => gameData.data.Ship.get(id)));
        expect(ships.length).toBe(288);
        // A minority define one, so the browse-pict fallback is the
        // common path and has to stay.
        expect(ships.filter(s => s.infoPict !== null).length).toBe(97);
    });

    it('resolves the HUD target PICT, 3000 + id - 128, reusing a '
        + 'same-looking ship\'s (EVN Bible ~:2700)', async () => {
            expect((await ship('nova:128')).targetPict).toBe('nova:3000');
            expect((await ship('nova:131')).targetPict).toBe('nova:3003');
            // The second Shuttle entry and the second-hand Shuttles have
            // no PICT 3060 / 3233 / 3234 of their own: they share the
            // Shuttle's base sprite, so they take its target render.
            for (const id of ['nova:188', 'nova:361', 'nova:362']) {
                expect((await ship(id)).targetPict).withContext(id)
                    .toBe('nova:3000');
            }
        });
});
