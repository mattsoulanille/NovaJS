import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { RouteState } from './route.js';
import { RouteStateStore, Starmap } from './starmap.js';

/**
 * After a MULTI-JUMP (oütf ModType 32), the map must not route the player
 * back through the systems the jump passed. Found by wave 52's MJ fix: a
 * route Alpha -> Sol -> Tichel -> Kania flown with a ModVal-2 outfit takes
 * one `j` to Tichel via Sol, and the sim route is left [Kania]; but just
 * opening and closing the map put the route back to Sol -> Tichel -> Kania
 * (the pins Sol and Tichel were never "arrived at", so they stayed at the
 * head of the persisted pin list), and the next `j` flew BACK to Sol.
 *
 * The plugin records the jump's hops when the player's ship departs
 * (RouteStateStore.arrival); the destination's map drops the pins they
 * reached the first time it reconciles.
 *
 *     Alpha - Sol - Tichel - Kania
 */
describe('the star map after a multi-jump', () => {
    beforeAll(() => installHeadlessPixi());

    const ALPHA = 'nova:2150';
    const SOL = 'nova:2151';
    const TICHEL = 'nova:2152';
    const KANIA = 'nova:2153';

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    function gameData(): MockGameData {
        const data = new MockGameData();
        const chain = [
            [ALPHA, 'Alpha', [SOL]],
            [SOL, 'Sol', [ALPHA, TICHEL]],
            [TICHEL, 'Tichel', [SOL, KANIA]],
            [KANIA, 'Kania', [TICHEL]],
        ] as const;
        chain.forEach(([id, name, links], i) => {
            data.data.System.map.set(id, {
                ...getDefaultSystemData(), id, name,
                position: [i * 40, 0], links: [...links],
            });
        });
        return data;
    }

    async function mapIn(systemId: string, store: RouteStateStore) {
        const starmap = new Starmap(displayAssets(),
            gameData() as unknown as SimulationGameDataInterface, systemId,
            new Subject<ControlEvent>(), () => new Set(), () => [], store);
        await starmap.buildPromise;
        return starmap;
    }

    /** Opens the full map on the sim's `route` and closes it with Done:
     * the route its close would commit. */
    async function openAndClose(starmap: Starmap, route: string[]) {
        const shown = starmap.show(route);
        await new Promise(resolve => setTimeout(resolve, 0));
        starmap.done();
        return await shown;
    }

    /** Alpha's route, pinned system by system, flown by one ModVal-2 `j`
     * from Alpha to Tichel via Sol. */
    function afterMultiJump(pinned: string[]): RouteStateStore {
        const state: RouteState = { pinned };
        return { state, arrival: { from: ALPHA, hops: [SOL, TICHEL] } };
    }

    it('keeps the rest of the route when the map is opened and closed',
        async () => {
            const store = afterMultiJump([SOL, TICHEL, KANIA]);
            const starmap = await mapIn(TICHEL, store);
            expect(await openAndClose(starmap, [KANIA])).toEqual([KANIA]);
            expect(store.state.pinned).toEqual([KANIA]);
            expect(store.arrival).toBeUndefined();
            // Applied once: a second open changes nothing.
            expect(await openAndClose(starmap, [KANIA])).toEqual([KANIA]);
            expect(store.state.pinned).toEqual([KANIA]);
        });

    it('keeps the rest of the route on the `h` minimap', async () => {
        const store = afterMultiJump([SOL, TICHEL, KANIA]);
        const starmap = await mapIn(TICHEL, store);
        const graph = await starmap.miniMapGraph({ x: 100, y: 100 }, 1,
            [KANIA]);
        expect(graph?.getEffectiveRoute()).toEqual([KANIA]);
        expect(store.state.pinned).toEqual([KANIA]);
        // The full map opened after the minimap: still forward.
        expect(await openAndClose(starmap, [KANIA])).toEqual([KANIA]);
    });

    it('keeps a later visit to a system the jump passed', async () => {
        // Alpha -> Sol -> Tichel -> Sol -> Alpha: the jump to Tichel via
        // Sol leaves Sol -> Alpha, not just Alpha.
        const store = afterMultiJump([SOL, TICHEL, SOL, ALPHA]);
        const starmap = await mapIn(TICHEL, store);
        expect(await openAndClose(starmap, [SOL, ALPHA]))
            .toEqual([SOL, ALPHA]);
        expect(store.state.pinned).toEqual([SOL, ALPHA]);
    });

    it('keeps a pin beyond the jump that only its expansion passed',
        async () => {
            // Only Kania pinned: the route Alpha -> Kania went through Sol
            // and Tichel by auto-routing.
            const store = afterMultiJump([KANIA]);
            const starmap = await mapIn(TICHEL, store);
            expect(await openAndClose(starmap, [KANIA])).toEqual([KANIA]);
            expect(store.state.pinned).toEqual([KANIA]);
        });

    it('ignores a recorded jump that did not end here', async () => {
        // A jump that failed recovers into the system it left (the plugin
        // also drops such a record when the next world is built).
        const store: RouteStateStore = {
            state: { pinned: [SOL, TICHEL, KANIA] },
            arrival: { from: ALPHA, hops: [SOL, TICHEL] },
        };
        const starmap = await mapIn(ALPHA, store);
        expect(await openAndClose(starmap, [SOL, TICHEL, KANIA]))
            .toEqual([SOL, TICHEL, KANIA]);
        expect(store.state.pinned).toEqual([SOL, TICHEL, KANIA]);
        expect(store.arrival).toBeUndefined();
    });
});
