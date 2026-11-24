#!/usr/bin/env node
/**
 * The magenta Kit Hulk's offset from the player, frame by frame, in a
 * window-cropped novaref recording (wave 7, the boarding speed gate). The
 * player is always drawn at the play-area centre (318, 302); the hulk is the
 * largest magenta component (loops/board.mjs isMagenta), which the player's
 * own sprite never is, so it is found even while the two overlap (unlike
 * planet_track.mjs, which has to blank the centre). Each `b` press gets the
 * offset in the frame the game read it (stamp + --latency, default 4.5).
 *
 *   node scripts/novaref/analysis/magenta_track.mjs <recording.mp4> --from F --to F
 *       [--events recording.events.json] [--key b] [--latency 4.5]
 *
 * Prints {track: [{f, x, y, d, n}], speed_px_per_frame, presses: [{frame, d, o}]}.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { findColour, isMagenta, CX, CY } from "../loops/board.mjs";

const W = 832, H = 604;

/** {x, y, n} of the largest magenta blob in a raw RGB frame, or null. */
export function magentaIn(rgb) {
    const data = Buffer.alloc(W * H * 4);
    for (let p = 0, q = 0; q < rgb.length; p += 4, q += 3) {
        data[p] = rgb[q]; data[p + 1] = rgb[q + 1]; data[p + 2] = rgb[q + 2]; data[p + 3] = 255;
    }
    return findColour({ width: W, height: H, data }, isMagenta, 20);
}

function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const from = Number(opt("--from")), to = Number(opt("--to"));
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", args[0], "-vf", `select=between(n\\,${from}\\,${to})`, "-vsync", "0",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2 ** 32 - 1 }).stdout;
    const N = Math.floor(raw.length / (W * H * 3));
    const track = [];
    for (let k = 0; k < N; k++) {
        const m = magentaIn(raw.subarray(k * W * H * 3, (k + 1) * W * H * 3));
        if (m) track.push({ f: from + k, x: +(m.x - CX).toFixed(1), y: +(m.y - CY).toFixed(1), d: +Math.hypot(m.x - CX, m.y - CY).toFixed(1), n: m.n });
    }
    // Speed: median frame-to-frame displacement over the track.
    const steps = track.slice(1).map((t, i) => Math.hypot(t.x - track[i].x, t.y - track[i].y) / (t.f - track[i].f)).sort((a, b) => a - b);
    const speed = steps.length ? +steps[steps.length >> 1].toFixed(3) : null;
    const latency = Number(opt("--latency", 4.5)), key = opt("--key", "b");
    const ev = opt("--events") ? JSON.parse(fs.readFileSync(opt("--events"), "utf8")).events : [];
    const presses = ev.filter((e) => e.kind === "press" && e.what === key && e.frame >= from && e.frame <= to).map((e) => {
        const at = Math.round(e.frame + latency);
        const t = track.find((r) => r.f === at);
        return { frame: e.frame, d: t?.d ?? null, o: t ? [t.x, t.y] : null };
    });
    console.log(JSON.stringify({ frames: N, speed_px_per_frame: speed, presses, track }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
