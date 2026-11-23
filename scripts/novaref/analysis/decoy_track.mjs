#!/usr/bin/env node
/**
 * Missile and asteroid tracks in a window-cropped novaref recording (832x604)
 * of the wave-5 decoy rig (scenarios/decoy_single.json): the player sits at
 * the play-area centre, a static target sits east of it, one asteroid drifts
 * about, and single guided missiles are fired one at a time.
 *
 *   node scripts/novaref/analysis/decoy_track.mjs <recording.mp4> [--target x,y]
 *       [--out tracks.json] [--from F] [--to F]
 *
 * Per frame of the play area (636x604):
 *  - a STATIC mask: pixels bright in the per-pixel minimum of 24 frames
 *    sampled across the recording (planet, player, target, stars);
 *  - ROCKS: 8-connected components of non-static pixels brighter than 60
 *    with at least 120 pixels (the asteroid sprite is about 30-40 px);
 *  - MISSILES: components of non-static, SATURATED pixels (max - min > 70,
 *    max > 100) of 2-60 pixels that are not inside a rock's box; the
 *    missile sprite is red/blue, its sparkle trail white, so only the head
 *    is kept.
 * Missiles are linked into tracks (nearest detection within 14 px, which is
 * more than two frames of a Speed-600 missile at 5.9 px/frame). For each
 * track the output gives its frames, where it ended (target / rock / edge /
 * lost), its distance to the rock at launch and at its closest approach,
 * and, for a track that ended on the rock, the CAPTURE ONSET: the first
 * frame from which the missile's heading kept closing on the rock's
 * bearing while opening from the target's (see onsetOf).
 * Distances are px between centres (the rock's centroid).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const PW = 636, PH = 604, VW = 832;
export const CENTRE = [318, 302];

function frameCount(file) {
    const r = spawnSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0",
        "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file], { encoding: "utf8" });
    return Number(r.stdout.trim());
}

/** Streams the play area as RGB frames: cb(frameIndex, buf). */
export function streamFrames(file, cb, { select } = {}) {
    return new Promise((resolve, reject) => {
        const vf = [select ? `select='${select}'` : null, `crop=${PW}:${PH}:0:0`].filter(Boolean).join(",");
        const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-vf", vf, ...(select ? ["-vsync", "0"] : []),
            "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
        const size = PW * PH * 3;
        let pending = [], have = 0, idx = 0;
        ff.stdout.on("data", (chunk) => {
            pending.push(chunk); have += chunk.length;
            while (have >= size) {
                const all = Buffer.concat(pending);
                cb(idx++, all.subarray(0, size));
                const rest = all.subarray(size);
                pending = rest.length ? [Buffer.from(rest)] : []; have = rest.length;
            }
        });
        ff.on("error", reject);
        ff.on("close", (code) => code === 0 ? resolve(idx) : reject(new Error(`ffmpeg exited ${code}`)));
    });
}

/** 8-connected components of `on` (Uint8Array PW*PH): [{n, x, y, x0, y0, x1, y1}]. */
export function components(on, minN = 1, maxN = Infinity) {
    const seen = new Uint8Array(PW * PH), out = [], st = [];
    for (let s = 0; s < PW * PH; s++) {
        if (!on[s] || seen[s]) continue;
        st.push(s); seen[s] = 1;
        let n = 0, sx = 0, sy = 0, x0 = PW, y0 = PH, x1 = 0, y1 = 0;
        while (st.length) {
            const q = st.pop(), qx = q % PW, qy = (q - qx) / PW;
            n++; sx += qx; sy += qy;
            if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = qx + dx, ny = qy + dy;
                if (nx < 0 || ny < 0 || nx >= PW || ny >= PH) continue;
                const nb = ny * PW + nx;
                if (on[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb); }
            }
        }
        if (n >= minN && n <= maxN) out.push({ n, x: sx / n, y: sy / n, x0, y0, x1, y1 });
    }
    return out;
}

/** Static mask from per-pixel minimum brightness over sampled frames, dilated by 2 px. */
export async function staticMask(file, total) {
    const step = Math.max(1, Math.floor(total / 24));
    const minB = new Uint8Array(PW * PH).fill(255);
    await streamFrames(file, (_i, buf) => {
        for (let p = 0, q = 0; p < PW * PH; p++, q += 3) {
            const v = Math.max(buf[q], buf[q + 1], buf[q + 2]);
            if (v < minB[p]) minB[p] = v;
        }
    }, { select: `not(mod(n\\,${step}))` });
    const mask = new Uint8Array(PW * PH);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
        if (minB[y * PW + x] <= 40) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < PW && ny < PH) mask[ny * PW + nx] = 1;
        }
    }
    return { mask, minB };
}

