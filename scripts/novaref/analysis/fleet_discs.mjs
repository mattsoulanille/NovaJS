#!/usr/bin/env node
/**
 * F1 for NPC fleets: tracks a disc-hull flët (white lead, red/green/blue/
 * yellow escorts; kits/testkit.mjs) in a window-cropped novaref recording
 * made by a player sitting STILL, so screen motion is world motion.
 *
 *  - Each colour's centroid per frame (one ship per colour).
 *  - The lead's velocity from its own track (central difference over
 *    +-4 frames), in px per video frame.
 *  - Each escort's offset from the lead rotated into the lead's frame:
 *    `along` (+ = ahead of the lead's motion) and `across` (+ = left of
 *    travel, screen y down).
 *
 *   node scripts/novaref/analysis/fleet_discs.mjs <recording.mp4> [--csv out.csv]
 *
 * Prints JSON with medians per escort for "moving" frames (lead speed above
 * 1.5 px/frame, about 45 px/s) split into speed bands, and the count of
 * usable frames.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const W = 832, H = 604, PLAY_W = 636;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 2 ** 32 }).stdout;
const N = Math.floor(raw.length / (W * H * 3));
const NAMES = ["white", "red", "green", "blue", "yellow"];
function classify(r, g, b) {
    const hi = 170, lo = 90;
    if (r > hi && g > hi && b > hi) return 0;
    if (r > hi && g < lo && b < lo) return 1;
    if (g > hi && r < lo && b < lo) return 2;
    if (b > hi && r < lo && g < lo) return 3;
    if (r > hi && g > hi && b < lo) return 4;
    return -1;
}
const pos = [];
for (let i = 0; i < N; i++) {
    const o = i * W * H * 3;
    const sum = NAMES.map(() => [0, 0, 0]);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = o + 3 * (y * W + x);
        const c = classify(raw[p], raw[p + 1], raw[p + 2]);
        if (c >= 0) { sum[c][0] += x; sum[c][1] += y; sum[c][2]++; }
    }
    // White also matches stars and the planet's highlights: require a
    // disc-sized blob and reject frames where white is spread out.
    pos.push(sum.map(([sx, sy, n]) => (n >= 120 && n <= 700 ? [sx / n, sy / n] : null)));
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(1) : null; };
const K = 4;
const rows = [];
for (let i = K; i < N - K; i++) {
    const a = pos[i - K][0], b = pos[i + K][0], l = pos[i][0];
    if (!a || !b || !l) continue;
    const vx = (b[0] - a[0]) / (2 * K), vy = (b[1] - a[1]) / (2 * K);
    const sp = Math.hypot(vx, vy);
    const row = { frame: i, lead_speed: +sp.toFixed(2) };
    for (let c = 1; c < NAMES.length; c++) {
        const e = pos[i][c];
        if (!e || sp < 0.2) continue;
        const dx = e[0] - l[0], dy = e[1] - l[1];
        const ux = vx / sp, uy = vy / sp;
        row[NAMES[c]] = [+(dx * ux + dy * uy).toFixed(1), +(dx * uy - dy * ux).toFixed(1)];
    }
    rows.push(row);
}
const bands = [[0.2, 1.5], [1.5, 3], [3, 5], [5, 99]];
const summary = {};
for (const [lo, hi] of bands) {
    const sel = rows.filter((r) => r.lead_speed >= lo && r.lead_speed < hi);
    const band = { frames: sel.length };
    for (const c of NAMES.slice(1)) {
        const v = sel.map((r) => r[c]).filter(Boolean);
        if (v.length) band[c] = { n: v.length, along: median(v.map((p) => p[0])), across: median(v.map((p) => p[1])) };
    }
    summary[`${lo}-${hi} px/frame`] = band;
}
const csv = opt("--csv", null);
if (csv) {
    fs.writeFileSync(csv, "frame,lead_speed," + NAMES.slice(1).flatMap((c) => [`${c}_along`, `${c}_across`]).join(",") + "\n" +
        rows.map((r) => [r.frame, r.lead_speed, ...NAMES.slice(1).flatMap((c) => r[c] ?? ["", ""])].join(",")).join("\n") + "\n");
}
const visible = pos.map((p) => NAMES.map((_, c) => (p[c] ? 1 : 0)));
console.log(JSON.stringify({
    file, frames: N, lead_visible_frames: visible.filter((v) => v[0]).length,
    usable_frames: rows.length, summary,
}, null, 1));
