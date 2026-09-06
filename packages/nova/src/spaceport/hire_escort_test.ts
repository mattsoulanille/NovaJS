import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/bay_plugin.js';
import {
    cappedEscortCount, CarriedEscortEntry,
} from '../nova_plugin/escort_cap.js';
import { MissionShipComponent } from '../nova_plugin/mission_ship_plugin.js';
import {
    EscortPayrollComponent, PlayerEscortComponent,
} from '../nova_plugin/player_escort.js';
import {
    hirePrice, hireRefusal, MAX_ESCORTS, MAX_ESCORTS_MESSAGE,
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
 * (maintainer ruling #161), through the one count in
 * nova_plugin/escort_cap.ts — given the display world (escorts still on
 * approach), the landed roster, and this landing's hires. escort_cap_test
 * pins the count itself; this pins how the bar feeds and applies it.
 */
describe('the escort cap', () => {
    const PLAYER = 'player-uuid';
    let n = 0;
    function escort(player = PLAYER, ...extra: ('fighter' | 'mission')[]):
        CarriedEscortEntry {
        const entity = new Entity();
        entity.components.set(PlayerEscortComponent, { player });
        if (extra.includes('fighter')) {
            entity.components.set(BayFighterComponent,
                { bayWeaponId: 'nova:150', slot: 0 } as any);
        }
        if (extra.includes('mission')) {
            entity.components.set(MissionShipComponent, {} as any);
        }
        return { player, uuid: `escort ${n++}`, entity };
    }
    /** The bar's count: escortsHeld() without the dialog. */
    function held(player: Entity | undefined,
        world: CarriedEscortEntry[], roster: CarriedEscortEntry[],
        hired: string[] = []): number {
        return cappedEscortCount(PLAYER, {
            world: world.map(({ uuid, entity }) => [uuid, entity]),
            carried: roster,
            pending:
                (player?.components.get(PendingEscortsComponent)?.length ?? 0)
                + hired.length,
        });
    }

    it('is six (#161), with the stock refusal', () => {
        expect(MAX_ESCORTS).toBe(6);
        expect(MAX_ESCORTS_MESSAGE)
            .toBe('You already have the maximum possible number of escorts.');
    });

    it('refuses the seventh hire at the cap, before money is considered',
        () => {
            const roster = Array.from({ length: 6 }, () => escort());
            expect(held(undefined, [], roster)).toBe(6);
            expect(hireRefusal(6, Number.MAX_SAFE_INTEGER, 1)).toBe('cap');
            // Five in the world plus one hired this visit is six too.
            expect(held(undefined, roster.slice(0, 5), [], ['nova:136']))
                .toBe(6);
            expect(hireRefusal(5 + 1, Number.MAX_SAFE_INTEGER, 1)).toBe('cap');
            // Under the cap, only the fee can refuse.
            expect(hireRefusal(5, 100, 1)).toBeUndefined();
            expect(hireRefusal(5, 0, 1)).toBe('credits');
            expect(hireRefusal(0, 0, 0)).toBeUndefined();
        });

    it('does not count mission escorts or bay fighters toward the seven',
        () => {
            // Six hired on the landed roster plus three mission escorts
            // and a wing of four fighters: still exactly at the cap.
            const roster = [
                ...Array.from({ length: 6 }, () => escort()),
                ...Array.from({ length: 3 }, () => escort(PLAYER, 'mission')),
                ...Array.from({ length: 4 }, () => escort(PLAYER, 'fighter')),
            ];
            expect(held(undefined, [], roster)).toBe(6);
            // ...and with one hired escort released, there is room again
            // however many mission ships and fighters fly along.
            expect(held(undefined, [], roster.slice(1))).toBe(5);
            expect(hireRefusal(5, 100, 1)).toBeUndefined();
        });

    it('counts the landed roster\'s escorts, not its fighters or mission '
        + 'ships, and not another player\'s', () => {
            const roster = [
                escort(), escort(), escort(PLAYER, 'fighter'),
                escort(PLAYER, 'mission'), escort('someone-else'),
            ];
            expect(held(undefined, [], roster)).toBe(2);
        });

    it('counts the escorts still flying down with the ones that landed, '
        + 'and not the payroll mirror', () => {
            // Three hired escorts followed the player down; one has
            // touched down, two are still on approach in the display
            // world. The payroll mirror on the docked entity was frozen
            // as the player left and is not consulted.
            const entity = new Entity();
            entity.components.set(EscortPayrollComponent,
                ['nova:136', 'nova:136', 'nova:136']);
            entity.components.set(PendingEscortsComponent, ['nova:130']);
            const fleet = [escort(), escort(), escort()];
            expect(held(entity, fleet.slice(1), fleet.slice(0, 1))).toBe(4);
            // The display frame that lands an escort inserts it on the
            // roster before applying its removal: briefly in both, once.
            expect(held(entity, fleet, fleet.slice(0, 1))).toBe(4);
            // A captured prize still on approach counts: it draws no
            // wage, so a mirror would have missed it.
            const prize = escort();
            prize.entity.components.set(PlayerEscortComponent,
                { player: PLAYER, provenance: 'captured' });
            expect(held(entity, [prize, ...fleet.slice(1)], fleet.slice(0, 1)))
                .toBe(5);
            // ...and one shot down on the way in is gone from the count,
            // mirror or no mirror.
            expect(held(entity, fleet.slice(2), fleet.slice(0, 1))).toBe(3);
            expect(held(new Entity(), [], [])).toBe(0);
        });

    it('never counts a hire twice across the bar\'s commit', () => {
        // The hire dialog counts the entity's PendingEscorts (what earlier
        // commits wrote) plus `hired`, the visit's list. The commit is the
        // ONE operation that moves hires from the second into the first,
        // and it empties the second as it does so — so the dialog's sum
        // reads the same number before and after, and a re-hire later
        // the same landing (the bar reopened after Leave) starts from a
        // clean list.
        const entity = new Entity();
        entity.components.set(PendingEscortsComponent, ['nova:130']);
        const hired = ['nova:136', 'nova:136'];
        const count = () => held(entity, [], [], hired);
        expect(count()).toBe(3);

        expect(commitPendingEscorts(entity, hired)).toBe(2);
        expect(entity.components.get(PendingEscortsComponent))
            .toEqual(['nova:130', 'nova:136', 'nova:136']);
        expect(hired).toEqual([]);
        expect(count()).toBe(3);

        // Committing again is a no-op, not a second copy.
        expect(commitPendingEscorts(entity, hired)).toBe(0);
        expect(count()).toBe(3);
        hired.push('nova:130');
        expect(count()).toBe(4);
        commitPendingEscorts(entity, hired);
        expect(count()).toBe(4);
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
