import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { DockedShip, DockedShipResource } from '../display/docked_ship.js';
import {
    playerComponent, playerJumpRoute, playerMissionMarks,
} from '../display/starmap_plugin.js';
import { DrawDockedStatus } from '../display/status_bar_docked.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    LOCATION_MISSION_COMPUTER, MissionMapMark, MissionOffer,
} from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent,
} from '../nova_plugin/ship/index.js';
import { JumpRouteComponent } from '../nova_plugin/travel/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { LandedTransaction } from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import { resetOfferRolls, rollOffers } from './mission_offers.js';
import { MissionUniverse } from './mission_universe.js';
import { OfferPopup, presentOffers } from './offer_popup.js';
import { Starmap, OpenStarmapOptions } from './starmap.js';

/**
 * ============================================================================
 * EVERY DOCKED READER OF THE PLAYER'S DATA READS THE LANDING'S WORKING COPY
 * ============================================================================
 *
 * While docked the player's ship is in no world: the landing edits ONE
 * working copy (LandedTransaction), and the held hull is written only when
 * a venue closes. Everything that read the player off the hull therefore
 * saw what they had before the open venue opened. Matthew's ruling on
 * #324: "There could be a plugin that adds two missions where you're
 * allowed to accept only one of them, and that NCB update would need to
 * apply immediately. Let's fix this generally for anything that reads
 * player data when docked."
 *
 * The synthetic scenario's Coldharbour mission computer lists exactly two
 * jobs, mutually exclusive on b107 (each `!b107` in its AvailBits, `b107`
 * in its OnAccept): the Refuge Run charter (an active mission bound for
 * Halden Refuge, in Ossory Shoal) and the Retainer (a one-shot that
 * auto-aborts at accept and pays 1,500 credits there).
 */
