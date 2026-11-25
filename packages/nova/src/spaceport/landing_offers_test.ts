import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    acceptOffer, LOCATION_BAR, LOCATION_MISSION_COMPUTER, LOCATION_TRADING,
    MissionOffer,
} from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { JumpRouteComponent } from '../nova_plugin/travel/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { LandedTransaction } from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import {
    landingOffers, offerRollsForSystem, resetOfferRolls,
} from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup } from './offer_popup.js';
import { presentVenueOffersIn } from './venue_offers.js';

/**
 * ============================================================================
 * A LANDING'S OFFERS ARE ROLLED ONCE (#324)
 * ============================================================================
 *
 * The original, measured (reference "#324 mission BBS after an accept,
 * wave 21"): an accept withdraws the listings that no longer qualify AT
 * ONCE, but adds nothing in the visit — a job, a bar offer and a
 * trade-center offer that the accept made available are offered from the
 * next landing on — and an accept that leaves the BBS empty closes it.
 *
 * Coldharbour's BBS (synthetic scenario): the Refuge Run charter and the
 * Retainer, mutually exclusive on b107; the Harbour Tally, which b107
 * leaves alone; and the Charter Post Bag, which needs b107. The bar's
 * Charter Toast and the trade center's Charter Manifest need b107 too.
 */
