#!/usr/bin/env node
/**
 * Times every change of a small, otherwise static screen region in a
 * window-cropped novaref recording. Pointed at the target panel's
 * "Armor: NN%" digits, each change is one hit on the target (the J-series
 * targets have armor 100 and take 1 damage per missile), so this gives the
 * hit times without reading the digits.
 *
 *   node scripts/novaref/analysis/panel_hits.mjs <recording.mp4> \
 *       [--rect 696,424,34,16] [--threshold 6] [--settle 3] [--events recording.events.json]
 *
 * --rect     x,y,w,h in window pixels (default: the target panel's armor digits)
 * --threshold mean absolute grey difference that counts as a change
 * --settle   changed frames closer than this merge into one change (h264
 *            takes a frame or two to settle after the digits redraw)
 * --events   recording.events.json from the run: the output then also gives
 *            each change's time relative to the first `down` and last `up`
 *            event (the trigger hold in jam_fire.json).
 *
 * Prints one JSON object: {changes: [{frame, t}], count, ...}. Read the
 * first and last values by eye from the run's shots; the count is the number
 * of digit redraws between them.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Mean absolute difference per frame between consecutive grey crops. */
export function frameDiffs(raw, size) {
    const n = Math.floor(raw.length / size);
    const out = new Float64Array(n);
    for (let i = 1; i < n; i++) {
        let s = 0;
        const a = (i - 1) * size, b = i * size;
        for (let k = 0; k < size; k++) s += Math.abs(raw[b + k] - raw[a + k]);
        out[i] = s / size;
    }
    return out;
}

/**
 * Frames where the diff crosses `threshold`, merging runs of changed frames
 * separated by fewer than `settle` frames into one change (its first frame).
 */
export function changeFrames(diffs, threshold, settle = 3) {
    const out = [];
    let last = -Infinity;
    for (let i = 1; i < diffs.length; i++) {
        if (diffs[i] <= threshold) continue;
        if (i - last >= settle) out.push(i);
        last = i;
    }
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) {
        console.error("usage: panel_hits.mjs <recording.mp4> [--rect x,y,w,h] [--threshold 6] [--settle 3] [--events f.json]");
        process.exit(2);
    }
    const [x, y, w, h] = opt("--rect", "696,424,34,16").split(",").map(Number);
    const threshold = Number(opt("--threshold", 6));
    const settle = Number(opt("--settle", 3));
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { maxBuffer: 2 ** 31 }).stdout;
    const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout.trim().split("\n").map((l) => parseFloat(l));
    const diffs = frameDiffs(raw, w * h);
    const frames = changeFrames(diffs, threshold, settle);
    const changes = frames.map((f) => ({ frame: f, t: +pts[f].toFixed(3), diff: +diffs[f].toFixed(1) }));
    const result = { ok: true, file, rect: [x, y, w, h], threshold, settle, frames: diffs.length, count: changes.length, changes };
    const evFile = opt("--events", null);
    if (evFile) {
        const ev = JSON.parse(fs.readFileSync(evFile, "utf8")).events;
        const down = ev.find((e) => e.kind === "down");
        const up = [...ev].reverse().find((e) => e.kind === "up");
        if (down && up) {
            result.trigger = { down_t: down.video_t, up_t: up.video_t, held_s: +(up.video_t - down.video_t).toFixed(3) };
            for (const c of changes) {
                c.since_down = +(c.t - down.video_t).toFixed(3);
                c.since_up = +(c.t - up.video_t).toFixed(3);
            }
            const first = changes.find((c) => c.since_down > 0);
            result.first_hit_after_down_s = first ? first.since_down : null;
            result.after_up = changes.filter((c) => c.since_up > 0).map((c) => c.since_up);
        }
    }
    console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
