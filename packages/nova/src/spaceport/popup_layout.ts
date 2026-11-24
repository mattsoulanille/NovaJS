/**
 * Geometry and line-breaking for the mission-text popups, kept free of PIXI
 * so it can be measured in specs.
 *
 * Every number here was read off the 1920x1080 original-hardware captures in
 * ui_screenshots/original_macos_screenshots (the Sigma Shipyards intro
 * mission, mïsn nova:555, in sigma_mission_1/, plus the longer kont-probe
 * offer in spaceport/). The frames are PICT art blitted 1:1 and the dialog is
 * centred on the screen, so image pixels ARE game pixels.
 */

// ── The tiled frame (offer 8521-8523 / briefing 8524-8526) ──────────────────
// 8521 is 441x9, 8522 441x365 (tiled vertically), 8523 441x40.
export const POPUP_WIDTH = 441;
export const POPUP_TOP_HEIGHT = 9;
export const POPUP_BOTTOM_HEIGHT = 40;
/**
 * Frame edge to the text's pen x. The frame art's own border eats 5px and
 * the original insets the text a further 7: on 1_sigma_1_offer.png the frame
 * starts at x=740 and the glyphs' ink starts at x=752-753.
 */
export const POPUP_TEXT_MARGIN = 12;
/**
 * Frame top to the top of the first LINE BOX. The original's first line of
 * ink sits 13px below the frame (y=478 with the frame at y=465 on
 * 2_sigma_1_accept.png); our glyphs sit 2px inside their box, so the box
 * starts at 11.
 */
export const POPUP_TEXT_TOP = 11;
/**
 * The middle strip's height: one 12px line per line of text plus 18px of
 * slack, but never less than four lines' worth (3_sigma_1_pick_up_cargo.png
 * holds two lines in a 66px strip) and never more than the original's
 * ceiling (the kont-probe offer paginates at 268px = 21 visible lines).
 */
export const POPUP_MIDDLE_PADDING = 18;
export const POPUP_MIDDLE_MIN = 66;
export const POPUP_MIDDLE_MAX = 268;
/** The original's leading: Geneva 9's 12px line pitch. */
export const POPUP_LINE_HEIGHT = 12;

// ── The desc + pict frame (8527/8528, 649x244, fixed size) ──────────────────
export const PICT_FRAME_WIDTH = 649;
export const PICT_FRAME_HEIGHT = 244;
/** Text well inside the art: x 5..431, y 4..206. */
export const PICT_TEXT_WELL = { x: 5, y: 4, width: 427, height: 203 };
/** Picture pane inside the art: x 439..640, y 4..206. */
export const PICT_PANE = { x: 439, y: 4, width: 202, height: 203 };
/**
 * Where the dësc's graphic actually lands in that pane: the reference's
 * 200x200 pict fills art x 439..638, y 7..206 (screen 1075..1274, 425..624
 * on 5_sigma_1_mission_text_with_pict.png). Smaller pictures centre in the
 * same rect; larger ones scale down to fit it.
 */
export const PICT_IMAGE_RECT = { x: 439, y: 7, width: 200, height: 200 };
/** Frame top to the first LINE BOX (the original's ink lands at y=428 with
 * the frame at y=418 on 5_sigma_1_mission_text_with_pict.png). */
export const PICT_TEXT_TOP = 8;

// ── Buttons ────────────────────────────────────────────────────────────────
/**
 * Button middle-strip width. The end caps (PICT 7500/7502) draw ~10.5px of
 * pill each, so this makes the 94px pill every reference shows (No spans
 * x=856..950 on 1_sigma_1_offer.png).
 */
export const POPUP_BUTTON_WIDTH = 73;
/** Sprite height of a button (PICT 7500-7502 are 13x25 / 2x25). */
export const POPUP_BUTTON_HEIGHT = 25;
/** Width of a button's end cap (PICT 7500 / 7502). */
export const POPUP_BUTTON_CAP_WIDTH = 13;
/**
 * Left edge of each pill, measured from the frame's left edge:
 * a lone Okay at 173, a No/Yes pair at 116 and 225.
 */
