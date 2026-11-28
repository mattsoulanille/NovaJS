#!/usr/bin/env node
/**
 * Beam-cap rig (kits/w60_beamcap.mjs): reads a window-cropped recording
 * frame by frame and counts the player's green BC Spray spokes (pure
 * 0x00FF00 beams from the play area's centre at random angles), and
 * measures the other beams by colour.
 *
 *   node scripts/novaref/analysis/beamcap.mjs <recording.mp4> [--cx 318 --cy 302]
 *        [--r1 120 --r2 190] [--json out.json] [--every 1]
 *
 * A spoke is a run of green on the circle of radius r1 AND within 1.2 deg
 * on the circle r2 (both sampled in 0.25 deg bins, +-2 px radially), so
 * stars and the HUD never count. Spokes are tracked across frames by
 * angle (0.7 deg): a birth is an angle first seen, a death is a spoke
 * missing for 4 frames. Two spokes closer than about 0.7 deg read as one
 * (a hidden birth): the per-frame count is a LOWER bound, and the birth
 * times show the firing cadence and when it stops.
 *
 * Prints one line per frame: index, pts (s), spokes, births so far,
 * deaths so far, red px (BC Probe, wëap 337, past r = 240 straight up),
 * blue px (BC Hidden, wëap 338, anywhere in the play area), magenta px
 * (the NPC beam, wëap 333 overridden). --json writes every birth and
 * death with its frame and pts.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const W = 832, H = 604, PLAY_W = 636;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);
const sopt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const CX = opt("--cx", 318), CY = opt("--cy", 302), R1 = opt("--r1", 120), R2 = opt("--r2", 190);
const every = opt("--every", 1);
const jsonOut = sopt("--json");

const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
    "-of", "csv=p=0", file], { maxBuffer: 1 << 28 }).stdout.toString().trim().split("\n").map((s) => parseFloat(s));

const BINS = 1440;
const cosT = new Float64Array(BINS), sinT = new Float64Array(BINS);
for (let b = 0; b < BINS; b++) { const a = (b + 0.5) * 2 * Math.PI / BINS; cosT[b] = Math.cos(a); sinT[b] = Math.sin(a); }
const green = (f, x, y) => {
    if (x < 0 || y < 0 || x >= PLAY_W || y >= H) return false;
    const p = 3 * (y * W + x);
    return f[p + 1] > 150 && f[p] < 110 && f[p + 2] < 110;
};
function ringRuns(f, R) {
    const hit = new Uint8Array(BINS);
    for (let b = 0; b < BINS; b++) {
        for (let dr = -2; dr <= 2 && !hit[b]; dr++) {
            const x = Math.round(CX + (R + dr) * cosT[b]), y = Math.round(CY - (R + dr) * sinT[b]);
            if (green(f, x, y)) hit[b] = 1;
        }
    }
    // Runs with gaps of at most one bin, wrapping round.
    const runs = [];
    let start = -1, last = -10;
    for (let b = 0; b < BINS; b++) {
        if (!hit[b]) continue;
        if (b - last > 2) { if (start >= 0) runs.push([start, last]); start = b; }
        last = b;
    }
    if (start >= 0) runs.push([start, last]);
    if (runs.length > 1 && runs[0][0] <= 1 && runs[runs.length - 1][1] >= BINS - 2) {
        const tail = runs.pop(); runs[0] = [tail[0] - BINS, runs[0][1]];
    }
    return runs.map(([a, b]) => (((a + b) / 2 + 0.5) * 360 / BINS + 360) % 360);
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function countColour(f, test, x0 = 0, x1 = PLAY_W, y0 = 0, y1 = H) {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = 3 * (y * W + x); if (test(f[p], f[p + 1], f[p + 2])) n++; }
    return n;
}

const tracks = []; // {a, born, bornT, last}
const events = [];
let births = 0, deaths = 0, idx = 0;
const FRAME = W * H * 3;
let buf = Buffer.alloc(0);
const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
ff.stdout.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (buf.length >= FRAME) {
        const f = buf.subarray(0, FRAME);
        processFrame(f, idx++);
        buf = buf.subarray(FRAME);
    }
});
ff.on("close", () => {
    for (const t of tracks) if (t.last >= 0) events.push({ kind: "alive-at-end", a: +t.a.toFixed(2), born: t.born, bornT: t.bornT });
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ file, CX, CY, R1, R2, pts, events }, null, 1));
});
function processFrame(f, i) {
    const t = pts[i] ?? NaN;
    const a1 = ringRuns(f, R1), a2 = ringRuns(f, R2);
    const spokes = a1.filter((a) => a2.some((b) => angDiff(a, b) < 1.2));
    for (const a of spokes) {
        let best = null, bd = 0.7;
        for (const tr of tracks) { const d = angDiff(tr.a, a); if (tr.last >= 0 && d < bd) { bd = d; best = tr; } }
        if (best) { best.a = a; best.last = i; }
        else { tracks.push({ a, born: i, bornT: t, last: i }); births++; events.push({ kind: "birth", a: +a.toFixed(2), frame: i, t }); }
    }
    for (const tr of tracks) {
        if (tr.last >= 0 && i - tr.last >= 4) {
            deaths++; events.push({ kind: "death", a: +tr.a.toFixed(2), frame: tr.last + 1, t: pts[tr.last + 1], born: tr.born, bornT: tr.bornT });
            tr.last = -1;
        }
    }
    if (i % every) return;
    const red = countColour(f, (r, g, b) => r > 150 && g < 90 && b < 90, CX - 6, CX + 7, 0, Math.max(0, CY - 240));
    const blue = countColour(f, (r, g, b) => b > 150 && r < 90 && g < 90);
    const mag = countColour(f, (r, g, b) => r > 150 && b > 150 && g < 90);
    console.log(`${i}\t${t.toFixed(3)}\t${spokes.length}\t${births}\t${deaths}\t${red}\t${blue}\t${mag}`);
}