/** Rocks and missile heads in one frame. */
export function detect(buf, mask, exclude = []) {
    const bright = new Uint8Array(PW * PH), sat = new Uint8Array(PW * PH);
    for (let p = 0, q = 0; p < PW * PH; p++, q += 3) {
        if (mask[p]) continue;
        const r = buf[q], g = buf[q + 1], b = buf[q + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        // Rocks are grey or brown: bright but not saturated.
        if (mx > 50 && mx - mn < 60) bright[p] = 1;
        if (mx > 80 && mx - mn > 50) sat[p] = 1;
    }
    // A rock: 60+ px and at least 8 px across (the small röid 128 sprite is
    // about 16 px); nothing inside an excluded circle (the target's
    // blinking brackets).
    const rocks = components(bright, 60).filter((k) => k.x1 - k.x0 >= 7 && k.y1 - k.y0 >= 7
        && !exclude.some(([x, y, r]) => Math.hypot(k.x - x, k.y - y) < r));
    const inRock = (c) => rocks.some((k) => c.x >= k.x0 - 4 && c.x <= k.x1 + 4 && c.y >= k.y0 - 4 && c.y <= k.y1 + 4);
    const missiles = mergeNear(components(sat, 2, 60).filter((c) => !inRock(c)), 9);
    return { rocks, missiles };
}

/** Merges detections closer than `r` px (the sprite's red and blue halves come out as two). */
export function mergeNear(cs, r) {
    const out = [];
    for (const c of cs) {
        const m = out.find((o) => Math.hypot(o.x - c.x, o.y - c.y) < r);
        if (!m) { out.push({ ...c }); continue; }
        const n = m.n + c.n;
        m.x = (m.x * m.n + c.x * c.n) / n; m.y = (m.y * m.n + c.y * c.n) / n; m.n = n;
    }
    return out;
}

/**
 * Sets p.rock on every point: for a track that ends within 45 px of a rock,
 * that rock followed back frame by frame (nearest to its last position, so
 * another rock passing closer to the missile is not picked up); otherwise
 * the rock nearest the missile in each frame.
 */
export function assignRock(pts) {
    const near = (p, x, y) => {
        let best = null, bd = Infinity;
        for (const k of p.rocks ?? []) { const d = Math.hypot(k[0] - x, k[1] - y); if (d < bd) { bd = d; best = k; } }
        return [best, bd];
    };
    const last = pts[pts.length - 1];
    const [endRock, endD] = near(last, last.x, last.y);
    if (endRock && endD < 45) {
        let prev = endRock;
        for (let i = pts.length - 1; i >= 0; i--) {
            const [k, d] = near(pts[i], prev[0], prev[1]);
            if (!k || d > 20) { for (let j = i; j >= 0; j--) pts[j].rock = null; break; }
            pts[i].rock = [k[0], k[1]];
            prev = k;
        }
    } else {
        for (const p of pts) { const [k] = near(p, p.x, p.y); p.rock = k ? [k[0], k[1]] : null; }
    }
}

const ang = (x, y) => Math.atan2(y, x);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };

/**
 * Capture onset of a track that ended on the rock: the earliest frame i
 * such that from i on the heading's angle to the rock's bearing never grows
 * by more than 8 degrees again and ends under 15 degrees, while the angle
 * to the target's bearing at the end exceeds the one at i by 10+ degrees.
 * Returns the index into track.pts or null.
 */
export function onsetOf(track, target) {
    const pts = track.pts;
    if (pts.length < 6) return null;
    const head = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
        head.push(ang(b.x - a.x, b.y - a.y));
    }
    const toRock = pts.map((p, i) => p.rock ? angDiff(head[i], ang(p.rock[0] - p.x, p.rock[1] - p.y)) : null);
    const toTgt = pts.map((p, i) => angDiff(head[i], ang(target[0] - p.x, target[1] - p.y)));
    const last = pts.length - 1;
    if (toRock[last] == null || toRock[last] > 15 * Math.PI / 180) return null;
    let onset = last;
    let best = toRock[last];
    for (let i = last - 1; i >= 0; i--) {
        if (toRock[i] == null) break;
        if (toRock[i] + 8 * Math.PI / 180 < best) break; // it was closer to the rock bearing before: not monotone
        best = Math.max(best, toRock[i]);
        onset = i;
    }
    // The capture turned it away from the target.
    if (toTgt[last] < toTgt[onset] + 10 * Math.PI / 180) return { i: onset, turnedFromTarget: false };
    return { i: onset, turnedFromTarget: true };
}

