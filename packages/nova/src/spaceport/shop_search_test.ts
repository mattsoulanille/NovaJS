import 'jasmine';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { overrideEnhancements } from '../enhancements.js';
import { isTextEntryActive } from '../input_focus.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import { ShipComponent } from '../nova_plugin/ship/index.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { ItemGrid, itemMatches } from './item_grid.js';
import {
    editSearchText, isFocusShortcut, searchKeyAction, ShopSearchField,
} from './shop_search.js';
import { Shipyard } from './shipyard.js';

describe('shop search: matching', () => {
    it('matches the shown name case-insensitively, as a substring', () => {
        expect(itemMatches({ name: 'Light Blaster' }, 'blast')).toBeTrue();
        expect(itemMatches({ name: 'Light Blaster' }, 'LIGHT B')).toBeTrue();
        expect(itemMatches({ name: 'Light Blaster' }, 'laser')).toBeFalse();
    });

    it('ignores the hidden "; developer note" suffix', () => {
        expect(itemMatches({ name: 'Shuttle; Version A' }, 'shuttle'))
            .toBeTrue();
        expect(itemMatches({ name: 'Fed Anaconda; Light Missile' },
            'missile')).toBeFalse();
    });

    it('matches the ShortName caption a ship tile shows', () => {
        const shuttle = { name: 'Shuttle; Version A',
            shortName: 'Shuttle\\n- Version A -' };
        expect(itemMatches(shuttle, 'version a')).toBeTrue();
        expect(itemMatches({ name: 'Asteroid Miner',
            shortName: 'Asteroid\\nMiner' }, 'asteroid miner')).toBeTrue();
    });

    it('matches everything with a blank query', () => {
        expect(itemMatches({ name: 'Anything' }, '')).toBeTrue();
        expect(itemMatches({ name: 'Anything' }, '   ')).toBeTrue();
    });
});

describe('shop search: keys', () => {
    it('edits with printable keys and Backspace', () => {
        expect(editSearchText('las', 'e')).toBe('lase');
        expect(editSearchText('lase', 'Backspace')).toBe('las');
        expect(editSearchText('', 'Backspace')).toBe('');
        expect(editSearchText('x', 'ArrowLeft')).toBeUndefined();
    });

    it('lets go on Escape (clearing), Enter and Tab (keeping)', () => {
        expect(searchKeyAction('q', { key: 'Escape' }))
            .toEqual({ kind: 'blur', clear: true });
        expect(searchKeyAction('q', { key: 'Enter' }))
            .toEqual({ kind: 'blur', clear: false });
        expect(searchKeyAction('q', { key: 'Tab' }))
            .toEqual({ kind: 'blur', clear: false });
    });

    it('types the shop and flight hotkeys as letters', () => {
        // b (buy), s (sell), d (depart), m (map): text, not commands.
        for (const key of ['b', 's', 'd', 'm', ' ', '1']) {
            expect(searchKeyAction('', { key }))
                .toEqual({ kind: 'edit', text: key });
        }
    });

    it('neither types nor leaves on a Cmd/Ctrl shortcut', () => {
        expect(searchKeyAction('q', { key: 'r', metaKey: true }))
            .toEqual({ kind: 'ignore' });
        expect(searchKeyAction('q', { key: 'v', ctrlKey: true }))
            .toEqual({ kind: 'ignore' });
    });

    it('takes Cmd/Ctrl+F as the focus shortcut', () => {
        expect(isFocusShortcut({ code: 'KeyF', key: 'f', metaKey: true }))
            .toBeTrue();
        expect(isFocusShortcut({ code: 'KeyF', key: 'f', ctrlKey: true }))
            .toBeTrue();
        expect(isFocusShortcut({ code: 'KeyF', key: 'f' })).toBeFalse();
        expect(isFocusShortcut({ code: 'KeyG', key: 'g', metaKey: true }))
            .toBeFalse();
    });
});

describe('ShopSearchField', () => {
    beforeAll(() => installHeadlessPixi());

    it('is hidden, and takes no focus, with the enhancement off', () => {
        const field = new ShopSearchField();
        field.open(false);
        expect(field.container.visible).toBeFalse();
        field.focus();
        expect(field.hasFocus).toBeFalse();
        expect(isTextEntryActive()).toBeFalse();
    });

    it('owns the keyboard while focused and lets go on Escape', () => {
        const field = new ShopSearchField();
        field.open(true);
        expect(field.container.visible).toBeTrue();
        field.focus();
        expect(field.hasFocus).toBeTrue();
        // The game's control relay stands down (input_focus.ts).
        expect(isTextEntryActive()).toBeTrue();
        field.type('l');
        field.type('a');
        expect(field.query.value).toBe('la');
        field.type('Escape');
        expect(field.query.value).toBe('');
        expect(field.hasFocus).toBeFalse();
        expect(isTextEntryActive()).toBeFalse();
    });

    it('keeps the query on Enter, and clears it when the shop reopens',
        () => {
            const field = new ShopSearchField();
            field.open(true);
            field.focus();
            field.type('x');
            field.type('Enter');
            expect(field.hasFocus).toBeFalse();
            expect(field.query.value).toBe('x');
            field.open(true);
            expect(field.query.value).toBe('');
            field.focus();
            field.close();
            expect(isTextEntryActive()).toBeFalse();
        });
});

