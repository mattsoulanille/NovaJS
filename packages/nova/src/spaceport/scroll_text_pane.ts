import * as PIXI from 'pixi.js';
import { enhancementEnabled } from '../enhancements.js';
import { TextWheelScroller } from './grid_wheel.js';
import { MenuControls } from './menu_controls.js';
import { popupKeyScroll, PopupScrollKey } from './popup_layout.js';
import { WheelSample } from './starmap_gestures.js';

/**
 * ============================================================================
 * A text pane that clips to its frame and scrolls
 * ============================================================================
 *
 * For a pane whose text has no upper bound — the hangar's ship sheet with a
 * plug-in loadout of forty "Build ..." outfits (Matthew's 2026-11-27
 * screenshot: the Outfits list ran down over Done and the spaceport's own
 * description), a plug-in's long shop description, the rollback screen's
 * checkpoint panes — the text is clipped to the pane and scrolls inside it:
 *
 * - the mouse wheel or a two-finger scroll over the pane (grid_wheel.ts
 *   TextWheelScroller: three lines a detent, the fingers' distance on a
 *   trackpad);
 * - a slim scroll bar down the pane's right edge, drawn only while the text
 *   overflows: drag its thumb, or click the track above or below it to page;
 * - a touch drag on the text itself;
 * - PageUp / PageDown / Home / End while the owner's keys are focused
 *   (bindPageKeys), as on the mission-text popup (popup_layout.ts).
 *
 * The bar is NovaJS's own (the original has no scroll bar in any of these
 * panes; its mission-text popup scrolls by the round arrows of
 * scroll_arrow.ts): a near-black well with a dark-red thumb in the
 * button discs' colours, so it reads as one of the landed UI's controls.
 *
 * {@link setText} puts the pane back at the top: a different item's text
 * starts at its own first line.
 */

/** A pane's clip rectangle, in its owner's coordinates. */
export interface PaneRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The bar's width, its gap from the pane's right edge, and the
 * shortest a thumb may get (so a very long text still has a handle). */
export const SCROLL_BAR = {
    width: 5,
    inset: 2,
    minThumb: 16,
    track: 0x141414,
    trackEdge: 0x303030,
    // The red of the button caps' discs (PICT 7500/7502), as the drawn
    // scroll arrows used before they became the caps themselves.
    thumb: 0x6e0000,
    thumbCore: 0x960a0a,
} as const;

/**
 * What a wrapped text gives up to the bar while it overflows: the bar and
 * a 2px gap. A text that fits keeps its full wrap width, so its line breaks
 * are the ones the pane always had (the shops' are measured against the
 * original's).
 */
export const SCROLL_BAR_GUTTER = SCROLL_BAR.width + SCROLL_BAR.inset + 2;

/**
 * The middle description pane of the shop frames — the shipyard's and
 * outfitter's 8502, and the hire dialog's and hangar's 8501, which share
 * it — in dialog coordinates: its black interior, measured off a render,
 * runs x -34..166 and y -153..116. The description text sits at (-27,
 * -150), so a text taller than 267 px reaches the frame's bottom rail.
 */
export const SHOP_DESCRIPTION_PANE: PaneRect = {
    x: -34, y: -153, width: 201, height: 270,
};

/** px of text hidden below the pane: 0 when it all fits. */
export function textScrollRange(contentHeight: number,
    viewHeight: number): number {
    return Math.max(0, Math.ceil(contentHeight - viewHeight));
}

/** Clamps a scroll offset into [0, maxOffset]. */
export function clampOffset(offset: number, maxOffset: number): number {
    return Math.max(0, Math.min(maxOffset, offset));
}

/**
 * The thumb on a track `trackHeight` tall: its size is the visible share of
 * the text (never under {@link SCROLL_BAR.minThumb}), its travel the rest
 * of the track. `y` is from the track's top.
 */
export function scrollThumb(offset: number, maxOffset: number,
    viewHeight: number, trackHeight: number):
    { y: number, height: number } {
    if (maxOffset <= 0) {
        return { y: 0, height: trackHeight };
    }
    const share = viewHeight / (viewHeight + maxOffset);
    const height = Math.min(trackHeight,
        Math.max(SCROLL_BAR.minThumb, trackHeight * share));
    const travel = trackHeight - height;
    return {
        y: travel * clampOffset(offset, maxOffset) / maxOffset,
        height,
    };
}

