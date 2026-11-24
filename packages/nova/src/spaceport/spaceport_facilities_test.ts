import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { BAR_PICT } from './bar.js';
import { Button } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { OUTFITTER_PICT } from './outfitter.js';
import { SHIP_INFO_PICT } from './ship_info.js';
import { MISSION_BBS_PICT, SPACEPORT_PICT, Spaceport } from './spaceport.js';
import { TRADE_CENTER_PICT } from './trade_center.js';

/**
 * #373 (Matthew, 2026-11-23: "yes, build a venue only when the stellar has
 * it"): the spaceport constructs the bar, outfitter, shipyard and trade
 * center only where the stellar's spöb flags offer them. Building a venue
 * is what loads its frame art and its data (the shipyard's every shïp,
 * the outfitter's every oütf), so a facility the stellar lacks now costs
 * the landing nothing. The buttons behave as before: a missing facility's
 * button is hidden and its key does nothing.
 */
describe('spaceport venues by facility (#373)', () => {
    beforeAll(() => installHeadlessPixi());

    type Venues = Record<'outfitter' | 'shipyard' | 'bar' | 'tradeCenter'
        | 'missionComputer', Menu<unknown> | undefined>;

    /** Display assets recording every PICT drawn. */
    function recordingAssets(drawn: string[]): DisplayAssetDataInterface {
        const draw = (id: string) => {
            drawn.push(id);
            return new PIXI.Sprite();
        };
        return {
            spriteFromPict: draw,
            spriteFromPictAsync: async (id: string) => draw(id),
            textureFromPict: (id: string) => {
                drawn.push(id);
                return PIXI.Texture.EMPTY;
            },
            textureFromPictAsync: async (id: string) => {
                drawn.push(id);
                return PIXI.Texture.EMPTY;
            },
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: { get: async () => undefined },
                StringTable: { get: async () => ({ strings: [] }) },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    async function build(planetId: string) {
        const gameData = await getSyntheticGameData();
        const drawn: string[] = [];
        const controlEvents = new Subject<ControlEvent>();
        const spaceport = new Spaceport(recordingAssets(drawn), gameData,
            planetId, controlEvents);
        await spaceport.buildPromise;
        const venues = spaceport as unknown as Venues;
        await Promise.all(Object.values(venues).map(venue =>
            venue?.buildPromise));
        const buttons = (spaceport as unknown as
            { buttons: Record<string, Button> }).buttons;
        return { spaceport, venues, drawn, buttons, controlEvents };
    }

    it('builds every venue at a full-service port', async () => {
        const { venues, drawn, buttons } = await build(SYNTHETIC.planets.port);
        for (const name of ['outfitter', 'shipyard', 'bar', 'tradeCenter',
            'missionComputer'] as const) {
            expect(venues[name]).withContext(name).toBeDefined();
        }
        for (const id of [OUTFITTER_PICT, SHIP_INFO_PICT, BAR_PICT,
            TRADE_CENTER_PICT]) {
            expect(drawn).toContain(id);
        }
        for (const name of ['bar', 'tradeCenter', 'outfitter', 'shipyard']) {
            expect(buttons[name].container.visible).withContext(name).toBeTrue();
        }
    });

    it('builds only the bar and the exchange at Coldharbour', async () => {
        const { spaceport, venues, drawn, buttons } =
            await build(SYNTHETIC.planets.coldharbour);
        expect(venues.bar).toBeDefined();
        expect(venues.tradeCenter).toBeDefined();
        expect(venues.missionComputer).toBeDefined();
        expect(venues.outfitter).toBeUndefined();
        expect(venues.shipyard).toBeUndefined();
        // Neither shop frame (the outfitter and shipyard share PICT 8502)
        // nor the shipyard's ship-info dialog was ever loaded.
        expect(drawn).not.toContain(OUTFITTER_PICT);
        expect(drawn).not.toContain(SHIP_INFO_PICT);
        expect(drawn).toContain(BAR_PICT);
        expect(drawn).toContain(TRADE_CENTER_PICT);
        // The buttons are as they were: the missing facilities' hidden.
        expect(buttons.outfitter.container.visible).toBeFalse();
        expect(buttons.shipyard.container.visible).toBeFalse();
        expect(buttons.bar.container.visible).toBeTrue();
        expect(buttons.tradeCenter.container.visible).toBeTrue();
        // Only the venues that exist are on the spaceport's stage.
        const children = spaceport.container.children;
        expect(children).toContain(venues.bar!.container);
        expect(children).toContain(venues.tradeCenter!.container);
    });

    it('builds no facility venue at an uninhabited moon, only the BBS', async () => {
        const { venues, drawn } = await build(SYNTHETIC.planets.moon);
        expect(venues.outfitter).toBeUndefined();
        expect(venues.shipyard).toBeUndefined();
        expect(venues.bar).toBeUndefined();
        expect(venues.tradeCenter).toBeUndefined();
        expect(venues.missionComputer).toBeDefined();
        expect(drawn).toContain(SPACEPORT_PICT);
        expect(drawn).toContain(MISSION_BBS_PICT);
        for (const id of [OUTFITTER_PICT, SHIP_INFO_PICT, BAR_PICT,
            TRADE_CENTER_PICT]) {
            expect(drawn).not.toContain(id);
        }
    });

    it('hands landing settings pushed before the build to the venues it builds',
        async () => {
            // The first landing at a stellar: the plugin constructs the
            // spaceport and pushes the landing's settings at once, while
            // the stellar's data (and so the venues) is still loading.
            const gameData = await getSyntheticGameData();
            const spaceport = new Spaceport(recordingAssets([]), gameData,
                SYNTHETIC.planets.port, new Subject<ControlEvent>());
            const counts = () => new Map([['nova:999', 1]]);
            const roster = () => [];
            spaceport.setDeployedOutfitCounts(counts);
            spaceport.setLandedEscorts(roster, 'player-uuid');
            await spaceport.buildPromise;
            const venues = spaceport as unknown as Record<string, unknown>;
            const field = (venue: string, name: string) =>
                (venues[venue] as Record<string, unknown>)[name];
            expect(field('tradeCenter', 'landedEscorts')).toBe(roster);
            expect(field('tradeCenter', 'playerUuid')).toBe('player-uuid');
            expect(field('bar', 'playerUuid')).toBe('player-uuid');
            expect(field('outfitter', 'deployedOutfitCounts')).toBe(counts);
            expect(field('shipyard', 'deployedOutfitCounts')).toBe(counts);
        });

    it('ignores the key of a facility the stellar lacks', async () => {
        const { spaceport, controlEvents } =
            await build(SYNTHETIC.planets.coldharbour);
        // Per-landing settings do not trip over the venues that are not
        // there.
        spaceport.setDeployedOutfitCounts(() => new Map());
        spaceport.setLandedEscorts(() => [], 'player-uuid');

        const gameData = await getSyntheticGameData();
        const { makeShip } = await import('../nova_plugin/ship/index.js');
        const entity: Entity = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.warden));
        const departed = spaceport.show(entity);
        for (let i = 0; i < 2000 && !spaceport.onMainScreen; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(spaceport.onMainScreen).toBeTrue();
        for (const action of ['shipyard', 'outfitter'] as const) {
            controlEvents.next({ action, state: 'start' });
            for (let i = 0; i < 20; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(spaceport.onMainScreen).withContext(action).toBeTrue();
        }
        controlEvents.next({ action: 'depart', state: 'start' });
        expect(await departed).toBe(entity);
        expect(MenuControls.focused).not.toBe(
            (spaceport as unknown as { controls: MenuControls }).controls);
    });
});
