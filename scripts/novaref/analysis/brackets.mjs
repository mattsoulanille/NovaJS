#!/usr/bin/env node
/**
 * Target brackets (wave 9): the four corner glyphs the original draws around
 * the targeted ship (yellow / red / green by disposition) or stellar (blue),
 * found by colour in a window shot or in recording frames.
 *
 *   node scripts/novaref/analysis/brackets.mjs <shot.png>... [--colour blue|yellow|red|green|any] [--corners] [--glyphs]
 *   node scripts/novaref/analysis/brackets.mjs --video rec.mp4 [--from F] [--to F] [--every N] [--colour c]
 *
 * Per shot (or frame) and colour, the best box of four glyphs that line up
 * as top-left / top-right / bottom-left / bottom-right corners:
 *   outer   the box through the glyphs' outermost pixels (x0, y0, x1, y1,
 *           inclusive) and its size w x h = x1 - x0 + 1
 *   centre  the outer box's centre; half = (w - 1) / 2, (h - 1) / 2 is the
 *           centre-to-outer-pixel distance
 *   glyph   each corner glyph's bounding box size
 *   art     the largest non-black, non-bracket blob inside the box (the
 *           target's visible sprite): its bbox, size and centre, so the box
 *           can be compared with the art and with the sprite frame
 * Off-play-area and clipped boxes are not found (a box needs all four).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const { PNG } = createRequire(import.meta.url)("pngjs");

export const PLAY_W = 636, PLAY_H = 604, CX = 318, CY = 302;

/** Colour tests for the four bracket colours seen on the original. */
export const BRACKET_COLOURS = {
    blue: (r, g, b) => b >= 120 && b > r + 80 && b > g + 30,
    yellow: (r, g, b) => r >= 170 && g >= 170 && b <= 130 && Math.abs(r - g) < 60,
    red: (r, g, b) => r >= 150 && g <= 100 && b <= 100,
    green: (r, g, b) => g >= 150 && r <= 120 && b <= 120,
    // Disabled ships (wave 8's hulks): a mid grey. Stars are grey too, but
    // single pixels; a glyph is a 5+ pixel component.
    grey: (r, g, b) => r >= 90 && r <= 225 && Math.abs(r - g) < 24 && Math.abs(g - b) < 24 && Math.abs(r - b) < 24,
};

/** Uint8Array mask (w*h) of the pixels of an RGB(A) buffer passing `test`. */
export function colourMask(data, w, h, test, channels = 4) {
    const mask = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
        const i = p * channels;
        if (test(data[i], data[i + 1], data[i + 2])) mask[p] = 1;
    }
    return mask;
}

/**
 * Connected components of `mask`, where two set pixels within `reach`
 * (Chebyshev) are connected: a corner glyph's diagonal and its L are a pixel
 * or two apart and must count as one glyph.
 */
