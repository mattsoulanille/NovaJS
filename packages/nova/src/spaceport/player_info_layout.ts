/**
 * Geometry for the player-info dialog ('p'), kept free of PIXI so it can be
 * measured in specs.
 *
 * The dialog is three PICTs stacked: 8518 (top strip, 413x40, the tab row),
 * 8519 (the black content pane) and 8520 (bottom strip, 413x40, the Done
 * row). Every p_properties/*.png capture shows the stock pane at 147px —
 * 8518 at screen (754,427) and 8520 at (754,614) on all five pages — and
 * none of them holds more text than that pane fits (the longest, extras.png,
 * is seven prose lines). So 147 is a FLOOR, not the size: the three-part
 * frame exists so the middle can grow, and a prose page whose wrapped text
 * runs past the stock pane grows the pane to fit it, pushing 8520, Done and
 * Jettison Cargo down with it. Before this the pane was a fixed 147 and a
 * long Extras list (~75 outfits, 21 lines) ran out of the frame onto the
 * bare background with Done drawn over its 13th line (tracker #356).
 *
 * PER PAGE, not the tallest page while open. No capture shows a grown
 * frame, so the references cannot choose between the two; per-page is the
 * default the brief sets for that case, and it is also the one that keeps
 * the stock pages stock: a pilot with a long outfit list still sees the
 * General and Cargo pages at the measured 413x227, exactly as the captures
 * show them, instead of in a box sized for a different page. The frame
 * stays centred as it grows (frameOrigin over the grown height), so the tab
 * row moves between pages only by the half-height difference centring
 * implies.
 *
 * A pane that would no longer fit the screen stops growing a margin short
 * of it and the prose scrolls inside it instead — the whole prose body,
 * the "Ship trade-in value" line included, so it is never pinned over the
 * list it totals.
 */
import { frameOrigin, INK_TO_BOX } from './hail_layout.js';

export const PINFO_WIDTH = 413;
export const PINFO_TOP_HEIGHT = 40;
/** The measured stock pane (see above): the floor the pane never goes
 * under, and the General page's height outright. */
export const PINFO_STOCK_CONTENT_HEIGHT = 147;
export const PINFO_BOTTOM_HEIGHT = 40;

/** Frame-local y of the tab row's sprites (8px into 8518). */
export const PINFO_TAB_Y = 8;
/** Done's and Jettison Cargo's sprites sit 8px into the 8520 strip: frame
 * y = 195 with the stock pane (195 = 40 + 147 + 8). */
export const PINFO_BOTTOM_BUTTON_DY = 8;

/** The General table's first text box (ink at frame y=45). */
export const PINFO_TABLE_TOP = 45 - INK_TO_BOX;
export const PINFO_TABLE_ROW_HEIGHT = 16;
/** The prose pages' first text box: cargo_with_stuff.png's first
 * paragraph inks at frame y=48. */
export const PINFO_PROSE_TOP = 48 - INK_TO_BOX;
/** Geneva 9's natural 12px leading (cargo_with_stuff.png's paragraphs ink
 * 24px apart: one line plus one blank line). */
export const PINFO_PROSE_LINE_HEIGHT = 12;
/**
 * Pane space kept below the last prose line box once the pane grows: the
 * same 5px the first line box sits below the top strip (45 - 40), so a
 * grown pane frames its text evenly.
 */
export const PINFO_PROSE_PADDING = PINFO_PROSE_TOP - PINFO_TOP_HEIGHT;
/**
 * Screen space left above and below a frame that has grown to the screen's
 * limit. The game canvas can be as small as 800x600; at 600 this caps the
 * frame at 520 (a 440px pane, 35 prose lines) before the prose scrolls.
 */
export const PINFO_SCREEN_MARGIN = 40;
/**
 * The 8519 pane's black interior: the art is a 5px left and 6px right
 * metal border around pure black (x 5..406), so text clipped to this can
 * never paint over the frame's own edges.
 */
export const PINFO_PANE_INNER = { x: 5, width: 402 };

/** Lines one mouse-wheel notch scrolls (the rollback list's step). */
export const PINFO_WHEEL_LINES = 3;

