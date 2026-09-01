import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { EscortDealEntry, settleEscortDeals } from './escort_deals.js';
import {
    closeFleetHolds, commitFleetHolds, FleetHold, fleetHoldOpen,
    openFleetHolds, withFleetHoldLease,
} from './fleet_cargo.js';

/**
 * ============================================================================
 * The fleet-hold LEASE: a venue's open holds freeze that escort's deals
 * ============================================================================
 *
 * The trade centre checks out working copies of the landed escorts' holds
 * when it opens and writes them back at Done. Meanwhile browser.ts settles
 * queued escort deals on EVERY docked frame at a shipyard, and a settled SALE
 * splices its escort off the landed roster.
 *
 * Nothing used to stop those from overlapping: sell an escort while the
 * exchange had its hold open and Done would commit the cargo onto an entity
 * that is no longer on any roster — so the goods evaporated while the credits
 * stayed spent. The lease closes it by freezing the deals of any escort whose
 * hold is checked out; they settle on the next docked frame after Done, which
 * the settlement already runs on.
 */

const PLAYER = 'player-uuid';
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

describe('open fleet holds', () => {
    /** Stands in for the open venue instance the registry is keyed by. */
    let venue: object;

    beforeEach(() => { venue = {}; });
    afterEach(() => closeFleetHolds(venue));

    it('reports only the escorts an open venue is actually editing', () => {
        const freighter = entry('f');
        expect(fleetHoldOpen('f')).toBe(false);
        openFleetHolds(venue, [hold(freighter)]);
        expect(fleetHoldOpen('f')).toBe(true);
        expect(fleetHoldOpen('somebody-else')).toBe(false);
        closeFleetHolds(venue);
        expect(fleetHoldOpen('f')).toBe(false);
    });

    it('replaces a venue\'s previous lease rather than stacking it — and '
        + 'says so, because it means a close was skipped', () => {
            const warn = spyOn(console, 'warn');
            openFleetHolds(venue, [hold(entry('first'))]);
            expect(warn).not.toHaveBeenCalled();
            openFleetHolds(venue, [hold(entry('second'))]);
            expect(fleetHoldOpen('first')).toBe(false);
            expect(fleetHoldOpen('second')).toBe(true);
            // Replacing is the safe behaviour but never the expected one:
            // the entry it absorbed had been freezing deals since.
            expect(warn).toHaveBeenCalled();
        });
});

/**
 * ============================================================================
 * The lease must not outlive a FAILED visit
 * ============================================================================
 *
 * The trade centre opens the lease two awaits into show() and released it
 * only from done(). Everything between — the price-event pass, the row
 * layout, Menu.show itself — can throw, and Spaceport.show's catch swallows
 * it; the lease then stayed in the module-level registry FOR THE REST OF THE
 * SESSION with no dialog on screen. settleEscortDeals would see
 * fleetHoldOpen and defer to the next docked frame, over and over, and the
 * player's queued escort sale would simply never pay out.
 *
 * The menu classes are PIXI-bound and cannot be built headlessly (see
 * trade_center_fleet_integration_test.ts), so the guard lives in
 * withFleetHoldLease, which is what the trade centre now wraps its visit in.
 */
describe('withFleetHoldLease', () => {
    let venue: object;

    beforeEach(() => { venue = {}; });
    afterEach(() => closeFleetHolds(venue));

    it('holds the lease for the duration of the body', async () => {
        let openDuringBody: boolean | undefined;
        await withFleetHoldLease(venue, [hold(entry('f'))], async () => {
            openDuringBody = fleetHoldOpen('f');
            // done()'s normal close, which the venue does itself after
            // committing the holds.
            closeFleetHolds(venue);
        });
        expect(openDuringBody).toBeTrue();
        expect(fleetHoldOpen('f')).toBeFalse();
    });

    it('releases the lease when the body throws, and rethrows', async () => {
        const boom = new Error('the exchange exploded mid-show');
        await expectAsync(
            withFleetHoldLease(venue, [hold(entry('f'))], async () => {
                expect(fleetHoldOpen('f')).toBeTrue();
                throw boom;
            })).toBeRejectedWith(boom);

        // THE POINT: nothing is leased afterwards, so the escort's queued
        // deals settle on the next docked frame as they always would.
        expect(fleetHoldOpen('f')).toBeFalse();

        const sold = entry('f', { pendingSale: true });
        const roster = [sold];
        expect(settleEscortDeals(roster, PLAYER, 0, getShip, fleetHoldOpen)
            .sold.map(s => s.uuid)).toEqual(['f']);
        expect(roster).toEqual([]);
    });

    it('does not double-close: a normal return leaves done()\'s close alone',
        () => {
            // The body owns the normal close (it has to happen AFTER
            // commitFleetHolds), so a successful visit must not have the
            // lease pulled out from under a venue that reopened since.
            const other = {};
            return withFleetHoldLease(venue, [hold(entry('f'))], async () => {
                closeFleetHolds(venue);
                // A second venue leases the same escort afterwards.
                openFleetHolds(other, [hold(entry('f'))]);
            }).then(() => {
                expect(fleetHoldOpen('f')).toBeTrue();
                closeFleetHolds(other);
            });
        });
});

