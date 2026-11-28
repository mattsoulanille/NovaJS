import 'jasmine';
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { Button, pressTransition } from './button.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';

describe('Button pressTransition', () => {
    it('presses and clicks when enabled', () => {
        const down = pressTransition('normal', undefined, 'down');
        expect(down.state).toBe('clicked');
        expect(down.pressedFrom).toBe('normal');
        const up = pressTransition('clicked', down.pressedFrom, 'up');
        expect(up.state).toBe('normal');
        expect(up.fire).toBeTrue();
    });

    it('stays grey through a click: no pressed flash, no enabled bounce, '
        + 'no click', () => {
        const down = pressTransition('grey', undefined, 'down');
        expect(down.state).toBeUndefined();
        expect(down.pressedFrom).toBeUndefined();
        const up = pressTransition('grey', down.pressedFrom, 'up');
        expect(up.state).toBeUndefined();
        expect(up.fire).toBeFalse();
    });

    it('presses THROUGH grey when the debug override asks, fires the click, '
        + 'and settles back to grey', () => {
        const down = pressTransition('grey', undefined, 'down', true);
        expect(down.state).toBe('clicked');
        expect(down.pressedFrom).toBe('grey');
        const up = pressTransition('clicked', down.pressedFrom, 'up');
        expect(up.fire).toBeTrue();
        expect(up.state).toBe('grey');
    });

    it('stays grey through a drag-off release', () => {
        const down = pressTransition('grey', undefined, 'down');
        const out = pressTransition('grey', down.pressedFrom, 'upoutside');
        expect(out.state).toBeUndefined();
        expect(out.fire).toBeFalse();
    });

    it('a drag-off release restores the pre-press state without firing',
        () => {
            const down = pressTransition('normal', undefined, 'down');
            const out = pressTransition('clicked', down.pressedFrom,
                'upoutside');
            expect(out.state).toBe('normal');
            expect(out.pressedFrom).toBeUndefined();
            expect(out.fire).toBeFalse();
        });

    it('a button greyed mid-press drags off back to grey', () => {
        // The press began enabled; the surface greyed it while held
        // (e.g. a refresh); releasing off the button restores what the
        // press started from.
        const down = pressTransition('grey', 'grey', 'upoutside');
        expect(down.state).toBe('grey');
    });
});

describe('Button cap placement', () => {
    beforeAll(() => installHeadlessPixi());

    const assets = {
        spriteFromPict: () => new PIXI.Sprite(),
        textureFromPict: () => PIXI.Texture.EMPTY,
        textureFromPictAsync: async () => PIXI.Texture.EMPTY,
    } as unknown as DisplayAssetDataInterface;

    /** Every state's [left, middle, right] sprite x. */
    function pieces(button: Button): number[][] {
        return button.container.children
            .filter(c => (c as PIXI.Container).children?.length === 3)
            .map(c => (c as PIXI.Container).children.map(p => p.x));
    }

    it('puts the caps and middle on whole pixels: the 13 px left cap ends '
        + 'where the middle starts, so it starts at the button\'s x', () => {
        const button = new Button(assets, 'Done', 73, { x: 183, y: 227 });
        for (const [left, middle, right] of pieces(button)) {
            // The left cap is anchored at its right edge.
            expect(left).toBe(13);
            expect(middle).toBe(13);
            expect(right).toBe(13 + 73);
        }
    });

    it('rounds a caption-measured width so the right cap stays on the grid',
        () => {
            const button = new Button(assets, 'Mission BBS');
            for (const [, , right] of pieces(button)) {
                expect(Number.isInteger(right)).toBeTrue();
            }
        });
});
