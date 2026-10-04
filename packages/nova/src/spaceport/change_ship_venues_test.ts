import 'jasmine';
import { MissionData } from 'novadatainterface/mission_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { BITS, SYNTHETIC } from 'novaparse/synthetic/universe';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { DockedShip } from '../display/docked_ship.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    LOCATION_BAR, LOCATION_MISSION_COMPUTER,
} from '../nova_plugin/missions/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../nova_plugin/player/index.js';
import {
    CargoComponent, makeShip, OutfitsStateComponent, ShipComponent,
} from '../nova_plugin/ship/index.js';
import { Bar } from './bar.js';
import { creditBalance } from './credit_commit.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { LandedTransaction } from './landed_transaction.js';
import { MenuControls } from './menu_controls.js';
import { MissionBoard } from './mission_board.js';
import { MissionUniverse } from './mission_universe.js';
import { Spaceport } from './spaceport.js';

/**
 * ============================================================================
 * A MISSION'S `Cxxx` / `Exxx` / `Hxxx` CHANGES THE SHIP AT EVERY LANDED VENUE
 * ============================================================================
 *
 * Tracker #141. The change-ship operators — "Cxxx: change the player's ship
 * to type xxx", `Exxx` / `Hxxx` its outfit-granting siblings (EVN Bible, the
 * mïsn set-string operators; ncb.ts's ShipChangeMode has the three outfit
 * treatments) — were wired only on the OUTFITTER's visit, for an oütf
 * OnPurchase. A mission accepted anywhere else ran its set string on the
 * landing's session with no hook: runNCBSet warned that the operator is not
 * implemented, and the pilot stayed in the old hull. Stock has five such
 * missions, all OnAccept (nova:197, 320, 361 and 748 from the main
 * spaceport's popups, nova:709 from the shipyard's), so none of the Vell-os
 * or Thunderforge plot turns handed the player their ship.
 *
 * The hook now belongs to the landing's transaction (LandedTransaction's
 * changeShip), which every venue's set strings run on, and the Spaceport
 * publishes the swap off it exactly as it publishes a shipyard purchase.
 *
 * The synthetic scenario's "Warden Commission" (a bar job, gated on
 * b106, OnAccept `!b106 H130`) is the parsed mission these drive; the C/E
 * variants and the BBS offering are the same mission re-written in a
 * spec-local universe.
 */
