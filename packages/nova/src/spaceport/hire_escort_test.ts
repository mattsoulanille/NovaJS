import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/bay_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { EscortPayrollComponent } from '../nova_plugin/player_escort.js';
import {
    escortCount, hirePrice, MAX_ESCORTS, MAX_ESCORTS_MESSAGE,
    NO_SHIPS_FOR_HIRE,
} from './hire_escort.js';
import { PendingEscortsComponent } from './pending_escorts.js';

function makeShip(ship: Partial<ShipData>): ShipData {
    return { ...getDefaultShipData(), ...ship };
}

/**
 * The escort cap the original enforces (STR# 2002 index 123: "You already
 * have the maximum possible number of escorts."), counted the way the
 * pilot file records escorts: hired and captured, not bay fighters and not
 * mission ships.
 */
describe('the escort cap', () => {
    const PLAYER = 'player-uuid';
    function escort(player = PLAYER, ...extra: ('fighter' | 'mission')[]) {
        const entity = new Entity();
        if (extra.includes('fighter')) {
            entity.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:150', slot: 0 } as any);
        }
        if (extra.includes('mission')) {
            entity.components.set(MissionShipComponent, {} as any);
        }
        return { player, entity };
    }

    it('is the pilot file\'s sixty-four escort slots', () => {
        expect(MAX_ESCORTS).toBe(64);
        expect(MAX_ESCORTS_MESSAGE)
            .toBe('You already have the maximum possible number of escorts.');
    });

    it('counts the landed roster\'s escorts, not its fighters or mission '
        + 'ships, and not another player\'s', () => {
            const roster = [
                escort(), escort(), escort(PLAYER, 'fighter'),
                escort(PLAYER, 'mission'), escort('someone-else'),
            ];
            expect(escortCount(undefined, () => roster, PLAYER)).toBe(2);
            // Without a uuid to attribute by, every non-fighter counts.
            expect(escortCount(undefined, () => roster)).toBe(3);
        });

    it('takes the larger of the roster and the payroll mirror, plus this '
        + 'landing\'s hires', () => {
            const entity = new Entity();
            entity.components.set(EscortPayrollComponent,
                ['nova:136', 'nova:136', 'nova:136']);
            entity.components.set(PendingEscortsComponent, ['nova:130']);
            // Only one of the three hired escorts has touched down yet.
            expect(escortCount(entity, () => [escort()], PLAYER)).toBe(4);
            // A captured prize is on the roster but draws no wage.
            expect(escortCount(entity,
                () => [escort(), escort(), escort(), escort()], PLAYER)).toBe(5);
            expect(escortCount(entity)).toBe(4);
            expect(escortCount(new Entity())).toBe(0);
        });
});

describe('hirePrice', () => {
    it('charges 10% of the ship price', () => {
        // The reference screenshot: a 300,000 cr Thunderhead hires
        // for 30,000 cr.
        expect(hirePrice(makeShip({ price: 300_000 }))).toEqual(30_000);
        expect(hirePrice(makeShip({ price: 17_500 }))).toEqual(1_750);
    });
});

/**
 * Matthew's item 6: hiring with nothing available shows a dialog saying
 * so, instead of an empty shipyard grid.
 */
describe('NO_SHIPS_FOR_HIRE', () => {
    it("is stock Nova's own wording, verbatim", () => {
        // STR# 2002 ("misc strings") index 223, Nova Data 5.ndat. Its
        // sibling at 222 is the shipyard's
        // "There are no ships available for purchase here." — note the
        // hire string has NO trailing "here".
        expect(NO_SHIPS_FOR_HIRE)
            .toBe('There are no ships available for hire.');
    });
});
