import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player/player_escort.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import {
    EscortDealEntry, queuedUpgradeTargets, settleEscortDeals,
} from './escort_deals.js';

/**
 * ============================================================================
 * Settling queued escort deals at the shipyard
 * ============================================================================
 *
 * The far end of the deferred flow: the comm dialog queued an upgrade or a
 * sale (nova_plugin/escorts/escort_action.ts) and the player has now landed
 * somewhere with a shipyard. These specs drive the settlement over a landed
 * roster exactly as browser.ts does — a plain array of CarriedEscort-shaped
 * entries, mutated in place — and check the money, the hull, and what is
 * left on the roster to lift off again.
 */

const PLAYER = 'player-uuid';
const OTHER_PLAYER = 'somebody-else';
const SHIP = 'test:terrapin';
const BETTER = 'test:terrapin-2';
const PLAIN = 'test:shuttle';
const UPGRADE_COST = 50_000;

const SHIPS = new Map<string, ShipData>([
    [SHIP, {
        ...getDefaultShipData(), id: SHIP, name: 'Terrapin', price: 150_000,
        escortUpgradeShip: BETTER, escortUpgradeCost: UPGRADE_COST,
        escortSellValue: 0,
        physics: { ...getDefaultShipData().physics, freeCargo: 100 },
    }],
    [BETTER, {
        ...getDefaultShipData(), id: BETTER, name: 'Terrapin II',
        price: 400_000, escortUpgradeShip: null, escortUpgradeCost: 0,
        escortSellValue: 0,
        physics: { ...getDefaultShipData().physics, freeCargo: 30 },
    }],
    [PLAIN, {
        ...getDefaultShipData(), id: PLAIN, name: 'Shuttle', price: 110_000,
        escortUpgradeShip: null, escortUpgradeCost: 0, escortSellValue: 0,
    }],
]);

const getShip = (id: string) => SHIPS.get(id);

/** A landed-roster entry, as browser.ts holds one. */
function entry(uuid: string, options: {
    shipId?: string,
    provenance?: 'hired' | 'captured',
    pendingUpgrade?: string,
    pendingSale?: boolean,
    parent?: string,
    player?: string,
} = {}): EscortDealEntry {
    const shipId = options.shipId ?? SHIP;
    const entity = new Entity()
        .addComponent(ShipComponent, { id: shipId })
        .addComponent(ShipDataComponent, SHIPS.get(shipId)!)
        .addComponent(PlayerEscortComponent, {
            player: options.player ?? PLAYER,
            parent: options.parent ?? options.player ?? PLAYER,
            provenance: options.provenance ?? 'captured',
            ...options.pendingUpgrade !== undefined
                ? { pendingUpgrade: options.pendingUpgrade } : {},
            ...options.pendingSale ? { pendingSale: true } : {},
        });
    return { player: options.player ?? PLAYER, uuid, entity };
}

function markerOf(entity: Entity) {
    return entity.components.get(PlayerEscortComponent)!;
}

describe('queuedUpgradeTargets', () => {
    it('names every class the roster\'s queued upgrades will need, sorted '
        + 'and de-duplicated', () => {
            const roster = [
                entry('a', { pendingUpgrade: BETTER }),
                entry('b', { pendingUpgrade: BETTER }),
                entry('c', { pendingUpgrade: PLAIN }),
                entry('d'),
            ];
            expect(queuedUpgradeTargets(roster, PLAYER))
                .toEqual([BETTER, PLAIN].sort());
        });

    it('ignores another player\'s escorts', () => {
        const roster = [entry('a',
            { player: OTHER_PLAYER, pendingUpgrade: BETTER })];
        expect(queuedUpgradeTargets(roster, PLAYER)).toEqual([]);
    });
});

