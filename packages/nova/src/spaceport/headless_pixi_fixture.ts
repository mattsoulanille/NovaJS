import * as PIXI from 'pixi.js';

/**
 * Enough of a canvas for PIXI.Text to exist under node.
 *
 * The spaceport menus are PIXI-bound, and most of them build a PIXI.Text
 * in their constructor. PIXI.Text needs a 2D canvas (it rasterises the
 * string into one and wraps it in a Texture), which node has not got, so
 * building a menu headlessly used to throw "document is not defined" and
 * the menus themselves could only be tested through the pure functions
 * they delegate to.
 *
 * This installs a stub canvas so a whole menu can be CONSTRUCTED and its
 * display list inspected (see shipyard_grid_build_test.ts, which counts
 * the grids the shipyard puts on screen). It is emphatically NOT a
 * renderer: every measurement it returns is a made-up constant, so it can
 * answer "which objects are in this container", never "what do they look
 * like". Pixel-level facts stay pinned against the original's screenshots
 * (shop_captions_test.ts, dialog_layout_test.ts).
 */

/** The made-up advance width per character. Any positive number does. */
const CHAR_WIDTH = 6;

/**
 * A 2D context that accepts every drawing call and answers the two
 * queries PIXI actually reads back:
 *
 *  - measureText, for line breaking and canvas sizing.
 *  - getImageData, which TextMetrics.measureFont scans for the font's
 *    ascent and descent. All-255 (the "nothing was drawn" colour it
 *    fills with first) makes both come out 0, which terminates its scan
 *    loops immediately.
 *
 * Everything else — fillText, scale, clearRect, the shadow and gradient
 * setters — is a no-op reached through the proxy's fallback, so a PIXI
 * upgrade that starts calling some new context method does not break the
 * fixture.
 */
function stubContext(): CanvasRenderingContext2D {
    const properties = new Map<string, unknown>();
    const queries: Record<string, (...args: any[]) => unknown> = {
        measureText: (text: string) => ({
            width: String(text).length * CHAR_WIDTH,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: String(text).length * CHAR_WIDTH,
            actualBoundingBoxAscent: 0,
            actualBoundingBoxDescent: 0,
        }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
            width: w, height: h,
            data: new Uint8ClampedArray(
                Math.max(1, w) * Math.max(1, h) * 4).fill(255),
        }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createPattern: () => null,
    };
    return new Proxy({}, {
        get(_target, key) {
            if (typeof key !== 'string') {
                return undefined;
            }
            if (key in queries) {
                return queries[key];
            }
            if (properties.has(key)) {
                return properties.get(key);
            }
            // Any other member is a drawing call: accept and ignore it.
            return () => undefined;
        },
        set(_target, key, value) {
            properties.set(String(key), value);
            return true;
        },
        // cast: a Proxy that answers every member is the whole point of
        // the stub; no declared type describes "anything PIXI asks for".
    }) as unknown as CanvasRenderingContext2D;
}

/**
 * PIXI decides how to wrap a texture source by `instanceof
 * HTMLCanvasElement` (CanvasResource.test), so the stub has to BE one as
 * far as node is concerned — hence installHeadlessPixi defining that
 * global.
 */
class StubCanvas {
    private context = stubContext();
    constructor(public width = 1, public height = 1) { }
    getContext(): CanvasRenderingContext2D {
        return this.context;
    }
}

let installed = false;

/**
 * Makes PIXI.Text (and so the spaceport menus) constructible under node.
 * Idempotent, and safe to call from several specs: PIXI's adapter and the
 * HTMLCanvasElement global are process-wide, and the stub is inert for
 * specs that never touch a canvas.
 */
export function installHeadlessPixi() {
    if (installed) {
        return;
    }
    installed = true;
    const globals = globalThis as Record<string, unknown>;
    globals['HTMLCanvasElement'] ??= StubCanvas;
    PIXI.settings.ADAPTER = {
        ...PIXI.settings.ADAPTER,
        // cast (both): the adapter is typed against the DOM classes, and
        // StubCanvas deliberately implements only the members PIXI.Text
        // reaches, not HTMLCanvasElement's hundreds.
        createCanvas: (width?: number, height?: number) =>
            new StubCanvas(width ?? 1, height ?? 1) as unknown as
            HTMLCanvasElement,
        getCanvasRenderingContext2D: () =>
            StubCanvas as unknown as typeof CanvasRenderingContext2D,
        getBaseUrl: () => '',
        getFontFaceSet: () => null,
    };
}
