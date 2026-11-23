#!/usr/bin/env node
/**
 * Tracks the test kit's disc hulls (solid white/red/green/blue/yellow/
 * magenta/cyan discs, kits/testkit.mjs discShip) in a window-cropped
 * novaref recording, and measures where each escort sits relative to the
 * white leader.
 *
 *  - Disc centres: centroid of each colour's pixels per frame (by hue, so
 *    h264 colour noise doesn't matter).
 *  - Leader velocity: the starfield moves opposite to the player, so the
 *    median frame-to-frame displacement of the small star dots (matched
 *    nearest-neighbour) gives the direction of travel. Parallax layers
 *    move at different rates, so only the DIRECTION is used, plus a speed
 *    estimate from the fastest (nearest) layer.
 *  - Offsets are rotated into the leader's frame: `along` (+ = ahead, along
 *    the velocity) and `across` (+ = to the left of travel, screen y down).
 *
 *   node scripts/novaref/analysis/discs.mjs <recording.mp4> [--fps 30] [--csv out.csv]
 *
 * Prints JSON: per-phase (rest / cruise) medians per escort colour, and
 * writes a per-frame CSV if asked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const W = 832, H = 604, PLAY_W = 636;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const FPS = Number(opt("--fps", 30));
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 2 ** 32 }).stdout;
const N = Math.floor(raw.length / (W * H * 3));

const COLOURS = ["white", "red", "green", "blue", "yellow", "magenta", "cyan"];
function classify(r, g, b) {
    const hi = 170, lo = 90;
    if (r > hi && g > hi && b > hi) return 0;
    if (r > hi && g < lo && b < lo) return 1;
    if (g > hi && r < lo && b < lo) return 2;
    if (b > hi && r < lo && g < lo) return 3;
    if (r > hi && g > hi && b < lo) return 4;
    if (r > hi && b > hi && g < lo) return 5;
    if (g > hi && b > hi && r < lo) return 6;
    return -1;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const rows = [];
let prevStars = null;
for (let i = 0; i < N; i++) {
    const o = i * W * H * 3;
    const sum = COLOURS.map(() => [0, 0, 0]);
    const starMask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = o + 3 * (y * W + x);
        const r = raw[p], g = raw[p + 1], b = raw[p + 2];
        const c = classify(r, g, b);
        if (c >= 0) { sum[c][0] += x; sum[c][1] += y; sum[c][2]++; }
        if (r + g + b > 300) starMask[y * W + x] = 1;
    }
    const disc = sum.map(([sx, sy, n]) => (n >= 120 ? [sx / n, sy / n, n] : null));
    // Stars: small bright components (1-12 px) away from the discs.
    const seen = new Uint8Array(W * H);
    const stars = [];
    for (let p = 0; p < W * H; p++) {
        if (!starMask[p] || seen[p]) continue;
        const st = [p]; seen[p] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++; sx += q % W; sy += (q / W) | 0;
            for (const r of [q - 1, q + 1, q - W, q + W]) if (r >= 0 && r < W * H && starMask[r] && !seen[r]) { seen[r] = 1; st.push(r); }
        }
        if (n <= 12) {
            const x = sx / n, y = sy / n;
            if (!disc.some((d) => d && Math.hypot(d[0] - x, d[1] - y) < 20)) stars.push([x, y]);
        }
    }
    let vx = NaN, vy = NaN, vmax = NaN;
    if (prevStars && stars.length) {
        const ds = [];
        for (const [x, y] of stars) {
            let best = null, bd = 12;
            for (const [px, py] of prevStars) { const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = [x - px, y - py]; } }
            if (best) ds.push(best);
        }
        if (ds.length >= 3) {
            vx = -median(ds.map((d) => d[0])); vy = -median(ds.map((d) => d[1]));
            vmax = Math.max(...ds.map((d) => Math.hypot(d[0], d[1])));
        }
    }
    prevStars = stars;
    rows.push({ i, disc, vx, vy, vmax });
}

// Smooth the velocity direction over +-5 frames.
const out = [];
for (let k = 0; k < rows.length; k++) {
    const win = rows.slice(Math.max(0, k - 5), k + 6).filter((r) => !isNaN(r.vx));
    const vx = win.length ? win.reduce((a, r) => a + r.vx, 0) / win.length : NaN;
    const vy = win.length ? win.reduce((a, r) => a + r.vy, 0) / win.length : NaN;
    const speed = Math.hypot(vx, vy);
    const lead = rows[k].disc[0];
    const rec = { i: rows[k].i, t: +(rows[k].i / FPS).toFixed(3), lead, speed: +speed.toFixed(3), vx, vy, esc: {} };
    if (lead) {
        const ux = speed > 0.3 ? vx / speed : NaN, uy = speed > 0.3 ? vy / speed : NaN;
        for (let c = 1; c < COLOURS.length; c++) {
            const d = rows[k].disc[c];
            if (!d) continue;
            const dx = d[0] - lead[0], dy = d[1] - lead[1];
            rec.esc[COLOURS[c]] = {
                dx: +dx.toFixed(1), dy: +dy.toFixed(1), dist: +Math.hypot(dx, dy).toFixed(1),
                along: isNaN(ux) ? null : +(dx * ux + dy * uy).toFixed(1),
                // left of travel (screen y points down): (uy, -ux)
                across: isNaN(ux) ? null : +(dx * uy - dy * ux).toFixed(1),
            };
        }
    }
    out.push(rec);
}
if (opt("--csv")) {
    const lines = ["t,frame,speed_px_per_frame,colour,dx,dy,dist,along,across"];
    for (const r of out) for (const [c, e] of Object.entries(r.esc)) lines.push([r.t, r.i, r.speed, c, e.dx, e.dy, e.dist, e.along, e.across].join(","));
    fs.writeFileSync(opt("--csv"), lines.join("\n") + "\n");
}
// Phases: rest = speed < 0.15 px/frame (direction undefined: report dx/dy/dist);
// cruise = speed within 10% of the run's 95th-percentile speed.
const speeds = out.map((r) => r.speed).filter((s) => !isNaN(s)).sort((a, b) => a - b);
const top = speeds[Math.floor(speeds.length * 0.95)] ?? 0;
const phase = (r) => (r.speed < 0.15 ? "rest" : r.speed > 0.9 * top ? "cruise" : "other");
const summary = {};
for (const r of out) {
    const ph = phase(r);
    for (const [c, e] of Object.entries(r.esc)) {
        const s = ((summary[ph] ??= {})[c] ??= { n: 0, dx: [], dy: [], dist: [], along: [], across: [] });
        s.n++; s.dx.push(e.dx); s.dy.push(e.dy); s.dist.push(e.dist);
        if (e.along !== null) { s.along.push(e.along); s.across.push(e.across); }
    }
}
for (const ph of Object.keys(summary)) for (const c of Object.keys(summary[ph])) {
    const s = summary[ph][c];
    summary[ph][c] = { frames: s.n, dx: median(s.dx), dy: median(s.dy), dist: median(s.dist),
        along: s.along.length ? median(s.along) : null, across: s.across.length ? median(s.across) : null };
}
console.log(JSON.stringify({ ok: true, file, frames: N, top_star_speed_px_per_frame: +top.toFixed(3), phases: summary }));
