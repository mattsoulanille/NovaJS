#!/usr/bin/env node
/**
 * Who fires? Births of bolt projectiles in a window-cropped novaref
 * recording (832x604), attributed to the nearest disc hull. Used for the
 * wave-5 E-fight question: do escorts with fixed guns or rear turrets fire
 * from the Formation slot? (The Kit Escort Gun and the A14 Gun share wëap
 * 131's graphic, an orange streak about 10 px long, so a bolt is told apart
 * only by where it appears.)
 *
 *   node scripts/novaref/analysis/bolt_births.mjs <recording.mp4> [--from F] [--to F] [--radius 26]
 *
 * Per frame of the play area: bolts are 8-connected components of orange
 * pixels (r > 170, 60 < g < 220, b < 120, r > g + 30) of 3-60 pixels, not on
 * a disc; discs are components of >= 150 px of the kit's pure red or blue.
 * Bolts are linked frame to frame into tracks; a track of 3+ frames moving
 * at 4+ px/frame (brackets and glints don't move like that) is a shot, and
 * its first point is its BIRTH. A birth within 32 px of a red disc is the
 * red ship's; otherwise it is attributed to the nearest disc whose centre
 * is within --radius px (the 24 px disc plus the muzzle offset), or to
 * "none" (a bolt first seen in flight, e.g. entering the screen).
 * Prints one JSON line per birth (frame, place, owner, speed, direction in
 * screen degrees, 0 = east, 90 = south) and a summary {births, by}.
 */
import { pathToFileURL } from "node:url";
import { streamFrames, components, PW, PH } from "./decoy_track.mjs";

export function discsAndBolts(buf) {
    const red = new Uint8Array(PW * PH), blue = new Uint8Array(PW * PH), orange = new Uint8Array(PW * PH);
    for (let p = 0, q = 0; p < PW * PH; p++, q += 3) {
        const r = buf[q], g = buf[q + 1], b = buf[q + 2];
        if (r > 170 && g < 90 && b < 90) red[p] = 1;
        else if (b > 170 && r < 90 && g < 90) blue[p] = 1;
        else if (r > 170 && g > 60 && g < 220 && b < 120 && r > g + 30) orange[p] = 1;
    }
    const discs = [...components(red, 150).map((c) => ({ ...c, colour: "red" })), ...components(blue, 150).map((c) => ({ ...c, colour: "blue" }))];
    const bolts = components(orange, 3, 60).filter((c) => !discs.some((d) => Math.hypot(c.x - d.x, c.y - d.y) < 14));
    return { discs, bolts };
}

async function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: bolt_births.mjs <recording.mp4> [--from F] [--to F] [--radius 26]"); process.exit(2); }
    const from = Number(opt("--from", 0)), to = Number(opt("--to", Infinity)), radius = Number(opt("--radius", 26));
    const live = [], tracks = [];
    await streamFrames(file, (f, buf) => {
        if (f < from || f > to) return;
        const { discs, bolts } = discsAndBolts(buf);
        const used = new Set();
        for (const t of live) {
            const p = t.pts[t.pts.length - 1], q = t.pts[t.pts.length - 2];
            const gap = f - p.f, vx = q ? (p.x - q.x) / (p.f - q.f) : 0, vy = q ? (p.y - q.y) / (p.f - q.f) : 0;
            let bi = -1, bd = q ? 8 + 4 * gap : 16 * gap;
            bolts.forEach((b, i) => { if (used.has(i)) return; const d = Math.hypot(b.x - p.x - vx * gap, b.y - p.y - vy * gap); if (d < bd) { bd = d; bi = i; } });
            if (bi >= 0) { used.add(bi); t.pts.push({ f, x: bolts[bi].x, y: bolts[bi].y }); }
        }
        bolts.forEach((b, i) => {
            if (used.has(i)) return;
            let best = null, bd = Infinity;
            for (const d of discs) { const dd = Math.hypot(b.x - d.x, b.y - d.y); if (dd < bd) { bd = dd; best = d; } }
            live.push({
                pts: [{ f, x: b.x, y: b.y }], near: best ? { colour: best.colour, d: bd } : null,
                redNear: discs.some((d) => d.colour === "red" && Math.hypot(b.x - d.x, b.y - d.y) < 32),
            });
        });
        for (let i = live.length - 1; i >= 0; i--) if (f - live[i].pts[live[i].pts.length - 1].f > 2) tracks.push(...live.splice(i, 1));
    });
    tracks.push(...live);
    const births = [];
    for (const t of tracks) {
        const a = t.pts[0], z = t.pts[t.pts.length - 1];
        if (t.pts.length < 3) continue;
        const speed = Math.hypot(z.x - a.x, z.y - a.y) / (z.f - a.f);
        if (speed < 4) continue;
        const by = t.redNear ? "red" : t.near && t.near.d < radius ? t.near.colour : "none";
        births.push({
            f: a.f, x: +a.x.toFixed(1), y: +a.y.toFixed(1), by, d: t.near ? +t.near.d.toFixed(1) : null,
            n: t.pts.length, speed: +speed.toFixed(1), dir: Math.round(Math.atan2(z.y - a.y, z.x - a.x) * 180 / Math.PI),
        });
    }
    births.sort((p, q) => p.f - q.f);
    for (const b of births) console.log(JSON.stringify(b));
    const by = { blue: 0, red: 0, none: 0 };
    for (const b of births) by[b.by]++;
    console.log(JSON.stringify({ summary: true, births: births.length, by }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
