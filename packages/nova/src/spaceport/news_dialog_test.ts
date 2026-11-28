import 'jasmine';
import { getDefaultCronData } from 'novadatainterface/cron_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { CronStatesComponent } from '../nova_plugin/player/index.js';
import { NEWS } from './dialog_layout.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { MissionUniverse } from './mission_universe.js';
import {
    COMMERCIALS_STRING_TABLE, composeNews, GENERIC_NEWS_STRING_TABLE,
    NewsDialog,
} from './news_dialog.js';

/**
 * ============================================================================
 * THE NEWS WINDOW STAYS INSIDE ITS PANE
 * ============================================================================
 *
 * Matthew's 2026-11-27 playtest, at a Polaris station: three
 * "Auroran/Federation border" crön items stacked down the PNS window, the
 * third running past the pane's bottom edge and over the spaceport
 * description underneath. The original (bar/news, Earth) shows ONE STR#
 * 8100 commercial over ONE news item, inside a pane of seven lines; the
 * text is clipped to the pane besides, so no string can escape it.
 */
describe('composeNews', () => {
    const first = () => 0;
    const last = () => 0.999;

    it('is one commercial and one crön item, local news first', () => {
        expect(composeNews({
            commercials: ['Ad A', 'Ad B'],
            local: [['Local 1'], ['Local 2a', 'Local 2b']],
            independent: [['Ind 1']],
            generic: ['Generic'],
        }, last)).toEqual(['Ad B', 'Local 2b']);
    });

    it('never stacks several crön items, however many are active', () => {
        const items = composeNews({
            commercials: ['Ad'],
            local: [],
            independent: [['A'], ['B'], ['C'], ['D']],
            generic: ['Generic'],
        }, first);
        expect(items).toEqual(['Ad', 'A']);
    });

    it('falls back to independent news, then to the generic list', () => {
        expect(composeNews({
            commercials: ['Ad'], local: [], independent: [['Ind']],
            generic: ['Generic'],
        }, first)).toEqual(['Ad', 'Ind']);
        expect(composeNews({
            commercials: ['Ad'], local: [], independent: [],
            generic: ['Generic'],
        }, first)).toEqual(['Ad', 'Generic']);
    });

    it('lets local news win even when it has no strings (Bible note 4)', () => {
        // A crön with local news for here but an empty list still blocks
        // the independent items; the window falls through to the generic.
        expect(composeNews({
            commercials: [], local: [[]], independent: [['Ind']],
            generic: ['Generic'],
        }, first)).toEqual(['Generic']);
    });
});

describe('NewsDialog', () => {
    beforeAll(() => installHeadlessPixi());

    const PLANET = 'nova:200';
    const GOVT = 'nova:130';

    function displayAssets(tables: Map<string, string[]>):
        DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            data: {
                StringTable: {
                    get: async (id: string) => {
                        const strings = tables.get(id);
                        if (!strings) {
                            throw new Error(`no STR# ${id}`);
                        }
                        return { id, name: id, prefix: 'nova', strings };
                    },
                },
            },
        } as unknown as DisplayAssetDataInterface;
    }

    function gameData(): SimulationGameDataInterface {
        const data = new MockGameData();
        data.data.Planet.map.set(PLANET, {
            ...getDefaultPlanetData(), id: PLANET, govt: GOVT,
        });
        data.data.Govt.map.set(GOVT, {
            ...getDefaultGovtData(), id: GOVT, newsPic: 'nova:9002',
        });
        return data as unknown as SimulationGameDataInterface;
    }

    /** Three active crons with independent news, as at the playtest's
     * Polaris station. */
    function universe(): MissionUniverse {
        const crons = ['nova:164', 'nova:175', 'nova:176'].map(id => ({
            ...getDefaultCronData(), id,
            indNews: [`News from the border (${id}): `
                + 'Auroran raiders have struck again. '.repeat(5)],
        }));
        return { load: async () => undefined, crons } as
            unknown as MissionUniverse;
    }

    function pilot(): Entity {
        return new Entity('pilot').addComponent(CronStatesComponent,
            new Map(['nova:164', 'nova:175', 'nova:176'].map(id =>
                [id, { phase: 'active' as const, phaseStart: 0,
                    nextEligible: 0 }])));
    }

    async function open(tables: Map<string, string[]>) {
        const dialog = new NewsDialog(displayAssets(tables), gameData(),
            new Subject<ControlEvent>(), universe(), PLANET);
        const shown = dialog.show(pilot());
        for (let i = 0; i < 50 && !dialog.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return {
            dialog,
            close: async () => {
                (dialog as unknown as { closed: Subject<void> }).closed.next();
                await shown;
            },
        };
    }

    it('shows the STR# 8100 commercial over ONE of the active crons\' news', async () => {
        const { dialog, close } = await open(new Map([
            [COMMERCIALS_STRING_TABLE, ['Happy hour at the bar.']],
            [GENERIC_NEWS_STRING_TABLE, ['Generic news.']],
        ]));
        expect(dialog.container.visible).toBeTrue();
        const items = dialog.shownItems;
        expect(items.length).toBe(2);
        expect(items[0]).toBe('Happy hour at the bar.');
        expect(items[1]).toMatch(/^News from the border/);
        await close();
    });

    it('clips its text to the black pane of the frame', async () => {
        const { dialog, close } = await open(new Map());
        const layer = dialog.container.getChildByName('NewsText') as
            PIXI.Container;
        expect(layer).toBeDefined();
        const mask = layer.mask as PIXI.Graphics;
        expect(mask).toBeInstanceOf(PIXI.Graphics);
        const bounds = mask.getLocalBounds();
        expect(bounds.left).toBe(NEWS.pane.left);
        expect(bounds.top).toBe(NEWS.pane.top);
        expect(bounds.right).toBe(NEWS.pane.right);
        expect(bounds.bottom).toBe(NEWS.pane.bottom);
        // Every item is drawn in the masked layer, starting inside it.
        expect(layer.children.length).toBe(dialog.shownItems.length);
        for (const text of layer.children) {
            expect(text.y).toBeGreaterThanOrEqual(NEWS.pane.top);
            expect(text.y).toBeLessThan(NEWS.pane.bottom);
        }
        await close();
    });

    it('falls back to stock samples when the data has no STR# 8100/8101', async () => {
        const { dialog, close } = await open(new Map());
        expect(dialog.shownItems.length).toBe(2);
        expect(dialog.shownItems[0]).toMatch(/^Local eatery/);
        await close();
    });

    it('fits the pane: seven 12px lines below the first line\'s top', () => {
        // The pane's measured height leaves room for exactly the
        // reference's two-line commercial + half-line gap + four-line
        // item (78px), and no third item.
        const room = NEWS.pane.bottom - NEWS.text.y;
        expect(room).toBeGreaterThanOrEqual(2 * 12 + NEWS.paragraphGap + 4 * 12);
        expect(Math.floor(room / 12)).toBe(7);
    });
});
