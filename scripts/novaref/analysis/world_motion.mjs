#!/usr/bin/env node
/**
 * World-motion tracker for window-cropped novaref recordings (832x604).
 * EV Nova keeps the player centred, so the player's velocity is minus the
 * on-screen velocity of the (static) stellars. Every frame, bright blobs of
 * at least MIN_AREA pixels in the play area (stars are 1-2 px and drop out)
 * are matched to the previous frame's blobs by nearest predicted position;
 * the frame's world displacement is the median of the matched blobs that do
 * not touch the screen edges or the player sprite. Positions are integrated
 * from that, so tracking survives stellars entering and leaving the view.
 *
 *   node scripts/novaref/analysis/world_motion.mjs <recording.mp4> [--from F] [--to F]
 *
 * Prints JSON: per-frame displacement (dx, dy, n blobs) and a fit of
 * speed(t) = min(a * (t - t0), vmax) to the speed series.
 */
import { spawnSync } from "node:child_process";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302, SHIP_R = 26, MIN_AREA = 30, FPS = 30;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 4 * 1024 * 1024 * 1024 }).stdout;
const N = Math.floor(raw.length / (W * H));
const from = opt("--from", 0), to = Math.min(opt("--to", N - 1), N - 1);

function blobs(f) {
    const seen = new Uint8Array(W * H);
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = y * W + x;
        if (seen[p] || f[p] < 25) continue;
        const stack = [p]; seen[p] = 1;
        let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, ship = false;
        while (stack.length) {
            const q = stack.pop(); const qx = q % W, qy = (q / W) | 0;
            n++; sx += qx; sy += qy;
            if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
            if (Math.abs(qx - CX) < SHIP_R && Math.abs(qy - CY) < SHIP_R) ship = true;
            for (const r of [q - 1, q + 1, q - W, q + W]) {
                if (r < 0 || r >= W * H || (r % W) >= PLAY_W || seen[r] || f[r] < 25) continue;
                seen[r] = 1; stack.push(r);
            }
        }
        if (n < MIN_AREA) continue;
        const edge = x0 <= 1 || y0 <= 1 || x1 >= PLAY_W - 2 || y1 >= H - 2;
        out.push({ n, cx: sx / n, cy: sy / n, w: x1 - x0, h: y1 - y0, edge, ship });
    }
    return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
let prev = null, vx = 0, vy = 0;
const rows = [];
for (let i = from; i <= to; i++) {
    const f = raw.subarray(i * W * H, (i + 1) * W * H);
    const cur = blobs(f).filter((b) => !b.ship);
    let dx = NaN, dy = NaN, n = 0;
    if (prev) {
        const ds = [];
        for (const b of cur) {
            if (b.edge) continue;
            let best = null, bd = Infinity;
            for (const a of prev) {
                if (a.edge) continue;
                // Same object: similar size, near its predicted position.
                if (Math.abs(a.n - b.n) > 0.25 * Math.max(a.n, b.n)) continue;
                const d = Math.hypot(a.cx + vx - b.cx, a.cy + vy - b.cy);
                if (d < bd) { bd = d; best = a; }
            }
            if (best && bd < 6) ds.push([b.cx - best.cx, b.cy - best.cy]);
        }
        n = ds.length;
        if (n) { dx = median(ds.map((d) => d[0])); dy = median(ds.map((d) => d[1])); vx = dx; vy = dy; }
    }
    rows.push({ i, dx, dy, n });
    prev = cur;
}

// Speed series (px/frame), smoothed over 5 frames where measured.
const sp = rows.map((r) => (r.n ? Math.hypot(r.dx, r.dy) : NaN));
const smooth = sp.map((_, k) => {
    const w = sp.slice(Math.max(0, k - 2), k + 3).filter((v) => !isNaN(v));
    return w.length >= 3 ? w.reduce((a, b) => a + b, 0) / w.length : NaN;
});
// Fit min(a (t - t0), vmax) by grid search over t0 and vmax, least squares in a.
const pts = smooth.map((v, k) => [rows[k].i, v]).filter(([, v]) => !isNaN(v));
let best = null;
const moving = pts.filter(([, v]) => v > 0.2);
if (moving.length > 10) {
    const vmaxGuess = Math.max(...moving.map(([, v]) => v));
    for (let t0 = moving[0][0] - 8; t0 <= moving[0][0] + 4; t0 += 0.25) {
        for (let vmax = vmaxGuess * 0.85; vmax <= vmaxGuess * 1.1; vmax += vmaxGuess * 0.002) {
            // a by least squares on the ramp part (v < vmax).
            let num = 0, den = 0;
            for (const [t, v] of moving) if (t > t0 && v < 0.97 * vmax) { num += v * (t - t0); den += (t - t0) ** 2; }
            const a = den ? num / den : 0;
            let err = 0;
            for (const [t, v] of pts) { if (t < t0 - 10) continue; err += (Math.min(Math.max(a * (t - t0), 0), vmax) - v) ** 2; }
            if (!best || err < best.err) best = { t0, a, vmax, err };
        }
    }
}
const plateau = best ? moving.filter(([t, v]) => best.a * (t - best.t0) > best.vmax * 1.05) : [];
if (process.env.RAW) for (const r of rows) if (r.n) console.error(r.i, r.dx.toFixed(2), r.dy.toFixed(2), r.n);
console.log(JSON.stringify({
    ok: true, file, frames: N, measured_frames: rows.filter((r) => r.n).length,
    fit: best && {
        start_frame: +best.t0.toFixed(2),
        accel_px_per_frame2: +best.a.toFixed(5), accel_px_per_s2: +(best.a * FPS * FPS).toFixed(2),
        top_px_per_frame: +best.vmax.toFixed(4), top_px_per_s: +(best.vmax * FPS).toFixed(2),
        ramp_frames: +(best.vmax / best.a).toFixed(1), rms: +Math.sqrt(best.err / pts.length).toFixed(4),
        plateau_frames_measured: plateau.length,
        plateau_median_px_per_frame: plateau.length ? +median(plateau.map(([, v]) => v)).toFixed(4) : null,
    },
    speed_every_6: pts.filter(([t]) => t % 6 === 0).map(([t, v]) => [t, +v.toFixed(2)]),
}));
