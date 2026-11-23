#!/usr/bin/env node
/**
 * Finds abrupt whole-frame changes (a map opening/closing, a dialog, a
 * screen switch) in a window-cropped novaref recording and prints the frame
 * index and pts of each, so the video clock can be checked against a known
 * real-time interval (e.g. `keys "m wait 20000 m"`: the remote helper sleeps
 * between the two key events, so their spacing is exact).
 *
 *   node scripts/novaref/analysis/frame_events.mjs <recording.mp4> [--threshold 12]
 */
import { spawnSync } from "node:child_process";

const W = 832, H = 604;
const args = process.argv.slice(2);
const file = args[0];
const ti = args.indexOf("--threshold");
const threshold = ti >= 0 ? Number(args[ti + 1]) : 12;
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=208:151", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 1024 * 1024 * 1024 }).stdout;
const w = 208, h = 151, N = Math.floor(raw.length / (w * h));
const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout.trim().split("\n").map((l) => parseFloat(l));
const events = [];
for (let i = 1; i < N; i++) {
    let s = 0;
    for (let k = 0; k < w * h; k++) s += Math.abs(raw[i * w * h + k] - raw[(i - 1) * w * h + k]);
    const d = s / (w * h);
    if (d > threshold) events.push({ frame: i, pts: pts[i], mean_abs_diff: +d.toFixed(1) });
}
const gaps = events.slice(1).map((e, k) => ({ from: events[k].frame, to: e.frame, frames: e.frame - events[k].frame, seconds_by_pts: +(e.pts - events[k].pts).toFixed(4) }));
console.log(JSON.stringify({ ok: true, file, frames: N, events, gaps }));