describe('a landing\'s offers (#324)', () => {
    beforeAll(() => installHeadlessPixi());

    const COLDHARBOUR = SYNTHETIC.planets.coldharbour;
    const CHARTER = SYNTHETIC.missions.refugeCharter;
    const RETAINER = SYNTHETIC.missions.charterRetainer;
    const TALLY = SYNTHETIC.missions.harbourTally;
    const POST_BAG = SYNTHETIC.missions.charterPostBag;
    const TOAST = SYNTHETIC.missions.charterToast;
    const MANIFEST = SYNTHETIC.missions.charterManifest;

    afterEach(() => {
        while (MenuControls.focused) {
            MenuControls.focused.unbind();
        }
    });

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

    async function setup() {
        resetOfferRolls();
        const gameData = await getSyntheticGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const hull = makeShip(shipData);
        hull.components.set(CreditsComponent, { credits: 20_000 });
        hull.components.set(CargoComponent, new Map());
        hull.components.set(MissionsComponent, new Map());
        hull.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        hull.components.set(ControlBitsComponent, new Set<number>());
        hull.components.set(LegalRecordsComponent,
            new Map([[SYNTHETIC.govts.compact, 0]]));
        hull.components.set(OutfitsStateComponent, new Map());
        hull.components.set(JumpRouteComponent, { route: [] });
        return { gameData, universe, hull };
    }
    type Setup = Awaited<ReturnType<typeof setup>>;

    /** A landing at Coldharbour over `hull` (the Spaceport's transaction). */
    function land(env: Setup, hull: Entity = env.hull) {
        return LandedTransaction.open(hull, env.gameData, env.universe,
            COLDHARBOUR);
    }

    async function openBoard(env: Setup, transaction: LandedTransaction) {
        const board = new MissionBoard(displayAssets(), env.gameData,
            new Subject<ControlEvent>(), env.universe, COLDHARBOUR,
            LOCATION_MISSION_COMPUTER, 'nova:8505', 'Mission BBS');
        board.transaction = transaction;
        const closed = board.show(transaction.ship);
        for (let i = 0; i < 200 && !board.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(board.container.visible).withContext('board open').toBeTrue();
        return { board, closed };
    }

    interface BoardInternals {
        rows: { kind: string, offer?: MissionOffer, label?: string }[];
        selectedIndex: number;
        accept(): void;
    }

    function listed(board: MissionBoard): string[] {
        return (board as unknown as BoardInternals).rows
            .filter(row => row.kind === 'offer')
            .map(row => row.offer!.data.id);
    }

    function acceptListing(board: MissionBoard, missionId: string) {
        const internals = board as unknown as BoardInternals;
        const index = internals.rows.findIndex(
            row => row.offer?.data.id === missionId);
        expect(index).withContext(`${missionId} listed`)
            .toBeGreaterThanOrEqual(0);
        internals.selectedIndex = index;
        internals.accept();
    }

    function ids(offers: MissionOffer[]): string[] {
        return offers.map(offer => offer.data.id);
    }

    /** Takes `missionId` through the session, as a bar or popup accept would. */
    function acceptElsewhere(transaction: LandedTransaction, missionId: string) {
        const offer = landingOffers(transaction.offerSets, transaction.session,
            transaction.universe, LOCATION_MISSION_COMPUTER)
            .find(candidate => candidate.data.id === missionId);
        expect(offer).withContext(`${missionId} on offer`).toBeDefined();
        expect(acceptOffer(transaction.session.machinery, offer!,
            transaction.session.outfits).accepted).toBeTrue();
    }

    // ── The BBS ─────────────────────────────────────────────────────────

    it('withdraws a disqualified listing at once and keeps the board open '
        + 'on the rest, but lists nothing the accept made available',
        async () => {
            const env = await setup();
            const transaction = await land(env);
            const { board, closed } = await openBoard(env, transaction);
            expect(listed(board)).toEqual([CHARTER, RETAINER, TALLY]);

            acceptListing(board, CHARTER);
            expect(transaction.state.bits.has(BITS.charterSigned)).toBeTrue();
            // The Retainer is gone at once; the Post Bag (b107) is not
            // added, though it qualifies now.
            expect(listed(board)).toEqual([TALLY]);
            expect(board.container.visible).withContext('still open')
                .toBeTrue();
            board.dismiss();
            await closed;

            // Reopened in the same landing: the same, frozen list.
            const again = await openBoard(env, transaction);
            expect(listed(again.board)).toEqual([TALLY]);
            again.board.dismiss();
            await again.closed;
        });

    it('lists the job an accept made available from the next landing on',
        async () => {
            const env = await setup();
            const first = await land(env);
            const { board, closed } = await openBoard(env, first);
            acceptListing(board, CHARTER);
            board.dismiss();
            await closed;
            const lifted = first.commit();

            const second = await land(env, lifted);
            const next = await openBoard(env, second);
            // The charter is active and its twin still disqualified.
            expect(listed(next.board)).toEqual([TALLY, POST_BAG]);
            next.board.dismiss();
            await next.closed;
        });

    it('closes the board when an accept leaves nothing listed, and hands '
        + 'the briefing on', async () => {
            const env = await setup();
            const transaction = await land(env);
            const { board, closed } = await openBoard(env, transaction);
            acceptListing(board, TALLY);
            // Two listings left: open.
            expect(board.container.visible).toBeTrue();
            expect(board.takeClosingBriefing()).toBeUndefined();

            // The charter withdraws the Retainer: nothing is left.
            acceptListing(board, CHARTER);
            await closed;
            expect(board.container.visible).withContext('closed').toBeFalse();
            // The visit was released like a Leave: on the hull.
            const missions = transaction.ship.components.get(MissionsComponent)!;
            expect(missions.has(CHARTER)).toBeTrue();
            expect(missions.has(TALLY)).toBeTrue();
            expect(board.takeClosingBriefing()?.text)
                .toContain('Halden Refuge');
            expect(board.takeClosingBriefing()).withContext('handed on once')
                .toBeUndefined();

            // Reopened: the empty board's message, the Post Bag not added.
            const again = await openBoard(env, transaction);
            expect(listed(again.board)).toEqual([]);
            expect((again.board as unknown as BoardInternals).rows[0]?.kind)
                .toBe('header');
            again.board.dismiss();
            await again.closed;
        });

    it('withdraws a listing on reopening when an accept elsewhere in the '
        + 'landing disqualified it', async () => {
            const env = await setup();
            const transaction = await land(env);
            const { board, closed } = await openBoard(env, transaction);
            expect(listed(board)).toEqual([CHARTER, RETAINER, TALLY]);
            board.dismiss();
            await closed;

            // The bar or a popup takes the Retainer: the charter must not
            // stay takeable at the BBS.
            acceptElsewhere(transaction, RETAINER);
            const again = await openBoard(env, transaction);
            expect(listed(again.board)).toEqual([TALLY]);
            again.board.dismiss();
            await again.closed;
        });

    // ── The bar and the venues ──────────────────────────────────────────

    it('adds no bar offer after an accept until the next landing',
        async () => {
            const env = await setup();
            const first = await land(env);
            const bar = () => ids(landingOffers(first.offerSets,
                first.session, env.universe, LOCATION_BAR));
            expect(bar()).not.toContain(TOAST);
            acceptElsewhere(first, CHARTER);
            expect(bar()).withContext('same landing').not.toContain(TOAST);

            const second = await land(env, first.commit());
            expect(ids(landingOffers(second.offerSets, second.session,
                env.universe, LOCATION_BAR))).toContain(TOAST);
        });

    it('puts no trade-center offer to the player after an accept until the '
        + 'next landing', async () => {
            const env = await setup();
            const shown: string[] = [];
            const popup = {
                show: async (text: string) => {
                    shown.push(text);
                    return 'refuse';
                },
            } as unknown as OfferPopup;
            const first = await land(env);
            await presentVenueOffersIn(first, popup, LOCATION_TRADING);
            expect(shown).toEqual([]);
            acceptElsewhere(first, CHARTER);
            await presentVenueOffersIn(first, popup, LOCATION_TRADING);
            expect(shown).withContext('walked in again').toEqual([]);

            const second = await land(env, first.commit());
            await presentVenueOffersIn(second, popup, LOCATION_TRADING);
            expect(shown.length).toBe(1);
            expect(shown[0]).toContain('manifest');
            expect(ids(landingOffers(second.offerSets, second.session,
                env.universe, LOCATION_TRADING))).toEqual([MANIFEST]);
        });

    // ── The frozen sets belong to the landing ───────────────────────────

    it('keeps the frozen sets across a rollback and a hull swap', async () => {
        const env = await setup();
        const transaction = await land(env);
        const venue = transaction.savepoint('venue');
        const before = landingOffers(transaction.offerSets,
            transaction.session, env.universe, LOCATION_MISSION_COMPUTER);
        expect(ids(before)).toEqual([CHARTER, RETAINER, TALLY]);
        acceptElsewhere(transaction, CHARTER);
        transaction.rollback(venue);
        // The accept is undone; the set rolled under it is not.
        expect(transaction.state.bits.has(BITS.charterSigned)).toBeFalse();
        expect(transaction.offerSets.has(LOCATION_MISSION_COMPUTER))
            .toBeTrue();

        acceptElsewhere(transaction, RETAINER);
        await env.gameData.data.Ship.get(SYNTHETIC.ships.warden);
        transaction.changeShip(SYNTHETIC.ships.warden, 'keep');
        expect(transaction.ship.components.get(ShipComponent)?.id)
            .toBe(SYNTHETIC.ships.warden);
        const after = landingOffers(transaction.offerSets,
            transaction.session, env.universe, LOCATION_MISSION_COMPUTER,
            offerRollsForSystem(SYNTHETIC.systems.thessaly));
        // Not re-rolled: the Post Bag stays out, and the tally is the same
        // frozen offer (its destination was chosen once).
        expect(ids(after)).toEqual([TALLY]);
        expect(after[0].travelPlanet).toBe(before[2].travelPlanet);
    });
});
