import 'jasmine';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
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
import { ActiveRanksComponent, ControlBitsComponent }
    from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import {
    CreditsComponent, GameDateComponent,
} from '../nova_plugin/player_state_plugin.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { commitVenueCredits, creditBalance } from './credit_commit.js';
import { EscortDealEntry, settleEscortDeals } from './escort_deals.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MenuControls } from './menu_controls.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * A SHIP BOUGHT AT THE SHIPYARD REACHES THE DOCKED SEAM IMMEDIATELY
 * ============================================================================
 *
 * `buildPurchasedShip` does not mutate the docked ship: it builds a WHOLE
 * NEW entity and leaves the traded-in hull untouched. The spaceport used to
 * hand that new entity over only at LeaveSpaceportEvent, so for the rest of
 * the visit every docked consumer — the client's `dockedShip.entity`, the
 * status bar's docked readouts, the save writer, and above all browser.ts's
 * per-frame escort-deal settlement — was still holding the ship that had
 * just been traded away.
 *
 * The money bug that made it urgent: escorts keep flying down and joining
 * the landed roster while the player shops, and a queued sale settles on the
 * docked frame the escort touches down (escort_deals.ts). Land with a sale
 * queued, trade up, and the sale's proceeds were added to the dead hull's
 * CreditsComponent — the escort left the roster for good, and the credits
 * evaporated at lift-off.
 *
 * These specs drive the REAL Spaceport (and so the real Shipyard, wired
 * through Spaceport.adoptPurchasedShip) headlessly against mock game data,
 * with a docked handle wired exactly as the display plugin and browser.ts
 * wire theirs: DockedShip's swap hook writes through to a stand-in for
 * browser.ts's `dockedShip` record.
 */
