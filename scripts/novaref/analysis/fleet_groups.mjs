#!/usr/bin/env node
/**
 * F1n with SEVERAL disc fleets on screen at once (fleet_discs.mjs assumes one
 * ship per colour). For every frame: each colour's discs as connected
 * components; every red/green/blue/yellow disc is assigned to the nearest
 * white lead within --radius px; the lead's velocity comes from its own track
 * (the nearest white disc --dt frames earlier and later); the escort's
 * offset is rotated into the lead's frame: `along` (+ = ahead) and `across`
 * (+ = left of travel, screen y down). The player must sit still, so screen
 * motion is world motion.
 *
 *   node scripts/novaref/analysis/fleet_groups.mjs <recording.mp4> [--step 2] [--radius 200] [--min-speed 1.5] [--dt 4]
 *
 * Prints JSON: per colour, the median along/across/distance over frames where
 * the lead moves faster than --min-speed px per video frame, and the sample
 * count.
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const W = 832, H = 604, PLAY_W = 636;
export const COLOURS = ["white", "red", "green", "blue", "yellow"];
export function classify(r, g, b) {
    const hi = 170, lo = 90;
    if (r > hi && g > hi && b > hi) return 0;
    if (r > hi && g < lo && b < lo) return 1;
    if (g > hi && r < lo && b < lo) return 2;
    if (b > hi && r < lo && g < lo) return 3;
    if (r > hi && g > hi && b < lo) return 4;
    return -1;
}

/** Connected components (8-connected) of `labels === c` with at least `min` pixels: [[cx, cy, n], ...]. */
export function blobs(labels, w, h, c, min = 150) {
    const seen = new Uint8Array(w * h);
    const out = [];
    for (let s = 0; s < w * h; s++) {
        if (labels[s] !== c || seen[s]) continue;
        const st = [s]; seen[s] = 1;
        let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++;
            const x = q % w, y = (q - x) / w; sx += x; sy += y;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                const r = yy * w + xx;
                if (labels[r] === c && !seen[r]) { seen[r] = 1; st.push(r); }
            }
        }
        if (n >= min) out.push([sx / n, sy / n, n]);
    }
    return out;
}

/** Offset of p from lead in the lead's frame given its velocity (vx, vy): {along, across}. */
export function leadFrame(p, lead, vx, vy) {
    const s = Math.hypot(vx, vy);
    const dx = p[0] - lead[0], dy = p[1] - lead[1];
    const ux = vx / s, uy = vy / s;
    // Screen y points down, so "left of travel" is (uy, -ux).
    return { along: dx * ux + dy * uy, across: dx * uy - dy * ux };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
    const STEP = opt("--step", 2), RADIUS = opt("--radius", 200), MIN_SPEED = opt("--min-speed", 1.5), DT = opt("--dt", 4);
    const nFrames = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file],
        { encoding: "utf8" }).stdout.trim() | 0;
    const CH = 600, FB = W * H * 3;
    const cache = new Map();
    let raw = null, start = -1;
    const whites = (i) => {
        if (cache.has(i)) return cache.get(i);
        if (raw === null || i < start || i >= start + CH) {
            start = i - (i % CH);
            raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select='between(n\\,${start}\\,${start + CH - 1})'`, "-vsync", "0",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: CH * FB + 1024 }).stdout;
        }
        const o = (i - start) * FB;
        if (o + FB > raw.length) { cache.set(i, null); return null; }
        const labels = new Int8Array(PLAY_W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
            const p = o + 3 * (y * W + x);
            labels[y * PLAY_W + x] = classify(raw[p], raw[p + 1], raw[p + 2]);
        }
        const res = COLOURS.map((_, c) => blobs(labels, PLAY_W, H, c));
        cache.set(i, res);
        return res;
    };
    const near = (list, p) => {
        let best = null, bd = Infinity;
        for (const q of list ?? []) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; } }
        return bd < 40 ? best : null;
    };
    const samples = { red: [], green: [], blue: [], yellow: [] };
    for (let i = DT; i + DT < nFrames; i += STEP) {
        const now = whites(i);
        if (!now || !now[0].length) continue;
        const before = whites(i - DT), after = whites(i + DT);
        if (!before || !after) continue;
        for (const lead of now[0]) {
            const a = near(before[0], lead), b = near(after[0], lead);
            if (!a || !b) continue;
            const vx = (b[0] - a[0]) / (2 * DT), vy = (b[1] - a[1]) / (2 * DT);
            const speed = Math.hypot(vx, vy);
            if (speed < MIN_SPEED) continue;
            for (let c = 1; c < COLOURS.length; c++) {
                for (const e of now[c]) {
                    // Assign to this lead only if it is the nearest lead.
                    const d = Math.hypot(e[0] - lead[0], e[1] - lead[1]);
                    if (d > RADIUS) continue;
                    if (now[0].some((l) => l !== lead && Math.hypot(e[0] - l[0], e[1] - l[1]) < d)) continue;
                    const f = leadFrame(e, lead, vx, vy);
                    samples[COLOURS[c]].push({ frame: i, speed, along: f.along, across: f.across, dist: d });
                }
            }
        }
    }
    const summary = {};
    for (const [c, s] of Object.entries(samples)) {
        summary[c] = { n: s.length, along: median(s.map((x) => x.along)), across: median(s.map((x) => x.across)),
            dist: median(s.map((x) => x.dist)), speed: median(s.map((x) => x.speed)),
            left: s.filter((x) => x.across > 0).length, right: s.filter((x) => x.across < 0).length };
        for (const k of ["along", "across", "dist", "speed"]) if (summary[c][k] !== null) summary[c][k] = +summary[c][k].toFixed(1);
    }
    console.log(JSON.stringify({ ok: true, file, frames: nFrames, step: STEP, summary, samples }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