export const POPUP_BUTTON_X = { single: 173, refuse: 116, accept: 225 };
/** Frame bottom to the button sprite's top, per frame kind. */
export const POPUP_BUTTON_BOTTOM_GAP = 32;
export const PICT_BUTTON_BOTTOM_GAP = 30;
/**
 * Centres of the two round scroll buttons, from the frame's left edge
 * (kiniké_kont_probe_mission_offer_in_spaceport.png: 1091 and 1124 with the
 * frame at 740). They share the button row's vertical centre.
 */
export const POPUP_SCROLL_X = { up: 351, down: 384 };
/**
 * The scroll arrows' centre below the button sprite's top: their spheres
 * span rows 674..686 on the R8 wave-5 bar capture (11-bar.png), whose
 * No / Yes pills' red faces run 672..684 (a pill face starts 5px below
 * its sprite's top).
 */
export const POPUP_SCROLL_DY = 12.5;

/*
 * How the original scrolls mission text (docs/reference_experiments.md,
 * "Scrolling: long mission text and the shop scroll arrows, wave 12",
 * frame-counted on a recording): an arrow HELD glides the text from the
 * press to the release at a steady 2 px a 30 fps video frame, with no
 * initial jump, no delay and no acceleration (181 px in a 3 s hold); a
 * single click moves 5 px; the Up / Down keys move 10 px a press and do
 * not repeat when held; PageUp / PageDown move 250 px; Home / End go to
 * the ends; the wheel does nothing (a NovaJS Enhancement adds it).
 */
/** Speed of an arrow's glide, from the press to the release (px/s). */
export const POPUP_SCROLL_HOLD_SPEED = 60;
/** The least one press-and-release of an arrow moves the text (px): a
 * quick click still moves this far. */
export const POPUP_SCROLL_CLICK = 5;
/** One press of the Up / Down key (px). */
export const POPUP_SCROLL_KEY_STEP = 10;
/** One press of PageUp / PageDown (px), about 21 lines. */
export const POPUP_SCROLL_PAGE = 250;
/** One detent of a notched mouse wheel, when the "Scroll wheel in text"
 * enhancement is on: three lines, the usual desktop step. */
export const POPUP_WHEEL_NOTCH_PX = 3 * POPUP_LINE_HEIGHT;

/** The laid-out size of a tiled popup holding `lineCount` lines of text. */
export interface TiledPopupLayout {
    /** Height of the tiled middle strip. */
    middleHeight: number;
    /** Top piece + middle + bottom piece. */
    totalHeight: number;
    /** Lines that fit in the text window (the rest scrolls). */
    visibleLines: number;
    /** Height of the clipped text window. */
    windowHeight: number;
    /** Pixels of text hidden below the window; 0 when it all fits. */
    maxScroll: number;
}

/**
 * The original grows the frame a line at a time between a four-line floor and
 * a 21-line ceiling, then paginates the rest with the scroll arrows.
 */
export function tiledPopupLayout(lineCount: number): TiledPopupLayout {
    const middleHeight = Math.min(POPUP_MIDDLE_MAX, Math.max(POPUP_MIDDLE_MIN,
        lineCount * POPUP_LINE_HEIGHT + POPUP_MIDDLE_PADDING));
    // The window ends a little short of the strip: with the frame at its
    // ceiling the original still shows only 21 lines in a 268px strip.
    const visibleLines = Math.max(1, Math.floor(
        (middleHeight - POPUP_MIDDLE_PADDING + 2) / POPUP_LINE_HEIGHT));
    const windowHeight = visibleLines * POPUP_LINE_HEIGHT;
    return {
        middleHeight,
        totalHeight: POPUP_TOP_HEIGHT + middleHeight + POPUP_BOTTOM_HEIGHT,
        visibleLines,
        windowHeight,
        maxScroll: Math.max(0,
            (lineCount - visibleLines) * POPUP_LINE_HEIGHT),
    };
}

