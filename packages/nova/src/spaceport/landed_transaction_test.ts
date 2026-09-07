import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { dayNumber } from '../nova_plugin/player/calendar.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import {
    escortDeal, PlayerEscortComponent, withEscortDeal,
} from '../nova_plugin/player/player_escort.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import {
    collectEscortsToSave, decodeSave, encodeSave, extractSaveData,
    extractSavedEscorts, restorePlayerState, restoreSavedEscorts,
    RosterEscort,
} from '../nova_plugin/session/save_game.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { completeEntity } from '../nova_plugin/spawn/entity_data_loader.js';
import { creditBalance } from './credit_commit.js';
import { EscortDealEntry } from './escort_deals.js';
import {
    LandedTransaction, settleVisitEscortDeals,
} from './landed_transaction.js';
import { MissionUniverse } from './mission_universe.js';
import { PendingEscortsComponent } from './pending_escorts.js';

/**
 * ============================================================================
 * THE LANDED TRANSACTION'S RULES (landed_transaction.ts)
 * ============================================================================
 *
 * One working copy per landing; savepoints a venue opens as it starts and
 * releases at Done (or rolls back); the entity written only by a flush,
 * which the outermost release performs, as a delta for credits; the hull
 * swappable and revertible; writers outside the venues composing through
 * the same ledger. Pinned here against mock data; the seams between real
 * venues are landed_seams_integration_test.ts.
 */