export function components(mask, w, h, reach = 2) {
    const seen = new Uint8Array(w * h);
    const out = [];
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (!mask[start] || seen[start]) continue;
        let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
        seen[start] = 1;
        stack.push(start);
        while (stack.length) {
            const p = stack.pop();
            const x = p % w, y = (p - x) / w;
            n++; sx += x; sy += y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            for (let dy = -reach; dy <= reach; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -reach; dx <= reach; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    const q = yy * w + xx;
                    if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
                }
            }
        }
        out.push({ n, cx: sx / n, cy: sy / n, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    return out;
}

/**
 * The best box of four corner glyphs among `comps`: TL/TR share a top edge,
 * BL/BR a bottom edge, TL/BL a left edge and TR/BR a right edge (each within
 * `tol` px), and the four glyphs are about the same size. Returns null or
 * {x0, y0, x1, y1, w, h, cx, cy, halfW, halfH, glyph: {w, h}, corners, err}.
 */
export function findBox(comps, { tol = 2, maxGlyph = 26, minGlyph = 4, minN = 5 } = {}) {
    const c = comps.filter(k => k.n >= minN && k.w <= maxGlyph && k.h <= maxGlyph
        && k.w >= minGlyph && k.h >= minGlyph).slice(0, 80);
    let best = null;
    for (const tl of c) for (const br of c) {
        if (br.x1 <= tl.x1 || br.y1 <= tl.y1) continue;
        for (const tr of c) {
            if (tr === tl || tr === br) continue;
            const eTop = Math.abs(tr.y0 - tl.y0), eRight = Math.abs(tr.x1 - br.x1);
            if (eTop > tol || eRight > tol || tr.x0 <= tl.x1) continue;
            for (const bl of c) {
                if (bl === tl || bl === br || bl === tr) continue;
                const eLeft = Math.abs(bl.x0 - tl.x0), eBottom = Math.abs(bl.y1 - br.y1);
                if (eLeft > tol || eBottom > tol || bl.y0 <= tl.y1) continue;
                const ws = [tl.w, tr.w, bl.w, br.w], hs = [tl.h, tr.h, bl.h, br.h];
                const spread = Math.max(...ws) - Math.min(...ws) + Math.max(...hs) - Math.min(...hs);
                if (spread > 2 * tol + 2) continue;
                const err = eTop + eRight + eLeft + eBottom + spread;
                const x0 = Math.min(tl.x0, bl.x0), x1 = Math.max(tr.x1, br.x1);
                const y0 = Math.min(tl.y0, tr.y0), y1 = Math.max(bl.y1, br.y1);
                const area = (x1 - x0) * (y1 - y0);
                if (!best || err < best.err || (err === best.err && area > best.area)) {
                    best = { err, area, x0, y0, x1, y1, corners: { tl, tr, bl, br } };
                }
            }
        }
    }
    if (!best) return null;
    const { x0, y0, x1, y1, corners, err } = best;
    const g = Object.values(corners);
    return {
        x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1,
        cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, halfW: (x1 - x0) / 2, halfH: (y1 - y0) / 2,
        glyph: { w: Math.max(...g.map(k => k.w)), h: Math.max(...g.map(k => k.h)) },
        corners: Object.fromEntries(Object.entries(corners).map(([k, v]) =>
            [k, { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1, n: v.n }])),
        err,
    };
}

/**
 * The target's visible art inside a box: the largest component of pixels
 * brighter than `minSum` (r + g + b) that are not bracket-coloured, within
 * the box less its glyphs. {x0, y0, x1, y1, w, h, cx, cy, n} or null.
 */
export function artInBox(data, w, h, box, isBracket, { minSum = 90, channels = 4, reach = 1 } = {}) {
    const g = box.glyph;
    const bx0 = box.x0 + 1, by0 = box.y0 + 1, bx1 = box.x1 - 1, by1 = box.y1 - 1;
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bw <= 0 || bh <= 0) return null;
    const mask = new Uint8Array(bw * bh);
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
        // Leave out the glyph squares in the corners.
        const inX = x < box.x0 + g.w || x > box.x1 - g.w, inY = y < box.y0 + g.h || y > box.y1 - g.h;
        if (inX && inY) continue;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * channels;
        const r = data[i], gg = data[i + 1], b = data[i + 2];
        if (r + gg + b >= minSum && !isBracket(r, gg, b)) mask[(y - by0) * bw + (x - bx0)] = 1;
    }
    const comps = components(mask, bw, bh, reach);
    if (!comps.length) return null;
    const a = comps.reduce((p, q) => (q.n > p.n ? q : p));
    return {
        x0: a.x0 + bx0, y0: a.y0 + by0, x1: a.x1 + bx0, y1: a.y1 + by0, w: a.w, h: a.h,
        cx: (a.x0 + a.x1) / 2 + bx0, cy: (a.y0 + a.y1) / 2 + by0, n: a.n,
    };
}

/**
 * One corner glyph as text rows ('#' bracket colour, '.' anything else) and
 * its colours by count, for reading the glyph's shape off a shot.
 */
