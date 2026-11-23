#!/usr/bin/env node
/**
 * Measures the player's ship motion in a window-cropped novaref recording
 * (832x604, `record start --window`) of the unit_probe scenario:
 *
 *  - TURN: while the ship turns in place, the 48x48 crop around the
 *    screen centre (where EV Nova always draws the player) only changes
 *    when the sprite steps to another rotation frame. The turn period is
 *    the lag at which the crop best repeats; sprite steps are counted too.
 *  - THRUST: the player stays centred and the world moves, so the ship's
 *    velocity is minus the on-screen velocity of a stellar. The stellar is
 *    tracked by masked template matching (template = its sprite cut from a
 *    frame where it is fully visible and clear of the ship).
 *
 *   node scripts/novaref/analysis/motion.mjs <recording.mp4> [--template-frame N] [--out data.json]
 *
 * Prints one JSON summary line. Times come from the frame index at the
 * recording's 30 fps (check pts regularity with ffprobe first).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const W = 832, H = 604, PLAY_W = 636;     // status bar starts at x ~ 638
const CX = 318, CY = 302, SHIP_R = 24;    // player sprite centre in the window
const FPS = 30;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error("usage: motion.mjs <recording.mp4> [--template-frame N] [--out data.json]"); process.exit(2); }

const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 4 * 1024 * 1024 * 1024 }).stdout;
const N = Math.floor(raw.length / (W * H));
const frame = (i) => raw.subarray(i * W * H, (i + 1) * W * H);

// ---- ship crop signatures
const crop = (f) => {
    const out = new Float32Array((2 * SHIP_R) * (2 * SHIP_R));
    let k = 0;
    for (let y = CY - SHIP_R; y < CY + SHIP_R; y++) for (let x = CX - SHIP_R; x < CX + SHIP_R; x++) out[k++] = f[y * W + x];
    return out;
};
const crops = Array.from({ length: N }, (_, i) => crop(frame(i)));
const dist = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const shipDiff = crops.map((c, i) => (i ? dist(c, crops[i - 1]) : 0));

// ---- stellar tracking
function bigBlob(f) {
    // Largest bright 4-connected component in the play area, ignoring the ship box.
    const seen = new Uint8Array(W * H);
    let best = null;
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = y * W + x;
        if (seen[p] || f[p] < 25) continue;
        const stack = [p]; seen[p] = 1;
        let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, touchesShip = false;
        while (stack.length) {
            const q = stack.pop(); const qx = q % W, qy = (q / W) | 0;
            n++; sx += qx; sy += qy; x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
            if (Math.abs(qx - CX) < SHIP_R && Math.abs(qy - CY) < SHIP_R) touchesShip = true;
            for (const r of [q - 1, q + 1, q - W, q + W]) {
                const rx = r % W;
                if (r < 0 || r >= W * H || rx >= PLAY_W || seen[r] || f[r] < 25) continue;
                seen[r] = 1; stack.push(r);
            }
        }
        if (!best || n > best.n) best = { n, cx: sx / n, cy: sy / n, box: [x0, y0, x1, y1], touchesShip };
    }
    return best;
}

let tf = opt("--template-frame") !== undefined ? Number(opt("--template-frame")) : -1;
if (tf < 0) {
    // First frame whose big blob is clear of the ship and of the edges.
    for (let i = 0; i < N; i += 3) {
        const b = bigBlob(frame(i));
        if (b && b.n > 800 && !b.touchesShip && b.box[0] > 2 && b.box[1] > 2 && b.box[2] < PLAY_W - 3 && b.box[3] < H - 3) { tf = i; break; }
    }
}
let track = [];
if (tf >= 0) {
    const ref = frame(tf);
    const b = bigBlob(ref);
    const [x0, y0, x1, y1] = b.box;
    const tpl = [];
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) if (ref[y * W + x] >= 25) tpl.push([x - x0, y - y0, ref[y * W + x]]);
    const score = (f, ox, oy) => {
        let s = 0, n = 0;
        for (const [dx, dy, v] of tpl) {
            const x = ox + dx, y = oy + dy;
            if (x < 0 || y < 0 || x >= PLAY_W || y >= H) continue;
            if (Math.abs(x - CX) < SHIP_R && Math.abs(y - CY) < SHIP_R) continue;
            s += Math.abs(f[y * W + x] - v); n++;
        }
        return n > tpl.length * 0.25 ? s / n : Infinity;
    };
    const locate = (i, gx, gy, r) => {
        let best = [Infinity, gx, gy];
        for (let oy = gy - r; oy <= gy + r; oy++) for (let ox = gx - r; ox <= gx + r; ox++) {
            const s = score(frame(i), ox, oy);
            if (s < best[0]) best = [s, ox, oy];
        }
        return best;
    };
    // Track forwards and backwards from the template frame.
    const pos = new Array(N).fill(null);
    pos[tf] = [x0, y0, 0];
    for (const dir of [1, -1]) {
        let px = x0, py = y0, vx = 0, vy = 0;
        for (let i = tf + dir; i >= 0 && i < N; i += dir) {
            const [s, ox, oy] = locate(i, Math.round(px + vx), Math.round(py + vy), 6);
            if (!isFinite(s) || s > 30) break;
            vx = ox - px; vy = oy - py; px = ox; py = oy;
            pos[i] = [ox, oy, s];
        }
    }
    track = pos.map((p, i) => (p ? { i, x: p[0], y: p[1], err: +p[2].toFixed(1) } : null));
}

// ---- summaries
// Turn: first long run of sprite steps (shipDiff spikes while the background is static).
const STEP = 4;
const steps = shipDiff.map((d, i) => (d > STEP ? i : -1)).filter((i) => i >= 0);

// Turn period from the crop autocorrelation over the turning segment.
let turn = null;
if (steps.length > 4) {
    const a = steps[0], b = steps[steps.length - 1];
    // Restrict to frames before the planet starts moving (thrust begins).
    let end = b;
    for (const t of track) if (t && t.i > a && (Math.abs(t.x - track[a]?.x) > 0 || Math.abs(t.y - track[a]?.y) > 0) && track[a]) { end = Math.min(end, t.i - 1); break; }
    const seg = [a, end];
    let bestLag = null, bestD = Infinity;
    for (let lag = 30; lag < (seg[1] - seg[0]) - 10; lag++) {
        let s = 0, n = 0;
        for (let i = seg[0]; i + lag <= seg[1]; i += 1) { s += dist(crops[i], crops[i + lag]); n++; }
        const d = s / n;
        if (d < bestD) { bestD = d; bestLag = lag; }
    }
    const segSteps = steps.filter((i) => i >= seg[0] && i <= seg[1]);
    const gaps = segSteps.slice(1).map((v, k) => v - segSteps[k]);
    turn = {
        segment_frames: seg, sprite_steps: segSteps.length,
        mean_frames_per_step: gaps.length ? +(gaps.reduce((x, y) => x + y, 0) / gaps.length).toFixed(3) : null,
        period_frames: bestLag, period_s: bestLag ? +(bestLag / FPS).toFixed(3) : null,
        deg_per_s: bestLag ? +(360 / (bestLag / FPS)).toFixed(2) : null, period_match_err: +bestD.toFixed(2),
    };
}

// Thrust: speed per frame from the track; plateau = top speed; ramp = accel.
let thrust = null;
const pts = track.filter(Boolean);
if (pts.length > 20) {
    const v = [];
    for (let k = 1; k < pts.length; k++) {
        const p = pts[k], q = pts[k - 1];
        if (p.i !== q.i + 1) continue;
        v.push({ i: p.i, s: Math.hypot(p.x - q.x, p.y - q.y) });
    }
    // Smooth over 5 frames (the template step is whole pixels).
    const sm = v.map((_, k) => {
        const w = v.slice(Math.max(0, k - 2), k + 3);
        return { i: v[k].i, s: w.reduce((x, y) => x + y.s, 0) / w.length };
    });
    const moving = sm.filter((p) => p.s > 0.3);
    const top = moving.length ? Math.max(...moving.map((p) => p.s)) : 0;
    const plateau = sm.filter((p) => p.s > 0.95 * top);
    const plateauMean = plateau.reduce((x, y) => x + y.s, 0) / (plateau.length || 1);
    // Ramp: first frame moving to first frame at >= 95% of plateau, using
    // displacement (more precise than per-frame speed).
    const start = moving[0]?.i;
    const reach = plateau[0]?.i;
    // Least-squares on positions over the ramp: s(t) = 0.5 a t^2 (t from start).
    let accel = null;
    if (start !== undefined && reach !== undefined && reach > start + 3) {
        const p0 = track[start - 1] ?? track[start];
        let num = 0, den = 0;
        for (let i = start; i <= reach; i++) {
            const t = track[i]; if (!t) continue;
            const d = Math.hypot(t.x - p0.x, t.y - p0.y), tt = i - (start - 1);
            num += d * 0.5 * tt * tt; den += (0.5 * tt * tt) ** 2;
        }
        accel = num / den;
    }
    // Plateau speed from a straight-line fit over the plateau frames.
    const pl = plateau.map((p) => track[p.i]).filter(Boolean);
    let topFit = null;
    if (pl.length > 10) {
        const a = pl[0], b = pl[pl.length - 1];
        topFit = Math.hypot(b.x - a.x, b.y - a.y) / (b.i - a.i);
    }
    thrust = {
        tracked_frames: pts.length, start_frame: start, reach_top_frame: reach,
        top_px_per_frame: topFit !== null ? +topFit.toFixed(3) : +plateauMean.toFixed(3),
        top_px_per_s: +((topFit ?? plateauMean) * FPS).toFixed(1),
        ramp_frames: reach - start,
        accel_px_per_frame2: accel !== null ? +accel.toFixed(4) : null,
        accel_px_per_s2: accel !== null ? +(accel * FPS * FPS).toFixed(1) : null,
        speed_profile: sm.filter((p, k) => k % 3 === 0).map((p) => [p.i, +p.s.toFixed(2)]),
    };
}

const summary = { ok: true, file, frames: N, fps: FPS, template_frame: tf, turn, thrust };
if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify({ summary, shipDiff, track }, null, 1));
console.log(JSON.stringify(summary));