async function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: decoy_track.mjs <recording.mp4> [--target x,y] [--out tracks.json]"); process.exit(2); }
    const from = Number(opt("--from", 0)), to = Number(opt("--to", Infinity));
    const total = frameCount(file);
    const { mask, minB } = await staticMask(file, total);
    // Target: the static blob nearest the expected marker position (250 px east).
    let target = opt("--target") ? opt("--target").split(",").map(Number) : null;
    if (!target) {
        const st = new Uint8Array(PW * PH);
        for (let p = 0; p < PW * PH; p++) if (minB[p] > 60) st[p] = 1;
        const blobs = components(st, 30).filter((c) => Math.hypot(c.x - CENTRE[0], c.y - CENTRE[1]) > 80);
        blobs.sort((a, b) => Math.hypot(a.x - CENTRE[0] - 250, a.y - CENTRE[1]) - Math.hypot(b.x - CENTRE[0] - 250, b.y - CENTRE[1]));
        target = blobs.length ? [+blobs[0].x.toFixed(1), +blobs[0].y.toFixed(1)] : [CENTRE[0] + 250, CENTRE[1]];
    }
    const live = [], done = [], rockPath = [];
    let nextId = 0;
    await streamFrames(file, (f, buf) => {
        if (f < from || f > to) return;
        const { rocks, missiles } = detect(buf, mask);
        rocks.sort((a, b) => b.n - a.n);
        const rockList = rocks.map((k) => [+k.x.toFixed(1), +k.y.toFixed(1), k.n]);
        rockPath.push({ f, rocks: rockList });
        const used = new Set();
        for (const t of live) {
            const p = t.pts[t.pts.length - 1];
            const vx = t.pts.length > 1 ? p.x - t.pts[t.pts.length - 2].x : 0, vy = t.pts.length > 1 ? p.y - t.pts[t.pts.length - 2].y : 0;
            const gap = f - p.f, ex = p.x + vx * gap, ey = p.y + vy * gap;
            let bi = -1, bd = 14 * gap;
            missiles.forEach((m, i) => { if (used.has(i)) return; const d = Math.hypot(m.x - ex, m.y - ey); if (d < bd) { bd = d; bi = i; } });
            if (bi >= 0) { used.add(bi); const m = missiles[bi]; t.pts.push({ f, x: +m.x.toFixed(1), y: +m.y.toFixed(1), rocks: rockList }); }
        }
        missiles.forEach((m, i) => {
            if (used.has(i)) return;
            // New tracks start near the player only (launches).
            if (Math.hypot(m.x - CENTRE[0], m.y - CENTRE[1]) > 45) return;
            live.push({ id: nextId++, pts: [{ f, x: +m.x.toFixed(1), y: +m.y.toFixed(1), rocks: rockList }] });
        });
        for (let i = live.length - 1; i >= 0; i--) {
            if (f - live[i].pts[live[i].pts.length - 1].f > 5) done.push(...live.splice(i, 1));
        }
    });
    done.push(...live);
    const tracks = done.filter((t) => t.pts.length >= 5).sort((a, b) => a.pts[0].f - b.pts[0].f).map((t) => {
        const pts = t.pts, last = pts[pts.length - 1];
        assignRock(pts);
        const dRock = (p) => p.rock ? Math.hypot(p.x - p.rock[0], p.y - p.rock[1]) : null;
        const ds = pts.map(dRock).filter((d) => d != null);
        const dTgt = Math.hypot(last.x - target[0], last.y - target[1]);
        const dEndRock = dRock(last);
        const edge = last.x < 12 || last.y < 12 || last.x > PW - 12 || last.y > PH - 12;
        const end = dEndRock != null && dEndRock < 30 ? "rock" : dTgt < 55 ? "target" : dEndRock != null && dEndRock < 45 ? "rock" : edge ? "edge" : "lost";
        const on = end === "rock" ? onsetOf(t, target) : null;
        const fmt = (v) => v == null ? null : +v.toFixed(1);
        // Closest any rock came, split by its bearing off the missile's
        // heading: ahead (<= 30 deg), oblique (30-60), side or behind (> 60).
        const cones = { ahead: null, oblique: null, side: null };
        for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
            if (a === b) continue;
            const h = ang(b.x - a.x, b.y - a.y);
            for (const k of pts[i].rocks ?? []) {
                const d = Math.hypot(k[0] - pts[i].x, k[1] - pts[i].y);
                const off = angDiff(h, ang(k[0] - pts[i].x, k[1] - pts[i].y)) * 180 / Math.PI;
                const c = off <= 30 ? "ahead" : off <= 60 ? "oblique" : "side";
                if (cones[c] == null || d < cones[c].d) cones[c] = { d: fmt(d), off: Math.round(off), f: pts[i].f };
            }
        }
        return {
            id: t.id, f0: pts[0].f, f1: last.f, n: pts.length, end,
            d_rock_launch: fmt(dRock(pts[0])), d_rock_min: ds.length ? fmt(Math.min(...ds)) : null,
            d_target_end: fmt(dTgt), cones,
            onset: on ? { f: pts[on.i].f, d_rock: fmt(dRock(pts[on.i])), turned_from_target: on.turnedFromTarget, frames_before_end: pts.length - 1 - on.i } : null,
            pts,
        };
    });
    const summary = tracks.map(({ pts, ...rest }) => rest);
    for (const s of summary) console.log(JSON.stringify(s));
    const out = opt("--out");
    if (out) fs.writeFileSync(out, JSON.stringify({ file, target, centre: CENTRE, tracks, rock: rockPath }, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