/** The offset that puts the thumb's top at `thumbY` (a drag). */
export function offsetForThumb(thumbY: number, maxOffset: number,
    viewHeight: number, trackHeight: number): number {
    const { height } = scrollThumb(0, maxOffset, viewHeight, trackHeight);
    const travel = trackHeight - height;
    if (maxOffset <= 0 || travel <= 0) {
        return 0;
    }
    return clampOffset(thumbY / travel * maxOffset, maxOffset);
}

/** One page of a pane `viewHeight` tall: the view less a 12px line, so
 * the line at the edge stays in sight. */
export function pageStep(viewHeight: number): number {
    return Math.max(12, viewHeight - 12);
}

export interface ScrollTextPaneOptions {
    /** The clip rectangle, in the owner's coordinates. */
    frame: PaneRect;
    /** Display-tree name for the pane's container (headless driving). */
    name?: string;
    /**
     * Whether the pane may scroll now (wheel, bar, drag, keys). Off, the
     * text is still clipped and sits at the top: for a pane of the
     * original's, the "Scroll wheel in text" NovaJS Enhancement. Default
     * always on.
     */
    scrollable?: () => boolean;
}

/**
 * A shop's description pane (shipyard, outfitter, hire escort): the
 * original's, so the text is always clipped to the pane, as a Mac text box
 * clips (a handful of stock descriptions, the Polaron Multi-Torpedo Tube
 * and the Fed Destroyer variants among them, wrap to a 23rd line, and the
 * Thunderforge's TripHammer to 29, which ran onto the frame's button
 * rail), and it scrolls only under the "Scroll wheel in text" NovaJS
 * Enhancement. Off, a long description is cut at the pane's bottom.
 */
export function shopDescriptionPane(text: PIXI.Text, name: string):
    ScrollTextPane {
    return new ScrollTextPane(text, {
        frame: SHOP_DESCRIPTION_PANE, name,
        scrollable: () => enhancementEnabled('enhTextScrollWheel'),
    });
}

/** Whether a key went to a text field, whose Home / End are its own. */
function isTextField(target: EventTarget | null): boolean {
    const tag = (target as { tagName?: unknown } | null)?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
}

export class ScrollTextPane {
    readonly container = new PIXI.Container();
    /** px the text is scrolled up by. */
    private offsetPx = 0;
    private frameRect: PaneRect;
    /** The text's resting position (its position at offset 0). */
    private readonly origin: { x: number, y: number };
    /** The text's own wrap width, for a wrapping text. */
    private readonly wrapWidth?: number;
    private readonly clip = new PIXI.Graphics();
    private readonly hit = new PIXI.Container();
    private readonly bar = new PIXI.Graphics();
    private readonly wheel = new TextWheelScroller();
    private readonly scrollable: () => boolean;
    /** The thumb drag or touch drag in progress. */
    private drag?: { startY: number, startOffset: number, thumb: boolean };
    private pageKeyListener?: (event: KeyboardEvent) => void;

