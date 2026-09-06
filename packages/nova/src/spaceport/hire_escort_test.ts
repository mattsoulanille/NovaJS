import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/bay_plugin.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import { EscortPayrollComponent } from '../nova_plugin/player_escort.js';
import {
    escortCount, hirePrice, hireRefusal, MAX_ESCORTS, MAX_ESCORTS_MESSAGE,
    NO_SHIPS_FOR_HIRE,
} from './hire_escort.js';
import {
    commitPendingEscorts, PendingEscortsComponent,
} from './pending_escorts.js';

function makeShip(ship: Partial<ShipData>): ShipData {
    return { ...getDefaultShipData(), ...ship };
}

/**
 * The escort cap the original enforces (STR# 2002 index 123: "You already
 * have the maximum possible number of escorts."), as the BAR counts it:
 * hired and captured escorts, not bay fighters and not mission ships
 * (maintainer ruling #161; nova_plugin/escort_cap.ts owns the rule).
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

    it('is six (#161), with the stock refusal', () => {
        expect(MAX_ESCORTS).toBe(6);
        expect(MAX_ESCORTS_MESSAGE)
            .toBe('You already have the maximum possible number of escorts.');
    });

    it('refuses the seventh hire at the cap, before money is considered',
        () => {
            const entity = new Entity();
            entity.components.set(EscortPayrollComponent,
                Array(6).fill('nova:136'));
            const held = escortCount(entity, () => [], PLAYER);
            expect(held).toBe(6);
            expect(hireRefusal(held, Number.MAX_SAFE_INTEGER, 1)).toBe('cap');
            // Five in the world plus one hired this visit is six too.
            expect(hireRefusal(5 + 1, Number.MAX_SAFE_INTEGER, 1)).toBe('cap');
            // Under the cap, only the fee can refuse.
            expect(hireRefusal(5, 100, 1)).toBeUndefined();
            expect(hireRefusal(5, 0, 1)).toBe('credits');
            expect(hireRefusal(0, 0, 0)).toBeUndefined();
        });

    it('does not count mission escorts or bay fighters toward the seven',
        () => {
            // Six hired on the payroll, and a landed roster of those six
            // plus three mission escorts and a wing of four fighters:
            // still exactly at the cap, no further.
            const entity = new Entity();
            entity.components.set(EscortPayrollComponent,
                Array(6).fill('nova:136'));
            const roster = [
                ...Array.from({ length: 6 }, () => escort()),
                ...Array.from({ length: 3 }, () => escort(PLAYER, 'mission')),
                ...Array.from({ length: 4 }, () => escort(PLAYER, 'fighter')),
            ];
            expect(escortCount(entity, () => roster, PLAYER)).toBe(6);
            // ...and with one hired escort released, there is room again
            // however many mission ships and fighters fly along.
            expect(escortCount(entity, () => roster.slice(1), PLAYER)).toBe(6);
            entity.components.set(EscortPayrollComponent,
                Array(5).fill('nova:136'));
            expect(escortCount(entity, () => roster.slice(1), PLAYER)).toBe(5);
            expect(hireRefusal(5, 100, 1)).toBeUndefined();
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

    it('never counts a hire twice across the bar\'s commit', () => {
        // The hire dialog counts escortCount(entity) + hired.length, where
        // `hired` is the visit's list and the entity's PendingEscorts is
        // what earlier commits wrote. The commit is the ONE operation that
        // moves hires from the first into the second, and it empties the
        // first as it does so — so the dialog's sum reads the same number
        // before and after, and a re-hire later the same landing (the bar
        // reopened after Leave) starts from a clean list.
        const entity = new Entity();
        entity.components.set(PendingEscortsComponent, ['nova:130']);
        const hired = ['nova:136', 'nova:136'];
        const held = () => escortCount(entity) + hired.length;
        expect(held()).toBe(3);

        expect(commitPendingEscorts(entity, hired)).toBe(2);
        expect(entity.components.get(PendingEscortsComponent))
            .toEqual(['nova:130', 'nova:136', 'nova:136']);
        expect(hired).toEqual([]);
        expect(held()).toBe(3);

        // Committing again is a no-op, not a second copy.
        expect(commitPendingEscorts(entity, hired)).toBe(0);
        expect(held()).toBe(3);
        hired.push('nova:130');
        expect(held()).toBe(4);
        commitPendingEscorts(entity, hired);
        expect(held()).toBe(4);
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