describe('escort deals frozen by an open hold', () => {
    let venue: object;

    beforeEach(() => { venue = {}; });
    afterEach(() => closeFleetHolds(venue));

    it('leaves a queued SALE queued, then settles it once Done releases the '
        + 'hold — and the goods bought mid-visit reach the escort', () => {
            const freighter = entry('f', { pendingSale: true });
            const roster = [freighter];
            const holds = [hold(freighter)];
            openFleetHolds(venue, holds);

            // A docked frame while the exchange is open: nothing settles.
            const frozen = settleEscortDeals(roster, PLAYER, 0, getShip,
                fleetHoldOpen);
            expect(frozen.sold).toEqual([]);
            expect(frozen.credits).toBe(0);
            expect(roster.length).toBe(1);
            // The deal is still QUEUED, not dropped.
            expect(freighter.entity.components
                .get(PlayerEscortComponent)!.pendingSale).toBe(true);

            // The player buys 40 tons that spill into this escort's hold,
            // then presses Done: commit, then release.
            holds[0].cargo.set('cargo:0', 40);
            commitFleetHolds(holds);
            closeFleetHolds(venue);
            expect(freighter.entity.components.get(CargoComponent)!
                .get('cargo:0')).toBe(40);

            // The very next docked frame settles the sale, and the escort
            // (cargo and all — the goods are aboard the ship being sold)
            // leaves the roster.
            const settled = settleEscortDeals(roster, PLAYER, 0, getShip,
                fleetHoldOpen);
            expect(settled.sold.map(s => s.uuid)).toEqual(['f']);
            expect(settled.credits).toBe(40_000);
            expect(roster).toEqual([]);
        });

    it('freezes a carrier\'s sale when a ship in its WING has a hold open',
        () => {
            // The sale takes the whole wing off the roster, so an open hold
            // anywhere in the subtree has to hold the sale back.
            const carrier = entry('carrier', { pendingSale: true });
            const wing = entry('wing', { parent: 'carrier' });
            const roster = [carrier, wing];
            openFleetHolds(venue, [hold(wing)]);

            expect(settleEscortDeals(roster, PLAYER, 0, getShip,
                fleetHoldOpen).sold).toEqual([]);
            expect(roster.length).toBe(2);

            closeFleetHolds(venue);
            expect(settleEscortDeals(roster, PLAYER, 0, getShip,
                fleetHoldOpen).sold.map(s => s.uuid)).toEqual(['carrier']);
            expect(roster).toEqual([]);
        });

    it('lets deals for escorts with NO open hold settle as they always did',
        () => {
            const freighter = entry('f');
            const fighter = entry('g',
                { shipId: FIGHTER, pendingSale: true });
            const roster = [freighter, fighter];
            // Only the freighter carries cargo, so only it is leased.
            openFleetHolds(venue, [hold(freighter)]);

            const settled = settleEscortDeals(roster, PLAYER, 0, getShip,
                fleetHoldOpen);
            expect(settled.sold.map(s => s.uuid)).toEqual(['g']);
            expect(roster.map(e => e.uuid)).toEqual(['f']);
        });

    it('WITHOUT the lease, the sale strands the hold — the bug this pins',
        () => {
            const freighter = entry('f', { pendingSale: true });
            const roster = [freighter];
            const holds = [hold(freighter)];
            // No openFleetHolds: settlement cannot see the exchange.
            settleEscortDeals(roster, PLAYER, 0, getShip);
            expect(roster).toEqual([]);

            // The exchange's Done still writes the hold, onto an entity that
            // left the roster and will never lift off.
            holds[0].cargo.set('cargo:0', 40);
            commitFleetHolds(holds);
            expect(roster.length).toBe(0);
        });
});