describe('settling a queued SALE', () => {
    it('pays the Bible\'s 10%-of-cost default and DROPS the escort from '
        + 'the roster, so it never lifts off', () => {
            // SHIP: price 150,000, EscSellValue 0 -> 15,000.
            const sold = entry('sold', { pendingSale: true });
            const kept = entry('kept');
            const roster = [sold, kept];
            const settled = settleEscortDeals(roster, PLAYER, 1_000, getShip);
            expect(settled.credits).toBe(15_000);
            expect(settled.sold).toEqual([{
                uuid: 'sold', shipId: SHIP, value: 15_000, withCarrier: [],
            }]);
            expect(roster).toEqual([kept]);
        });

    it('pays the class\'s own EscSellValue when it has one', () => {
        const ships = new Map(SHIPS);
        ships.set(SHIP, { ...SHIPS.get(SHIP)!, escortSellValue: 25_000 });
        const sold = entry('sold', { pendingSale: true });
        sold.entity.components.set(ShipDataComponent, ships.get(SHIP)!);
        const roster = [sold];
        expect(settleEscortDeals(roster, PLAYER, 0,
            id => ships.get(id)).credits).toBe(25_000);
        expect(roster).toEqual([]);
    });

    it('takes the sold escort\'s OWN WING with it — a wing was the '
        + 'player\'s only through its carrier', () => {
            const carrier = entry('carrier', { pendingSale: true });
            const wing = entry('wing', { parent: 'carrier' });
            const deeper = entry('deeper', { parent: 'wing' });
            const other = entry('other');
            const roster = [carrier, wing, deeper, other];
            const settled = settleEscortDeals(roster, PLAYER, 0, getShip);
            expect(settled.sold[0].withCarrier).toEqual(['deeper', 'wing']);
            expect(roster).toEqual([other]);
        });

    it('DROPS a sale flagged on a HIRED escort rather than paying for a '
        + 'hull that was never the player\'s', () => {
            const hired = entry('hired',
                { provenance: 'hired', pendingSale: true });
            const roster = [hired];
            const settled = settleEscortDeals(roster, PLAYER, 0, getShip);
            expect(settled.credits).toBe(0);
            expect(settled.sold).toEqual([]);
            expect(roster).toEqual([hired]);
            // ...and the impossible flag is cleared, not left to try again.
            expect(markerOf(hired.entity).pendingSale).toBeUndefined();
        });

    it('leaves another player\'s queued sale entirely alone', () => {
        const theirs = entry('theirs',
            { player: OTHER_PLAYER, pendingSale: true });
        const roster = [theirs];
        expect(settleEscortDeals(roster, PLAYER, 0, getShip).credits).toBe(0);
        expect(roster).toEqual([theirs]);
        expect(markerOf(theirs.entity).pendingSale).toBeTrue();
    });
});

describe('settling a queued UPGRADE', () => {
    it('charges EscUpgrdCost and swaps the class in place', () => {
        const escort = entry('e', { pendingUpgrade: BETTER });
        const roster = [escort];
        const settled = settleEscortDeals(roster, PLAYER, 100_000, getShip);
        expect(settled.credits).toBe(-UPGRADE_COST);
        expect(settled.upgraded).toEqual([{
            uuid: 'e', fromShip: SHIP, toShip: BETTER, cost: UPGRADE_COST,
        }]);
        expect(escort.entity.components.get(ShipComponent)?.id).toBe(BETTER);
        // It is still aboard, and still the player's.
        expect(roster).toEqual([escort]);
        expect(markerOf(escort.entity).player).toBe(PLAYER);
        expect(markerOf(escort.entity).provenance).toBe('captured');
    });

    it('clamps cargo to the new hull\'s hold (replaceEscortShipClass)', () => {
        const escort = entry('e', { pendingUpgrade: BETTER });
        escort.entity.components.set(CargoComponent,
            new Map([['cargo:0', 40], ['cargo:4', 30]]));
        settleEscortDeals([escort], PLAYER, 100_000, getShip);
        const cargo = escort.entity.components.get(CargoComponent)!;
        expect(cargo.get('cargo:0')).toBe(30);
        expect(cargo.get('cargo:4')).toBeUndefined();
    });

    it('SKIPS an upgrade the player cannot afford and KEEPS IT QUEUED',
        () => {
            const escort = entry('e', { pendingUpgrade: BETTER });
            const settled =
                settleEscortDeals([escort], PLAYER, UPGRADE_COST - 1, getShip);
            expect(settled.credits).toBe(0);
            expect(settled.upgraded).toEqual([]);
            expect(escort.entity.components.get(ShipComponent)?.id).toBe(SHIP);
            expect(markerOf(escort.entity).pendingUpgrade).toBe(BETTER);
        });

    it('DROPS a queue whose stored target no longer matches the escort\'s '
        + 'own UpgradeTo', () => {
            // The escort changed class some other way since the deal was
            // struck; charging one class's price for another's hull is
            // exactly what the stored target exists to prevent.
            const escort = entry('e',
                { shipId: PLAIN, pendingUpgrade: BETTER });
            const settled =
                settleEscortDeals([escort], PLAYER, 1_000_000, getShip);
            expect(settled.upgraded).toEqual([]);
            expect(settled.credits).toBe(0);
            expect(escort.entity.components.get(ShipComponent)?.id).toBe(PLAIN);
            expect(markerOf(escort.entity).pendingUpgrade).toBeUndefined();
        });

    it('keeps a queue whose target class is not loaded, rather than '
        + 'dropping it', () => {
            const escort = entry('e', { pendingUpgrade: BETTER });
            const settled = settleEscortDeals([escort], PLAYER, 1_000_000,
                id => id === BETTER ? undefined : SHIPS.get(id));
            expect(settled.upgraded).toEqual([]);
            expect(markerOf(escort.entity).pendingUpgrade).toBe(BETTER);
        });

    it('leaves another player\'s queued upgrade alone', () => {
        const theirs = entry('theirs',
            { player: OTHER_PLAYER, pendingUpgrade: BETTER });
        expect(settleEscortDeals([theirs], PLAYER, 1_000_000, getShip)
            .upgraded).toEqual([]);
        expect(theirs.entity.components.get(ShipComponent)?.id).toBe(SHIP);
    });
});

