import 'jasmine';
import { ShipData } from 'novadatainterface/ship_data';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import {
    escortDailyFee, escortSellValue, escortUpgradeCost, escortUpgradeShip,
    hirePrice,
} from './escort_fees.js';

/**
 * ============================================================================
 * Escort prices against the REAL stock data
 * ============================================================================
 *
 * The two original-hardware captures of the escort comm box quote four
 * figures between them, and three of the four are pure data that the parser
 * and escort_fees must reproduce exactly:
 *
 *   hail/hail_escort.png           a HIRED Terrapin (shïp nova:136):
 *                                    "Upgrade Cost: 50,000 credits"
 *                                    "Pay: 1,100 credits per day"
 *   hail/hail_captured_escort.png  a CAPTURED Pirate Viper (shïp nova:166):
 *                                    "Upgrade Cost: 35,000 credits"
 *                                    "Sell Price: 11,000 credits"
 *
 * The Terrapin's 50,000 and the Pirate Viper's 35,000 are shïp EscUpgrdCost
 * verbatim. The Pirate Viper's 11,000 is the Bible's own default in action:
 * its EscSellValue is <= 0, so it falls back to "10% of the ship's original
 * cost" and its cost is 110,000.
 *
 * The FOURTH figure, the Terrapin's 1,100 cr/day wage, is the one NovaJS
 * knowingly diverges on — Matthew's rule is 10% of the hire fee, which for
 * a 150,000 cr hull is 1,500. Pinned here as well as in escort_fees_test.ts
 * so the divergence stays a recorded decision rather than a surprise; see
 * escort_fees.ts's module comment for why one sample was not enough to
 * reverse-engineer the original's formula.
 */
describe('escort prices against real stock data', () => {
    /** shïp nova:136 "Terrapin" — hail/hail_escort.png's hired escort. */
    const TERRAPIN = 'nova:136';
    /** shïp nova:166 "Pirate Viper" — the captured escort. */
    const PIRATE_VIPER = 'nova:166';

    let terrapin: ShipData;
    let pirateViper: ShipData;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        terrapin = await gameData.data.Ship.get(TERRAPIN);
        pirateViper = await gameData.data.Ship.get(PIRATE_VIPER);
    });

    it('parses the Terrapin the captures describe', () => {
        expect(terrapin.name).toBe('Terrapin');
        expect(terrapin.price).toBe(150_000);
    });

    it('quotes the Terrapin\'s "Upgrade Cost: 50,000 credits"', () => {
        expect(escortUpgradeShip(terrapin)).not.toBeNull();
        expect(escortUpgradeCost(terrapin)).toBe(50_000);
    });

    it('parses the Pirate Viper the captures describe', () => {
        expect(pirateViper.name).toBe('Pirate Viper');
        expect(pirateViper.price).toBe(110_000);
    });

    it('quotes the Pirate Viper\'s "Sell Price: 11,000 credits" through '
        + 'the Bible\'s <= 0 default', () => {
            // The data really does leave it unset — that is what makes
            // this a test of the DEFAULT and not of a field read.
            expect(pirateViper.escortSellValue).toBeLessThanOrEqual(0);
            expect(escortSellValue(pirateViper)).toBe(11_000);
        });

    it('quotes the Pirate Viper\'s "Upgrade Cost: 35,000 credits"', () => {
        expect(escortUpgradeShip(pirateViper)).not.toBeNull();
        expect(escortUpgradeCost(pirateViper)).toBe(35_000);
    });

    it('hires a Terrapin pilot for 10% of the hull', () => {
        expect(hirePrice(terrapin)).toBe(15_000);
    });

    it('pays 1,500 cr/day for the Terrapin where the original paid 1,100 '
        + '— the one KNOWN divergence', () => {
            expect(escortDailyFee(terrapin)).toBe(1_500);
        });

    it('normalizes an un-upgradeable class to null rather than 0 or -1',
        async () => {
            // The Bible gives two sentinels; the parser collapses both, so
            // consumers test one thing. Somewhere in the stock ship list
            // there is a class with no upgrade path at all.
            const gameData = await getIntegrationGameData();
            const ids = (await gameData.ids).Ship;
            let sawNull = false;
            for (const id of ids) {
                const ship = await gameData.data.Ship.get(id);
                if (ship.escortUpgradeShip === null) {
                    sawNull = true;
                    // ...and it is offered no upgrade, whatever the cost
                    // field happens to hold.
                    expect(escortUpgradeCost(ship)).toBe(0);
                } else {
                    // Every non-null target really resolves to a ship id.
                    expect(ids).toContain(ship.escortUpgradeShip);
                }
            }
            expect(sawNull).toBeTrue();
        });
});