describe('a mission\'s change-ship set string at a landed venue', () => {
    beforeAll(() => installHeadlessPixi());

    const PORT = SYNTHETIC.planets.port;
    const SKIFF = SYNTHETIC.ships.skiff;
    const WARDEN = SYNTHETIC.ships.warden;
    const COMMISSION = SYNTHETIC.missions.wardenCommission;
    /** The skiff's own gun: NONpersistent, so an `H` drops it. */
    const BLASTER = SYNTHETIC.outfits.blaster;
    /** Nonpersistent too, and the Warden's loadout carries two of them. */
    const CAPACITOR = SYNTHETIC.outfits.shieldCapacitor;
    const CREDITS = 30_000;

    afterEach(() => {
        // Whatever a spec did, nothing may be left holding the keyboard.
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
     * A skiff pilot docked at Port Amberline with the commission on offer.
     * b102 keeps the bar's Gate Survey from being offered first.
     */
    async function landedSkiff(): Promise<Entity> {
        const gameData = await getSyntheticGameData();
        const entity = makeShip(await gameData.data.Ship.get(SKIFF));
        entity.components.set(CreditsComponent, { credits: CREDITS });
        entity.components.set(CargoComponent, new Map());
        entity.components.set(MissionsComponent, new Map());
        entity.components.set(GameDateComponent,
            { day: 1, month: 1, year: 1177 });
        entity.components.set(ControlBitsComponent, new Set<number>(
            [BITS.commissionOffered, BITS.surveyAccepted]));
        entity.components.set(OutfitsStateComponent, new Map([
            [BLASTER, { count: 1 }],
            [CAPACITOR, { count: 1 }],
        ]));
        return entity;
    }

    /** Spins the event loop until `ready` holds (or the spec gives up). */
    async function waitFor(ready: () => boolean, what = 'condition') {
        for (let i = 0; i < 6000 && !ready(); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(ready()).withContext(what).toBe(true);
    }

    /**
     * Accepts the offer popup that is up, then OKs the briefing it is
     * followed by (the commission has one), until no popup is left.
     */
    async function acceptOfferAndBriefing(popup: {
        container: PIXI.Container,
        choice: Subject<'accept' | 'refuse'>,
    }) {
        for (let i = 0; i < 2000; i++) {
            if (popup.container.visible) {
                popup.choice.next('accept');
            }
            await new Promise(resolve => setTimeout(resolve, 0));
            if (i > 20 && !popup.container.visible) {
                return;
            }
        }
    }

    /** Any warning about a change-ship: the missing hook, or a cold cache. */
    function changeShipWarnings(warn: jasmine.Spy): string[] {
        return warn.calls.allArgs().map(args => args.map(String).join(' '))
            .filter(text => /Cxxx\/Exxx\/Hxxx|Change-ship/.test(text));
    }

    /**
     * The outfits the Bible's three operators leave aboard, written out
     * for this pilot (blaster 1, capacitor 1) and the Warden's loadout.
     */
    async function expectedOutfits(letter: 'C' | 'E' | 'H') {
        const gameData = await getSyntheticGameData();
        const warden = await gameData.data.Ship.get(WARDEN);
        const outfits = new Map<string, number>();
        if (letter !== 'C') {
            // E and H: "given all of the default weapons and items that
            // come with ship type xxx".
            for (const [id, count] of Object.entries(warden.outfits)) {
                if (count > 0) {
                    outfits.set(id, count);
                }
            }
        }
        if (letter !== 'H') {
            // C and E keep what the pilot had; H loses every
            // nonpersistent item, which is all this pilot owns.
            for (const [id, count] of [[BLASTER, 1], [CAPACITOR, 1]] as const) {
                outfits.set(id, (outfits.get(id) ?? 0) + count);
            }
        }
        return outfits;
    }

    function outfitCounts(entity: Entity): Map<string, number> {
        return new Map([...entity.components.get(OutfitsStateComponent)
            ?? []].map(([id, { count }]) => [id, count]));
    }

    it('parses the scenario\'s commission as a bar job whose OnAccept is H130',
        async () => {
            const gameData = await getSyntheticGameData();
            const mission = await gameData.data.Mission.get(COMMISSION);
            expect(mission.availLoc).toBe(LOCATION_BAR);
            expect(mission.onAccept)
                .toBe(`!b${BITS.commissionOffered} H130`);
            expect(WARDEN).toBe('nova:130');
        });

    describe('through the real Spaceport, at the bar', () => {
        it('hands the pilot the Heron Warden at the accept, publishes it to '
            + 'the docked handle, and lifts off in it', async () => {
                const warn = spyOn(console, 'warn').and.callThrough();
                const gameData = await getSyntheticGameData();
                const controlEvents = new Subject<ControlEvent>();
                const spaceport = new Spaceport(displayAssets(), gameData,
                    PORT, controlEvents);
                await spaceport.buildPromise;

                const entity = await landedSkiff();
                // browser.ts's own docked record, written by the swap hook.
                const client = { entity };
                const dockedShip = new DockedShip(entity,
                    ship => { client.entity = ship; });
                spaceport.setDockedShip(dockedShip);

                const departed = spaceport.show(entity);
                await waitFor(() => spaceport.onMainScreen, 'landed');
                controlEvents.next({ action: 'bar', state: 'start' });
                const bar = (spaceport as unknown as { bar: Bar }).bar;
                const popup = (bar as unknown as {
                    offerPopup: {
                        container: PIXI.Container,
                        choice: Subject<'accept' | 'refuse'>,
                    },
                }).offerPopup;
                await waitFor(() => popup.container.visible, 'bar offer up');
                await acceptOfferAndBriefing(popup);
                await waitFor(() => !popup.container.visible, 'offer closed');

                // Published at the accept, as a shipyard purchase is.
                expect(client.entity).not.toBe(entity);
                expect(dockedShip.entity).toBe(client.entity);
                expect(client.entity.components.get(ShipComponent)?.id)
                    .toBe(WARDEN);
                // The traded-away skiff is left as it was.
                expect(entity.components.get(ShipComponent)?.id).toBe(SKIFF);

                // Out of the bar: the spaceport holds the new hull, not
                // the one the bar was opened over.
                controlEvents.next({ action: 'depart', state: 'start' });
                await waitFor(() => spaceport.onMainScreen, 'bar left');
                expect((spaceport as unknown as { input: Entity }).input)
                    .toBe(client.entity);

                // ...and the landing lifts off in it.
                controlEvents.next({ action: 'depart', state: 'start' });
                const ship = await departed;
                expect(ship).toBe(client.entity);
                expect(ship.components.get(ShipComponent)?.id).toBe(WARDEN);
                expect(outfitCounts(ship)).toEqual(await expectedOutfits('H'));
                expect(ship.components.get(MissionsComponent)!
                    .has(COMMISSION)).toBe(true);
                const bits = ship.components.get(ControlBitsComponent)!;
                expect(bits.has(BITS.commissionOffered)).toBe(false);
                expect(bits.has(BITS.surveyAccepted)).toBe(true);
                // No price: the commission hands the ship over.
                expect(creditBalance(ship)).toBe(CREDITS);
                expect(changeShipWarnings(warn)).toEqual([]);
            }, 120_000);
    });

    describe('on the landing\'s transaction, for each operator', () => {
        /**
         * A universe of this spec's own whose commission runs `letter`130
         * and is offered at `location` (the shared one is left alone).
         */
        async function universeWith(letter: 'C' | 'E' | 'H',
            location: number): Promise<MissionUniverse> {
            const gameData = await getSyntheticGameData();
            const universe = new MissionUniverse(gameData);
            await universe.load();
            const variant: MissionData = {
                ...universe.getMission(COMMISSION)!,
                availLoc: location,
                onAccept: `!b${BITS.commissionOffered} ${letter}130`,
            };
            (universe as unknown as { missionsById: Map<string, MissionData> })
                .missionsById.set(COMMISSION, variant);
            universe.missions = universe.missions.map(
                mission => mission.id === COMMISSION ? variant : mission);
            return universe;
        }

        /** Accepts the commission at the bar; resolves with Done's entity. */
        async function acceptAtBar(entity: Entity, universe: MissionUniverse,
            transaction: LandedTransaction): Promise<Entity> {
            const gameData = await getSyntheticGameData();
            const controlEvents = new Subject<ControlEvent>();
            const bar = new Bar(displayAssets(), gameData, controlEvents,
                universe, PORT);
            await bar.buildPromise;
            bar.transaction = transaction;
            const internals = bar as unknown as {
                controls: MenuControls,
                offerPopup: {
                    container: PIXI.Container,
                    choice: Subject<'accept' | 'refuse'>,
                },
            };
            const left = bar.show(entity);
            await waitFor(() => internals.offerPopup.container.visible,
                'bar offer up');
            await acceptOfferAndBriefing(internals.offerPopup);
            await waitFor(() => MenuControls.focused === internals.controls,
                'back in the bar');
            controlEvents.next({ action: 'depart', state: 'start' });
            return left;
        }

        /** Accepts the commission off the BBS; resolves with Done's entity. */
        async function acceptAtBoard(entity: Entity,
            universe: MissionUniverse,
            transaction: LandedTransaction): Promise<Entity> {
            const gameData = await getSyntheticGameData();
            const controlEvents = new Subject<ControlEvent>();
            const board = new MissionBoard(displayAssets(), gameData,
                controlEvents, universe, PORT, LOCATION_MISSION_COMPUTER,
                'nova:8505', 'Mission BBS');
            await board.buildPromise;
            board.transaction = transaction;
            const left = board.show(entity);
            await waitFor(() => board.container.visible, 'board up');
            const internals = board as unknown as {
                rows: { kind: string, offer?: { data: MissionData } }[],
                selectedIndex: number,
                accept(): void,
                text: { status: { text: string } },
            };
            internals.selectedIndex = internals.rows.findIndex(row =>
                row.kind === 'offer' && row.offer?.data.id === COMMISSION);
            expect(internals.selectedIndex).toBeGreaterThanOrEqual(0);
            internals.accept();
            expect(internals.text.status.text.startsWith('Accepted:'))
                .withContext(internals.text.status.text).toBe(true);
            controlEvents.next({ action: 'depart', state: 'start' });
            return left;
        }

        const venues = [
            { name: 'the bar', location: LOCATION_BAR, accept: acceptAtBar },
            {
                name: 'the mission BBS', location: LOCATION_MISSION_COMPUTER,
                accept: acceptAtBoard,
            },
        ];
        for (const venue of venues) {
            for (const letter of ['C', 'E', 'H'] as const) {
                it(`swaps the hull for ${letter}130 accepted at ${venue.name}`,
                    async () => {
                        const warn = spyOn(console, 'warn').and.callThrough();
                        const gameData = await getSyntheticGameData();
                        const universe =
                            await universeWith(letter, venue.location);
                        const entity = await landedSkiff();
                        // Opened as the Spaceport opens the landing's.
                        const transaction = await LandedTransaction.open(
                            entity, gameData, universe, PORT);
                        expect(transaction.session.machinery.changeShip)
                            .withContext('change-ship hook wired')
                            .toBeDefined();
                        const changes: Entity[] = [];
                        transaction.onShipChanged(ship => changes.push(ship));

                        const done = await venue.accept(
                            entity, universe, transaction);

                        // One change, announced as it happened.
                        expect(changes.length).toBe(1);
                        const ship = changes[0];
                        expect(ship).not.toBe(entity);
                        expect(transaction.ship).toBe(ship);
                        // Done hands back the hull the pilot is in now.
                        expect(done).toBe(ship);
                        expect(ship.components.get(ShipComponent)?.id)
                            .toBe(WARDEN);
                        expect(outfitCounts(ship))
                            .toEqual(await expectedOutfits(letter));
                        // The rest of the set string, and the visit's
                        // accept, landed on the new hull.
                        expect(ship.components.get(ControlBitsComponent)!
                            .has(BITS.commissionOffered)).toBe(false);
                        expect(ship.components.get(MissionsComponent)!
                            .has(COMMISSION)).toBe(true);
                        expect(creditBalance(ship)).toBe(CREDITS);
                        // The skiff is untouched.
                        expect(entity.components.get(ShipComponent)?.id)
                            .toBe(SKIFF);
                        expect(changeShipWarnings(warn)).toEqual([]);
                    }, 120_000);
            }
        }
    });
});