describe('the landed transaction', () => {
    const PLANET = 'nova:128';
    const HULL = 'nova:128';
    const BIGGER = 'nova:129';
    const OUTFIT = 'nova:300';
    const PLAYER = 'player-uuid';

    function gameData(): SimulationGameDataInterface {
        const data = new MockGameData();
        for (const id of [HULL, BIGGER]) {
            data.data.Ship.map.set(id, { ...getDefaultShipData(), id });
        }
        data.data.Outfit.map.set(OUTFIT,
            { ...getDefaultOutfitData(), id: OUTFIT, price: 500 });
        return data as unknown as SimulationGameDataInterface;
    }

    function pilot(credits = 100_000, shipId = HULL): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: shipId })
            .addComponent(CreditsComponent, { credits })
            .addComponent(CargoComponent, new Map([['cargo:0', 5]]))
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(MissionsComponent, new Map())
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
    }

    async function landing(entity = pilot()) {
        const data = gameData();
        const transaction = await LandedTransaction.open(entity, data,
            new MissionUniverse(data), PLANET);
        return { entity, transaction };
    }

    it('seeds the working copy from the entity and writes nothing until the '
        + 'outermost release flushes', async () => {
            const { entity, transaction } = await landing();
            const visit = transaction.savepoint('outfitter');
            transaction.credits.credits -= 500;
            transaction.outfits.set(OUTFIT, 1);
            transaction.state.cargo.set('cargo:0', 15);
            transaction.hired.push(BIGGER);
            // The venue is still open: the entity is exactly as it landed.
            expect(creditBalance(entity)).toBe(100_000);
            expect(entity.components.get(OutfitsStateComponent)!.size).toBe(0);
            expect(entity.components.get(CargoComponent)!.get('cargo:0')).toBe(5);
            expect(entity.components.has(PendingEscortsComponent)).toBe(false);

            transaction.release(visit);
            expect(creditBalance(entity)).toBe(99_500);
            expect(entity.components.get(OutfitsStateComponent)!.get(OUTFIT))
                .toEqual({ count: 1 });
            expect(entity.components.get(CargoComponent)!.get('cargo:0'))
                .toBe(15);
            // The hires move onto the entity in the one step that empties
            // the list (pending_escorts.ts).
            expect(entity.components.get(PendingEscortsComponent))
                .toEqual([BIGGER]);
            expect(transaction.hired).toEqual([]);
            // The entity holds COPIES: a later edit does not show until the
            // next flush.
            transaction.state.cargo.set('cargo:0', 20);
            expect(entity.components.get(CargoComponent)!.get('cargo:0'))
                .toBe(15);
        });

    it('rolls a visit\'s edits back IN PLACE, so every view keeps its '
        + 'objects, and leaves the entity at its last flush', async () => {
            const { entity, transaction } = await landing();
            const credits = transaction.credits;
            const cargo = transaction.state.cargo;
            const outfits = transaction.outfits;
            const bits = transaction.state.bits;
            const visit = transaction.savepoint('outfitter');
            credits.credits -= 500;
            cargo.set('cargo:0', 15);
            outfits.set(OUTFIT, 1);
            bits.add(4322);
            transaction.hired.push(BIGGER);
            transaction.state.missions.set('nova:500',
                { id: 'nova:500' } as never);

            transaction.rollback(visit);
            // The same objects, back to what the savepoint saw.
            expect(transaction.credits).toBe(credits);
            expect(credits.credits).toBe(100_000);
            expect(transaction.state.cargo).toBe(cargo);
            expect(cargo.get('cargo:0')).toBe(5);
            expect(outfits.size).toBe(0);
            expect(bits.has(4322)).toBe(false);
            expect(transaction.hired).toEqual([]);
            expect(transaction.state.missions.size).toBe(0);
            expect(creditBalance(entity)).toBe(100_000);
            // A rolled-back savepoint is gone: releasing it is a no-op.
            transaction.release(visit);
            expect(transaction.depth).toBe(0);
        });

    it('nests: an inner release keeps its edits inside the outer visit, '
        + 'which a rollback undoes; only the outermost release flushes',
        async () => {
            const { entity, transaction } = await landing();
            const outer = transaction.savepoint('bar');
            transaction.credits.credits -= 1_000;
            const inner = transaction.savepoint('bar offer');
            transaction.credits.credits -= 2_000;
            transaction.release(inner);
            expect(transaction.depth).toBe(1);
            // Not flushed: the outer visit is still open.
            expect(creditBalance(entity)).toBe(100_000);
            expect(transaction.credits.credits).toBe(97_000);
            transaction.rollback(outer);
            expect(transaction.credits.credits).toBe(100_000);

            // ...and the other way: both released, one flush with both.
            const outer2 = transaction.savepoint('bar');
            transaction.credits.credits -= 1_000;
            const inner2 = transaction.savepoint('bar offer');
            transaction.credits.credits -= 2_000;
            transaction.release(inner2);
            transaction.release(outer2);
            expect(creditBalance(entity)).toBe(97_000);
            // Rolling back to an outer savepoint pops the inner too.
            const a = transaction.savepoint('a');
            transaction.savepoint('b');
            transaction.rollback(a);
            expect(transaction.depth).toBe(0);
        });

    it('flushes credits as a DELTA over a writer it does not own '
        + '(credit_commit.ts), idempotently', async () => {
            const { entity, transaction } = await landing();
            const visit = transaction.savepoint('trade center');
            transaction.credits.credits -= 500;
            // A sale settles onto the live component behind the visit's
            // back — the writer before a transaction exists, or a spec.
            entity.components.get(CreditsComponent)!.credits += 40_000;
            transaction.release(visit);
            expect(creditBalance(entity)).toBe(100_000 - 500 + 40_000);
            // The working balance follows the composed result.
            expect(transaction.credits.credits).toBe(139_500);
            transaction.flush();
            transaction.flush();
            expect(creditBalance(entity)).toBe(139_500);
        });

    it('moves working, live and the sync point together for an external '
        + 'credit, so a rollback keeps the money and undoes only the visit',
        async () => {
            const { entity, transaction } = await landing();
            const visit = transaction.savepoint('outfitter');
            transaction.credits.credits -= 500;
            transaction.applyExternalCredits(40_000);
            expect(transaction.credits.credits).toBe(139_500);
            expect(transaction.spendable()).toBe(139_500);
            expect(creditBalance(entity)).toBe(140_000);

            transaction.rollback(visit);
            expect(transaction.credits.credits).toBe(140_000);
            transaction.flush();
            expect(creditBalance(entity)).toBe(140_000);

            // Released instead: the spend and the sale both land, once.
            const again = transaction.savepoint('outfitter');
            transaction.credits.credits -= 500;
            transaction.applyExternalCredits(-100);
            transaction.release(again);
            expect(creditBalance(entity)).toBe(139_400);
        });

    it('re-seeds from a purchased hull, and hands the old hull back on a '
        + 'rollback, telling the swap listeners each time', async () => {
            const { entity, transaction } = await landing();
            const swaps: Entity[] = [];
            transaction.onShipSwap(ship => swaps.push(ship));
            const credits = transaction.credits;
            const outfits = transaction.outfits;
            const visit = transaction.savepoint('shipyard');
            // What buildPurchasedShip returns: a new entity, charged.
            const bought = pilot(100_000 - 25_000, BIGGER);
            bought.components.set(OutfitsStateComponent,
                new Map([[OUTFIT, { count: 2 }]]));
            transaction.adoptPurchasedShip(bought);
            expect(transaction.ship).toBe(bought);
            expect(swaps).toEqual([bought]);
            // The views keep their objects and read the new hull.
            expect(transaction.credits).toBe(credits);
            expect(credits.credits).toBe(75_000);
            expect(outfits.get(OUTFIT)).toBe(2);
            // A settlement after the trade pays the new hull.
            transaction.applyExternalCredits(40_000);
            expect(creditBalance(bought)).toBe(115_000);
            expect(creditBalance(entity)).toBe(100_000);

            transaction.rollback(visit);
            expect(transaction.ship).toBe(entity);
            expect(swaps).toEqual([bought, entity]);
            expect(outfits.size).toBe(0);
            // The money that arrived meanwhile is not the visit's to undo:
            // it is carried back onto the hull the player is left with.
            expect(credits.credits).toBe(140_000);
            expect(creditBalance(entity)).toBe(140_000);
            transaction.flush();
            expect(creditBalance(entity)).toBe(140_000);
        });

    it('keeps the working credits and bits ahead of the entity across a '
        + 'set-string ship change, moving only the target and the outfits',
        async () => {
            const { entity, transaction } = await landing();
            const visit = transaction.savepoint('outfitter');
            transaction.credits.credits -= 50_000; // the permit
            transaction.state.bits.add(4000);
            // buildChangedShip: the old hull's LIVE balance, new outfits.
            const changed = pilot(100_000, BIGGER);
            changed.components.set(OutfitsStateComponent,
                new Map([[OUTFIT, { count: 1 }]]));
            transaction.adoptChangedShip(changed, BIGGER);
            expect(transaction.ship).toBe(changed);
            expect(transaction.credits.credits).toBe(50_000);
            expect(transaction.state.bits.has(4000)).toBe(true);
            expect(transaction.outfits.get(OUTFIT)).toBe(1);
            transaction.release(visit);
            // The visit's spend lands as a delta on the hull that lifts off.
            expect(creditBalance(changed)).toBe(50_000);
            expect(changed.components.get(ControlBitsComponent)!.has(4000))
                .toBe(true);
            expect(creditBalance(entity)).toBe(100_000);
        });

    it('commit releases every open savepoint, flushes once, and returns the '
        + 'hull; a release that arrives later is dropped, loudly', async () => {
            const { entity, transaction } = await landing();
            const bar = transaction.savepoint('bar');
            transaction.credits.credits -= 1_000;
            const popup = transaction.savepoint('bar offer');
            transaction.credits.credits -= 2_000;
            expect(transaction.commit()).toBe(entity);
            expect(transaction.isClosed).toBe(true);
            expect(transaction.depth).toBe(0);
            expect(creditBalance(entity)).toBe(97_000);
            // The hull has lifted off: the client encodes it on its next
            // frame, after which this entity object is nobody's. A popup
            // sequence still running blind under the Leave (or a venue's
            // Done from a listener that outlived the visit) edits and
            // releases: nothing lands, and the drop is named.
            const warn = spyOn(console, 'warn');
            transaction.credits.credits -= 500;
            transaction.release(popup);
            expect(creditBalance(entity)).toBe(97_000);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.calls.mostRecent().args[0])
                .toContain('release of "bar offer" after the lift-off commit');
            // Nor does the enclosing visit's, a bare flush, or a second
            // commit; each says so.
            transaction.release(bar);
            expect(transaction.flush()).toEqual([]);
            expect(transaction.commit()).toBe(entity);
            expect(creditBalance(entity)).toBe(97_000);
            expect(warn).toHaveBeenCalledTimes(4);
            // A rollback of a savepoint the commit released is the same
            // no-op it always was (and touches neither entity nor copy).
            transaction.rollback(bar);
            expect(transaction.credits.credits).toBe(96_500);
            expect(creditBalance(entity)).toBe(97_000);
        });

    describe('the client\'s escort-deal settlement, through the visit', () => {
        const ESCORT = 'test:terrapin';
        const BETTER = 'test:terrapin-2';
        const ships = (upgradeCost: number) => new Map<string, ShipData>([
            [ESCORT, {
                ...getDefaultShipData(), id: ESCORT, price: 150_000,
                escortUpgradeShip: BETTER, escortUpgradeCost: upgradeCost,
            }],
            [BETTER, { ...getDefaultShipData(), id: BETTER, price: 400_000 }],
        ]);
        function roster(catalogue: Map<string, ShipData>): EscortDealEntry[] {
            return [{
                player: PLAYER, uuid: 'escort-uuid',
                entity: new Entity('escort')
                    .addComponent(ShipComponent, { id: ESCORT })
                    .addComponent(ShipDataComponent, catalogue.get(ESCORT)!)
                    .addComponent(PlayerEscortComponent, {
                        player: PLAYER, parent: PLAYER,
                        provenance: 'hired', pendingUpgrade: BETTER,
                    }),
            }];
        }

        it('gates an upgrade on the WORKING balance and leaves one it '
            + 'cannot cover queued, so the release never goes negative',
            async () => {
                // 100,000 cr; the outfitter has spent 90,000 of it; a
                // 50,000 upgrade lands mid-visit.
                const { entity, transaction } = await landing();
                const visit = transaction.savepoint('outfitter');
                transaction.credits.credits -= 90_000;
                const catalogue = ships(50_000);
                const deals = roster(catalogue);
                const settled = settleVisitEscortDeals(transaction, deals,
                    PLAYER, id => catalogue.get(id));
                expect(settled.upgraded).toEqual([]);
                expect(deals[0].entity.components.get(PlayerEscortComponent)!
                    .pendingUpgrade).toBe(BETTER);
                transaction.release(visit);
                expect(creditBalance(entity)).toBe(10_000);
            });

        it('settles one it CAN cover into the same ledger the visit is '
            + 'spending from', async () => {
                const { entity, transaction } = await landing();
                const visit = transaction.savepoint('outfitter');
                transaction.credits.credits -= 90_000;
                const catalogue = ships(5_000);
                const settled = settleVisitEscortDeals(transaction,
                    roster(catalogue), PLAYER, id => catalogue.get(id));
                expect(settled.upgraded.length).toBe(1);
                // The gate, the readout and the balance that lifts off agree.
                expect(transaction.credits.credits).toBe(5_000);
                expect(transaction.spendable()).toBe(5_000);
                transaction.release(visit);
                expect(creditBalance(entity)).toBe(5_000);
            });
    });

    it('processLanding advances the date on the entity, re-seeds the '
        + 'working copy from it, and flushes the landing', async () => {
            const { entity, transaction } = await landing();
            const before = dayNumber(entity.components.get(GameDateComponent)!);
            const events = await transaction.processLanding();
            expect(events).toEqual([]);
            expect(dayNumber(entity.components.get(GameDateComponent)!))
                .toBe(before + 1);
            expect(transaction.session.currentDay).toBe(before + 1);
            expect(transaction.landingEvents).toBe(events);
        });

    /**
     * The seam between the transaction and the save: a save taken while
     * landed reads the docked entity (client/player_save.ts's
     * buildSaveData) and the landed rosters, so it sees exactly what the
     * last flush put there; restoring it (restorePlayerState writes every
     * required field unconditionally, save_game.ts) hands a fresh entity to
     * a new transaction, whose seed COPIES the restored Maps and Sets into
     * its working objects (mission_session.ts's create / reseed) and whose
     * lift-off flush writes copies back. Nothing on either side may be
     * shared by reference or dropped on the way round: what lifts off from
     * the restored pilot is what lifted off from the original.
     */
    describe('a save taken while landed, restored, and lifted off', () => {
        const SYSTEM = 'test:system';
        const ESCORT = 'test:escort';
        const BETTER = 'test:escort-2';

        it('lands, buys an outfit, queues an escort deal, saves, restores '
            + 'and lifts off with the same state and the deal still queued',
            async () => {
                // ── Land, and shop ──────────────────────────────────────
                const data = gameData();
                const universe = new MissionUniverse(data);
                const entity = pilot();
                const transaction = await LandedTransaction.open(entity, data,
                    universe, PLANET);
                const visit = transaction.savepoint('outfitter');
                transaction.credits.credits -= 500;
                transaction.outfits.set(OUTFIT, 1);
                transaction.state.cargo.set('cargo:0', 7);
                transaction.state.bits.add(42);
                transaction.state.missions.set('nova:500', {
                    id: 'nova:500', acceptedDay: 1, acceptedAt: PLANET,
                    travelPlanet: null, returnPlanet: PLANET, cargoType: -1,
                    cargoQty: 0, cargoLoaded: false, travelDone: false,
                    deadlineDay: null,
                });
                transaction.release(visit);
                expect(creditBalance(entity)).toBe(99_500);

                // ── Queue a deal on a landed escort ─────────────────────
                // The roster holds the escort whole (landed_escorts.ts); the
                // deal is the same marker escort_action.ts writes in flight.
                const mock = new MockGameData();
                for (const id of [ESCORT, BETTER]) {
                    mock.data.Ship.map.set(id, {
                        ...getDefaultShipData(), id,
                        ...(id === ESCORT ? {
                            escortUpgradeShip: BETTER, escortUpgradeCost: 1_000,
                        } : {}),
                    });
                    await mock.data.Ship.get(id);
                }
                const world = await makeSystem(SYSTEM,
                    mock as unknown as SimulationGameDataInterface, undefined,
                    { npcs: false });
                const serializer = world.resources.get(SerializerResource)!;
                const escort = makeShip(mock.data.Ship.map.get(ESCORT)!);
                escort.components.set(MovementStateComponent, {
                    accelerating: 0, position: new Position(500, 500),
                    rotation: new Angle(0), turnBack: false, turning: 0,
                    velocity: new Vector(0, 0),
                });
                escort.components.set(PlayerEscortComponent, withEscortDeal(
                    { player: PLAYER, parent: PLAYER, provenance: 'captured' },
                    { kind: 'upgrade', toShip: BETTER }));
                await completeEntity(world, escort);
                const roster: RosterEscort[] =
                    [{ player: PLAYER, uuid: 'escort-uuid', entity: escort }];

                // ── Save, as buildSaveData does while docked ────────────
                const before = extractSaveData(entity, SYSTEM)!;
                const stored = encodeSave({
                    ...before,
                    escorts: extractSavedEscorts(
                        collectEscortsToSave(PLAYER, [], [roster]), serializer),
                    playerUuid: PLAYER,
                });
                const save = decodeSave(stored)!;
                expect(save.credits).toBe(99_500);
                expect(save.outfits).toEqual([[OUTFIT, 1]]);

                // ── Restore onto a fresh pilot, as player_start does ────
                const fresh = new Entity('restored pilot')
                    .addComponent(ShipComponent, { id: save.ship })
                    .addComponent(OutfitsStateComponent, new Map(
                        save.outfits.map(([id, count]) => [id, { count }])));
                restorePlayerState(fresh, save);
                const escorts = restoreSavedEscorts(save.escorts, serializer,
                    { player: PLAYER, armament: new Set() });
                expect(escorts.map(({ uuid }) => uuid)).toEqual(['escort-uuid']);

                // The restored pilot is still landed: its transaction seeds
                // from the restored components — copies, not the objects
                // restorePlayerState wrote — and sees the purchase.
                const reopened = await LandedTransaction.open(fresh, data,
                    universe, PLANET);
                expect(reopened.spendable()).toBe(99_500);
                expect(reopened.outfits.get(OUTFIT)).toBe(1);
                expect(reopened.state.cargo).not.toBe(
                    fresh.components.get(CargoComponent)!);
                expect(reopened.state.bits).not.toBe(
                    fresh.components.get(ControlBitsComponent)!);

                // ── Lift off ────────────────────────────────────────────
                const hull = reopened.commit();
                expect(hull).toBe(fresh);
                for (const component of [CargoComponent, ControlBitsComponent,
                    MissionsComponent, OutfitsStateComponent, CreditsComponent,
                    GameDateComponent]) {
                    expect(hull.components.get(component))
                        .withContext(component.name)
                        .toEqual(entity.components.get(component));
                }
                // Everything the save reads is what it read before the trip.
                expect(extractSaveData(hull, SYSTEM)).toEqual(before);
                // And the deal is still queued for the next shipyard, in the
                // encoding the settlement reads.
                const marker = escorts[0].entity.components
                    .get(PlayerEscortComponent);
                expect(escortDeal(marker))
                    .toEqual({ kind: 'upgrade', toShip: BETTER });
                expect(marker).toEqual(
                    escort.components.get(PlayerEscortComponent)!);
                expect(escorts[0].entity.components.get(ShipDataComponent)?.id)
                    .toBe(ESCORT);
            });
    });
});