describe('docked readers of the player\'s data, mid-visit', () => {
    beforeAll(() => installHeadlessPixi());

    const COLDHARBOUR = SYNTHETIC.planets.coldharbour;
    const CHARTER = SYNTHETIC.missions.refugeCharter;
    const RETAINER = SYNTHETIC.missions.charterRetainer;
    const CREDITS = 20_000;

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

    /**
     * A skiff pilot landed at Coldharbour, the landing's transaction open
     * over it and attached to the docked handle (as the Spaceport does),
     * and a display world holding that handle — where the starmap plugin
     * and the status bar find the docked player.
     */
    async function landedAtColdharbour() {
        resetOfferRolls();
        const gameData = await getSyntheticGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const hull = makeShip(shipData);
        hull.components.set(CreditsComponent, { credits: CREDITS });
        hull.components.set(CargoComponent, new Map());
        hull.components.set(MissionsComponent, new Map());
        hull.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        hull.components.set(ControlBitsComponent, new Set<number>());
        hull.components.set(LegalRecordsComponent,
            new Map([[SYNTHETIC.govts.compact, 0]]));
        hull.components.set(OutfitsStateComponent, new Map());
        hull.components.set(JumpRouteComponent, { route: [] });
        const transaction = await LandedTransaction.open(hull, gameData,
            universe, COLDHARBOUR);
        const docked = new DockedShip(hull);
        docked.transaction = transaction;
        const world = new World();
        world.resources.set(DockedShipResource, { current: docked });
        return { gameData, universe, hull, transaction, docked, world };
    }

    type Landed = Awaited<ReturnType<typeof landedAtColdharbour>>;

    /** The BBS over the landing, open, with whatever 'm' passes captured. */
    async function openBoard(landed: Landed) {
        const mapOpens: OpenStarmapOptions[] = [];
        const board = new MissionBoard(displayAssets(), landed.gameData,
            new Subject<ControlEvent>(), landed.universe, COLDHARBOUR,
            LOCATION_MISSION_COMPUTER, 'nova:8505', 'Mission BBS',
            async options => { mapOpens.push(options ?? {}); });
        board.transaction = landed.transaction;
        const closed = board.show(landed.hull);
        for (let i = 0; i < 200 && !board.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(board.container.visible).withContext('board open').toBeTrue();
        return { board, closed, mapOpens };
    }

    interface BoardInternals {
        rows: { kind: string, offer?: MissionOffer }[];
        selectedIndex: number;
        accept(): void;
        openMap(): Promise<void>;
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

    async function leave(board: MissionBoard, closed: Promise<Entity>) {
        board.dismiss();
        await closed;
    }

    // ── The ruling's case: two missions, only one of which may be taken ──

    it('withdraws the other of two mutually exclusive jobs as soon as one '
        + 'is accepted, in the same BBS visit', async () => {
            const landed = await landedAtColdharbour();
            const { board, closed } = await openBoard(landed);
            expect(listed(board)).toEqual([CHARTER, RETAINER]);

            acceptListing(board, CHARTER);

            expect(landed.transaction.state.missions.has(CHARTER)).toBeTrue();
            // b107 is set in the working copy, so the Retainer's `!b107`
            // fails NOW — not only after the visit is released.
            expect(listed(board)).toEqual([]);
            // ...and it cannot be taken by a stale selection either.
            expect(landed.transaction.state.credits.credits).toBe(CREDITS);
            await leave(board, closed);
            expect(landed.hull.components.get(MissionsComponent)!.has(RETAINER))
                .toBeFalse();
        });

    it('withdraws the charter run when the retainer is taken instead',
        async () => {
            const landed = await landedAtColdharbour();
            const { board, closed } = await openBoard(landed);
            acceptListing(board, RETAINER);
            expect(listed(board)).toEqual([]);
            await leave(board, closed);
        });

    it('puts only one of the two to the player in an offer-popup sequence',
        async () => {
            // The bar, the landing and the venue-entry popups present the
            // offers they rolled one after another: an accept earlier in
            // the sequence must withdraw a later, mutually exclusive one.
            const landed = await landedAtColdharbour();
            const session = landed.transaction.session;
            const offers = rollOffers(session, landed.universe,
                LOCATION_MISSION_COMPUTER);
            expect(offers.map(offer => offer.data.id))
                .toEqual([CHARTER, RETAINER]);
            const shown: string[] = [];
            const popup = {
                show: async (text: string) => {
                    shown.push(text);
                    return 'accept';
                },
            } as unknown as OfferPopup;
            await presentOffers(popup, session, landed.universe, offers);

            expect(session.state.missions.has(CHARTER)).toBeTrue();
            // Never offered, so never paid.
            expect(session.state.credits.credits).toBe(CREDITS);
            expect(shown.some(text => text.includes('retainer'))).toBeFalse();
        });

    // ── The status bar (#246) ───────────────────────────────────────────

    it('shows a BBS accept\'s payout in the docked status bar before the '
        + 'visit is released', async () => {
            const landed = await landedAtColdharbour();
            const { board, closed } = await openBoard(landed);
            acceptListing(board, RETAINER);
            // Paid into the working copy; the hull still holds the balance
            // the BBS opened over (it is written at Leave).
            expect(landed.transaction.state.credits.credits)
                .toBe(CREDITS + 1500);
            expect(landed.hull.components.get(CreditsComponent)!.credits)
                .toBe(CREDITS);

            const drawn: number[] = [];
            const statusBar = {
                gauges: { drawStats: () => undefined },
                cargo: {
                    drawCargo: (_free: number, credits: number) =>
                        drawn.push(credits),
                },
            };
            (DrawDockedStatus.step as unknown as (...args: unknown[]) => void)(
                statusBar, landed.world.resources.get(DockedShipResource),
                landed.gameData, undefined);
            expect(drawn).toEqual([CREDITS + 1500]);
            await leave(board, closed);
        });

    // ── The BBS map: visibility, Legal Status and marks (#324) ──────────

    it('gives the starmap plugin the working copy\'s bits, records and '
        + 'missions while the BBS is still open', async () => {
            const landed = await landedAtColdharbour();
            const { board, closed } = await openBoard(landed);
            acceptListing(board, CHARTER);
            // A record moved in this visit (a mission's CompReward would).
            landed.transaction.state.records!.set(SYNTHETIC.govts.compact, -30);

            expect(playerComponent(landed.world, ControlBitsComponent)
                ?.has(BITS.charterSigned)).toBeTrue();
            expect(playerComponent(landed.world, LegalRecordsComponent)
                ?.get(SYNTHETIC.govts.compact)).toBe(-30);
            // The orange mark for the charter run just accepted.
            expect(playerMissionMarks(landed.world, landed.universe))
                .toContain(jasmine.objectContaining<MissionMapMark>({
                    systemId: SYNTHETIC.systems.ossory, missionId: CHARTER,
                }));
            // The hull, which the readers used to see, has none of it yet.
            expect(landed.hull.components.get(ControlBitsComponent)!
                .has(BITS.charterSigned)).toBeFalse();
            expect(landed.hull.components.get(MissionsComponent)!.size)
                .toBe(0);
            await leave(board, closed);
        });

    it('filters the map opened from the BBS against the bit an accept in '
        + 'this visit set', async () => {
            const landed = await landedAtColdharbour();
            const { board, closed, mapOpens } = await openBoard(landed);
            acceptListing(board, CHARTER);
            await (board as unknown as BoardInternals).openMap();
            expect(mapOpens.length).toBe(1);

            // The BBS passes no bits of its own: the map asks the plugin's
            // lookup, as wired in StarmapPlugin. A galaxy with one system
            // hidden behind b107 stands in for a plug-in's story system.
            const HOME = 'nova:128';
            const STORY = 'nova:900';
            const galaxy = new MockGameData();
            galaxy.data.Govt.map.set('nova:128', {
                ...getDefaultGovtData(), id: 'nova:128', name: 'Concord',
                crimeTol: 6,
            });
            galaxy.data.System.map.set(HOME, {
                ...getDefaultSystemData(), id: HOME, name: 'Home',
                position: [0, 0], links: [STORY], govt: 'nova:128',
            });
            galaxy.data.System.map.set(STORY, {
                ...getDefaultSystemData(), id: STORY, name: 'Charter Reach',
                position: [100, 0], links: [HOME],
                visibility: `b${BITS.charterSigned}`, govt: 'nova:128',
            });
            const starmap = new Starmap(displayAssets(),
                galaxy as unknown as SimulationGameDataInterface, HOME,
                new Subject<ControlEvent>(),
                () => playerComponent(landed.world, ControlBitsComponent)
                    ?? new Set());
            await starmap.buildPromise;
            starmap.openOptions = mapOpens[0];
            const shown = starmap.show([]);
            await new Promise(resolve => setTimeout(resolve, 0));
            const graph = (starmap as unknown as {
                systemGraph?: { hasSystem(id: string): boolean },
            }).systemGraph;
            expect(graph?.hasSystem(STORY)).toBeTrue();
            starmap.dismiss();
            await shown;
            await leave(board, closed);
        });

    // ── The docked route (#323) ─────────────────────────────────────────

    it('hands the docked map the landing\'s route, and lifts off with what '
        + 'the map plotted', async () => {
            const landed = await landedAtColdharbour();
            landed.hull.components.set(JumpRouteComponent,
                { route: [SYNTHETIC.systems.kestrel] });
            // The transaction seeds its route as the landing opens.
            const transaction = await LandedTransaction.open(landed.hull,
                landed.gameData, landed.universe, COLDHARBOUR);
            landed.docked.transaction = transaction;

            const route = playerJumpRoute(landed.world);
            // What the docked map reconciles against: the ship's real
            // route, not the empty one an out-of-world ship used to give.
            expect(route?.route).toEqual([SYNTHETIC.systems.kestrel]);
            // The map's close writes the effective route back in place.
            route!.route = [SYNTHETIC.systems.ossory];

            const lifted = transaction.commit();
            expect(lifted.components.get(JumpRouteComponent)?.route)
                .toEqual([SYNTHETIC.systems.ossory]);
        });
});
