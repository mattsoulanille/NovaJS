#!/usr/bin/env node
/**
 * Turning circles of missiles (wave 6: sensor-interference loops vs an
 * ordinary homing turn). Reads a decoy_track.mjs `tracks.json` (missile
 * heads per frame of a recording where the player sits still, so screen =
 * world) and, for every stretch of a track that keeps turning the same way,
 * fits a circle: radius, centre, speed and turn rate per video frame.
 *
 *   node scripts/novaref/analysis/missile_circles.mjs tracks.json [--min 12] [--window 20]
 *
 * Each track is cut into windows of `--window` points (sliding by half a
 * window); a window is a "turn" when its algebraic circle fit has an rms
 * residual under 2 px and the heading swept is over 60 degrees. Per track it
 * prints the median radius, the turn rate (deg/frame) and the drift of the
 * fitted centre between the first and last turning window (px per lap).
 * Turn rate w = v / r; a full circle of diameter D at speed v takes
 * pi D / v frames.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Kasa algebraic circle fit of [{x, y}]: {cx, cy, r, rms} or null. */
export function fitCircle(pts) {
    const n = pts.length;
    if (n < 3) return null;
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= n; my /= n;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (const p of pts) {
        const u = p.x - mx, v = p.y - my;
        suu += u * u; svv += v * v; suv += u * v;
        suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-9) return null;
    const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
    const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
    const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
    const cx = uc + mx, cy = vc + my;
    const rms = Math.sqrt(pts.reduce((s, p) => s + (Math.hypot(p.x - cx, p.y - cy) - r) ** 2, 0) / n);
    return { cx, cy, r, rms };
}

/** Unwrapped angle swept about (cx, cy) along pts, in degrees (signed). */
export function swept(pts, cx, cy) {
    let tot = 0;
    for (let i = 1; i < pts.length; i++) {
        let d = Math.atan2(pts[i].y - cy, pts[i].x - cx) - Math.atan2(pts[i - 1].y - cy, pts[i - 1].x - cx);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        tot += d;
    }
    return tot * 180 / Math.PI;
}

export function trackCircles(pts, win = 20) {
    const out = [];
    for (let s = 0; s + win <= pts.length; s += Math.max(1, win >> 1)) {
        const w = pts.slice(s, s + win);
        const c = fitCircle(w);
        if (!c || c.rms > 2) continue;
        const sw = swept(w, c.cx, c.cy);
        const frames = w[w.length - 1].f - w[0].f;
        if (Math.abs(sw) < 60 || frames <= 0) continue;
        let len = 0;
        for (let i = 1; i < w.length; i++) len += Math.hypot(w[i].x - w[i - 1].x, w[i].y - w[i - 1].y);
        out.push({ f0: w[0].f, f1: w[w.length - 1].f, cx: c.cx, cy: c.cy, r: c.r, rms: c.rms,
            deg_per_frame: sw / frames, px_per_frame: len / frames });
    }
    return out;
}

const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };

function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const file = args[0];
    const minN = Number(opt("--min", 12)), win = Number(opt("--window", 20));
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = [];
    for (const t of j.tracks) {
        if (t.pts.length < minN) continue;
        const cs = trackCircles(t.pts, Math.min(win, t.pts.length));
        if (!cs.length) continue;
        const first = cs[0], last = cs[cs.length - 1];
        const laps = Math.abs((last.f1 - first.f0) * med(cs.map((c) => c.deg_per_frame))) / 360;
        rows.push({
            id: t.id, f0: t.f0, f1: t.f1, windows: cs.length,
            r: +med(cs.map((c) => c.r)).toFixed(1), diameter: +(2 * med(cs.map((c) => c.r))).toFixed(1),
            deg_per_frame: +med(cs.map((c) => c.deg_per_frame)).toFixed(2),
            px_per_frame: +med(cs.map((c) => c.px_per_frame)).toFixed(2),
            centre_drift_px: +Math.hypot(last.cx - first.cx, last.cy - first.cy).toFixed(1),
            laps: +laps.toFixed(2),
        });
    }
    const all = rows.map((r) => r.diameter);
    console.log(JSON.stringify({ file, tracks: rows.length, median_diameter: med(all), median_deg_per_frame: med(rows.map((r) => r.deg_per_frame)), rows }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
