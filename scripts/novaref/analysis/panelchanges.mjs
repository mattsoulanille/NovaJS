#!/usr/bin/env node
/**
 * Ship-cap rig (kits/w60_shipcap.mjs): every change of the secondary
 * weapon panel's text (window x 740-819, y 300-315, e.g. "SC Bay - 45")
 * in a window-cropped recording is one launch (or one refill); prints
 * each change with its frame and pts, plus the green Kit Bay Disc pixels
 * in the play area, and a line every 150 frames.
 *
 *   node scripts/novaref/analysis/panelchanges.mjs <recording.mp4>
 */
import { spawn, spawnSync } from "node:child_process";

const file = process.argv[2];
const W = 832, H = 604, FRAME = W * H * 3;
const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time",
    "-of", "csv=p=0", file], { maxBuffer: 1 << 28 }).stdout.toString().trim().split("\n").map((s) => parseFloat(s));
let buf = Buffer.alloc(0), i = 0, prev = null, changes = 0;
const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
ff.stdout.on("data", (c) => {
    buf = buf.length ? Buffer.concat([buf, c]) : c;
    while (buf.length >= FRAME) { frame(buf.subarray(0, FRAME)); buf = buf.subarray(FRAME); i++; }
});
function frame(f) {
    let s = "";
    for (let y = 300; y < 316; y++) for (let x = 740; x < 820; x++) s += f[3 * (y * W + x)] > 160 ? "1" : "0";
    let green = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < 636; x++) {
        const p = 3 * (y * W + x);
        if (f[p + 1] > 150 && f[p] < 100 && f[p + 2] < 100) green++;
    }
    const t = (pts[i] ?? NaN).toFixed(2);
    if (prev !== null && s !== prev) console.log(`change ${++changes} frame ${i} t ${t} green ${green}`);
    prev = s;
    if (i % 150 === 0) console.log(`frame ${i} t ${t} green ${green}`);
}
