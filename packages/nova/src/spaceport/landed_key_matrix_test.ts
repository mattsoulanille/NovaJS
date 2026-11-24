import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';
import { OpenStarmapOptions } from './starmap.js';
import { Spaceport } from './spaceport.js';

/**
 * The landed screens' global keys, against the original's wave-11 matrix
 * (docs/reference_experiments.md, "The UI screen x key matrix, wave 11"):
 * `m` opens the star map over the spaceport AND over the outfitter,
 * shipyard, trade center and bar (closing it lands back in the venue).
 */
describe('landed key matrix (wave 11)', () => {
    beforeAll(() => installHeadlessPixi());

    type VenueName = 'outfitter' | 'shipyard' | 'bar' | 'tradeCenter';
    const VENUE_KEYS: Record<VenueName, ControlAction> = {
        outfitter: 'outfitter',
        shipyard: 'shipyard',
        bar: 'bar',
        tradeCenter: 'tradeCenter',
    };

    function stubAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {
                Sound: { get: async () => undefined },
                StringTable: { get: async () => ({ strings: [] }) },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    async function settle(turns = 50) {
        for (let i = 0; i < turns; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async function dock() {
        const gameData = await getSyntheticGameData();
        const controlEvents = new Subject<ControlEvent>();
        const mapOpens: (OpenStarmapOptions | undefined)[] = [];
        const missionOpens: Entity[] = [];
        const spaceport = new Spaceport(
            stubAssets(), gameData,
            SYNTHETIC.planets.port, controlEvents,
            async options => { mapOpens.push(options); },
            undefined,
            async entity => { missionOpens.push(entity); });
        await spaceport.buildPromise;
        const venues = spaceport as unknown as
            Record<VenueName, Menu<Entity> | undefined>;
        await Promise.all(Object.keys(VENUE_KEYS).map(name =>
            venues[name as VenueName]?.buildPromise));
        const { makeShip } = await import('../nova_plugin/ship/index.js');
        const entity: Entity = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.warden));
        const departed = spaceport.show(entity);
        for (let i = 0; i < 2000 && !spaceport.onMainScreen; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(spaceport.onMainScreen).toBeTrue();
        const press = (action: ControlAction) =>
            controlEvents.next({ action, state: 'start' });
        return {
            spaceport, venues, press, departed, mapOpens, missionOpens,
            controlEvents,
        };
    }

    function focusedIs(menu: Menu<Entity>) {
        return MenuControls.focused ===
            (menu as unknown as { controls: MenuControls }).controls;
    }

    it('opens the star map over the spaceport', async () => {
        const { press, departed, mapOpens } = await dock();
        press('map');
        expect(mapOpens.length).toBe(1);
        press('depart');
        await departed;
    });

    for (const name of Object.keys(VENUE_KEYS) as VenueName[]) {
        it(`opens the star map over the ${name}`, async () => {
            const {
                spaceport, venues, press, departed, mapOpens, controlEvents,
            } = await dock();
            const venue = venues[name]!;
            expect(venue).withContext(name).toBeDefined();
            // The synthetic port's venue-entry mission offers (AvailLoc
            // 2, 4-6) are not this spec's business: skip them.
            (spaceport as unknown as
                { presentVenueOffers: () => Promise<void> })
                .presentVenueOffers = async () => undefined;
            if (name === 'bar') {
                (venue as unknown as
                    { presentBarOffers: () => Promise<void> })
                    .presentBarOffers = async () => undefined;
            }
            press(VENUE_KEYS[name]);
            for (let i = 0; i < 2000 && !focusedIs(venue); i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(focusedIs(venue)).withContext(`${name} open`).toBeTrue();
            press('map');
            expect(mapOpens.length).withContext(name).toBe(1);
            // The docked ship's map: its mission marks ride along, as
            // over the spaceport.
            expect(mapOpens[0]?.missionMarks).withContext('marks')
                .toEqual([]);
            // A surface bound over the venue (a quantity dialog, the
            // bar's popups) keeps the key: no map under it.
            const overlay = new MenuControls(controlEvents);
            overlay.bind();
            press('map');
            expect(mapOpens.length).withContext('under an overlay').toBe(1);
            overlay.unbind();
            press('depart');
            await settle();
            expect(spaceport.onMainScreen).withContext('back').toBeTrue();
            press('depart');
            await departed;
        });
    }
});