/** Lines of text the fixed-size desc+pict well can show before it scrolls. */
export function pictPopupVisibleLines(): number {
    return Math.floor((PICT_TEXT_WELL.height - 8) / POPUP_LINE_HEIGHT);
}

/** Clamps a scroll offset into [0, maxScroll]. */
export function clampScroll(offset: number, maxScroll: number): number {
    return Math.max(0, Math.min(maxScroll, offset));
}

/**
 * How far the text has glided after `heldMs` of holding an arrow: the
 * glide starts at the press, with no jump and no delay.
 */
export function heldScrollDistance(heldMs: number): number {
    return Math.max(0, heldMs) * POPUP_SCROLL_HOLD_SPEED / 1000;
}

/**
 * How far one press-and-release of an arrow moves the text in all: the
 * glide's distance, but never less than a click's {@link
 * POPUP_SCROLL_CLICK} (the original's 60 ms click moves 5 px).
 */
export function releasedScrollDistance(heldMs: number): number {
    return Math.max(POPUP_SCROLL_CLICK, heldScrollDistance(heldMs));
}

/** A keyboard scroll of the text: its key, and what it does. */
export type PopupScrollKey = 'PageUp' | 'PageDown' | 'Home' | 'End';

/**
 * The text offset after a PageUp / PageDown / Home / End press, from
 * `offset` in a text that scrolls `maxOffset` px, clamped to the text.
 */
export function popupKeyScroll(key: PopupScrollKey, offset: number,
    maxOffset: number): number {
    switch (key) {
        case 'PageUp':
            return clampScroll(offset - POPUP_SCROLL_PAGE, maxOffset);
        case 'PageDown':
            return clampScroll(offset + POPUP_SCROLL_PAGE, maxOffset);
        case 'Home':
            return 0;
        case 'End':
            return maxOffset;
    }
}

/**
 * Breaks mission text the way the original's Mac text engine did.
 *
 * Greedy word wrap with two details PIXI's own wrapper gets differently, both
 * visible in the references:
 *  - a line may break after a hyphen inside a word ("...to all non-" /
 *    "Sigma Shipyards personnel..." in 4_sigma_1_return.png);
 *  - trailing spaces hang past the wrap width instead of pushing the next
 *    word down (mission text double-spaces after every full stop).
 *
 * `measure` returns the rendered width of a string; the caller passes the
 * same font the text is drawn with.
 */
export function wrapMissionText(text: string, wrapWidth: number,
    measure: (s: string) => number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
        if (paragraph === '') {
            lines.push('');
            continue;
        }
        let line = '';
        for (const token of tokenizeForWrap(paragraph)) {
            if (line === '') {
                // Whitespace never opens a line: the original drops it when
                // it wraps.
                if (/^\s+$/.test(token)) {
                    continue;
                }
                line = token;
                continue;
            }
            const candidate = line + token;
            if (measure(trimEnd(candidate)) <= wrapWidth) {
                line = candidate;
            } else if (/^\s+$/.test(token)) {
                // Spaces never force a break; they hang off the end.
                line = candidate;
            } else {
                lines.push(trimEnd(line));
                line = token;
            }
        }
        lines.push(trimEnd(line));
    }
    return lines;
}

/**
 * Splits a paragraph into the pieces a line may end on: runs of whitespace,
 * and word fragments that end after each hyphen.
 */
function tokenizeForWrap(paragraph: string): string[] {
    const tokens: string[] = [];
    for (const run of paragraph.match(/\s+|\S+/g) ?? []) {
        if (/^\s+$/.test(run)) {
            tokens.push(run);
            continue;
        }
        // "non-Sigma" -> ["non-", "Sigma"]; a trailing hyphen stays put.
        let start = 0;
        for (let i = 0; i < run.length; i++) {
            if (run[i] === '-' && i + 1 < run.length) {
                tokens.push(run.slice(start, i + 1));
                start = i + 1;
            }
        }
        tokens.push(run.slice(start));
    }
    return tokens;
}

function trimEnd(s: string): string {
    return s.replace(/\s+$/, '');
}
