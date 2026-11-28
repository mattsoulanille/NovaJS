// A per-channel MAX blend (QuickDraw's addMax) for the WebGL renderer.
//
// PIXI names the mode BLEND_MODES.LIGHTEN — "the lighter of the two,
// channel by channel", which is exactly a MAX — but its WebGL renderer
// only has blend FUNCTIONS for it and maps it to plain NORMAL. A MAX needs
// the blend EQUATION (WebGL 2's gl.MAX, or WebGL 1's EXT_blend_minmax),
// which PIXI 7's StateSystem applies when a blend-mode entry carries six
// values (srcRGB, dstRGB, srcAlpha, dstAlpha, eqRGB, eqAlpha) — the shape
// of its own SUBTRACT. So installing this re-points LIGHTEN at the real
// thing on one renderer; anything drawn LIGHTEN without it (a headless
// spec's renderer, a context without the extension) draws NORMAL, PIXI's
// own fallback, rather than failing.
//
// Used by the star map's nebulae, which the original combines with the
// Show Borders territory by a per-channel max (reference_experiments.md
// "Star-map nebulae (nëbu), wave 53": (8, 0, 8) nebula over a (49, 0, 0)
// border shows (49, 0, 8); black nebula pixels show the border).
import * as PIXI from 'pixi.js';

/** The blend mode that is a per-channel MAX once {@link installMaxBlend}
 * has run on the renderer (NORMAL before). */
export const MAX_BLEND_MODE = PIXI.BLEND_MODES.LIGHTEN;

/** The GL MAX equation `gl` supports, if any. */
function maxEquation(gl: WebGLRenderingContext): number | undefined {
    if (typeof WebGL2RenderingContext !== 'undefined'
        && gl instanceof WebGL2RenderingContext) {
        return gl.MAX;
    }
    return gl.getExtension('EXT_blend_minmax')?.MAX_EXT;
}

/**
 * Makes {@link MAX_BLEND_MODE} a per-channel max on `renderer`, now and
 * after every context restore (the StateSystem rebuilds its table on
 * contextChange; this runner is added after it, so it runs after).
 * Answers whether the context supports it; a canvas renderer never does.
 */
export function installMaxBlend(renderer: PIXI.IRenderer): boolean {
    if (!(renderer instanceof PIXI.Renderer)) {
        return false;
    }
    const install = () => {
        const gl = renderer.gl;
        const max = maxEquation(gl);
        if (max === undefined) {
            return false;
        }
        // The factors are ignored under MAX; ONE keeps them harmless.
        // (`blendModes` is protected in PIXI's typings, public in fact.)
        const state = renderer.state as unknown as { blendModes: number[][] };
        state.blendModes[MAX_BLEND_MODE] =
            [gl.ONE, gl.ONE, gl.ONE, gl.ONE, max, max];
        return true;
    };
    renderer.runners.contextChange.add({ contextChange: install });
    return install();
}
