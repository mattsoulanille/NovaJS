#!/usr/bin/env node
/**
 * Disc-hull positions in ONE window screenshot (832x604 PNG): for each kit
 * disc colour, the largest connected component of that colour in the play
 * area, its centroid, pixel count and equivalent diameter, and its
 * distance from the white disc (the leader). Exact where the recording
 * tracker (discs.mjs) is noisy: no h264 blur, and components rather than a
 * per-colour centroid, so stars and planet highlights don't pull the
 * white centroid.
 *
 *   node scripts/novaref/analysis/disc_shot.mjs <shot.png> [more.png ...]
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const { PNG } = createRequire(import.meta.url)("pngjs");
const PLAY_W = 636;
const COLOURS = {
    white: (r, g, b) => r > 200 && g > 200 && b > 200,
    red: (r, g, b) => r > 200 && g < 60 && b < 60,
    green: (r, g, b) => g > 200 && r < 60 && b < 60,
    blue: (r, g, b) => b > 200 && r < 60 && g < 60,
    yellow: (r, g, b) => r > 200 && g > 200 && b < 60,
    magenta: (r, g, b) => r > 200 && b > 200 && g < 60,
    cyan: (r, g, b) => g > 200 && b > 200 && r < 60,
};

function largest(png, test) {
    const { width: W, height: H, data } = png;
    const mask = new Uint8Array(PLAY_W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const i = (y * W + x) * 4;
        if (test(data[i], data[i + 1], data[i + 2])) mask[y * PLAY_W + x] = 1;
    }
    let best = null;
    const seen = new Uint8Array(mask.length);
    for (let s = 0; s < mask.length; s++) {
        if (!mask[s] || seen[s]) continue;
        const st = [s]; seen[s] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++;
            const qx = q % PLAY_W, qy = (q / PLAY_W) | 0; sx += qx; sy += qy;
            for (const r of [q - 1, q + 1, q - PLAY_W, q + PLAY_W]) {
                if (r >= 0 && r < mask.length && mask[r] && !seen[r] && Math.abs((r % PLAY_W) - qx) <= 1) { seen[r] = 1; st.push(r); }
            }
        }
        if (!best || n > best.n) best = { x: sx / n, y: sy / n, n };
    }
    return best && best.n >= 40 ? best : null;
}

for (const file of process.argv.slice(2)) {
    const png = PNG.sync.read(fs.readFileSync(file));
    const found = {};
    for (const [c, test] of Object.entries(COLOURS)) {
        const b = largest(png, test);
        if (b) found[c] = { x: +b.x.toFixed(1), y: +b.y.toFixed(1), px: b.n, diameter: +(2 * Math.sqrt(b.n / Math.PI)).toFixed(1) };
    }
    const w = found.white;
    if (w) for (const [c, v] of Object.entries(found)) if (c !== "white") v.dist_from_white = +Math.hypot(v.x - w.x, v.y - w.y).toFixed(1);
    console.log(JSON.stringify({ file, discs: found }));
}