describe('a shipyard purchase published to the docked seam', () => {
    beforeAll(() => installHeadlessPixi());

    /**
     * Every landing these specs open, so it can be walked back out again.
     * MenuControls' focus stack is process-wide: a spec that ends inside
     * the shipyard would leave `MenuControls.focused` set for everything
     * that runs after it, and the display plugins that stand down while a
     * menu owns the keyboard (the UI-sound triggers, the starmap and
     * player-info toggles) would quietly stop firing.
     */
    const openVisits: (() => Promise<void>)[] = [];
    afterEach(async () => {
        while (openVisits.length > 0) {
            await openVisits.pop()!();
        }
    });

    const PLANET_ID = 'nova:200';
    /** The hull the pilot lands in, and the one they trade up to. */
    const OLD_SHIP = 'nova:128';
    const NEW_SHIP = 'nova:129';
    /** The class a captured escort is flying when its sale settles. */
    const ESCORT_SHIP = 'nova:130';

    function ship(id: string, price: number,
        extra: Partial<ShipData> = {}): ShipData {
        // buyRandom 100: on the lot every day (the default 0 is the
        // Bible's "never made available for purchase").
        return {
            ...getDefaultShipData(), id, price, pict: '', buyRandom: 100,
            ...extra,
        };
    }

    const SHIPS = new Map<string, ShipData>([
        [OLD_SHIP, ship(OLD_SHIP, 100_000, { name: 'Old Hull' })],
        [NEW_SHIP, ship(NEW_SHIP, 200_000, { name: 'New Hull; author note' })],
        [ESCORT_SHIP, ship(ESCORT_SHIP, 40_000,
            { name: 'Escort', escortSellValue: 40_000 })],
    ]);

    function planet(): PlanetData {
        return {
            ...getDefaultPlanetData(), id: PLANET_ID, name: 'Testworld',
            landingPict: '', landingDesc: '',
            flags: {
                ...getDefaultPlanetData().flags,
                hasShipyard: true, hasOutfitter: false, hasBar: false,
                hasCommodityExchange: false,
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

    /** Just enough game data for a spaceport with only a shipyard. */
    function simulationData(): SimulationGameDataInterface {
        const outfits = new Map([['nova:300',
            { ...getDefaultOutfitData(), id: 'nova:300', pict: '' }]]);
        const empty = { get: async () => undefined, getCached: () => undefined };
        const spriteSheet = getDefaultSpriteSheetData();
        return {
            ids: Promise.resolve({
                Ship: [...SHIPS.keys()], Outfit: ['nova:300'], Govt: [],
                Weapon: [], Planet: [PLANET_ID], System: [], Mission: [],
                Pers: [], Cron: [], Rank: [], Fleet: [], Dude: [], Junk: [],
                Oops: [], Asteroid: [], SpriteSheet: [], PlayerStart: [],
            }),
            data: {
                ...empty,
                Ship: {
                    get: async (id: string) => SHIPS.get(id),
                    getCached: (id: string) => SHIPS.get(id),
                },
                Outfit: {
                    get: async (id: string) => outfits.get(id),
                    getCached: (id: string) => outfits.get(id),
                },
                Govt: empty,
                Planet: {
                    get: async () => planet(),
                    getCached: () => planet(),
                },
                Mission: empty, Cron: empty, Rank: empty, Pers: empty,
                Junk: empty, Oops: empty, System: empty, Weapon: empty,
                // The purchased hull's stat providers run over a scratch
                // world (ship_build_world.ts); its collision hull comes
                // from here.
                SpriteSheet: {
                    get: async () => spriteSheet,
                    getCached: () => spriteSheet,
                },
            },
        } as unknown as SimulationGameDataInterface;
    }

    /** The pilot as they touch down: old hull, cash, ranks, cargo. */
    function landedPilot(credits: number): Entity {
        return new Entity('pilot')
            .addComponent(ShipComponent, { id: OLD_SHIP })
            .addComponent(MultiplayerData, { owner: 'peer-1' })
            .addComponent(CreditsComponent, { credits })
            .addComponent(OutfitsStateComponent, new Map())
            .addComponent(CargoComponent, new Map())
            .addComponent(ControlBitsComponent, new Set<number>())
            .addComponent(ActiveRanksComponent, new Set(['nova:150']))
            .addComponent(GameDateComponent, { day: 1, month: 1, year: 1177 });
    }

    /**
     * A landed visit wired the way the game wires one: browser.ts holds a
     * `{ uuid, entity, planetId }` record, the display plugin builds a
     * DockedShip over the same entity whose swap hook writes back into that
     * record, and the spaceport is pointed at the DockedShip.
     */
    async function land(credits: number) {
        const controlEvents = new Subject<ControlEvent>();
        const gameData = simulationData();
        // The 'p' dialog is handed the docked entity explicitly (it is out
        // of the world while landed), so it is a direct read of the handle
        // the spaceport itself keeps.
        const playerInfoShown: Entity[] = [];
        const spaceport = new Spaceport(displayAssets(), gameData, PLANET_ID,
            controlEvents, undefined,
            async (shown: Entity) => { playerInfoShown.push(shown); });
        await spaceport.buildPromise;

        const entity = landedPilot(credits);
        // browser.ts's own docked record.
        const client = { uuid: 'player-uuid', entity, planetId: PLANET_ID };
        const dockedShip = new DockedShip(entity,
            ship => { client.entity = ship; });
        spaceport.setDockedShip(dockedShip);

        const departed = spaceport.show(entity);
        // The landing sequence (mission processing, then the pointer-only
        // landing popups, which hold the keyboard) has to finish before the
        // spaceport's own keys mean anything.
        await waitFor(() => spaceport.onMainScreen);
        const press = async (action: ControlEvent['action']) => {
            controlEvents.next({ action, state: 'start' });
            await settle();
        };
        /** Opens a venue: waits until it has taken the keyboard. */
        const enter = async (action: ControlEvent['action']) => {
            await press(action);
            await waitFor(() => !spaceport.onMainScreen);
        };
        /** Leaves the open venue and waits for the main screen to return. */
        const leaveVenue = async () => {
            await press('depart');
            // The purchased hull's stat providers are awaited before the
            // spaceport takes its controls back, and that is real async
            // work — wait for the transition rather than a fixed number of
            // turns of the event loop.
            await waitFor(() => spaceport.onMainScreen);
        };
        // Back out of whatever is still open when the spec ends.
        openVisits.push(async () => {
            for (let i = 0; i < 5 && MenuControls.focused; i++) {
                await press('depart');
            }
        });
        return {
            spaceport, client, dockedShip, departed, press, enter, leaveVenue,
            entity, playerInfoShown,
        };
    }

    /** Lets the menus' pending promise chains run to quiescence. */
    async function settle() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean) {
        for (let i = 0; i < 2000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).toBe(true);
    }

    /**
     * Opens the shipyard and trades up to NEW_SHIP. 'right' twice puts the
     * grid's selection on the second stocked hull (the grid starts with
     * nothing selected).
     */
    async function tradeUp(visit: {
        press: (action: ControlEvent['action']) => Promise<void>,
        enter: (action: ControlEvent['action']) => Promise<void>,
    }) {
        await visit.enter('shipyard');
        await visit.press('right');
        await visit.press('right');
        await visit.press('buy');
    }

    /**
     * The client's per-frame escort-deal settlement, verbatim from
     * browser.ts's `settleDockedEscortDeals`: read the held entity's
     * credits, settle, add the net back.
     */
    function settleFrame(roster: EscortDealEntry[], player: string,
        entity: Entity) {
        const credits = entity.components.get(CreditsComponent);
        if (!credits) {
            return;
        }
        const settled = settleEscortDeals(roster, player, credits.credits,
            id => SHIPS.get(id));
        credits.credits += settled.credits;
    }

    /** A captured escort on the landed roster with a sale queued. */
    function escortWithSaleQueued(player: string): EscortDealEntry {
        return {
            player, uuid: 'escort-uuid',
            entity: new Entity('escort')
                .addComponent(ShipDataComponent, SHIPS.get(ESCORT_SHIP)!)
                .addComponent(PlayerEscortComponent,
                    { player, provenance: 'captured', pendingSale: true }),
        };
    }

    it('moves the docked handle onto the new hull at the BUY, not at Leave',
        async () => {
            const visit = await land(500_000);
            const { client, dockedShip, entity } = visit;
            await tradeUp(visit);

            // Still inside the shipyard — the visit has not ended.
            expect(client.entity).not.toBe(entity);
            expect(dockedShip.entity).toBe(client.entity);
            expect(client.entity.components.get(ShipComponent)?.id)
                .toBe(NEW_SHIP);
            // The traded-in hull is left exactly as it was (the purchase
            // builds a new entity rather than mutating this one).
            expect(entity.components.get(ShipComponent)?.id).toBe(OLD_SHIP);
            expect(entity.components.get(CreditsComponent)?.credits)
                .toBe(500_000);
            // Trade-up price: 200,000 less 25% of the old hull's 100,000.
            expect(creditBalance(client.entity)).toBe(500_000 - 175_000);
        });

    it('settles an escort sale onto the ship the player will fly, '
        + 'and lifts off with the money', async () => {
            const visit = await land(500_000);
            const { client, press, leaveVenue, departed, entity } = visit;
            const roster = [escortWithSaleQueued('player-uuid')];

            await tradeUp(visit);
            // The escort touches down mid-visit, after the trade: the
            // client's next docked frame settles its queued sale.
            settleFrame(roster, 'player-uuid', client.entity);

            expect(creditBalance(client.entity))
                .toBe(500_000 - 175_000 + 40_000);
            // The dead hull never saw a credit of it.
            expect(entity.components.get(CreditsComponent)?.credits)
                .toBe(500_000);
            expect(roster.length).toBe(0);

            // Leave the shipyard, then the spaceport: the entity that lifts
            // off is the purchased hull, carrying the settled proceeds.
            await leaveVenue();
            await press('depart');
            const launched = await departed;
            expect(launched).toBe(client.entity);
            expect(launched.components.get(ShipComponent)?.id).toBe(NEW_SHIP);
            expect(creditBalance(launched)).toBe(500_000 - 175_000 + 40_000);
        });

    it('lands a venue delta commit on the new hull, composed with a '
        + 'settlement that arrives while the venue is open', async () => {
            const visit = await land(500_000);
            const { client, leaveVenue } = visit;
            await tradeUp(visit);
            await leaveVenue(); // Back on the spaceport's main screen.

            // A venue opens over the NEW hull and seeds its working copy.
            const held = client.entity;
            const baseline = creditBalance(held);
            expect(baseline).toBe(500_000 - 175_000);
            const working = { credits: baseline - 20_000 }; // bought goods

            // ...and a queued escort sale settles into the live component
            // while that venue is still open.
            const roster = [escortWithSaleQueued('player-uuid')];
            settleFrame(roster, 'player-uuid', client.entity);

            // Done: the venue commits its DELTA, so both survive.
            const newBaseline = commitVenueCredits(held, baseline, () => {
                held.components.set(CreditsComponent,
                    { credits: working.credits });
            });
            expect(creditBalance(held)).toBe(baseline - 20_000 + 40_000);
            expect(newBaseline).toBe(baseline - 20_000);
        });

    it('shows the new ship in the docked readouts and keeps the pilot\'s '
        + 'ranks across the trade', async () => {
            const visit = await land(500_000);
            const { dockedShip, leaveVenue, press, playerInfoShown } = visit;
            await tradeUp(visit);

            // What the status bar's DrawDockedStatus reads.
            expect(dockedShip.entity.components.get(ShipComponent)?.id)
                .toBe(NEW_SHIP);
            expect(dockedShip.entity.components.get(CreditsComponent)?.credits)
                .toBe(500_000 - 175_000);
            // Ränks are plot state, a shipyard gate and a price discount;
            // a trade must not wipe them.
            expect([...dockedShip.entity.components
                .get(ActiveRanksComponent) ?? []]).toEqual(['nova:150']);

            // ...and the 'p' dialog, back on the main screen, is handed the
            // ship the pilot is now standing in.
            await leaveVenue();
            await press('properties');
            expect(playerInfoShown.length).toBe(1);
            expect(playerInfoShown[0]).toBe(dockedShip.entity);
        });
});