export function glyphRows(data, w, corner, isBracket, channels = 4) {
    const rows = [], colours = new Map();
    for (let y = corner.y0; y <= corner.y1; y++) {
        let s = "";
        for (let x = corner.x0; x <= corner.x1; x++) {
            const i = (y * w + x) * channels;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const on = isBracket(r, g, b);
            if (on) { const k = `${r},${g},${b}`; colours.set(k, (colours.get(k) || 0) + 1); }
            s += on ? "#" : ".";
        }
        rows.push(s);
    }
    return { rows, colours: [...colours].sort((a, b) => b[1] - a[1]) };
}

/** Every colour's box in one RGB(A) image of the play area (or a window shot). */
export function bracketsIn(data, w, h, { colours = Object.keys(BRACKET_COLOURS), channels = 4, tol } = {}) {
    const pw = Math.min(w, PLAY_W), ph = Math.min(h, PLAY_H);
    // Work on the play area only (the status bar has red and blue chrome).
    const play = new Uint8Array(pw * ph * channels);
    for (let y = 0; y < ph; y++) {
        play.set(data.subarray((y * w) * channels, (y * w + pw) * channels), y * pw * channels);
    }
    const out = [];
    for (const colour of colours) {
        const test = BRACKET_COLOURS[colour];
        const box = findBox(components(colourMask(play, pw, ph, test, channels), pw, ph), tol === undefined ? {} : { tol });
        if (!box) continue;
        const art = artInBox(play, pw, ph, box, test, { channels });
        const glyphs = Object.fromEntries(Object.entries(box.corners).map(([k, v]) =>
            [k, glyphRows(play, pw, v, test, channels)]));
        out.push({
            colour, ...box, glyphs,
            fromPlayer: { dx: box.cx - CX, dy: box.cy - CY },
            art,
            artToBox: art ? { dx: box.cx - art.cx, dy: box.cy - art.cy } : null,
        });
    }
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const colourOpt = opt("--colour", "any");
    const colours = colourOpt === "any" ? Object.keys(BRACKET_COLOURS) : colourOpt.split(",");
    const slim = b => ({
        colour: b.colour, outer: [b.x0, b.y0, b.x1, b.y1], size: [b.w, b.h], centre: [b.cx, b.cy],
        half: [b.halfW, b.halfH], glyph: [b.glyph.w, b.glyph.h], err: b.err,
        fromPlayer: b.fromPlayer, art: b.art && { bbox: [b.art.x0, b.art.y0, b.art.x1, b.art.y1], size: [b.art.w, b.art.h], centre: [b.art.cx, b.art.cy], n: b.art.n },
        artToBox: b.artToBox, corners: args.includes("--corners") ? b.corners : undefined,
        glyphs: args.includes("--glyphs") ? b.glyphs : undefined,
    });
    const video = opt("--video");
    if (video) {
        const from = Number(opt("--from", 0)), to = Number(opt("--to", 1e9)), every = Number(opt("--every", 1));
        const crop = opt("--crop", "");
        const vf = [crop ? `crop=${crop}` : null, `select='between(n\\,${from}\\,${to})*not(mod(n-${from}\\,${every}))'`].filter(Boolean).join(",");
        const r = spawnSync("ffmpeg", ["-v", "error", "-i", video, "-vf", vf, "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            { maxBuffer: 2 ** 31 - 1 });
        const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video], { encoding: "utf8" });
        let [w, h] = probe.stdout.trim().split(",").map(Number);
        if (crop) [w, h] = crop.split(":").map(Number);
        const size = w * h * 3;
        for (let k = 0; k * size < r.stdout.length; k++) {
            const frame = r.stdout.subarray(k * size, (k + 1) * size);
            const found = bracketsIn(frame, w, h, { colours, channels: 3, tol: 3 });
            console.log(JSON.stringify({ frame: from + k * every, boxes: found.map(slim) }));
        }
        return;
    }
    for (const f of args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--colour"].includes(args[i - 1])))) {
        const png = PNG.sync.read(fs.readFileSync(f));
        const found = bracketsIn(png.data, png.width, png.height, { colours });
        console.log(JSON.stringify({ shot: f, boxes: found.map(slim) }));
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
