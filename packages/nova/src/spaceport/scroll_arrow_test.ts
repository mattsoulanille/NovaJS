import 'jasmine';
import * as PIXI from 'pixi.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { ROUND_GLYPH_RECTS, RoundButton } from './round_button.js';
import { SCROLL_ARROW_PIVOT, ScrollArrow } from './scroll_arrow.js';

describe('the round scroll arrows', () => {
    beforeAll(() => installHeadlessPixi());

    /** The PICT textures asked for. */
    let requested: string[];
    /** The PICTs drawn as plain sprites. */
    let sprites: string[];
    function displayAssets(): DisplayAssetDataInterface {
        requested = [];
        sprites = [];
        return {
            spriteFromPict: (id: string) => {
                sprites.push(id);
                return new PIXI.Sprite();
            },
            textureFromPict: (id: string) => {
                requested.push(id);
                return PIXI.Texture.EMPTY;
            },
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
        } as unknown as DisplayAssetDataInterface;
    }

    /** The visible state's [left, middle, right] sprites. */
    function visibleState(button: { container: PIXI.Container }) {
        return button.container.children.filter(c =>
            c.visible && (c as PIXI.Container).children?.length === 3)
            .map(c => (c as PIXI.Container).children);
    }

    it('is the button caps with no middle, as the map\'s zoom buttons are',
        () => {
            const arrow = new ScrollArrow(displayAssets(), 'up');
            // The three middles are tiled at width 0; the caps go through
            // their masks (button_mask.ts), so are not plain sprites.
            expect(sprites).toEqual([]);
            expect(requested.sort()).toEqual(['nova:7500', 'nova:7501',
                'nova:7502', 'nova:7503', 'nova:7504', 'nova:7505',
                'nova:7506', 'nova:7507', 'nova:7508']);
            const [[left, middle, right]] = visibleState(arrow);
            expect((middle as PIXI.TilingSprite).width).toBe(0);
            expect(left.x - right.x).toBe(1);
        });

    it('places the caps\' top-left where the outfitter capture has them '
        + 'for the disc centre it is positioned at', () => {
            const arrow = new ScrollArrow(displayAssets(), 'down');
            // Outfitter: centre (738, 679.5), caps from (725, 668).
            arrow.container.position.set(738, 679.5);
            arrow.container.transform.updateLocalTransform();
            const origin = arrow.container.localTransform
                .apply(new PIXI.Point(0, 0));
            expect([origin.x, origin.y]).toEqual([725, 668]);
            expect(SCROLL_ARROW_PIVOT).toEqual({ x: 13, y: 11.5 });
        });

    it('draws the measured chevrons, down the mirror of up', () => {
        const pixels = (kind: 'up' | 'down') => {
            const set = new Set<string>();
            for (const { x, y, w, h } of ROUND_GLYPH_RECTS[kind]) {
                for (let dy = 0; dy < h; dy++) {
                    for (let dx = 0; dx < w; dx++) {
                        set.add(`${x + dx},${y + dy}`);
                    }
                }
            }
            return set;
        };
        const up = pixels('up');
        // 10 x 6 at (9, 10): x734..743, y678..683 on the outfitter.
        const xs = [...up].map(p => +p.split(',')[0]);
        const ys = [...up].map(p => +p.split(',')[1]);
        expect([Math.min(...xs), Math.max(...xs)]).toEqual([9, 18]);
        expect([Math.min(...ys), Math.max(...ys)]).toEqual([10, 15]);
        expect(up.size).toBe(28);
        expect(up.has('13,10') && up.has('14,10')).toBeTrue();
        expect(up.has('9,15') && up.has('18,15')).toBeTrue();
        const down = pixels('down');
        expect([...down].sort()).toEqual([...up].map(p => {
            const [x, y] = p.split(',').map(Number);
            return `${x},${25 - y}`;
        }).sort());
    });

    it('shows the grey caps when disabled and ignores presses there', () => {
        const arrow = new ScrollArrow(displayAssets(), 'down');
        const button = (arrow as unknown as { button: RoundButton }).button;
        let clicks = 0;
        let presses = 0;
        arrow.click.subscribe(() => clicks++);
        arrow.press.subscribe(() => presses++);
        arrow.enabled = false;
        expect(button.state).toBe('grey');
        arrow.container.emit('pointerdown', {} as never);
        arrow.container.emit('pointerup', {} as never);
        expect([clicks, presses]).toEqual([0, 0]);
        expect(button.state).toBe('grey');
        arrow.enabled = true;
        expect(button.state).toBe('normal');
    });

    it('shows the pressed caps while held, then fires on the release', () => {
        const arrow = new ScrollArrow(displayAssets(), 'up');
        const button = (arrow as unknown as { button: RoundButton }).button;
        let clicks = 0;
        let presses = 0;
        arrow.click.subscribe(() => clicks++);
        arrow.press.subscribe(() => presses++);
        arrow.container.emit('pointerdown', {} as never);
        expect(button.state).toBe('clicked');
        expect([clicks, presses]).toEqual([0, 1]);
        arrow.container.emit('pointerup', {} as never);
        expect(button.state).toBe('normal');
        expect([clicks, presses]).toEqual([1, 1]);
    });

    it('greyed while held, it stays pressed until the release, then greys '
        + 'without firing', () => {
            for (const release of ['pointerup', 'pointerupoutside']) {
                const arrow = new ScrollArrow(displayAssets(), 'down');
                const button =
                    (arrow as unknown as { button: RoundButton }).button;
                let clicks = 0;
                arrow.click.subscribe(() => clicks++);
                arrow.container.emit('pointerdown', {} as never);
                arrow.enabled = false;
                expect(button.state).toBe('clicked');
                arrow.container.emit(release, {} as never);
                expect(button.state).withContext(release).toBe('grey');
                expect(clicks).withContext(release).toBe(0);
            }
        });
});