export interface PlayerInfoLayout {
    /** Height of the 8519 pane (tiled 1:1 to this height). */
    contentHeight: number;
    /** The whole frame: 40 + contentHeight + 40. */
    height: number;
    /** Container-local top-left of the frame (the container sits at the
     * screen's centre). */
    origin: { x: number, y: number };
    /** Frame-local y of the 8520 bottom strip. */
    bottomY: number;
    /** Frame-local y of the Done / Jettison Cargo sprites. */
    buttonY: number;
    /**
     * The frame-local band text is clipped to. The whole pane while
     * nothing scrolls; the line-aligned text window while it does, so a
     * line scrolled partly out never peeks into the pane's padding.
     */
    clip: { x: number, y: number, width: number, height: number };
    /** Prose lines visible at once (every line when nothing scrolls). */
    visibleLines: number;
    /** Pixels of prose hidden below the window; 0 when it all fits. */
    maxScroll: number;
}

/**
 * Lays the dialog out for one page.
 *
 * `proseLines` is the page's wrapped line count — PIXI's own wrap
 * (TextMetrics) of the text exactly as it is drawn, blank paragraph lines
 * included — or undefined for the General page, which is a fixed table the
 * stock pane is dimensioned for (nine 16px rows, the ninth ending a pixel
 * above 8520) and keeps the measured 147. `screenHeight` is the UI-logical
 * screen height the frame is centred in.
 */
export function playerInfoLayout(proseLines: number | undefined,
    screenHeight: number): PlayerInfoLayout {
    const chrome = PINFO_TOP_HEIGHT + PINFO_BOTTOM_HEIGHT;
    const proseInset = PINFO_PROSE_TOP - PINFO_TOP_HEIGHT;
    let contentHeight = PINFO_STOCK_CONTENT_HEIGHT;
    let visibleLines = proseLines ?? 0;
    let maxScroll = 0;
    if (proseLines !== undefined) {
        const fit = proseInset + proseLines * PINFO_PROSE_LINE_HEIGHT
            + PINFO_PROSE_PADDING;
        const limit = screenHeight - 2 * PINFO_SCREEN_MARGIN - chrome;
        if (fit <= Math.max(limit, PINFO_STOCK_CONTENT_HEIGHT)) {
            contentHeight = Math.max(PINFO_STOCK_CONTENT_HEIGHT, fit);
        } else {
            // Too tall for the screen: as many whole lines as the limit
            // allows (never fewer than the stock pane holds), and the pane
            // cut to exactly that window plus its padding.
            visibleLines = Math.max(1, Math.floor(
                (Math.max(limit, PINFO_STOCK_CONTENT_HEIGHT)
                    - proseInset - PINFO_PROSE_PADDING)
                / PINFO_PROSE_LINE_HEIGHT));
            contentHeight = Math.max(PINFO_STOCK_CONTENT_HEIGHT,
                proseInset + visibleLines * PINFO_PROSE_LINE_HEIGHT
                + PINFO_PROSE_PADDING);
            maxScroll = (proseLines - visibleLines) * PINFO_PROSE_LINE_HEIGHT;
        }
    }
    const height = chrome + contentHeight;
    const bottomY = PINFO_TOP_HEIGHT + contentHeight;
    const clip = maxScroll > 0
        ? { ...PINFO_PANE_INNER, y: PINFO_PROSE_TOP,
            height: visibleLines * PINFO_PROSE_LINE_HEIGHT }
        : { ...PINFO_PANE_INNER, y: PINFO_TOP_HEIGHT, height: contentHeight };
    return {
        contentHeight,
        height,
        // Whole-pixel origin, as the original blits a centred frame (see
        // hail_layout.frameOrigin): the stock 413x227 is odd both ways.
        origin: frameOrigin(PINFO_WIDTH, height),
        bottomY,
        buttonY: bottomY + PINFO_BOTTOM_BUTTON_DY,
        clip,
        visibleLines,
        maxScroll,
    };
}

/**
 * A scroll offset moved by `lines` prose lines, clamped into the layout's
 * range. Offsets stay whole lines, so the window never shows a cut line.
 */
export function scrollPlayerInfo(offset: number, lines: number,
    layout: PlayerInfoLayout): number {
    const next = offset + lines * PINFO_PROSE_LINE_HEIGHT;
    return Math.max(0, Math.min(layout.maxScroll, next));
}

/** Lines one page key moves: a window less one line, so the line at the
 * edge stays in view for context. */
export function playerInfoPageLines(layout: PlayerInfoLayout): number {
    return Math.max(1, layout.visibleLines - 1);
}
