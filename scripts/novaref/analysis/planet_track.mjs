#!/usr/bin/env node
/**
 * Where was the planet at each key press? For the U9 landing-range runs
 * (scenarios/land_range.json): the player is always drawn at the play-area
 * centre (318, 302), so the planet's centre offset from that point is the
 * ship-to-planet distance. The planet is the largest bright blob in the play
 * area; when it is clipped by the play-area edge its centre is still found
 * from the unclipped side:
 *
 *  - on an axis where the blob touches an edge, centre = the free edge
 *    -/+ D/2, D being the planet's visible size on that axis, measured in
 *    the first recorded frames (the player starts on the planet, so it is
 *    whole there);
 *  - on an axis where it doesn't, centre = the middle of the extent (a
 *    round sprite cut by a vertical line still spans symmetrically in y).
 *
 * The approach leg flies at a constant velocity, so a least-squares line
 * through the per-frame centres over --from..--to smooths them; each press
 * gets both the raw distance (in its stamped frame) and the fitted one
 * --latency frames later (default 4.5, when the game reads the key).
 * Each press also gets `msg`, an id for the status-line text 8 frames
 * after it (--msg-dir writes msg-<id>.png crops to read them), or
 * "landed".
 *
 *   node scripts/novaref/analysis/planet_track.mjs <recording.mp4> --events recording.events.json \
 *       [--key l] [--from F] [--to F] [--size-frames 0,10] [--threshold 40] [--latency 4.5]
 *       [--msg-dir dir] [--every N] [--out track.json]
 *
 * Also gives "land_frame", the first frame showing the spaceport (one blob
 * over 400x400 px, or more than half the play area bright), and
 * "landed_press", the last press before it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { largestBlob } from "./blob_offset.mjs";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302;
/** The status-line message strip [x, y, w, h] and when to read it after a press. */
const MSG = [20, 543, 460, 20], MSG_DELAY = 8;
/** Half-width (frames) of the central difference for a press's speed `v`. */
const SPAN = 3;

/**
 * Centre of a blob's bbox [x0, y0, x1, y1] given the planet's whole size
 * [dw, dh], correcting axes where the bbox touches the play-area edge.
 * Returns null when both edges of an axis are clipped.
 */
export function clippedCentre(bbox, size, playW = PLAY_W, playH = H) {
    const [x0, y0, x1, y1] = bbox;
    const axis = (a0, a1, d, max) => {
        const lo = a0 <= 0, hi = a1 >= max - 1;
        if (lo && hi) return null;
        if (hi) return a0 + (d - 1) / 2;
        if (lo) return a1 - (d - 1) / 2;
        return (a0 + a1) / 2;
    };
    const cx = axis(x0, x1, size[0], playW), cy = axis(y0, y1, size[1], playH);
    return cx === null || cy === null ? null : [cx, cy];
}

/** Least-squares line v = a + b*t over [t, v] pairs. */
export function fitLine(pts) {
    const n = pts.length;
    if (n < 2) return null;
    let st = 0, sv = 0, stt = 0, stv = 0;
    for (const [t, v] of pts) { st += t; sv += v; stt += t * t; stv += t * v; }
    const den = n * stt - st * st;
    if (!den) return null;
    const b = (n * stv - st * sv) / den, a = (sv - b * st) / n;
    return { a, b, at: (t) => a + b * t };
}

