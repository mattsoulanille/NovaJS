import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import {
    MissionShipComponent, NO_DEAL, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/index.js';
import { EscortDealEntry } from './escort_deals.js';
import {
    ESCORT_DEFECTED_MESSAGE, ESCORTS_DEFECTED_MESSAGE, escortWageReport,
    settleEscortWages,
} from './escort_wages.js';

/**
 * Reference "Escort wages (R12), wave 37": the landing day's wage (1% of
 * the hull's Cost) is paid as the player LEAVES the spaceport, escort by
 * escort; one the player cannot pay DEFECTS ("Due to lack of pay, one of
 * your escorts has defected.") and the rest are paid and stay.
 */

const PLAYER = 'player-uuid';
/** Kit Wage hulls (shïp 582 / 581): Cost 100,000 and 10,000. */
const DEAR = 'test:wage-1000';
const CHEAP = 'test:wage-100';

const SHIPS = new Map<string, ShipData>([
    [DEAR, { ...getDefaultShipData(), id: DEAR, price: 100_000 }],
    [CHEAP, { ...getDefaultShipData(), id: CHEAP, price: 10_000 }],
]);

function entry(uuid: string, shipId: string, options: {
    provenance?: 'hired' | 'captured', parent?: string, player?: string,
} = {}): EscortDealEntry {
    const player = options.player ?? PLAYER;
    const entity = new Entity()
        .addComponent(ShipComponent, { id: shipId })
        .addComponent(ShipDataComponent, SHIPS.get(shipId)!)
        .addComponent(PlayerEscortComponent, {
            player,
            parent: options.parent ?? player,
            provenance: options.provenance ?? 'hired',
            deal: NO_DEAL,
        });
    return { player, uuid, entity };
}

describe('settleEscortWages (R12, wave 37)', () => {
    it('pays each hired escort 1% of its Cost and keeps them all', () => {
        const roster = [entry('a', DEAR), entry('b', CHEAP)];
        const settled = settleEscortWages(roster, PLAYER, 200_000);
        expect(settled).toEqual({ paid: 1_100, defected: [] });
        expect(roster.map(e => e.uuid)).toEqual(['a', 'b']);
        expect(escortWageReport(settled)).toBeUndefined();
    });

    it('r12_c: 500 credits against 1,000 + 100: the 1,000 escort defects, '
        + 'the 100 one is paid and stays', () => {
        const roster = [entry('dear', DEAR), entry('cheap', CHEAP)];
        const settled = settleEscortWages(roster, PLAYER, 500);
        expect(settled.paid).toBe(100);
        expect(settled.defected.map(d => [d.uuid, d.wage]))
            .toEqual([['dear', 1_000]]);
        expect(roster.map(e => e.uuid)).toEqual(['cheap']);
        expect(escortWageReport(settled)).toBe(ESCORT_DEFECTED_MESSAGE);
        expect(ESCORT_DEFECTED_MESSAGE)
            .toBe('Due to lack of pay, one of your escorts has defected.');
    });

    it('pays in roster order while the credits last (GUESS): each one the '
        + 'rest cannot cover defects', () => {
        const roster = [entry('cheap1', CHEAP), entry('dear', DEAR),
            entry('cheap2', CHEAP), entry('dear2', DEAR)];
        const settled = settleEscortWages(roster, PLAYER, 1_150);
        // 100 paid; 1,000 against 1,050 paid; 100 against 50 defects;
        // 1,000 against 50 defects.
        expect(settled.paid).toBe(1_100);
        expect(settled.defected.map(d => d.uuid)).toEqual(['cheap2', 'dear2']);
        expect(roster.map(e => e.uuid)).toEqual(['cheap1', 'dear']);
        expect(escortWageReport(settled)).toBe(ESCORTS_DEFECTED_MESSAGE);
    });

    it('charges no captured hull, bay fighter, mission ship or another '
        + 'player\'s escort', () => {
        const fighter = entry('fighter', DEAR);
        fighter.entity.components.set(BayFighterComponent,
            { carrier: PLAYER, outfit: 'test:bay' } as never);
        const mission = entry('mission', DEAR);
        mission.entity.components.set(MissionShipComponent, {} as never);
        const roster = [entry('prize', DEAR, { provenance: 'captured' }),
            fighter, mission, entry('theirs', DEAR, { player: 'other' })];
        const settled = settleEscortWages(roster, PLAYER, 0);
        expect(settled).toEqual({ paid: 0, defected: [] });
        expect(roster.length).toBe(4);
    });

    it('takes a defecting carrier\'s own wing with it', () => {
        const roster = [entry('carrier', DEAR),
            entry('wingman', CHEAP, { parent: 'carrier',
                provenance: 'captured' })];
        const settled = settleEscortWages(roster, PLAYER, 0);
        expect(settled.defected).toEqual([{
            uuid: 'carrier', shipId: DEAR, wage: 1_000,
            withCarrier: ['wingman'],
        }]);
        expect(roster).toEqual([]);
    });

    it('never splices an escort whose hold a venue has open', () => {
        const roster = [entry('a', DEAR)];
        const settled = settleEscortWages(roster, PLAYER, 0, u => u === 'a');
        expect(settled).toEqual({ paid: 0, defected: [] });
        expect(roster.length).toBe(1);
    });
});
