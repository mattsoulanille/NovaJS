#!/usr/bin/env node
/**
 * Measures a homing missile's turn rate from a window-cropped recording
 * of a STATIONARY player: the missile (and its smoke) is what changes
 * against a background frame taken just before launch. Per frame, the
 * changed blob farthest from the player that continues the previous
 * position is the missile head (first seen within 60 px of the player). Its heading is taken from positions 3
 * frames apart, and the turn rate is the slope of heading vs frame while
 * it turns (linear fit over the steady part), in deg/frame and deg/s.
 *
 *   node scripts/novaref/analysis/missile_turn.mjs <rec.mp4> --bg F --from F --to F [--fps 30]
 */
import { spawnSync } from "node:child_process";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? Number(args[i + 1]) : d; };
const bgI = opt("--bg"), from = opt("--from"), to = opt("--to"), FPS = opt("--fps", 30);
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 2 ** 32 }).stdout;
const fr = (i) => raw.subarray(i * W * H, (i + 1) * W * H);
const bg = fr(bgI);
let prev = null, miss = 0;
const path = [];
for (let i = from; i <= to; i++) {
    const f = fr(i);
    // Bright changed pixels (the missile sprite; smoke is dimmer), away from the player.
    let best = null;
    const seen = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
        const x = p % W; if (x >= PLAY_W) continue;
        if (seen[p] || Math.abs(f[p] - bg[p]) < 35 || f[p] < 60) continue;
        const st = [p]; seen[p] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++; sx += q % W; sy += (q / W) | 0;
            for (const r of [q - 1, q + 1, q - W, q + W]) if (r >= 0 && r < W * H && !seen[r] && Math.abs(f[r] - bg[r]) >= 35 && f[r] >= 60) { seen[r] = 1; st.push(r); }
        }
        const x0 = sx / n, y0 = sy / n;
        if (n < 3 || Math.hypot(x0 - CX, y0 - CY) < 16) continue;
        const score = prev ? Math.hypot(x0 - prev[0], y0 - prev[1]) : Math.hypot(x0 - CX, y0 - CY);
        if (!prev && score > 60) continue; // a new missile appears at the ship
        if (prev && score > 12 * (miss + 1)) continue;
        if (!best || score < best.score) best = { x: x0, y: y0, score };
    }
    if (best) { path.push({ i, x: best.x, y: best.y }); prev = [best.x, best.y]; miss = 0; } else if (prev && ++miss > 6) break;
}
const hd = [];
for (let k = 3; k < path.length; k++) {
    const a = path[k - 3], b = path[k];
    if (b.i - a.i !== 3) continue;
    hd.push({ i: b.i - 1.5, deg: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, speed: Math.hypot(b.x - a.x, b.y - a.y) / 3 });
}
// unwrap
for (let k = 1; k < hd.length; k++) { while (hd[k].deg - hd[k - 1].deg > 180) hd[k].deg -= 360; while (hd[k].deg - hd[k - 1].deg < -180) hd[k].deg += 360; }
const fit = (pts) => { const n = pts.length; if (n < 4) return null; const mx = pts.reduce((a, p) => a + p.i, 0) / n, my = pts.reduce((a, p) => a + p.deg, 0) / n; let num = 0, den = 0; for (const p of pts) { num += (p.i - mx) * (p.deg - my); den += (p.i - mx) ** 2; } return num / den; };
const slope = fit(hd);
console.log(JSON.stringify({ ok: true, file, tracked: path.length, frames: path.length ? [path[0].i, path[path.length - 1].i] : null,
    speed_px_per_frame: hd.length ? +(hd.reduce((a, h) => a + h.speed, 0) / hd.length).toFixed(3) : null,
    turn_deg_per_frame: slope === null ? null : +slope.toFixed(3), turn_deg_per_s: slope === null ? null : +(slope * FPS).toFixed(1),
    heading_every_3: hd.filter((_, k) => k % 3 === 0).map((h) => [h.i, +h.deg.toFixed(1)]) }));
