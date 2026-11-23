#!/usr/bin/env node
/**
 * Tracks projectiles fired by a STATIONARY player in a window-cropped
 * novaref recording: each frame is differenced against a background frame
 * taken just before the shot, changed pixels away from the ship are grouped
 * into blobs, and each blob's distance from the screen centre is recorded.
 * A straight-line fit of distance vs frame gives each shot's speed.
 *
 *   node scripts/novaref/analysis/shots.mjs <recording.mp4> --bg <frame> --from <frame> --to <frame>
 */
import { spawnSync } from "node:child_process";

const W = 832, H = 604, PLAY_W = 636, CX = 318, CY = 302, FPS = 30;
const args = process.argv.slice(2);
const file = args[0];
const opt = (n) => Number(args[args.indexOf(n) + 1]);
const bgI = opt("--bg"), from = opt("--from"), to = opt("--to");
const raw = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 4 * 1024 * 1024 * 1024 }).stdout;
const fr = (i) => raw.subarray(i * W * H, (i + 1) * W * H);
const bg = fr(bgI);
const rows = [];
for (let i = from; i <= to; i++) {
    const f = fr(i);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        const p = y * W + x;
        if (Math.hypot(x - CX, y - CY) < 14) continue;
        if (Math.abs(f[p] - bg[p]) > 40) mask[p] = 1;
    }
    const seen = new Uint8Array(W * H);
    const blobs = [];
    for (let p = 0; p < W * H; p++) {
        if (!mask[p] || seen[p]) continue;
        const st = [p]; seen[p] = 1; let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop(); n++; sx += q % W; sy += (q / W) | 0;
            for (const r of [q - 1, q + 1, q - W, q + W, q - W - 1, q - W + 1, q + W - 1, q + W + 1]) {
                if (r >= 0 && r < W * H && mask[r] && !seen[r]) { seen[r] = 1; st.push(r); }
            }
        }
        if (n >= 3) blobs.push({ n, x: sx / n, y: sy / n, d: Math.hypot(sx / n - CX, sy / n - CY) });
    }
    rows.push({ i, blobs: blobs.sort((a, b) => a.d - b.d) });
}
// Link blobs into tracks by distance continuity along the ray.
const tracks = [];
for (const r of rows) {
    for (const b of r.blobs) {
        let best = null, bd = 25;
        for (const t of tracks) {
            const last = t.pts[t.pts.length - 1];
            if (last.i !== r.i - 1 && last.i !== r.i - 2) continue;
            const pred = last.d + (t.v ?? 0) * (r.i - last.i);
            const dd = Math.abs(pred - b.d) + 0.2 * Math.hypot(last.x - b.x, last.y - b.y) / Math.max(1, r.i - last.i) * 0;
            if (dd < bd && b.d > last.d - 2) { bd = dd; best = t; }
        }
        if (best) {
            const last = best.pts[best.pts.length - 1];
            best.v = (b.d - last.d) / (r.i - last.i);
            best.pts.push({ i: r.i, ...b });
        } else tracks.push({ pts: [{ i: r.i, ...b }] });
    }
}
const fit = (pts) => {
    const n = pts.length, mx = pts.reduce((a, p) => a + p.i, 0) / n, my = pts.reduce((a, p) => a + p.d, 0) / n;
    let num = 0, den = 0; for (const p of pts) { num += (p.i - mx) * (p.d - my); den += (p.i - mx) ** 2; }
    const slope = num / den; const res = Math.sqrt(pts.reduce((a, p) => a + (my + slope * (p.i - mx) - p.d) ** 2, 0) / n);
    return { slope, res };
};
const out = tracks.filter((t) => t.pts.length >= 10).map((t) => {
    const f = fit(t.pts);
    return { frames: [t.pts[0].i, t.pts[t.pts.length - 1].i], n: t.pts.length, d0: +t.pts[0].d.toFixed(1), d1: +t.pts[t.pts.length - 1].d.toFixed(1),
        px_per_frame: +f.slope.toFixed(4), px_per_s: +(f.slope * FPS).toFixed(2), fit_rms_px: +f.res.toFixed(2) };
});
console.log(JSON.stringify({ ok: true, file, tracks: out }));
