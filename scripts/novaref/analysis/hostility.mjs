#!/usr/bin/env node
/**
 * Reads a window-cropped novaref recording of a passive player and says
 * whether the NPCs (the test kit's red disc hulls) attacked it:
 *
 *  - the player's shield and armor bars (status bar rows y=201 and y=218,
 *    x 670-823): filled pixels per frame, so any damage shows as a drop;
 *  - every red disc (connected red component of >= 150 px in the play
 *    area) and its distance from the player, who is always drawn at the
 *    play-area centre (318, 302).
 *
 *   node scripts/novaref/analysis/hostility.mjs <recording.mp4> [--every 30] [--colour red]
 *
 * Prints JSON: a per-second timeline and a summary (shield/armor start and
 * end, first frame the shield dropped, share of frames with a disc within
 * 200 px, closest approach).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const EVERY = Number(opt("--every", 30));
const COLOUR = opt("--colour", "red");
const isColour = {
    red: (r, g, b) => r > 170 && g < 90 && b < 90,
    green: (r, g, b) => g > 170 && r < 90 && b < 90,
    blue: (r, g, b) => b > 170 && r < 90 && g < 90,
    yellow: (r, g, b) => r > 170 && g > 170 && b < 90,
    magenta: (r, g, b) => r > 170 && b > 170 && g < 90,
    cyan: (r, g, b) => g > 170 && b > 170 && r < 90,
    white: (r, g, b) => r > 170 && g > 170 && b > 170,
}[COLOUR];
if (!file || !isColour) {
    console.error("usage: hostility.mjs <recording.mp4> [--every 30] [--colour red|green|...]");
    process.exit(2);
}

const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout.trim().split("\n").map((l) => parseFloat(l));
const N = pts.length;
// Decode in chunks: a whole 832x604 rgb24 recording passes Node's 4 GB
// buffer limit after about 95 s at 30 fps (spawnSync then silently returns
// a truncated buffer, so the last minute of a long run went missing).
const CHUNK = 1500, FRAME_BYTES = W * H * 3;
let raw = null, chunkStart = -1;
function frameOffset(i) {
    if (raw === null || i < chunkStart || i >= chunkStart + CHUNK) {
        chunkStart = i - (i % CHUNK);
        raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='between(n\\,${chunkStart}\\,${chunkStart + CHUNK - 1})'`,
            "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: CHUNK * FRAME_BYTES + 1024 }).stdout;
    }
    const o = (i - chunkStart) * FRAME_BYTES;
    return o + FRAME_BYTES <= raw.length ? o : null;
}

function barPx(o, y, test) {
    let n = 0;
    for (let x = 670; x <= 823; x++) {
        const p = o + 3 * (y * W + x);
        if (test(raw[p], raw[p + 1], raw[p + 2])) n++;
    }
    return n;
}
const shieldFill = (r, g, b) => r > 120 && g < 70 && b < 70;
const armorFill = (r, g, b) => r > 130 && g > 130 && b > 130;

function discs(o) {
    const mask = new Uint8Array(PLAY_W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = o + 3 * (y * W + x);
        if (isColour(raw[p], raw[p + 1], raw[p + 2])) mask[y * PLAY_W + x] = 1;
    }
    // The disc sprite renders dithered: dilate by joining pixels within 2 px.
    const out = [];
    const seen = new Uint8Array(PLAY_W * H);
    for (let s = 0; s < mask.length; s++) {
        if (!mask[s] || seen[s]) continue;
        const st = [s]; seen[s] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++;
            const qx = q % PLAY_W, qy = (q / PLAY_W) | 0; sx += qx; sy += qy;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const x = qx + dx, y = qy + dy;
                if (x < 0 || y < 0 || x >= PLAY_W || y >= H) continue;
                const r = y * PLAY_W + x;
                if (mask[r] && !seen[r]) { seen[r] = 1; st.push(r); }
            }
        }
        if (n >= 150) out.push([+(sx / n).toFixed(1), +(sy / n).toFixed(1), n]);
    }
    return out;
}

// Start after the scenario's opening map toggle (it covers the status
// bar): --from <s>, or 0.5 s after the last `m` press in the first 15 s of
// the run's <recording>.events.json (novaref frame sync).
let FROM = opt("--from", null);
if (FROM === null) {
    FROM = 0;
    try {
        const ev = JSON.parse(fs.readFileSync(file.replace(/\.mp4$/, "") + ".events.json", "utf8"));
        const ms = ev.events.filter((e) => e.kind === "press" && e.what === "m" && e.video_t < 15);
        if (ms.length) FROM = ms.at(-1).video_t + 0.5;
    } catch { /* no frame sync for this recording */ }
}
FROM = Number(FROM);
const timeline = [];
let shield0 = null, armor0 = null, firstDrop = null, near = 0, closest = Infinity, maxDiscs = 0;
let last = null;
for (let i = 0; i < N; i++) {
    if (pts[i] < FROM) continue;
    const o = frameOffset(i);
    if (o === null) continue;
    const sh = barPx(o, 201, shieldFill), ar = barPx(o, 218, armorFill);
    // The map or a dialog covers the status bar: skip frames whose bars
    // vanish entirely (a real empty shield still has armor).
    if (sh === 0 && ar === 0) continue;
    if (shield0 === null) { shield0 = sh; armor0 = ar; }
    if (firstDrop === null && sh < shield0 - 2) firstDrop = { frame: i, t: pts[i] };
    const ds = discs(o);
    maxDiscs = Math.max(maxDiscs, ds.length);
    const dist = ds.map(([x, y]) => Math.hypot(x - CX, y - CY));
    const dmin = dist.length ? Math.min(...dist) : null;
    if (dmin !== null && dmin < 200) near++;
    if (dmin !== null) closest = Math.min(closest, dmin);
    last = { frame: i, t: pts[i], shield_px: sh, armor_px: ar };
    if (i % EVERY === 0) timeline.push({ frame: i, t: +pts[i]?.toFixed(2), shield_px: sh, armor_px: ar, discs: ds.length, nearest_px: dmin === null ? null : Math.round(dmin) });
}
const counted = timeline.length ? N : 0;
console.log(JSON.stringify({
    file, frames: N, colour: COLOUR, from_s: FROM,
    summary: {
        shield_start_px: shield0, shield_end_px: last?.shield_px ?? null,
        armor_start_px: armor0, armor_end_px: last?.armor_px ?? null,
        shield_first_drop: firstDrop,
        frames_with_disc_within_200px: near, share_within_200px: counted ? +(near / Math.max(1, N - Math.round(FROM * 30))).toFixed(3) : 0,
        closest_px: Number.isFinite(closest) ? Math.round(closest) : null, max_discs_on_screen: maxDiscs,
    },
    timeline,
}, null, 1));
