import 'jasmine';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { ITEM_GRID_NAME } from './item_grid.js';
import { Outfitter } from './outfitter.js';
import { Shipyard } from './shipyard.js';

/**
 * How many ship grids the shop menus put on the screen.
 *
 * Matthew's playtest report: "I'm seeing multiple copies of the shipyard
 * ship grid." The Shipyard's constructor ended with `this.build()` even
 * though Menu's OWN constructor already kicks build() off through
 * buildPromise, so the whole of build() ran TWICE: two ItemGrids, both
 * addChild'd to the shipyard's container at the same position, and only
 * the one that happened to assign `this.itemGrid` last was the one
 * setInput/refreshGrid/left/right ever touched. The other stayed on
 * screen forever, showing a stale, differently-gated ship list under the
 * live grid and drifting out of alignment with it the moment the player
 * scrolled.
 *
 * It went unnoticed for as long as it did because the two grids used to
 * be identical: before the stock gates (shipyard_stock_rules.ts,
 * ship_gate_context.ts) the grid was always "every ship in display
 * order", so the duplicate sat pixel-for-pixel on top of the original and
 * only the tile highlight ever gave it away.
 *
 * These tests build the real menus headlessly against mock data (PIXI
 * itself runs fine under node — see menu_test.ts) and count the grid
 * containers by name.
 */
describe('shop menu grid building', () => {
    beforeAll(() => installHeadlessPixi());

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

    const SHIP_IDS = ['nova:128', 'nova:129', 'nova:130'];
    const OUTFIT_IDS = ['nova:200'];

    function ship(id: string, techLevel: number): ShipData {
        return { ...getDefaultShipData(), id, techLevel, pict: '' };
    }

    /**
     * Just enough game data for a shipyard/outfitter build: the id lists
     * both grids enumerate, and a Gettable-shaped `get` for each type the
     * menus load (ships, outfits, and the govts the outfitter's
     * clean-record rules read).
     */
    function simulationData(): SimulationGameDataInterface {
        const ships = new Map(SHIP_IDS.map((id, i) =>
            [id, ship(id, i + 1)]));
        const outfits = new Map(OUTFIT_IDS.map(id =>
            [id, { ...getDefaultOutfitData(), id, pict: '' }]));
        return {
            ids: Promise.resolve({
                Ship: SHIP_IDS, Outfit: OUTFIT_IDS, Govt: [],
                Weapon: [], Planet: [], System: [], Mission: [], Pers: [],
                Cron: [], Rank: [], Fleet: [], Dude: [], Junk: [],
                Oops: [], Asteroid: [], SpriteSheet: [], PlayerStart: [],
            }),
            data: {
                Ship: { get: async (id: string) => ships.get(id) },
                Outfit: { get: async (id: string) => outfits.get(id) },
                Govt: { get: async () => undefined },
            },
        } as unknown as SimulationGameDataInterface;
    }

    /** A landed player entity, the input both menus are shown with. */
    function player(): Entity {
        return new Entity()
            .addComponent(ShipComponent, { id: SHIP_IDS[0] })
            .addComponent(ControlBitsComponent, new Set<number>());
    }

    /** The grid containers currently in a menu's display list. */
    function grids(container: PIXI.Container): PIXI.DisplayObject[] {
        return container.children.filter(c => c.name === ITEM_GRID_NAME);
    }

    /** Shows the menu and immediately closes it, as leaving the shop does. */
    async function visit(menu: { show(i: Entity): Promise<Entity>, dismiss(): void },
        input: Entity) {
        const shown = menu.show(input);
        menu.dismiss();
        await shown;
    }

    it('puts exactly ONE ship grid in the shipyard', async () => {
        const shipyard = new Shipyard(displayAssets(), simulationData(),
            new Subject<ControlEvent>());
        await shipyard.buildPromise;

        // The bug: build() ran twice and this was 2.
        expect(grids(shipyard.container).length).toBe(1);
        // ...and the grid on screen is the one the menu's own state
        // points at, so scrolling and refreshGrid move what the player
        // sees rather than a hidden twin.
        expect(grids(shipyard.container)
            .indexOf(shipyard.itemGrid!.container)).toBe(0);
    });

    it('keeps one ship grid across repeated visits and a re-stock',
        async () => {
            const shipyard = new Shipyard(displayAssets(), simulationData(),
                new Subject<ControlEvent>());
            await shipyard.buildPromise;
            const entity = player();

            // Land, leave, land again: setInput -> refreshGrid runs each
            // time, and must never add another grid.
            await visit(shipyard, entity);
            await visit(shipyard, entity);

            expect(grids(shipyard.container).length).toBe(1);
            expect(grids(shipyard.container)[0])
                .toBe(shipyard.itemGrid!.container);
        });

    it('puts exactly ONE outfit grid in the outfitter', async () => {
        // The outfitter never had the stray constructor build() the
        // shipyard did; this pins that it stays that way, since the two
        // shops are edited in step.
        const outfitter = new Outfitter(displayAssets(), simulationData(),
            new Subject<ControlEvent>());
        await outfitter.buildPromise;

        expect(grids(outfitter.container).length).toBe(1);
    });
});
