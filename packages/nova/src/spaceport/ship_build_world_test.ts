import 'jasmine';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { runShipBuildWorld } from './ship_build_world.js';

// On the synthetic data set: any purchasable hull exercises the scratch
// world's resource set.

/**
 * Pins the post-purchase "outfit builder" scratch world: its resource set
 * must stay sufficient for addPlugin(SystemPlugin). Shipped bug this
 * guards against: MissileGuidanceResource became required by
 * ProjectileGuidanceSystem (make_system.ts got it; this world didn't), so
 * every ship purchase threw inside the shipyard's click handler — the
 * spaceport never adopted the new ship and departing afterwards flew
 * without one. Any future make_system-only required resource should fail
 * here first.
 */
describe('runShipBuildWorld', () => {
    it('runs a bought ship through SystemPlugin without throwing',
        async () => {
            const gameData = await getSyntheticGameData();
            const ids = await gameData.ids;
            const shipData = await gameData.data.Ship.get(ids.Ship[0]);
            const ship = makeShip(shipData);
            // Display assets are only stored as a resource here (systems
            // read them lazily at step time for sprites, which stat
            // providers don't do), so a stub satisfies the scratch run.
            const displayAssets = {} as DisplayAssetDataInterface;

            // The shipped failure mode was NOT a rejection of this call:
            // nested world.addPlugin promises inside a plugin's build are
            // detached, so the missing-resource throw surfaced as an
            // UNHANDLED REJECTION after the outer addPlugin resolved
            // (verified by direct repro). Capture those, or this spec
            // passes right through the bug.
            const rejections: unknown[] = [];
            const onRejection = (reason: unknown) => {
                rejections.push(reason);
            };
            process.on('unhandledRejection', onRejection);
            try {
                await runShipBuildWorld(ship, gameData, displayAssets);
                // Give detached rejections a couple of macrotasks to land.
                await new Promise(resolve => setTimeout(resolve, 0));
                await new Promise(resolve => setTimeout(resolve, 0));
            } finally {
                process.off('unhandledRejection', onRejection);
            }
            expect(rejections).toEqual([]);
        });
});
