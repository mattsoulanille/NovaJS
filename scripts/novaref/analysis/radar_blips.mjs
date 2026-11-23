#!/usr/bin/env node
/**
 * Radar blips per frame in a window-cropped novaref recording (832x604).
 * The radar is the black box at the top of the status bar, centred on the
 * player (window (734, 96)); stellars are static dots, ships are coloured
 * dots that move. Used for "where did that ship go": a blip that vanishes on
 * a stellar's dot landed there, one that vanishes elsewhere jumped out (or
 * left the radar's reach, which then shows as a vanish at the box edge).
 *
 *   node scripts/novaref/analysis/radar_blips.mjs <recording.mp4> [--every 10] [--from F] [--to F]
 *       [--colour yellow|red|green|any] [--out blips.json]
 *
 * Prints one JSON line per sampled frame: {f, t, blips: [{x, y, rgb, n}]},
 * x/y in radar pixels relative to the player (+x right, +y down). Blips
 * are 4-connected pixels brighter than 50 in any channel; the player's own
 * ring (within 4 px of the centre) is left out. Use --colour to keep only
 * blips whose mean colour is that hue (stellar dots are grey or pale).
 * The scale is about 33 world px per radar px in Kit Range (the 600 px
 * marker grid is 18 radar px), see docs/reference_experiments.md.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const W = 832, H = 604;
export const RADAR = { x0: 646, y0: 8, x1: 822, y1: 182, cx: 734, cy: 96 };

/** Hue class of a mean [r, g, b] (0-255). */
export function hueOf([r, g, b]) {
    // Ratios, not levels: a 1-pixel blip is dim after h264.
    const big = (a, x, y) => a > 1.6 * x && a > 1.6 * y;
    if (big(r, g, b)) return "red";
    if (big(g, r, b)) return "green";
    if (big(b, r, g)) return "blue";
    if (r > 1.6 * b && g > 1.6 * b) return "yellow";
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx - mn < 0.3 * mx ? "grey" : "other";
}

/** Connected blips in an RGB frame (Buffer, W*H*3). */
export function blipsIn(rgb, w = W, box = RADAR) {
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const on = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const p = ((box.y0 + y) * w + box.x0 + x) * 3;
        if (Math.max(rgb[p], rgb[p + 1], rgb[p + 2]) > 50) on[y * bw + x] = 1;
    }
    const seen = new Uint8Array(bw * bh), out = [];
    for (let s = 0; s < bw * bh; s++) {
        if (!on[s] || seen[s]) continue;
        const st = [s]; seen[s] = 1;
        let n = 0, sx = 0, sy = 0, sr = 0, sg = 0, sb = 0;
        while (st.length) {
            const q = st.pop(), qx = q % bw, qy = (q - qx) / bw;
            const p = ((box.y0 + qy) * w + box.x0 + qx) * 3;
            n++; sx += qx; sy += qy; sr += rgb[p]; sg += rgb[p + 1]; sb += rgb[p + 2];
            for (const nb of [qx > 0 ? q - 1 : -1, qx < bw - 1 ? q + 1 : -1, qy > 0 ? q - bw : -1, qy < bh - 1 ? q + bw : -1]) {
                if (nb >= 0 && on[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb); }
            }
        }
        const x = box.x0 + sx / n - box.cx, y = box.y0 + sy / n - box.cy;
        if (Math.hypot(x, y) <= 4) continue; // the player's ring
        const c = [sr / n, sg / n, sb / n].map(Math.round);
        out.push({ x: +x.toFixed(1), y: +y.toFixed(1), rgb: c, hue: hueOf(c), n });
    }
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: radar_blips.mjs <recording.mp4> [--every 10] [--colour yellow] [--out blips.json]"); process.exit(2); }
    const every = Number(opt("--every", 10)), from = Number(opt("--from", 0)), to = Number(opt("--to", Infinity));
    const colour = opt("--colour", "any");
    // Decode only the radar box: whole RGB frames of a 3-minute recording
    // overflow node's 4 GB pipe buffer (and were silently cut short).
    // Even sizes: ffmpeg rounds a yuv420 crop down to even dimensions.
    const cw = (RADAR.x1 - RADAR.x0 + 2) & ~1, ch = (RADAR.y1 - RADAR.y0 + 2) & ~1;
    const box = { x0: 0, y0: 0, x1: RADAR.x1 - RADAR.x0, y1: RADAR.y1 - RADAR.y0, cx: RADAR.cx - RADAR.x0, cy: RADAR.cy - RADAR.y0 };
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `crop=${cw}:${ch}:${RADAR.x0}:${RADAR.y0}`,
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2 ** 32 - 1 }).stdout;
    const fsz = cw * ch * 3;
    const N = Math.floor(raw.length / fsz);
    const rows = [];
    for (let f = from; f < Math.min(N, to + 1); f += every) {
        let b = blipsIn(raw.subarray(f * fsz, (f + 1) * fsz), cw, box);
        if (colour !== "any") b = b.filter((x) => x.hue === colour);
        rows.push({ f, t: +(f / 30).toFixed(2), blips: b });
    }
    if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify(rows) + "\n");
    if (args.includes("--tracks")) {
        for (const t of linkTracks(rows, { gap: Number(opt("--gap", 3)), reach: Number(opt("--reach", 8)) })) console.log(JSON.stringify(t));
        return;
    }
    for (const r of rows) console.log(JSON.stringify(r));
}

/**
 * Links blips across sampled rows into tracks (nearest neighbour within
 * `reach` radar px, a track survives up to `gap` empty samples: dim
 * 1-pixel blips flicker after h264). Tracks that never move more than 1.5
 * px are stellars and are dropped. Each track: first/last sample time and
 * position, the hues seen, and its speed over its last 3 samples (radar
 * px per second; a jump-out accelerates hard before vanishing).
 */
export function linkTracks(rows, { gap = 3, reach = 8 } = {}) {
    const open = [], done = [];
    for (const [k, r] of rows.entries()) {
        const free = r.blips.slice();
        for (const t of open) {
            const last = t.pts.at(-1);
            let best = -1, bd = Infinity;
            free.forEach((b, i) => { const d = Math.hypot(b.x - last.x, b.y - last.y); if (d < bd) { bd = d; best = i; } });
            if (best >= 0 && bd <= reach * (k - t.lastK)) {
                const b = free.splice(best, 1)[0];
                t.pts.push({ t: r.t, x: b.x, y: b.y }); t.hues.add(b.hue); t.lastK = k;
            }
        }
        for (let i = open.length - 1; i >= 0; i--) if (k - open[i].lastK > gap) done.push(...open.splice(i, 1));
        for (const b of free) open.push({ pts: [{ t: r.t, x: b.x, y: b.y }], hues: new Set([b.hue]), lastK: k });
    }
    done.push(...open);
    return done.filter((t) => {
        const p0 = t.pts[0];
        return t.pts.some((p) => Math.hypot(p.x - p0.x, p.y - p0.y) > 1.5);
    }).map((t) => {
        const a = t.pts.at(-4) ?? t.pts[0], z = t.pts.at(-1);
        return { from: t.pts[0].t, to: z.t, start: [t.pts[0].x, t.pts[0].y], end: [z.x, z.y], hues: [...t.hues],
            samples: t.pts.length, end_speed: z.t > a.t ? +(Math.hypot(z.x - a.x, z.y - a.y) / (z.t - a.t)).toFixed(1) : null };
    }).sort((p, q) => p.from - q.from);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