function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: planet_track.mjs <recording.mp4> --events recording.events.json [...]"); process.exit(2); }
    const thr = Number(opt("--threshold", 40));
    const key = opt("--key", "l");
    const latency = Number(opt("--latency", 4.5));
    const excl = Number(opt("--exclude-centre", 16));
    const [s0, s1] = opt("--size-frames", "0,10").split(",").map(Number);
    const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { maxBuffer: 2 ** 32 - 1 }).stdout;
    const N = Math.floor(raw.length / (W * H));
    const frames = [];
    for (let f = 0; f < N; f++) {
        const mask = new Uint8Array(PLAY_W * H);
        let bright = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
            const v = raw[f * W * H + y * W + x];
            if (v > thr) bright++;
            const dx = x - CX, dy = y - CY;
            if (dx * dx + dy * dy <= excl * excl) continue;
            if (v > thr) mask[y * PLAY_W + x] = 1;
        }
        const b = largestBlob(mask, PLAY_W, H);
        frames.push({ f, bright: bright / (PLAY_W * H), bbox: b && b.n >= 60 ? [b.x0, b.y0, b.x1, b.y1] : null, n: b?.n ?? 0 });
    }
    // The planet's whole size from the first frames (player on the planet).
    const sizes = frames.slice(s0, s1 + 1).filter((r) => r.bbox).map((r) => [r.bbox[2] - r.bbox[0] + 1, r.bbox[3] - r.bbox[1] + 1]);
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const size = opt("--size") ? opt("--size").split(",").map(Number) : [med(sizes.map((s) => s[0])), med(sizes.map((s) => s[1]))];
    // The spaceport (landed) fills the play area with one huge blob.
    const isPort = (r) => r.bright > 0.5 || (r.bbox && r.bbox[2] - r.bbox[0] > 400 && r.bbox[3] - r.bbox[1] > 400);
    for (const r of frames) r.c = r.bbox && !isPort(r) ? clippedCentre(r.bbox, size) : null;
    const from = Number(opt("--from", 0)), to = Number(opt("--to", N - 1));
    const seg = frames.filter((r) => r.f >= from && r.f <= to && r.c);
    const fx = fitLine(seg.map((r) => [r.f, r.c[0]])), fy = fitLine(seg.map((r) => [r.f, r.c[1]]));
    const ev = opt("--events") ? JSON.parse(fs.readFileSync(opt("--events"), "utf8")).events : [];
    const presses = ev.filter((e) => e.kind === "press" && e.what === key).map((e) => {
        const r = frames[e.frame] ?? {};
        const raw = r.c ? Math.hypot(r.c[0] - CX, r.c[1] - CY) : null;
        // The game acts on a key 4-5 frames after its stamp (README "Input/frame
        // sync"): `fit` is the distance when the game read the key.
        const at = e.frame + latency;
        const fit = fx && fy && at >= from && at <= to ? Math.hypot(fx.at(at) - CX, fy.at(at) - CY) : null;
        // Ship speed (px per video frame) around the moment the key is read,
        // from the raw centres +-SPAN frames away (for braking runs).
        const fa = frames[Math.round(at) - SPAN]?.c, fb = frames[Math.round(at) + SPAN]?.c;
        const v = fa && fb ? Math.hypot(fb[0] - fa[0], fb[1] - fa[1]) / (2 * SPAN) : null;
        const dist = (c) => c && +Math.hypot(c[0] - CX, c[1] - CY).toFixed(1);
        return { frame: e.frame, t: e.video_t, raw: raw && +raw.toFixed(1), fit: fit && +fit.toFixed(1),
            at_read: dist(frames[Math.round(at)]?.c), v: v === null ? null : +v.toFixed(3), bbox: r.bbox ?? null };
    });
    const landF = frames.findIndex(isPort);
    // Status-line messages: the bitmap of the message strip MSG_DELAY frames
    // after each press (or just before the next press), clustered so each
    // distinct text gets one id; --msg-dir writes one PNG per id to read.
    const strip = (f) => {
        const bits = new Uint8Array(MSG[2] * MSG[3]);
        for (let y = 0; y < MSG[3]; y++) for (let x = 0; x < MSG[2]; x++) {
            bits[y * MSG[2] + x] = raw[f * W * H + (MSG[1] + y) * W + MSG[0] + x] > 200 ? 1 : 0; // white text only, not a planet behind it
        }
        return bits;
    };
    const clusters = [];
    const msgOf = (f) => {
        const s = strip(f);
        if (!s.some(Boolean)) return -1; // blank
        for (const [i, c] of clusters.entries()) {
            let d = 0;
            for (let k = 0; k < s.length; k++) d += s[k] !== c.bits[k];
            if (d / s.length < 0.015) { c.n++; return i; }
        }
        clusters.push({ bits: s, frame: f, n: 1 });
        return clusters.length - 1;
    };
    presses.forEach((p, i) => {
        const next = presses[i + 1]?.frame ?? N;
        const f = Math.min(p.frame + MSG_DELAY, next - 1, N - 1);
        p.msg = landF >= 0 && f >= landF ? "landed" : msgOf(f);
    });
    if (opt("--msg-dir")) {
        fs.mkdirSync(opt("--msg-dir"), { recursive: true });
        clusters.forEach((c, i) => spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf",
            `select=eq(n\\,${c.frame}),crop=${MSG[2]}:${MSG[3]}:${MSG[0]}:${MSG[1]}`, "-frames:v", "1", `${opt("--msg-dir")}/msg-${i}.png`]));
    }
    const landedPress = landF < 0 ? null : presses.filter((p) => p.frame < landF).at(-1) ?? null;
    const resid = seg.length && fx ? Math.sqrt(seg.reduce((s, r) => s + (r.c[0] - fx.at(r.f)) ** 2 + (r.c[1] - fy.at(r.f)) ** 2, 0) / seg.length) : null;
    const out = {
        file, frames: N, size, fit: fx && { from, to, n: seg.length, vx: +fx.b.toFixed(3), vy: +fy.b.toFixed(3), rms: resid && +resid.toFixed(2) },
        land_frame: landF < 0 ? null : landF, landed_press: landedPress,
        messages: clusters.map((c, i) => ({ id: i, first_frame: c.frame, presses: c.n })), presses,
    };
    if (opt("--out")) {
        const every = Number(opt("--every", 1));
        fs.writeFileSync(opt("--out"), JSON.stringify({ ...out, track: frames.filter((r) => r.f % every === 0).map(({ f, bright, bbox, c }) =>
            ({ f, bright: +bright.toFixed(3), bbox, c: c && c.map((v) => +v.toFixed(1)) })) }, null, 1) + "\n");
    }
    console.log(JSON.stringify(out));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
