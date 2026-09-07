import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player/player_escort.js';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { EscortDealEntry, settleEscortDeals } from './escort_deals.js';
import { commitFleetHolds, FleetHold } from './fleet_cargo.js';
import { LandedTransaction } from './landed_transaction.js';
import { MissionUniverse } from './mission_universe.js';

/**
 * ============================================================================
 * The fleet-hold LEASE: a trade visit's open holds freeze that escort's deals
 * ============================================================================
 *
 * The trade centre checks out working copies of the landed escorts' holds
 * when it opens and writes them back at Done. Meanwhile the client settles
 * queued escort deals on EVERY docked frame at a shipyard, and a settled SALE
 * splices its escort off the landed roster.
 *
 * Nothing used to stop those from overlapping: sell an escort while the
 * exchange had its hold open and Done would commit the cargo onto an entity
 * that is no longer on any roster — so the goods evaporated while the credits
 * stayed spent. The lease closes it by freezing the deals of any escort whose
 * hold is checked out; they settle on the next docked frame after Done, which
 * the settlement already runs on.
 *
 * The lease is a property of the landing's transaction
 * (landed_transaction.ts), scoped to the trade visit's savepoint: the
 * transaction answers `holdOpen`, commits the holds when the visit is
 * released, and drops the lease when it is rolled back.
 */

const PLAYER = 'player-uuid';
const PLANET = 'nova:128';
const FREIGHTER = 'test:freighter';
const FIGHTER = 'test:fighter';

const SHIPS = new Map<string, ShipData>([
    [FREIGHTER, {
        ...getDefaultShipData(), id: FREIGHTER, name: 'Freighter',
        price: 200_000, escortSellValue: 40_000, inherentAI: 1,
        physics: { ...getDefaultShipData().physics, freeCargo: 100 },
    }],
    [FIGHTER, {
        ...getDefaultShipData(), id: FIGHTER, name: 'Fighter',
        price: 60_000, escortSellValue: 10_000, inherentAI: 3,
    }],
]);
const getShip = (id: string) => SHIPS.get(id);

function gameData(): SimulationGameDataInterface {
    const data = new MockGameData();
    for (const [id, ship] of SHIPS) {
        data.data.Ship.map.set(id, ship);
    }
    return data as unknown as SimulationGameDataInterface;
}

function entry(uuid: string, options: {
    shipId?: string, pendingSale?: boolean, parent?: string,
} = {}): EscortDealEntry {
    const shipId = options.shipId ?? FREIGHTER;
    const entity = new Entity()
        .addComponent(ShipComponent, { id: shipId })
        .addComponent(ShipDataComponent, SHIPS.get(shipId)!)
        .addComponent(CargoComponent, new Map())
        .addComponent(PlayerEscortComponent, {
            player: PLAYER, parent: options.parent ?? PLAYER,
            provenance: 'captured' as const,
            ...options.pendingSale ? { pendingSale: true } : {},
        });
    return { player: PLAYER, uuid, entity };
}

/** The working hold the exchange would collect for a roster entry. */
function hold(entry: EscortDealEntry, cargo: [string, number][] = []):
    FleetHold {
    return {
        uuid: entry.uuid, capacity: 100, cargo: new Map(cargo),
        entity: entry.entity,
    };
}

/** A landing's transaction over a bare docked pilot. */
async function landing(): Promise<LandedTransaction> {
    const data = gameData();
    const pilot = new Entity().addComponent(CreditsComponent, { credits: 0 });
    return LandedTransaction.open(pilot, data, new MissionUniverse(data),
        PLANET);
}

/**
 * The trade centre's opening: a savepoint for the visit, then the roster's
 * cargo-carrying holds leased under it.
 */
async function tradeVisit(roster: EscortDealEntry[]) {
    const transaction = await landing();
    const visit = transaction.savepoint('trade center');
    const holds = await transaction.leaseFleetHolds(roster, PLAYER);
    const holdOpen = (uuid: string) => transaction.holdOpen(uuid);
    return { transaction, visit, holds, holdOpen };
}

describe('open fleet holds', () => {
    it('reports only the escorts the open visit is actually editing',
        async () => {
            const freighter = entry('f');
            const { transaction, visit } = await tradeVisit([freighter]);
            expect(transaction.holdOpen('f')).toBe(true);
            expect(transaction.holdOpen('somebody-else')).toBe(false);
            transaction.release(visit);
            expect(transaction.holdOpen('f')).toBe(false);
        });

    it('replaces a visit\'s previous lease rather than stacking it — and '
        + 'says so, because it means a close was skipped', async () => {
            const warn = spyOn(console, 'warn');
            const { transaction } = await tradeVisit([entry('first')]);
            expect(warn).not.toHaveBeenCalled();
            await transaction.leaseFleetHolds([entry('second')], PLAYER);
            expect(transaction.holdOpen('first')).toBe(false);
            expect(transaction.holdOpen('second')).toBe(true);
            // Replacing is the safe behaviour but never the expected one:
            // the entry it absorbed had been freezing deals since.
            expect(warn).toHaveBeenCalled();
        });

    it('refuses a lease with no visit to scope it to', async () => {
        // The lease's lifetime IS the savepoint's; without one there would
        // be nothing to release it with.
        const transaction = await landing();
        await expectAsync(transaction.leaseFleetHolds([entry('f')], PLAYER))
            .toBeRejected();
        expect(transaction.holdOpen('f')).toBe(false);
    });
});

