#!/usr/bin/env node
/**
 * When is an overlay on screen? Counts the bright pixels in a window rect
 * per frame of a window-cropped novaref recording (832x604) and reports the
 * frames where that count crosses a threshold: an overlay with white text
 * (the escort command panel, the `h` minimap) turns a dark patch of space
 * "lit". Every transition is given relative to the key events of the run
 * (recording.events.json) so a close can be timed from the press that
 * opened the panel.
 *
 *   node scripts/novaref/analysis/region_lit.mjs <recording.mp4> [--rect 20,170,150,95]
 *       [--min 60] [--level 150] [--events recording.events.json]
 *
 * --rect   x,y,w,h (default: the escort panel's rows, E-view layout)
 * --level  grey level that counts as bright (white text, not stars' dim dots)
 * --min    bright pixels needed to call the rect "lit" (stars give a few)
 *
 * Prints one JSON object: {transitions: [{frame, t, lit}], events: [...]}.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Frames where `lit(count)` flips, given per-frame counts. */
export function litTransitions(counts, min) {
    const out = [];
    let prev = null;
    counts.forEach((c, f) => {
        const lit = c >= min;
        if (lit !== prev) out.push({ frame: f, lit });
        prev = lit;
    });
    return out;
}

function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: region_lit.mjs <recording.mp4> [--rect x,y,w,h] [--events ...]"); process.exit(2); }
    let [x, y, w, h] = opt("--rect", "20,170,150,95").split(",").map(Number);
    w += w & 1; h += h & 1; // ffmpeg rounds yuv420 crops to even sizes
    const level = Number(opt("--level", 150)), min = Number(opt("--min", 60));
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { maxBuffer: 2 ** 32 - 1 }).stdout;
    const n = Math.floor(raw.length / (w * h));
    const counts = [];
    for (let f = 0; f < n; f++) {
        let c = 0;
        for (let k = f * w * h; k < (f + 1) * w * h; k++) if (raw[k] > level) c++;
        counts.push(c);
    }
    const ev = opt("--events") ? JSON.parse(fs.readFileSync(opt("--events"), "utf8")).events
        .filter((e) => e.kind !== "shot").map((e) => ({ frame: e.frame, kind: e.kind, what: e.what })) : [];
    const transitions = litTransitions(counts, min).map((t) => ({ ...t, t: +(t.frame / 30).toFixed(2) }));
    console.log(JSON.stringify({ file, frames: n, transitions, events: ev }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
