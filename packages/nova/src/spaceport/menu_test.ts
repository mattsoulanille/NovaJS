import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { Menu } from './menu.js';
import { MenuControls } from './menu_controls.js';

/** The smallest concrete Menu: shows, and finishes on done(). */
class TestMenu extends Menu<string[]> {
    finish() {
        this.done();
    }
}

/** A subclass that follows the convention, counting its own builds. */
class CountingMenu extends Menu<string[]> {
    builds = 0;
    protected override async build() {
        await super.build();
        this.builds++;
    }
    /** Stands in for a subclass constructor that also calls build(). */
    buildAgain() {
        return this.build();
    }
}

function displayAssets() {
    return {
        spriteFromPict: () => new PIXI.Sprite(),
    } as unknown as DisplayAssetDataInterface;
}

/**
 * A menu builds itself exactly once, from Menu's own constructor.
 *
 * The shipyard's constructor used to end with an extra `this.build()` on
 * top of the one Menu already starts, which ran the whole build twice and
 * left two ItemGrids stacked in the display list (see
 * shipyard_grid_build_test.ts). A second build is always a bug, so it
 * fails loudly instead of silently doubling the menu's contents.
 */
describe('Menu.build', () => {
    it('runs the subclass hook once', async () => {
        const menu = new CountingMenu(displayAssets(),
            {} as SimulationGameDataInterface, 'nova:0', new Subject());
        await menu.buildPromise;
        expect(menu.builds).toBe(1);
        expect(menu.built).toBeTrue();
    });

    it('rejects a second build rather than doubling the contents',
        async () => {
            const menu = new CountingMenu(displayAssets(),
                {} as SimulationGameDataInterface, 'nova:0', new Subject());
            await menu.buildPromise;
            await expectAsync(menu.buildAgain()).toBeRejectedWithError(
                /CountingMenu\.build\(\) ran twice/);
            expect(menu.builds).toBe(1);
        });
});

describe('Menu.dismiss', () => {
    let events: Subject<ControlEvent>;
    let menu: TestMenu;

    beforeEach(() => {
        events = new Subject();
        const displayAssets = {
            spriteFromPict: () => new PIXI.Sprite(),
        } as unknown as DisplayAssetDataInterface;
        menu = new TestMenu(displayAssets,
            {} as SimulationGameDataInterface, 'nova:0', events);
    });

    afterEach(() => {
        expect(MenuControls.focused).toBeUndefined();
    });

    it('resolves a pending show() with the current input and releases the '
        + 'keyboard (the world was torn down mid-jump with the map open)',
        async () => {
            const shown = menu.show(['nova:128', 'nova:129']);
            expect(MenuControls.focused).toBeDefined();
            expect(menu.container.visible).toBeTrue();

            menu.dismiss();

            expect(await shown).toEqual(['nova:128', 'nova:129']);
            expect(menu.container.visible).toBeFalse();
            expect(MenuControls.focused).toBeUndefined();
        });

    it('is a no-op when the menu is not shown', () => {
        menu.dismiss();
        expect(menu.container.visible).toBeFalse();
    });

    it('does not interfere with a normal done()', async () => {
        const shown = menu.show(['a']);
        menu.finish();
        expect(await shown).toEqual(['a']);
        menu.dismiss();
        expect(MenuControls.focused).toBeUndefined();
    });
});