describe('ItemGrid search filter', () => {
    beforeAll(() => installHeadlessPixi());

    const items = ['Light Blaster', 'Heavy Blaster', 'Proton Cannon',
        'Missile Launcher', 'Missile', 'Shield Booster']
        .map((name, i) => ({ id: `o:${i}`, name, desc: '', pict: '' }));

    it('narrows the grid, back to the top, and restores it', () => {
        const grid = new ItemGrid(undefined as never, items);
        grid.setFilter('blaster');
        expect(grid.itemCount).toBe(2);
        grid.setFilter('MISSILE');
        expect(grid.itemCount).toBe(2);
        grid.setFilter('nothing like it');
        expect(grid.itemCount).toBe(0);
        grid.setFilter('');
        expect(grid.itemCount).toBe(items.length);
    });

    it('keeps the selection on an item that still matches', () => {
        const grid = new ItemGrid(undefined as never, items);
        grid.right();
        grid.right(); // Heavy Blaster
        expect(grid.selection.name).toBe('Heavy Blaster');
        grid.setFilter('blast');
        expect(grid.selection.name).toBe('Heavy Blaster');
        grid.setFilter('cannon');
        expect(grid.selection).toBeUndefined();
        expect(grid.activeTile.value).toBeUndefined();
    });

    it('applies to a re-stock (setItems) as well', () => {
        const grid = new ItemGrid(undefined as never, items);
        grid.setFilter('missile');
        grid.setItems(items.slice(0, 4));
        expect(grid.itemCount).toBe(1);
    });
});

describe('the shipyard\'s search field', () => {
    beforeAll(() => installHeadlessPixi());
    afterEach(() => overrideEnhancements({}));

    const IDS = ['nova:128', 'nova:129', 'nova:130', 'nova:131'];
    const NAMES = ['Shuttle', 'Heavy Shuttle', 'Starbridge', 'Leviathan'];

    function shipyard(): Shipyard {
        const ships = new Map<string, ShipData>(IDS.map((id, i) => [id,
            { ...getDefaultShipData(), id, name: NAMES[i], shortName: '',
                pict: '', techLevel: 1, buyRandom: 100 }]));
        const data = {
            ids: Promise.resolve({ Ship: IDS, Outfit: [], Govt: [] }),
            data: {
                Ship: { get: async (id: string) => ships.get(id) },
                Outfit: { get: async () => undefined },
                Govt: { get: async () => undefined },
            },
        } as unknown as SimulationGameDataInterface;
        const assets = {
            spriteFromPict: () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
        } as unknown as DisplayAssetDataInterface;
        return new Shipyard(assets, data, new Subject<ControlEvent>());
    }

    function player(): Entity {
        return new Entity()
            .addComponent(ShipComponent, { id: IDS[0] })
            .addComponent(ControlBitsComponent, new Set<number>());
    }

    function searchOf(menu: Shipyard): ShopSearchField {
        return (menu as unknown as { search: ShopSearchField }).search;
    }

    it('filters the grid as the player types (enhancement on)', async () => {
        const menu = shipyard();
        await menu.buildPromise;
        const shown = menu.show(player());
        const search = searchOf(menu);
        expect(search.container.visible).toBeTrue();
        search.focus();
        for (const key of 'shuttle') {
            search.type(key);
        }
        expect(menu.itemGrid!.itemCount).toBe(2);
        search.type('Escape');
        expect(menu.itemGrid!.itemCount).toBe(IDS.length);
        menu.dismiss();
        await shown;
    });

    it('is absent, and the grid whole, with the enhancement off',
        async () => {
            overrideEnhancements({ enhShopSearch: false });
            const menu = shipyard();
            await menu.buildPromise;
            const shown = menu.show(player());
            expect(searchOf(menu).container.visible).toBeFalse();
            expect(menu.itemGrid!.itemCount).toBe(IDS.length);
            menu.dismiss();
            await shown;
        });
});
