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
import { ActiveMission, MissionsComponent } from '../nova_plugin/player/index.js';
import type { MissionInfoAbort } from './mission_info.js';
import { MenuControls } from './menu_controls.js';
import { OpenStarmapOptions } from './starmap.js';
import { Spaceport } from './spaceport.js';

/**
 * The landed screens' global keys, against the original's wave-11 matrix
 * (docs/reference_experiments.md, "The UI screen x key matrix, wave 11"):
 * `m` opens the star map over the spaceport AND over the outfitter,
 * shipyard, trade center and bar (closing it lands back in the venue);
 * `i` is ignored in the venues. On the spaceport's main screen `i` opens
 * the mission dialog, with a working Abort (reference "#324 mission BBS
 * after an accept, wave 21", finding 6).
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

    async function dock(missions?: Map<string, ActiveMission>) {
        const gameData = await getSyntheticGameData();
        const controlEvents = new Subject<ControlEvent>();
        const mapOpens: (OpenStarmapOptions | undefined)[] = [];
        const missionOpens: { entity: Entity, abort?: MissionInfoAbort }[] =
            [];
        const spaceport = new Spaceport(
            stubAssets(), gameData,
            SYNTHETIC.planets.port, controlEvents,
            async options => { mapOpens.push(options); },
            undefined,
            async (entity, abort) => { missionOpens.push({ entity, abort }); });
        await spaceport.buildPromise;
        const venues = spaceport as unknown as
            Record<VenueName, Menu<Entity> | undefined>;
        await Promise.all(Object.keys(VENUE_KEYS).map(name =>
            venues[name as VenueName]?.buildPromise));
        const { makeShip } = await import('../nova_plugin/ship/index.js');
        const entity: Entity = makeShip(
            await gameData.data.Ship.get(SYNTHETIC.ships.warden));
        if (missions) {
            entity.components.set(MissionsComponent, missions);
        }
        const departed = spaceport.show(entity);
        for (let i = 0; i < 2000 && !spaceport.onMainScreen; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(spaceport.onMainScreen).toBeTrue();
        const press = (action: ControlAction) =>
            controlEvents.next({ action, state: 'start' });
        return {
            spaceport, venues, press, departed, mapOpens, controlEvents,
            missionOpens, entity,
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

    it('opens the mission dialog on i in the spaceport, for the docked '
        + 'hull, with an Abort that edits the landing', async () => {
            const courier = SYNTHETIC.missions.courier;
            const { spaceport, press, departed, missionOpens, entity } =
                await dock(new Map([[courier, {
                    id: courier, acceptedDay: 1,
                    acceptedAt: SYNTHETIC.planets.port, travelPlanet: null,
                    // Due elsewhere, so this landing completes nothing.
                    returnPlanet: SYNTHETIC.planets.refuge, cargoType: -1,
                    cargoQty: 0, cargoLoaded: false, travelDone: false,
                    deadlineDay: null,
                }]]));
            press('missions');
            for (let i = 0; i < 2000 && missionOpens.length === 0; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            expect(missionOpens.length).toBe(1);
            const [{ entity: shown, abort }] = missionOpens;
            expect(shown).toBe(entity);
            expect(abort).withContext('Abort is live docked').toBeDefined();
            expect(await abort!(courier)).toBeTrue();
            // Off the working copy, and (the savepoint released at once)
            // off the docked hull too.
            expect(entity.components.get(MissionsComponent)!.has(courier))
                .toBeFalse();
            expect(spaceport.onMainScreen).toBeTrue();
            press('depart');
            await departed;
            expect(entity.components.get(MissionsComponent)!.has(courier))
                .toBeFalse();
        });

    for (const name of Object.keys(VENUE_KEYS) as VenueName[]) {
        it(`opens the star map over the ${name}`, async () => {
            const {
                spaceport, venues, press, departed, mapOpens, controlEvents,
                missionOpens,
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
            press('missions');
            await settle();
            expect(focusedIs(venue)).withContext(`i in the ${name}`)
                .toBeTrue();
            expect(missionOpens.length).withContext(`i in the ${name}`)
                .toBe(0);
            press('depart');
            await settle();
            expect(spaceport.onMainScreen).withContext('back').toBeTrue();
            press('depart');
            await departed;
        });
    }
});
