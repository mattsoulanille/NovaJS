#!/usr/bin/env node
/**
 * Where is the planet (or another big sprite) relative to the player? The
 * player is always drawn at the centre of the play area (318, 302) in a
 * window shot, so the offset of the largest bright connected blob from that
 * point is the distance from the player to that object, in screen pixels
 * (= world units).
 *
 *   node scripts/novaref/analysis/blob_offset.mjs <shot.png>... [--min 400] [--exclude-centre 14]
 *
 * --min             smallest blob (pixels) to report
 * --exclude-centre  ignore pixels within this radius of the centre (the
 *                   player's own sprite) so it doesn't merge with the blob
 *
 * Prints one JSON line per shot: the largest blob's centroid, its offset and
 * distance from the centre, its pixel count and bounding box, or null.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PLAY_W = 636, CX = 318, CY = 302;

/**
 * Largest 4-connected component of `mask` (Uint8Array, w*h, 1 = set).
 * Returns {n, cx, cy, x0, y0, x1, y1} or null.
 */
export function largestBlob(mask, w, h) {
    const seen = new Uint8Array(w * h);
    let best = null;
    const stack = [];
    for (let start = 0; start < w * h; start++) {
        if (!mask[start] || seen[start]) continue;
        let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
        stack.push(start);
        seen[start] = 1;
        while (stack.length) {
            const p = stack.pop();
            const x = p % w, y = (p - x) / w;
            n++; sx += x; sy += y;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
                if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
            }
        }
        if (!best || n > best.n) best = { n, cx: sx / n, cy: sy / n, x0, y0, x1, y1 };
    }
    return best;
}

function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const min = Number(opt("--min", 400));
    const excl = Number(opt("--exclude-centre", 14));
    const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
    for (const f of files) {
        const raw = spawnSync("ffmpeg", ["-v", "error", "-i", f, "-vf", `crop=${PLAY_W}:604:0:0`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            { maxBuffer: 2 ** 28 }).stdout;
        const h = Math.floor(raw.length / PLAY_W);
        const mask = new Uint8Array(PLAY_W * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < PLAY_W; x++) {
            const dx = x - CX, dy = y - CY;
            if (dx * dx + dy * dy <= excl * excl) continue;
            if (raw[y * PLAY_W + x] > 40) mask[y * PLAY_W + x] = 1;
        }
        const b = largestBlob(mask, PLAY_W, h);
        if (!b || b.n < min) { console.log(JSON.stringify({ file: f, blob: null })); continue; }
        const dx = b.cx - CX, dy = b.cy - CY;
        console.log(JSON.stringify({ file: f, n: b.n, centroid: [+b.cx.toFixed(1), +b.cy.toFixed(1)],
            offset: [+dx.toFixed(1), +dy.toFixed(1)], distance: +Math.hypot(dx, dy).toFixed(1), bbox: [b.x0, b.y0, b.x1, b.y1] }));
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