    constructor(readonly text: PIXI.Text, options: ScrollTextPaneOptions) {
        this.frameRect = { ...options.frame };
        this.scrollable = options.scrollable ?? (() => true);
        this.container.name = options.name ?? 'ScrollTextPane';
        this.origin = { x: text.position.x, y: text.position.y };
        this.wrapWidth = text.style.wordWrap
            ? text.style.wordWrapWidth : undefined;
        text.mask = this.clip;
        // The hit area over the pane takes the wheel and a touch drag; the
        // bar, above it, takes the thumb and the track.
        this.hit.eventMode = 'static';
        this.hit.on('wheel', (event: PIXI.FederatedWheelEvent) => {
            const native = event.nativeEvent as WheelEvent & {
                wheelDeltaY?: number };
            if (this.onWheel({
                deltaX: event.deltaX, deltaY: event.deltaY,
                deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
                wheelDeltaY: typeof native?.wheelDeltaY === 'number'
                    ? native.wheelDeltaY : undefined,
                timeStamp: event.timeStamp,
            })) {
                // Scrolled the text: the owner's own wheel (a dialog-wide
                // listener) must not act on the same event.
                event.stopPropagation();
            }
        });
        this.hit.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            if (event.pointerType === 'touch') {
                this.beginDrag(event, false);
            }
        });
        this.bar.eventMode = 'static';
        this.bar.cursor = 'pointer';
        this.bar.on('pointerdown', (event: PIXI.FederatedPointerEvent) =>
            this.onBarDown(event));
        for (const target of [this.hit, this.bar]) {
            target.on('globalpointermove',
                (event: PIXI.FederatedPointerEvent) => this.onDragMove(event));
            target.on('pointerup', () => { this.drag = undefined; });
            target.on('pointerupoutside', () => { this.drag = undefined; });
        }
        this.container.addChild(this.clip, text, this.hit, this.bar);
        this.refit();
    }

    /** px the text is scrolled by (0 = its first line at the top). */
    get offset(): number {
        return this.offsetPx;
    }

    /** px of text below the pane at offset 0 (0 when it all fits). */
    get maxOffset(): number {
        return this.scrollable()
            ? textScrollRange(this.contentHeight, this.frameRect.height
                - (this.origin.y - this.frameRect.y))
            : 0;
    }

    /** The current clip rectangle. */
    get frame(): PaneRect {
        return { ...this.frameRect };
    }

    private get contentHeight(): number {
        return this.text.text ? this.text.height : 0;
    }

    /** Replaces the text and goes back to its top. */
    setText(value: string) {
        this.text.text = value;
        this.offsetPx = 0;
        this.drag = undefined;
        this.refit();
    }

    /** Moves or resizes the pane (e.g. a message now shares it). */
    setFrame(frame: PaneRect) {
        if (frame.x === this.frameRect.x && frame.y === this.frameRect.y
            && frame.width === this.frameRect.width
            && frame.height === this.frameRect.height) {
            return;
        }
        this.frameRect = { ...frame };
        this.refit();
    }

    /**
     * Re-wraps the text for the bar: its full wrap width when it fits, the
     * width less {@link SCROLL_BAR_GUTTER} when it overflows (so no line
     * runs under the bar), then lays the pane out.
     */
    private refit() {
        if (this.wrapWidth !== undefined) {
            this.text.style.wordWrapWidth = this.wrapWidth;
            if (this.maxOffset > 0) {
                this.text.style.wordWrapWidth =
                    this.wrapWidth - SCROLL_BAR_GUTTER;
            }
        }
        this.layout();
    }

    scrollTo(offset: number) {
        this.offsetPx = clampOffset(offset, this.maxOffset);
        this.layout();
    }

    scrollBy(dy: number) {
        this.scrollTo(this.offsetPx + dy);
    }

    /**
     * One wheel event over the pane. True when it moved (or could move)
     * the text, i.e. the pane claims the event. Public for the specs.
     */
    onWheel(sample: WheelSample): boolean {
        if (this.maxOffset <= 0) {
            return false;
        }
        const dy = this.wheel.pixels(sample);
        if (dy === 0) {
            return false;
        }
        this.scrollBy(dy);
        return true;
    }

    /** PageUp / PageDown / Home / End. Public for the specs. */
    onPageKey(key: PopupScrollKey) {
        const max = this.maxOffset;
        if (max <= 0) {
            return;
        }
        if (key === 'PageUp' || key === 'PageDown') {
            const step = pageStep(this.frameRect.height);
            this.scrollBy(key === 'PageUp' ? -step : step);
        } else {
            this.scrollTo(popupKeyScroll(key, this.offsetPx, max));
        }
    }

    /**
     * Takes PageUp / PageDown / Home / End off the DOM while `controls` is
     * the focused surface (the game's control set has no page actions; see
     * offer_popup.ts listenPageKeys). Returns the unbind.
     */
    bindPageKeys(controls: MenuControls): () => void {
        this.unbindPageKeys();
        if (typeof document === 'undefined') {
            return () => undefined;
        }
        const listener = (event: KeyboardEvent) => {
            const key = event.key;
            if ((key !== 'PageUp' && key !== 'PageDown' && key !== 'Home'
                && key !== 'End') || MenuControls.focused !== controls
                || !this.container.worldVisible || isTextField(event.target)) {
                return;
            }
            event.preventDefault();
            this.onPageKey(key);
        };
        this.pageKeyListener = listener;
        document.addEventListener('keydown', listener);
        return () => this.unbindPageKeys();
    }

    unbindPageKeys() {
        if (this.pageKeyListener) {
            document.removeEventListener('keydown', this.pageKeyListener);
            this.pageKeyListener = undefined;
        }
    }

    /** The track: the pane's right edge, inset, its full height. */
    private get track(): PaneRect {
        const { x, y, width, height } = this.frameRect;
        return {
            x: x + width - SCROLL_BAR.inset - SCROLL_BAR.width,
            y: y + SCROLL_BAR.inset,
            width: SCROLL_BAR.width,
            height: height - 2 * SCROLL_BAR.inset,
        };
    }

    private onBarDown(event: PIXI.FederatedPointerEvent) {
        const max = this.maxOffset;
        if (max <= 0) {
            return;
        }
        event.stopPropagation();
        const track = this.track;
        const local = event.getLocalPosition(this.container);
        const thumb = scrollThumb(this.offsetPx, max, this.frameRect.height,
            track.height);
        const top = track.y + thumb.y;
        if (local.y < top) {
            this.onPageKey('PageUp');
        } else if (local.y > top + thumb.height) {
            this.onPageKey('PageDown');
        } else {
            this.beginDrag(event, true);
        }
    }

    private beginDrag(event: PIXI.FederatedPointerEvent, thumb: boolean) {
        this.drag = {
            startY: event.getLocalPosition(this.container).y,
            startOffset: this.offsetPx, thumb,
        };
    }

    private onDragMove(event: PIXI.FederatedPointerEvent) {
        const drag = this.drag;
        if (!drag) {
            return;
        }
        if (event.buttons === 0 && event.pointerType === 'mouse') {
            // Released outside the window: no pointerup reached us.
            this.drag = undefined;
            return;
        }
        const dy = event.getLocalPosition(this.container).y - drag.startY;
        if (drag.thumb) {
            const max = this.maxOffset;
            const track = this.track;
            const start = scrollThumb(drag.startOffset, max,
                this.frameRect.height, track.height).y;
            this.scrollTo(offsetForThumb(start + dy, max,
                this.frameRect.height, track.height));
        } else {
            // The text follows the finger.
            this.scrollTo(drag.startOffset - dy);
        }
    }

    /** Places the text, the clip, the hit area and the bar. */
    private layout() {
        const { x, y, width, height } = this.frameRect;
        const max = this.maxOffset;
        this.offsetPx = clampOffset(this.offsetPx, max);
        this.text.position.set(this.origin.x, this.origin.y - this.offsetPx);
        this.clip.clear().beginFill(0xffffff).drawRect(x, y, width, height)
            .endFill();
        this.hit.hitArea = max > 0
            ? new PIXI.Rectangle(x, y, width, height) : null;
        this.hit.eventMode = max > 0 ? 'static' : 'none';
        this.bar.clear();
        this.bar.visible = max > 0;
        this.bar.eventMode = max > 0 ? 'static' : 'none';
        if (max <= 0) {
            return;
        }
        const track = this.track;
        const thumb = scrollThumb(this.offsetPx, max, height, track.height);
        this.bar.lineStyle(1, SCROLL_BAR.trackEdge, 1, 1)
            .beginFill(SCROLL_BAR.track)
            .drawRect(track.x, track.y, track.width, track.height)
            .endFill()
            .lineStyle(0)
            .beginFill(SCROLL_BAR.thumb)
            .drawRect(track.x, track.y + thumb.y, track.width, thumb.height)
            .endFill()
            .beginFill(SCROLL_BAR.thumbCore)
            .drawRect(track.x + 1, track.y + thumb.y + 1,
                Math.max(1, track.width - 3), Math.max(1, thumb.height - 2))
            .endFill();
        // The bar's hit area is the whole track (page clicks above and
        // below the thumb), a little wider than drawn for a fingertip.
        this.bar.hitArea = new PIXI.Rectangle(track.x - 3, track.y,
            track.width + 3 + SCROLL_BAR.inset, track.height);
    }

    destroy() {
        this.unbindPageKeys();
    }
}
