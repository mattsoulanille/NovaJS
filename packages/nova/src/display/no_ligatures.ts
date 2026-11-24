/**
 * No typographic ligatures anywhere in NovaJS's text.
 *
 * The original draws every string with the classic Mac's bitmap fonts
 * (Geneva 9 and friends), which have no ligatures: in the 1920x1080
 * captures "find", "first", "fighter", "Office", "effluent", "fleet's"
 * and "traffic" all show the i's own dot and two separate f's. Our
 * stand-in, macOS's outline Geneva, carries "fi" and "fl" ligatures that
 * the browser applies by default, merging the i's dot (and the l's
 * ascender) into the f's hook.
 *
 * Canvas 2D has no `font-variant-ligatures`: the `font` string resets it,
 * `textRendering = 'optimizeSpeed'` is Chromium-only (and visibly changes
 * the anti-aliasing), and PIXI.Text resizes its canvas on every redraw,
 * which resets any context state we set. So canvas text gets a ZERO WIDTH
 * NON-JOINER after each "f" that could start a ligature, at draw time:
 * the browser's shaper never ligates across a ZWNJ, the ZWNJ itself has
 * no advance, and the strings the game keeps (`PIXI.Text.text`, the
 * wrap code's input) are untouched. Geneva has no kerning pairs, so the
 * resulting advances are exactly f's plus i's -- the original's metric.
 *
 * DOM text (the title dialogs, the touch controls) gets the CSS property
 * instead; see `NO_LIGATURES_CSS`.
 */

/** U+200C ZERO WIDTH NON-JOINER. */
export const ZWNJ = '‌';

/**
 * An "f" followed by a letter that Latin fonts' default ligatures pair it
 * with (ff, fi, fj, fl; ffi and ffl are covered as ff + fi/fl). Narrow on
 * purpose: a ZWNJ between two letters can also block a kerning pair, so
 * only the pairs that can actually ligate get one. (Geneva itself has
 * just fi and fl, and no kerning at all.)
 */
const LIGATURE_START = /f(?=[fijl])/g;

/** `text` with a ZWNJ inside every pair that could form a ligature. */
export function breakLigatures(text: string): string {
    // Fast path: most strings have no "f" at all.
    if (text.indexOf('f') < 0) {
        return text;
    }
    return text.replace(LIGATURE_START, 'f' + ZWNJ);
}

/**
 * Every DOM element, including form controls (whose UA `font` shorthand
 * would otherwise reset the inherited value) and rules that set the
 * `font` shorthand themselves (touch_controls.ts), hence `!important`.
 */
export const NO_LIGATURES_CSS =
    '*, *::before, *::after { font-variant-ligatures: none !important; }';

/** The text-drawing methods of a 2D context that take the string first. */
interface TextContextPrototype {
    fillText(text: string, ...rest: unknown[]): void;
    strokeText(text: string, ...rest: unknown[]): void;
    measureText(text: string): unknown;
}

const INSTALLED = Symbol.for('nova.noLigatures');

/**
 * Routes `fillText`, `strokeText` and `measureText` of `proto` through
 * `breakLigatures`. Idempotent. Measuring goes through it too, so the
 * widths PIXI wraps and sizes with are the widths that get drawn.
 */
export function patchTextContext(proto: TextContextPrototype): void {
    const marked = proto as TextContextPrototype & { [INSTALLED]?: true };
    if (marked[INSTALLED]) {
        return;
    }
    const { fillText, strokeText, measureText } = proto;
    proto.fillText = function (text: string, ...rest: unknown[]) {
        return fillText.call(this, breakLigatures(String(text)), ...rest);
    };
    proto.strokeText = function (text: string, ...rest: unknown[]) {
        return strokeText.call(this, breakLigatures(String(text)), ...rest);
    };
    proto.measureText = function (text: string) {
        return measureText.call(this, breakLigatures(String(text)));
    };
    marked[INSTALLED] = true;
}

/**
 * Turns ligatures off for all of the page's text: the 2D canvas contexts
 * (PIXI.Text, BitmapFont's glyph atlas, anything else that draws with
 * fillText) and the DOM. Call once at startup, before any text is drawn.
 */
export function installNoLigatures(doc: Document = document): void {
    const contexts = [
        globalThis.CanvasRenderingContext2D,
        globalThis.OffscreenCanvasRenderingContext2D,
    ];
    for (const ctor of contexts) {
        if (ctor) {
            patchTextContext(ctor.prototype as unknown as TextContextPrototype);
        }
    }
    if (!doc.getElementById('nova-no-ligatures')) {
        const style = doc.createElement('style');
        style.id = 'nova-no-ligatures';
        style.textContent = NO_LIGATURES_CSS;
        doc.head.appendChild(style);
    }
}