/**
 * ============================================================================
 * The lease must not outlive a FAILED visit
 * ============================================================================
 *
 * The trade centre leases two awaits into show() and releases at Done.
 * Everything between — the price-event pass, the row layout, Menu.show
 * itself — can throw, and Spaceport.show's catch swallows it. When the lease
 * was a module-level registry it then stayed there FOR THE REST OF THE
 * SESSION with no dialog on screen: settleEscortDeals saw the hold open and
 * deferred to the next docked frame, over and over, and the player's queued
 * escort sale simply never paid out.
 *
 * The lease now lives on the transaction under the visit's savepoint, and
 * the trade centre rolls that savepoint back on a throw.
 */
describe('a rolled-back trade visit', () => {
    it('drops the lease, so the escort\'s queued deals settle on the next '
        + 'docked frame as they always would', async () => {
            const sold = entry('f', { pendingSale: true });
            const roster = [sold];
            const { transaction, visit, holdOpen } = await tradeVisit(roster);
            expect(transaction.holdOpen('f')).toBeTrue();

            // The exchange exploded mid-show: its show() rolls the visit back.
            transaction.rollback(visit);

            expect(transaction.holdOpen('f')).toBeFalse();
            expect(settleEscortDeals(roster, PLAYER, 0, getShip, holdOpen)
                .sold.map(s => s.uuid)).toEqual(['f']);
            expect(roster).toEqual([]);
        });

    it('does not double-close: a stale release leaves a later visit\'s '
        + 'lease alone', async () => {
            // A Done that fires twice (Menu.dismiss after done) must not
            // pull the lease out from under a visit that opened since.
            const { transaction, visit } = await tradeVisit([entry('f')]);
            transaction.release(visit);
            const later = transaction.savepoint('trade center, again');
            await transaction.leaseFleetHolds([entry('f')], PLAYER);
            transaction.release(visit);
            expect(transaction.holdOpen('f')).toBeTrue();
            transaction.release(later);
            expect(transaction.holdOpen('f')).toBeFalse();
        });
});

describe('escort deals frozen by an open hold', () => {
    it('leaves a queued SALE queued, then settles it once Done releases the '
        + 'hold — and the goods bought mid-visit reach the escort', async () => {
            const freighter = entry('f', { pendingSale: true });
            const roster = [freighter];
            const { transaction, visit, holds, holdOpen } =
                await tradeVisit(roster);

            // A docked frame while the exchange is open: nothing settles.
            const frozen = settleEscortDeals(roster, PLAYER, 0, getShip,
                holdOpen);
            expect(frozen.sold).toEqual([]);
            expect(frozen.credits).toBe(0);
            expect(roster.length).toBe(1);
            // The deal is still QUEUED, not dropped.
            expect(freighter.entity.components
                .get(PlayerEscortComponent)!.pendingSale).toBe(true);

            // The player buys 40 tons that spill into this escort's hold,
            // then presses Done: the release commits the holds and closes
            // the lease in one step.
            holds[0].cargo.set('cargo:0', 40);
            transaction.release(visit);
            expect(freighter.entity.components.get(CargoComponent)!
                .get('cargo:0')).toBe(40);

            // The very next docked frame settles the sale, and the escort
            // (cargo and all — the goods are aboard the ship being sold)
            // leaves the roster.
            const settled = settleEscortDeals(roster, PLAYER, 0, getShip,
                holdOpen);
            expect(settled.sold.map(s => s.uuid)).toEqual(['f']);
            expect(settled.credits).toBe(40_000);
            expect(roster).toEqual([]);
        });

    it('freezes a carrier\'s sale when a ship in its WING has a hold open',
        async () => {
            // The sale takes the whole wing off the roster, so an open hold
            // anywhere in the subtree has to hold the sale back. Only the
            // wing (a freighter) carries cargo; the carrier is a fighter.
            const carrier = entry('carrier',
                { shipId: FIGHTER, pendingSale: true });
            const wing = entry('wing', { parent: 'carrier' });
            const roster = [carrier, wing];
            const { transaction, visit, holdOpen } = await tradeVisit(roster);
            expect(transaction.holdOpen('wing')).toBeTrue();
            expect(transaction.holdOpen('carrier')).toBeFalse();

            expect(settleEscortDeals(roster, PLAYER, 0, getShip, holdOpen)
                .sold).toEqual([]);
            expect(roster.length).toBe(2);

            transaction.release(visit);
            expect(settleEscortDeals(roster, PLAYER, 0, getShip, holdOpen)
                .sold.map(s => s.uuid)).toEqual(['carrier']);
            expect(roster).toEqual([]);
        });

    it('lets deals for escorts with NO open hold settle as they always did',
        async () => {
            const freighter = entry('f');
            const fighter = entry('g',
                { shipId: FIGHTER, pendingSale: true });
            const roster = [freighter, fighter];
            // Only the freighter carries cargo, so only it is leased.
            const { transaction, holdOpen } = await tradeVisit(roster);
            expect(transaction.holdOpen('g')).toBeFalse();

            const settled = settleEscortDeals(roster, PLAYER, 0, getShip,
                holdOpen);
            expect(settled.sold.map(s => s.uuid)).toEqual(['g']);
            expect(roster.map(e => e.uuid)).toEqual(['f']);
        });

    it('WITHOUT the lease, the sale strands the hold — the bug this pins',
        () => {
            const freighter = entry('f', { pendingSale: true });
            const roster = [freighter];
            const holds = [hold(freighter)];
            // No lease: settlement cannot see the exchange.
            settleEscortDeals(roster, PLAYER, 0, getShip);
            expect(roster).toEqual([]);

            // The exchange's Done still writes the hold, onto an entity that
            // left the roster and will never lift off.
            holds[0].cargo.set('cargo:0', 40);
            commitFleetHolds(holds);
            expect(roster.length).toBe(0);
        });
});
