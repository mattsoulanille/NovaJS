#!/usr/bin/env node
/**
 * Range limit or per-tick chance? (asteroid decoy capture, waves 5-6). Reads
 * one or more decoy_track.mjs `tracks.json` files and, for every missile,
 * every frame and every rock, the rock's distance and its bearing off the
 * missile's heading. A capture is a missile that ended on a rock; its
 * onset (decoy_track's onsetOf) is the frame it started turning to the
 * rock, or its launch for a rock dead ahead.
 *
 * For each (distance band, off-angle band) cell it counts:
 *   exposure  missile-frames spent with a rock in that cell BEFORE any
 *             capture (missiles that were never captured contribute all
 *             their frames),
 *   captures  onsets whose rock sat in that cell,
 *   first     missiles whose FIRST entry into the cell (coming from
 *             outside it) ended in a capture there, of all first entries.
 * With a hard range R inside a cone C every first entry inside (R, C)
 * captures at once and exposure there stays ~0; with a per-tick chance the
 * exposure is large and captures/exposure is the per-frame hazard.
 * It also lists every "miss inside": a rock ahead (off <= 10 deg) under
 * 160 px and 30+ px nearer than the target, for 3+ frames, without a
 * capture onto it. The tracker's onset detection is conservative (it finds
 * an onset only when the heading visibly settles on the rock), so check
 * each listed missile against its trail picture before calling it a miss.
 *
 *   node scripts/novaref/analysis/decoy_encounters.mjs tracks.json [more.json ...]
 *       [--bands 0,50,100,150,200,250,300] [--offs 0,5,10,20,30,60,180]
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { assignRock, onsetOf } from "./decoy_track.mjs";

const deg = (r) => r * 180 / Math.PI;
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };

/** Per-frame heading (radians) from +-2 frames of the track. */
export function headings(pts) {
    return pts.map((_, i) => {
        const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
        return Math.atan2(b.y - a.y, b.x - a.x);
    });
}

/** Encounters of one track: [{i, d, off, captureRock}] per frame per rock, and the onset index (or null). */
export function encounters(track, target) {
    const pts = track.pts;
    if (track.end === "rock") assignRock(pts);
    const on = track.end === "rock" ? onsetOf(track, target) : null;
    const head = headings(pts);
    const rows = [];
    pts.forEach((p, i) => {
        for (const k of p.rocks ?? []) {
            const d = Math.hypot(k[0] - p.x, k[1] - p.y);
            const off = deg(angDiff(head[i], Math.atan2(k[1] - p.y, k[0] - p.x)));
            const isCaptor = !!(p.rock && Math.hypot(p.rock[0] - k[0], p.rock[1] - k[1]) < 1);
            const dTarget = Math.hypot(target[0] - p.x, target[1] - p.y);
            rows.push({ i, d, off, isCaptor, dTarget });
        }
    });
    return { rows, onset: on ? on.i : null };
}

export function tabulate(files, bands, offs) {
    const cell = (d, off) => {
        const bi = bands.findIndex((b, j) => j < bands.length - 1 && d >= b && d < bands[j + 1]);
        const oi = offs.findIndex((o, j) => j < offs.length - 1 && off >= o && off < offs[j + 1]);
        return bi < 0 || oi < 0 ? null : `${bands[bi]}-${bands[bi + 1]}|${offs[oi]}-${offs[oi + 1]}`;
    };
    const table = {}, misses = [];
    const get = (c) => (table[c] ??= { exposure: 0, captures: 0 });
    let missiles = 0, captured = 0;
    for (const f of files) {
        const j = JSON.parse(fs.readFileSync(f, "utf8"));
        for (const t of j.tracks) {
            if (t.pts.length < 6) continue;
            missiles++;
            const { rows, onset } = encounters(t, j.target);
            if (onset !== null) {
                captured++;
                const r = rows.find((x) => x.i === onset && x.isCaptor);
                const c = r && cell(r.d, r.off);
                if (c) get(c).captures++;
            }
            const stop = onset ?? Infinity;
            let ahead = 0;
            for (const r of rows) {
                if (r.i >= stop) continue;
                const c = cell(r.d, r.off);
                if (c) get(c).exposure++;
            }
            // Misses inside: a rock under 160 px within 10 deg ahead, and nearer
            // than the target by 30+ px (not just beyond it), for 3+ frames,
            // without a capture onto it.
            const byFrame = new Map();
            for (const r of rows) if (r.i < stop && r.d < 160 && r.off <= 10 && r.d < r.dTarget - 30 && !(onset !== null && r.isCaptor)) byFrame.set(r.i, Math.min(byFrame.get(r.i) ?? 1e9, r.d));
            ahead = byFrame.size;
            if (ahead >= 3) misses.push({ file: f.split("/").slice(-2, -1)[0], id: t.id, frames: ahead, closest: +Math.min(...byFrame.values()).toFixed(1), end: t.end });
        }
    }
    for (const v of Object.values(table)) v.hazard = v.exposure ? +(v.captures / v.exposure).toFixed(3) : null;
    return { missiles, captured, table, misses_inside: misses };
}

function main() {
    const args = process.argv.slice(2);
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
    const bands = opt("--bands", "0,50,100,150,200,250,300").split(",").map(Number);
    const offs = opt("--offs", "0,5,10,20,30,60,180").split(",").map(Number);
    console.log(JSON.stringify(tabulate(files, bands, offs), null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
