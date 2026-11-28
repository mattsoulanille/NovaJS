import 'jasmine';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { escortUpgradeOffer } from './hail_dialog_plugin.js';

/**
 * The escort comm box's Upgrade offer against REAL ship data, pinned to
 * what the original does (docs/reference_experiments.md, "Escort upgrade
 * gates, wave 57"): only the target hull's Availability test gates the
 * offer. Require, AppearOn and TechLevel do not.
 *
 * Matthew's report: a Pirate Valkyrie Class III escort (shïp 289, UpgradeTo
 * 291) could not be upgraded to Class IV with the Singularity plug-in
 * installed, which overrides shïp 291 with Availability "b9999" (a bit
 * nothing sets). The original refuses that upgrade too ("This ship class
 * cannot be upgraded."), so it is correct, and the stock data's Rebel IDA
 * Frigate chain (412 -> 413 -> 414, Availability b9999) is refused alike.
 */
async function offered(gameData: GameDataAggregator, from: string,
    bits: number[] = []) {
    const ship = await gameData.data.Ship.get(from);
    const offer = await escortUpgradeOffer(ship.escortUpgradeShip,
        { bits: new Set(bits) }, gameData as never);
    return { to: ship.escortUpgradeShip, offer: offer?.id };
}

describe('escortUpgradeOffer on stock Nova data', () => {
    it('offers the Pirate Valkyrie Class III -> Class IV upgrade', async () => {
        const gameData = await getIntegrationGameData();
        expect(await offered(gameData, 'nova:289'))
            .toEqual({ to: 'nova:291', offer: 'nova:291' });
    }, 300_000);

    it('refuses both Rebel IDA Frigate upgrades (Availability b9999)',
        async () => {
            const gameData = await getIntegrationGameData();
            expect(await offered(gameData, 'nova:412'))
                .toEqual({ to: 'nova:413', offer: undefined });
            expect(await offered(gameData, 'nova:413'))
                .toEqual({ to: 'nova:414', offer: undefined });
        }, 300_000);

    it('offers an upgrade whose target Require the player lacks', async () => {
        // Valkyrie;Second-Hand - poor -> Valkyrie (Require 0x300000000, the
        // weapons licenses' Contribute): the player contributes nothing here.
        const gameData = await getIntegrationGameData();
        const valkyrie = await gameData.data.Ship.get('nova:137');
        expect(BigInt(valkyrie.require)).toBe(0x300000000n);
        expect(await offered(gameData, 'nova:371'))
            .toEqual({ to: 'nova:137', offer: 'nova:137' });
    }, 300_000);

    it('offers an upgrade whose target AppearOn fails or whose TechLevel '
        + 'no stellar stocks', async () => {
            const gameData = await getIntegrationGameData();
            // Arachnid -> Nil'kimas Arachnid (AppearOn !b1303), b1303 set.
            expect(await offered(gameData, 'nova:158', [1303]))
                .toEqual({ to: 'nova:311', offer: 'nova:311' });
            // Lightning -> Wild Geese Lightning (TechLevel 100).
            expect(await offered(gameData, 'nova:135'))
                .toEqual({ to: 'nova:191', offer: 'nova:191' });
        }, 300_000);
});

describe('escortUpgradeOffer with the Singularity plug-in', () => {
    it('refuses the Pirate Valkyrie Class III -> Class IV upgrade, whose '
        + 'target the plug-in gates on b9999', async () => {
            const gameData = await getPluginGameData('singularity');
            if (!gameData) {
                pending('Singularity plug-in not installed');
                return;
            }
            const target = await gameData.data.Ship.get('nova:291');
            expect(target.availability).toMatch(/^b\d+$/);
            expect(await offered(gameData, 'nova:289'))
                .toEqual({ to: 'nova:291', offer: undefined });
        }, 300_000);
});
