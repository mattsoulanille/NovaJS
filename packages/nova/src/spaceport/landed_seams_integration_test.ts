import 'jasmine';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSpriteSheetData } from 'novadatainterface/sprite_sheet_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { DockedShip } from '../display/docked_ship.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { LOCATION_MISSION_COMPUTER } from '../nova_plugin/mission_logic.js';
import { ActiveRanksComponent, ControlBitsComponent }
    from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player_state_plugin.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { Bar } from './bar.js';
import { creditBalance } from './credit_commit.js';
import { EscortDealEntry } from './escort_deals.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    LandedTransaction, settleVisitEscortDeals,
} from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import { resetOfferRolls } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { Outfitter } from './outfitter.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { Spaceport } from './spaceport.js';
import { TradeCenter } from './trade_center.js';

/**
 * ============================================================================
 * THE SEAMS BETWEEN VENUES, DRIVEN THROUGH THE REAL VENUES
 * ============================================================================
 *
 * Every venue used to keep a working copy of its own and write it back at
 * Done; every review-round money bug lived on the seam between two of
 * those copies. The landing now has ONE working copy — the transaction
 * (landed_transaction.ts) — and each venue is a view onto it. These specs
 * pin the four seams the refactor exists to close, each through the real
 * PIXI-bound venues (headless PIXI, mock data):
 *
 *   1. buy an outfit at the outfitter, then trade the hull in at the
 *      shipyard, in one landing;
 *   2. hire a pilot at the bar, then gamble the money away;
 *   3. fill the hold at the trade center, then try to accept a cargo
 *      mission at the BBS;
 *   4. queue an escort upgrade, then trade the hull in — and the reverse.
 */
