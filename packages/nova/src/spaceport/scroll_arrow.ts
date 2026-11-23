import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';

/**
 * The geometry of one scroll arrow, read off the original's outfitter
 * (outfitter/earth_outfitter_cant_have_any.png has both arrows enabled,
 * the R8 wave-5 fullscreen 03-outfitter.png and 05-shipyard.png show the
 * disabled ones):
 *
 * - a 15px SPHERE (x731..745 / x761..775 on the outfitter), dark red with
 *   a white chevron when the grid can scroll that way, near-black with a
 *   dark chevron when it can't, both with a specular glint at the upper
 *   left;
 * - sunk in a SOCKET whose rim catches the light on its lower right (the
 *   bright arc runs from the sphere's right round to its bottom, about
 *   11px out) and is in shadow on its upper left;
 * - a chevron about 10px wide and 5px tall whose stroke is ~2px, sitting
 *   a pixel right of and below the sphere's centre.
 *
 * None of this is in the frame PICT (8502): with no arrows drawn, our
 * shipyard showed plain metal where the original has two dark spheres.
 * The original's is shaded artwork we have no resource for, so this is a
 * drawn approximation of its silhouette, colours and glint.
 */
export const SCROLL_ARROW = {
    sphereRadius: 7.5,
    socketRadius: 10.5,
    /** The chevron's points relative to the sphere centre, pointing up;
     * the down chevron is the same mirrored about y = 1.75. */
    chevronUp: [-4, 4, 0.5, -0.5, 5, 4],
    chevronWidth: 2,
    enabled: { sphere: 0x6e0000, core: 0x960a0a, glint: 0xff8a8a, chevron: 0xffffff },
    disabled: { sphere: 0x080808, core: 0x141414, glint: 0x8a8a8a, chevron: 0x303030 },
    rimLight: 0x9a9a9a,
    rimShadow: 0x101010,
} as const;

/**
 * A round scroll-arrow button: the outfitter, shipyard and hire-escort
 * grids each have an up/down pair at their bottom-left, and a mission-text
 * popup too long for its frame has one right of its buttons. A grid's
 * pair is ALWAYS shown, greyed at either end of the list — the shipyard
 * capture shows both arrows disabled over a list that fits on one page.
 */
export class ScrollArrow {
    container = new PIXI.Container();
    /** Fires on release over an enabled arrow (one page / one step). */
    readonly click = new Subject<void>();
    /** Fires on press-down over an enabled arrow, for owners that scroll
     * while the arrow is HELD (the mission-text popup). A greyed arrow
     * ignores the press entirely. */
    readonly press = new Subject<void>();
    private socket = new PIXI.Graphics();
    private sphere = new PIXI.Graphics();
    private glyph = new PIXI.Graphics();
    private wrappedEnabled = true;

    constructor(private direction: 'up' | 'down') {
        this.container.addChild(this.socket, this.sphere, this.glyph);
        this.container.interactive = true;
        this.container.cursor = 'pointer';
        // An explicit hit area so the whole socket is reliably clickable
        // (graphics-only children can hit-test inconsistently).
        this.container.hitArea = new PIXI.Circle(0, 0,
            SCROLL_ARROW.socketRadius);
        this.container.on('pointerup', () => {
            if (this.wrappedEnabled) {
                this.click.next();
            }
        });
        this.container.on('pointerdown', () => {
            if (this.wrappedEnabled) {
                this.press.next();
            }
        });
        this.drawSocket();
        this.draw();
    }

    get enabled() {
        return this.wrappedEnabled;
    }

    set enabled(value: boolean) {
        if (value === this.wrappedEnabled) {
            return;
        }
        this.wrappedEnabled = value;
        this.draw();
    }

    private drawSocket() {
        const r = SCROLL_ARROW.socketRadius;
        this.socket.clear()
            // The recess: in shadow all round...
            .lineStyle(2, SCROLL_ARROW.rimShadow, 0.8)
            .drawCircle(0, 0, r - 1)
            // ...with the rim lit from the lower right. (moveTo first, or
            // the arc is joined to the pen's last point by a stray line.)
            .lineStyle(2, SCROLL_ARROW.rimLight, 1)
            .moveTo(r * Math.cos(-Math.PI / 3), r * Math.sin(-Math.PI / 3))
            .arc(0, 0, r, -Math.PI / 3, Math.PI * 5 / 6);
    }

    private draw() {
        const look = this.wrappedEnabled
            ? SCROLL_ARROW.enabled : SCROLL_ARROW.disabled;
        const r = SCROLL_ARROW.sphereRadius;
        this.sphere.clear()
            .beginFill(look.sphere).drawCircle(0, 0, r).endFill()
            .beginFill(look.core).drawCircle(-0.5, -0.5, r - 2).endFill()
            .beginFill(look.glint, 0.9).drawCircle(-3, -3.5, 1.6).endFill();

        const [x0, y0, x1, y1, x2, y2] = SCROLL_ARROW.chevronUp;
        // Mirror the up chevron about its own vertical middle for "down".
        const mid = (y0 + y1) / 2;
        const fy = (y: number) =>
            this.direction === 'up' ? y : 2 * mid - y;
        this.glyph.clear()
            .lineStyle({
                width: SCROLL_ARROW.chevronWidth, color: look.chevron,
                join: PIXI.LINE_JOIN.MITER, cap: PIXI.LINE_CAP.BUTT,
            })
            .moveTo(x0, fy(y0))
            .lineTo(x1, fy(y1))
            .lineTo(x2, fy(y2));
    }
}
