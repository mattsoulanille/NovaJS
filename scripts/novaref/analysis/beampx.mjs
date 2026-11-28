#!/usr/bin/env node
/**
 * Beam-cap rig (kits/w60_beamcap.mjs), pixel count: the original redraws
 * every BC Spray beam at a NEW random angle each frame (its Inaccuracy is
 * re-rolled per frame, wave 60), so spokes can't be tracked; count them by
 * their green pixels instead. Each spoke of the 230 px, 1 px-core beam
 * puts a fixed number of core pixels in the annulus r1..r2 around the
 * play area's centre, and spokes from one centre overlap only when almost
 * parallel, so beams = green px / px-per-beam (calibrate on the first
 * frames, where the angular count is exact).
 *
 *   node scripts/novaref/analysis/beampx.mjs <recording.mp4> [--r1 60 --r2 225] [--cx 318 --cy 302]
 *
 * Prints: frame, pts, green core px in the annulus, red px, blue px,
 * magenta px (play area), and the angular spoke counts on r = 140 and r = 200 (runs of
 * green in 0.25 deg bins, +-2 px radially, gaps of one bin bridged).
 */
import { spawn, spawnSync } from "node:child_process";

const W = 832, H = 604, PLAY_W = 636;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const CX = opt("--cx", 318), CY = opt("--cy", 302), R1 = opt("--r1", 60), R2 = opt("--r2", 225);
const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
    "-of", "csv=p=0", file], { maxBuffer: 1 << 28 }).stdout.toString().trim().split("\n").map((s) => parseFloat(s));
const annulus = [];
for (let y = Math.max(0, CY - R2); y <= Math.min(H - 1, CY + R2); y++) for (let x = Math.max(0, CX - R2); x <= Math.min(PLAY_W - 1, CX + R2); x++) {
    const d = Math.hypot(x - CX, y - CY);
    if (d >= R1 && d <= R2) annulus.push(y * W + x);
}
const BINS = 1440;
// h264 4:2:0 smears a 1 px pure-green core: test green DOMINANCE, not purity.
const isGreen = (f, p) => f[p + 1] > 90 && f[p + 1] > f[p] + 50 && f[p + 1] > f[p + 2] + 50;
function spokes(f, R) {
    const hit = new Uint8Array(BINS);
    for (let b = 0; b < BINS; b++) {
        const a = (b + 0.5) * 2 * Math.PI / BINS;
        for (let dr = -2; dr <= 2 && !hit[b]; dr++) { const xx = Math.round(CX + (R + dr) * Math.cos(a)), yy = Math.round(CY - (R + dr) * Math.sin(a)); const q = 3 * (yy * W + xx); if (isGreen(f, q)) hit[b] = 1; }
    }
    let n = 0;
    for (let b = 0; b < BINS; b++) if (hit[b] && !hit[(b + BINS - 1) % BINS] && !hit[(b + BINS - 2) % BINS]) n++;
    return n;
}
const FRAME = W * H * 3;
let buf = Buffer.alloc(0), idx = 0;
const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
ff.stdout.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= FRAME) { frame(buf.subarray(0, FRAME), idx++); buf = buf.subarray(FRAME); }
});
function frame(f, i) {
    let g = 0;
    for (const q of annulus) { const p = 3 * q; if (isGreen(f, p)) g++; }
    let red = 0, blue = 0, mag = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = 3 * (y * W + x), r = f[p], gg = f[p + 1], b = f[p + 2];
        if (r > 90 && b > 90 && r > gg + 50 && b > gg + 50) mag++;
        else if (r > 90 && r > gg + 50 && r > b + 50) red++;
        else if (b > 90 && b > r + 50 && b > gg + 50) blue++;
    }
    console.log(`${i}\t${(pts[i] ?? NaN).toFixed(3)}\t${g}\t${red}\t${blue}\t${mag}\t${spokes(f, 140)}\t${spokes(f, 200)}`);
}