describe('the settlement as a whole', () => {
    it('is IDEMPOTENT — the client calls it on every docked frame', () => {
        const escort = entry('e', { pendingUpgrade: BETTER });
        const roster = [escort];
        expect(settleEscortDeals(roster, PLAYER, 100_000, getShip).credits)
            .toBe(-UPGRADE_COST);
        // Second and third calls do nothing: the flag is gone, and the
        // upgraded hull is a dead end with nothing left to queue.
        for (let i = 0; i < 2; i++) {
            const again =
                settleEscortDeals(roster, PLAYER, 100_000, getShip);
            expect(again).toEqual({ sold: [], upgraded: [], credits: 0 });
        }
    });

    it('settles SALES FIRST, so their proceeds pay for the upgrades', () => {
        // 15,000 from the sale turns an unaffordable 50,000 upgrade into
        // an affordable one.
        const sold = entry('sold', { pendingSale: true });
        const upgrading = entry('up', { pendingUpgrade: BETTER });
        const roster = [sold, upgrading];
        const settled =
            settleEscortDeals(roster, PLAYER, UPGRADE_COST - 15_000, getShip);
        expect(settled.sold.length).toBe(1);
        expect(settled.upgraded.length).toBe(1);
        expect(settled.credits).toBe(15_000 - UPGRADE_COST);
        expect(roster).toEqual([upgrading]);
    });

    it('stops charging once the running balance runs out, leaving the rest '
        + 'queued', () => {
            const first = entry('a', { pendingUpgrade: BETTER });
            const second = entry('b', { pendingUpgrade: BETTER });
            const settled = settleEscortDeals([first, second], PLAYER,
                UPGRADE_COST, getShip);
            expect(settled.upgraded.map(u => u.uuid)).toEqual(['a']);
            expect(markerOf(second.entity).pendingUpgrade).toBe(BETTER);
        });

    it('SELLS rather than upgrades if a hand-edited save somehow set both',
        () => {
            const escort = entry('e',
                { pendingUpgrade: BETTER, pendingSale: true });
            const roster = [escort];
            const settled =
                settleEscortDeals(roster, PLAYER, 1_000_000, getShip);
            expect(settled.sold.length).toBe(1);
            expect(settled.upgraded).toEqual([]);
            expect(roster).toEqual([]);
        });

    it('does nothing at all to a roster with no queued deals', () => {
        const roster = [entry('a'), entry('b', { provenance: 'hired' })];
        const before = [...roster];
        expect(settleEscortDeals(roster, PLAYER, 1_000_000, getShip))
            .toEqual({ sold: [], upgraded: [], credits: 0 });
        expect(roster).toEqual(before);
    });

    it('restores the marker\'s ENCODED SHAPE when a deal is settled, so it '
        + 'hashes like an escort that never had one', () => {
            const escort = entry('e', { pendingUpgrade: BETTER });
            settleEscortDeals([escort], PLAYER, 1_000_000, getShip);
            expect(markerOf(escort.entity)).toEqual({
                player: PLAYER, parent: PLAYER, provenance: 'captured',
            });
            expect(Object.keys(markerOf(escort.entity)).sort())
                .toEqual(['parent', 'player', 'provenance']);
        });
});