describe('the seams between landed venues', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => {
        resetOfferRolls();
        // Whatever a spec did, nothing may be left holding the keyboard.
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

    const PLANET_ID = 'nova:200';
    const OLD_SHIP = 'nova:128';
    const NEW_SHIP = 'nova:129';
    const ESCORT_SHIP = 'nova:130';
    const BETTER_ESCORT = 'nova:131';
    const OUTFIT = 'nova:300';
    const MISSION = 'nova:500';
    const PLAYER = 'player-uuid';
    /** Every hull lands with a generous free mass and a 20-ton hold. */
    const PHYSICS = {
        ...getDefaultShipData().physics, freeMass: 1_000, freeCargo: 20,
    };

    function ship(id: string, price: number,
        extra: Partial<ShipData> = {}): ShipData {
        return {
            ...getDefaultShipData(), id, price, pict: '', buyRandom: 100,
            physics: PHYSICS, ...extra,
        };
    }

    const SHIPS = new Map<string, ShipData>([
        [OLD_SHIP, ship(OLD_SHIP, 100_000, { name: 'Old Hull' })],
        [NEW_SHIP, ship(NEW_SHIP, 200_000, { name: 'New Hull' })],
        // The one pilot for hire at the bar (a 30,000 cr fee).
        [ESCORT_SHIP, ship(ESCORT_SHIP, 300_000, {
            name: 'Escort', escortSellValue: 40_000, hireRandom: 100,
            escortUpgradeShip: BETTER_ESCORT, escortUpgradeCost: 60_000,
        })],
        [BETTER_ESCORT, ship(BETTER_ESCORT, 400_000, { name: 'Better' })],
    ]);
    const OUTFITS = new Map<string, OutfitData>([
        [OUTFIT, { ...getDefaultOutfitData(), id: OUTFIT, pict: '',
            name: 'Widget', price: 500 }],
    ]);

    function planet(flags: Partial<PlanetData['flags']>): PlanetData {
        return {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Testworld',
            landingPict: '', landingDesc: '',
            // Food trades here at the low tier.
            tradeTiers: ['low', null, null, null, null, null],
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: false, hasOutfitter: false, hasBar: false,
                hasCommodityExchange: false, ...flags,
            },
        } as PlanetData;
    }

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: { Sound: { get: async () => undefined } },
        } as unknown as DisplayAssetDataInterface;
    }

    /** Mock data for a stellar with the given venues (MockGameData). */
    function gameData(flags: Partial<PlanetData['flags']>,
        missions: Partial<ReturnType<typeof getDefaultMissionData>>[] = []):
        SimulationGameDataInterface {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET_ID, planet(flags));
        for (const [id, hull] of SHIPS) {
            data.data.Ship.map.set(id, hull);
        }
        for (const [id, outfit] of OUTFITS) {
            data.data.Outfit.map.set(id, outfit);
        }
        for (const mission of missions) {
            data.data.Mission.map.set(mission.id!,
                { ...getDefaultMissionData(), ...mission });
        }
        data.data.SpriteSheet.map.set('nova:0', getDefaultSpriteSheetData());
        return data as unknown as SimulationGameDataInterface;
    }

    function landedPilot(credits: number): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: OLD_SHIP })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(MissionsComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(ActiveRanksComponent, new Set<string>())
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
    }

    /** Lets the menus' pending promise chains run to quiescence. */
    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean, what = 'ready') {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    /** An escort on the landed roster with an upgrade (or a sale) queued. */
    function escort(deal: 'upgrade' | 'sale'): EscortDealEntry {
        return {
            player: PLAYER, uuid: 'escort-uuid',
            entity: new Entity('escort')
                .addComponent(ShipComponent, { id: ESCORT_SHIP })
                .addComponent(ShipDataComponent, SHIPS.get(ESCORT_SHIP)!)
                .addComponent(PlayerEscortComponent, {
                    player: PLAYER, parent: PLAYER,
                    ...(deal === 'upgrade'
                        ? { provenance: 'hired', pendingUpgrade: BETTER_ESCORT }
                        : { provenance: 'captured', pendingSale: true }),
                }),
        };
    }

    // ── The spaceport harness (seams 1 and 4) ─────────────────────────

    /**
     * A landed visit wired the way the game wires one (see
     * shipyard_docked_swap_test.ts): the client holds a docked record, the
     * display plugin builds a DockedShip over the same entity, and the
     * spaceport is pointed at the DockedShip — which is where the landing's
     * transaction is published for the client's frame loop.
     */
    async function land(credits: number, flags: Partial<PlanetData['flags']>) {
        const controlEvents = new Subject<ControlEvent>();
        const data = gameData(flags);
        const spaceport = new Spaceport(displayAssets(), data, PLANET_ID,
            controlEvents);
        await spaceport.buildPromise;
        const entity = landedPilot(credits);
        const client = { uuid: PLAYER, entity, planetId: PLANET_ID };
        const dockedShip = new DockedShip(entity,
            ship => { client.entity = ship; });
        spaceport.setDockedShip(dockedShip);
        const departed = spaceport.show(entity);
        await waitFor(() => spaceport.onMainScreen, 'the spaceport opened');
        const transaction = dockedShip.transaction!;
        expect(transaction).toBeDefined();
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        const enter = async (action: ControlEvent['action']) => {
            await press(action);
            await waitFor(() => !spaceport.onMainScreen, `${action} opened`);
        };
        const leaveVenue = async () => {
            await press('depart');
            await waitFor(() => spaceport.onMainScreen, 'back on the main screen');
        };
        const venues = spaceport as unknown as {
            outfitter: Outfitter, shipData?: ShipData,
        };
        return {
            spaceport, client, dockedShip, transaction, departed, press,
            enter, leaveVenue, entity, venues, data,
        };
    }

    /** Opens the shipyard and trades up to NEW_SHIP (the second tile). */
    async function tradeUp(visit: {
        press: (action: ControlEvent['action']) => Promise<void>,
        enter: (action: ControlEvent['action']) => Promise<void>,
    }) {
        await visit.enter('shipyard');
        await visit.press('right');
        await visit.press('right');
        await visit.press('buy');
    }

    /** Trade-up price: 200,000 less 25% of the old hull and its outfits. */
    const tradeUpPrice = (outfitsAboard: number) =>
        200_000 - Math.floor(0.25 * (100_000 + outfitsAboard));

    describe('an outfit bought at the outfitter, then the hull traded in at '
        + 'the shipyard, in one landing', () => {
            it('values the outfit just bought in the trade-in, charges each '
                + 'once, and lifts off with the sum', async () => {
                    const visit = await land(500_000,
                        { hasOutfitter: true, hasShipyard: true });
                    const { client, entity, press, enter, leaveVenue,
                        departed, transaction } = visit;
                    const outfitter = visit.venues.outfitter as unknown as {
                        shipData?: ShipData,
                        applyBuy(outfit: OutfitData): void,
                    };

                    await enter('outfitter');
                    await waitFor(() => outfitter.shipData !== undefined,
                        'the outfitter priced the hull');
                    outfitter.applyBuy(OUTFITS.get(OUTFIT)!);
                    // The outfitter's view IS the landing's working copy...
                    expect(transaction.outfits.get(OUTFIT)).toBe(1);
                    expect(transaction.credits.credits).toBe(499_500);
                    // ...and nothing is on the entity until Done.
                    expect(creditBalance(entity)).toBe(500_000);
                    await leaveVenue();
                    expect(creditBalance(entity)).toBe(499_500);
                    expect(entity.components.get(OutfitsStateComponent)!
                        .get(OUTFIT)).toEqual({ count: 1 });

                    await tradeUp(visit);
                    // The shipyard priced the trade against the outfit the
                    // outfitter just put aboard (judgment call 3: every
                    // non-persistent outfit is valued at 25% of list).
                    expect(client.entity.components.get(ShipComponent)?.id)
                        .toBe(NEW_SHIP);
                    const expected = 499_500 - tradeUpPrice(500);
                    expect(creditBalance(client.entity)).toBe(expected);
                    // The transaction re-seeded from the new hull: the
                    // traded-in outfit is gone from the working copy too.
                    expect(transaction.ship).toBe(client.entity);
                    expect(transaction.credits.credits).toBe(expected);
                    expect(transaction.outfits.has(OUTFIT)).toBe(false);
                    // The traded-in hull is left exactly as it was.
                    expect(creditBalance(entity)).toBe(499_500);

                    await leaveVenue();
                    await press('depart');
                    const launched = await departed;
                    expect(launched).toBe(client.entity);
                    expect(creditBalance(launched)).toBe(expected);
                    expect(launched.components.get(OutfitsStateComponent)!
                        .has(OUTFIT)).toBe(false);
                });
        });

    describe('an escort upgrade queued, then the hull traded in', () => {
        it('pays the upgrade from the NEW hull when it settles after the '
            + 'trade, and lifts off with it', async () => {
                const visit = await land(500_000, { hasShipyard: true });
                const { client, entity, press, leaveVenue, departed,
                    transaction } = visit;
                const roster = [escort('upgrade')];

                await tradeUp(visit);
                // The escort touches down mid-visit: the client's docked
                // frame settles its queued upgrade THROUGH the transaction.
                const settled = settleVisitEscortDeals(transaction, roster,
                    PLAYER, id => SHIPS.get(id));
                expect(settled.upgraded.map(u => u.toShip))
                    .toEqual([BETTER_ESCORT]);
                const expected = 500_000 - tradeUpPrice(0) - 60_000;
                expect(creditBalance(client.entity)).toBe(expected);
                expect(transaction.credits.credits).toBe(expected);
                // The dead hull never paid a credit of it.
                expect(creditBalance(entity)).toBe(500_000);

                await leaveVenue();
                await press('depart');
                const launched = await departed;
                expect(launched).toBe(client.entity);
                expect(creditBalance(launched)).toBe(expected);
            });

        it('charges the trade from the post-upgrade balance when the '
            + 'upgrade settled first — neither is paid twice', async () => {
                const visit = await land(500_000, { hasShipyard: true });
                const { client, press, leaveVenue, departed, transaction,
                    enter } = visit;
                const roster = [escort('upgrade')];

                await enter('shipyard');
                // Settles while the shipyard is open, before the Buy.
                settleVisitEscortDeals(transaction, roster, PLAYER,
                    id => SHIPS.get(id));
                expect(transaction.credits.credits).toBe(440_000);
                await press('right');
                await press('right');
                await press('buy');
                const expected = 440_000 - tradeUpPrice(0);
                expect(creditBalance(client.entity)).toBe(expected);
                expect(transaction.credits.credits).toBe(expected);

                await leaveVenue();
                await press('depart');
                expect(creditBalance(await departed)).toBe(expected);
            });

        it('prices a purchase from a sale that settled while the shipyard '
            + 'was open, so the money is not lost to a stale copy', async () => {
                const visit = await land(500_000, { hasShipyard: true });
                const { client, press, transaction, enter } = visit;
                const roster = [escort('sale')];
                await enter('shipyard');
                const settled = settleVisitEscortDeals(transaction, roster,
                    PLAYER, id => SHIPS.get(id));
                expect(settled.credits).toBe(40_000);
                expect(roster).toEqual([]);
                await press('right');
                await press('right');
                await press('buy');
                expect(creditBalance(client.entity))
                    .toBe(540_000 - tradeUpPrice(0));
                expect(transaction.credits.credits)
                    .toBe(540_000 - tradeUpPrice(0));
            });

        it('refuses an upgrade the working balance cannot cover after the '
            + 'trade, leaving it queued', async () => {
                // 500,000 less the 175,000 trade leaves 325,000; a
                // 60,000 upgrade is fine, but a hull bought first with
                // a thinner wallet is not.
                const visit = await land(200_000, { hasShipyard: true });
                const { transaction } = visit;
                const roster = [escort('upgrade')];
                await tradeUp(visit);
                expect(transaction.credits.credits).toBe(25_000);
                const settled = settleVisitEscortDeals(transaction, roster,
                    PLAYER, id => SHIPS.get(id));
                expect(settled.upgraded).toEqual([]);
                expect(roster[0].entity.components.get(PlayerEscortComponent)!
                    .pendingUpgrade).toBe(BETTER_ESCORT);
                expect(transaction.credits.credits).toBe(25_000);
            });
    });

    // ── Standalone venues sharing one transaction (seams 2 and 3) ─────

    /** A landing's transaction over `entity`, to attach to venues. */
    async function transactionOver(entity: Entity,
        data: SimulationGameDataInterface) {
        return LandedTransaction.open(entity, data, new MissionUniverse(data),
            PLANET_ID);
    }

    describe('a pilot hired at the bar, then the money gambled away', () => {
        /** The bar's sub-dialogs, driven as their buttons would. */
        interface BarInternals {
            hireEscort: {
                container: PIXI.Container,
                itemGrid?: { right(): void },
                escortsHeld(): number,
                text: { status: { text: string } },
            };
            gamble: {
                container: PIXI.Container,
                select(index: number): void,
                bet(amount: number): Promise<void>,
                runRace(winner: number): Promise<void>,
            };
            controls: MenuControls;
        }

        async function openBar(entity: Entity,
            transaction: LandedTransaction) {
            const controlEvents = new Subject<ControlEvent>();
            const data = gameData({ hasBar: true });
            const bar = new Bar(displayAssets(), data, controlEvents,
                new MissionUniverse(data), PLANET_ID);
            await bar.buildPromise;
            bar.transaction = transaction;
            const left = bar.show(entity);
            const { hireEscort, gamble, controls } =
                bar as unknown as BarInternals;
            await waitFor(() => MenuControls.focused === controls,
                'the bar took the keyboard');
            const press = async (action: ControlEvent['action']) => {
                controlEvents.next({ action, state: 'start' });
                await settle();
            };
            return { bar, left, press, hireEscort, gamble };
        }

        it('takes the fee and the stake off the one balance, records the '
            + 'hire once, and refuses a hire the balance no longer covers',
            async () => {
                const data = gameData({ hasBar: true });
                const entity = landedPilot(40_000);
                const transaction = await transactionOver(entity, data);

                // Hire: the 300,000 cr Escort's pilot asks 30,000.
                let bar = await openBar(entity, transaction);
                await bar.press('hire');
                await waitFor(() => bar.hireEscort.container.visible,
                    'the hire dialog opened');
                bar.hireEscort.itemGrid!.right();
                await bar.press('hire');
                expect(transaction.hired).toEqual([ESCORT_SHIP]);
                expect(transaction.credits.credits).toBe(10_000);
                expect(bar.hireEscort.escortsHeld()).toBe(1);
                await bar.press('depart'); // closes the hire dialog

                // Gamble: bet 5,000 on racer 0 and lose to racer 3.
                await bar.press('gamble');
                await waitFor(() => bar.gamble.container.visible,
                    'the gamble dialog opened');
                bar.gamble.runRace = async () => undefined;
                const random = spyOn(Math, 'random').and.returnValue(0.99);
                bar.gamble.select(0);
                await bar.gamble.bet(5_000);
                random.and.callThrough();
                expect(transaction.credits.credits).toBe(5_000);
                await bar.press('depart'); // closes the gamble dialog
                // Nothing reached the entity yet.
                expect(creditBalance(entity)).toBe(40_000);
                expect(entity.components.has(PendingEscortsComponent))
                    .toBe(false);

                await bar.press('depart'); // Leave
                await bar.left;
                expect(creditBalance(entity)).toBe(5_000);
                expect(entity.components.get(PendingEscortsComponent))
                    .toEqual([ESCORT_SHIP]);
                expect(transaction.hired).toEqual([]);

                // Back into the bar, same landing: the hire counts ONCE and
                // the fee is refused against the balance the bet left.
                bar = await openBar(entity, transaction);
                await bar.press('hire');
                await waitFor(() => bar.hireEscort.container.visible,
                    'the hire dialog reopened');
                expect(bar.hireEscort.escortsHeld()).toBe(1);
                bar.hireEscort.itemGrid!.right();
                await bar.press('hire');
                expect(bar.hireEscort.text.status.text)
                    .toBe('You cannot afford this pilot\'s fee.');
                expect(transaction.hired).toEqual([]);
                expect(transaction.credits.credits).toBe(5_000);
                await bar.press('depart');
                await bar.press('depart');
                await bar.left;
                expect(entity.components.get(PendingEscortsComponent))
                    .toEqual([ESCORT_SHIP]);
                expect(creditBalance(entity)).toBe(5_000);
            });
    });

    describe('the hold filled at the trade center, then a cargo mission '
        + 'at the BBS', () => {
            /** A 10-ton delivery, picked up at accept, always on the board. */
            const CARGO_MISSION = {
                id: MISSION, availLoc: LOCATION_MISSION_COMPUTER,
                availRandom: 100, cargoType: 0, cargoQty: 10, pickupMode: 0,
                offerText: 'Haul ten tons for us.',
            };

            async function venuesOver(entity: Entity) {
                const data = gameData({ hasCommodityExchange: true },
                    [CARGO_MISSION]);
                const universe = new MissionUniverse(data);
                const transaction = await LandedTransaction.open(entity, data,
                    universe, PLANET_ID);
                const controlEvents = new Subject<ControlEvent>();
                const exchange = new TradeCenter(displayAssets(), data,
                    controlEvents, PLANET_ID);
                const board = new MissionBoard(displayAssets(), data,
                    controlEvents, universe, PLANET_ID,
                    LOCATION_MISSION_COMPUTER, 'nova:8505', 'Mission BBS');
                await Promise.all([exchange.buildPromise, board.buildPromise]);
                exchange.transaction = transaction;
                board.transaction = transaction;
                /** Opens a venue; resolves once it is up, with its visit. */
                const open = async (venue: TradeCenter | MissionBoard) => {
                    const shown = venue.show(entity);
                    await waitFor(() => venue.container.visible,
                        `${venue.container.name} opened`);
                    return { shown };
                };
                const leave = async (visit: { shown: Promise<Entity> }) => {
                    controlEvents.next({ action: 'depart', state: 'start' });
                    await visit.shown;
                };
                return {
                    transaction, exchange, board, open, leave,
                    trade: exchange as unknown as { buy(): void, sell(): void },
                    bbs: board as unknown as {
                        accept(): void, text: { status: { text: string } },
                    },
                };
            }

            it('refuses the mission against the hold the exchange just '
                + 'filled, and accepts it once the goods are sold', async () => {
                    const entity = landedPilot(1_000_000);
                    const { transaction, exchange, board, open, leave, trade,
                        bbs } = await venuesOver(entity);

                    // Fill the 20-ton hold with food.
                    let shown = await open(exchange);
                    trade.buy();
                    expect(transaction.state.cargo.get('cargo:0')).toBe(20);
                    await leave(shown);
                    expect(entity.components.get(CargoComponent)!.get('cargo:0'))
                        .toBe(20);

                    // The BBS reads the very Map the exchange filled: no room.
                    shown = await open(board);
                    bbs.accept();
                    expect(bbs.text.status.text)
                        .toBe('You need 10 tons of free cargo space to accept '
                            + 'this mission.');
                    expect(transaction.state.missions.has(MISSION)).toBe(false);
                    await leave(shown);
                    expect(entity.components.get(MissionsComponent)!.size)
                        .toBe(0);

                    // Sell the food; the hold the BBS reads empties with it.
                    shown = await open(exchange);
                    trade.sell();
                    expect(transaction.state.cargo.has('cargo:0')).toBe(false);
                    await leave(shown);

                    shown = await open(board);
                    bbs.accept();
                    expect(bbs.text.status.text.startsWith('Accepted:'))
                        .withContext(bbs.text.status.text).toBe(true);
                    expect(transaction.state.missions.has(MISSION)).toBe(true);
                    // The mission's freight is in the working hold at once...
                    const freight = [...transaction.state.cargo]
                        .find(([key]) => key.startsWith('mission:'));
                    expect(freight?.[1]).toBe(10);
                    await leave(shown);
                    // ...and on the entity once the visit is released.
                    expect(entity.components.get(MissionsComponent)!.has(MISSION))
                        .toBe(true);
                    expect([...entity.components.get(CargoComponent)!]
                        .find(([key]) => key.startsWith('mission:'))?.[1])
                        .toBe(10);
                });
        });

    // ── The transaction's edges, through the real spaceport ───────────

    describe('a landing whose transaction cannot open', () => {
        // The outfitter's bit-only no-session fallback is gone (tracker
        // #247 asks for the player-facing message). What must hold in its
        // place: no venue that runs set strings opens without a
        // transaction to run them in — so a purchase's OnPurchase can
        // never be dropped on the floor — and the ship lifts off exactly
        // as it landed.
        it('opens no outfitter, says why, and lifts off with the ship as it '
            + 'landed', async () => {
                const warn = spyOn(console, 'warn');
                spyOn(MissionUniverse.prototype, 'load')
                    .and.rejectWith(new Error('the fetch storm lost'));
                const controlEvents = new Subject<ControlEvent>();
                const spaceport = new Spaceport(displayAssets(),
                    gameData({ hasOutfitter: true }), PLANET_ID, controlEvents);
                await spaceport.buildPromise;
                const entity = landedPilot(100_000);
                entity.components.get(ControlBitsComponent)!.add(4000);
                const dockedShip = new DockedShip(entity, () => { });
                spaceport.setDockedShip(dockedShip);
                const departed = spaceport.show(entity);
                await waitFor(() => spaceport.onMainScreen, 'the spaceport opened');
                expect(dockedShip.transaction).toBeUndefined();
                expect(warn.calls.allArgs().map(args => args[0]))
                    .toContain('Landing transaction failed to open:');

                const outfitter = (spaceport as unknown as
                    { outfitter: Outfitter }).outfitter;
                controlEvents.next({ action: 'outfitter', state: 'start' });
                await settle();
                // The shop tried a transaction of its own, could not, and
                // refused the visit: never shown, no savepoint, and the
                // spaceport has its keys back.
                expect(outfitter.container.visible).toBe(false);
                expect((outfitter as unknown as { visit?: unknown }).visit)
                    .toBeUndefined();
                expect(warn.calls.allArgs().map(args => args[0]))
                    .toContain('Outfitter mission session unavailable:');
                expect(spaceport.onMainScreen).toBe(true);
                expect(MenuControls.focused)
                    .toBe((spaceport as unknown as
                        { controls: MenuControls }).controls);

                controlEvents.next({ action: 'depart', state: 'start' });
                expect(await departed).toBe(entity);
                expect(creditBalance(entity)).toBe(100_000);
                expect(entity.components.get(OutfitsStateComponent)!.size)
                    .toBe(0);
                expect([...entity.components.get(ControlBitsComponent)!])
                    .toEqual([4000]);
            });

        it('runs an outfit\'s set string only through a transaction: '
            + 'without one the string is refused aloud, not run bit-only',
            async () => {
                // The branch show() makes unreachable, pinned directly so a
                // future caller that reaches it cannot be silent.
                const outfitter = new Outfitter(displayAssets(),
                    gameData({ hasOutfitter: true }),
                    new Subject<ControlEvent>());
                await outfitter.buildPromise;
                const warn = spyOn(console, 'warn');
                (outfitter as unknown as {
                    runSetString(expression: string): void,
                }).runSetString('b4000');
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.calls.mostRecent().args[0])
                    .toContain('Outfit set string "b4000" dropped');
            });
    });

    describe('the spaceport after its Leave', () => {
        it('is torn down without writing the lifted-off hull again',
            async () => {
                // The spaceport is reused per stellar, and the world's
                // teardown (a jump out of the system) dismisses every one
                // it built — including the one the player already Left.
                // Its transaction is committed: the dismiss's flush for the
                // exit-to-title save must leave it alone, silently (the
                // stray-write guard is for writes that would have landed).
                const visit = await land(100_000, { hasOutfitter: true });
                await visit.enter('outfitter');
                const outfit = OUTFITS.get(OUTFIT)!;
                (visit.venues.outfitter as unknown as {
                    applyBuy(outfit: OutfitData): void,
                }).applyBuy(outfit);
                await visit.leaveVenue();
                await visit.press('depart');
                const lifted = await visit.departed;
                expect(lifted).toBe(visit.entity);
                expect(creditBalance(lifted)).toBe(99_500);
                expect(visit.transaction.isClosed).toBe(true);

                const warn = spyOn(console, 'warn');
                visit.spaceport.dismiss();
                expect(warn).not.toHaveBeenCalled();
                expect(creditBalance(lifted)).toBe(99_500);
            });
    });
});
