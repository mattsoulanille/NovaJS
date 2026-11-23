#!/usr/bin/env node
/**
 * Escort recall timeline (E-recall, waves 5-6): every blue disc's distance
 * from the player (the play-area centre) in every frame of a window-cropped
 * esc_recall2.json recording, and per escort the shape of its return after
 * the `c` (formation) press: when it first comes on screen, its closest pass
 * (does it fly through the slot?), the farthest it swings out after that
 * pass (the overshoot, "off" when it leaves the screen), and when it settles
 * (distance steady within 2 px for 30 frames).
 *
 *   node scripts/novaref/analysis/recall_frames.mjs <recording.mp4> --events recording.events.json
 *       [--key c] [--out recall_frames.json]
 *
 * Discs are the kit's blue escort hulls (24 px, b > 160, r and g < 90);
 * the two escorts are told apart by nearest-neighbour linking frame to
 * frame. Frames are counted as ffmpeg decodes the file (README "Input/frame
 * sync").
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { PW, PH, components, streamFrames } from "./decoy_track.mjs";

const CX = 318, CY = 302;
export const isBlue = (r, g, b) => b > 160 && r < 90 && g < 90;

/** Blue disc centroids in one RGB play-area frame (60-700 px components). */
export function blueDiscs(buf) {
    const on = new Uint8Array(PW * PH);
    for (let p = 0, q = 0; p < PW * PH; p++, q += 3) if (isBlue(buf[q], buf[q + 1], buf[q + 2])) on[p] = 1;
    return components(on, 60, 700).map((c) => ({ x: +c.x.toFixed(1), y: +c.y.toFixed(1), d: +Math.hypot(c.x - CX, c.y - CY).toFixed(1) }));
}

/**
 * Links per-frame discs into tracks by nearest neighbour (gap-tolerant):
 * returns tracks [{id, pts: [{f, x, y, d}]}].
 */
export function linkDiscs(frames, reach = 40, gap = 90) {
    const tracks = [];
    for (const { f, discs } of frames) {
        const free = new Set(discs.map((_, i) => i));
        for (const t of tracks) {
            const last = t.pts[t.pts.length - 1];
            if (f - last.f > gap) continue;
            let best = -1, bd = reach + (f - last.f) * 12;
            for (const i of free) {
                const dd = Math.hypot(discs[i].x - last.x, discs[i].y - last.y);
                if (dd < bd) { bd = dd; best = i; }
            }
            if (best >= 0) { t.pts.push({ f, ...discs[best] }); free.delete(best); }
        }
        for (const i of free) tracks.push({ id: tracks.length, pts: [{ f, ...discs[i] }] });
    }
    return tracks;
}

/** Shape of one escort's return: first on screen, closest pass, overshoot after it, settled. */
export function recallShape(pts, cFrame, { settleFrames = 30, settleTol = 2 } = {}) {
    const after = pts.filter((p) => p.f >= cFrame);
    if (!after.length) return null;
    const first = after[0];
    let settled = null;
    for (let i = 0; i < after.length; i++) {
        const win = after.slice(i).filter((p) => p.f < after[i].f + settleFrames);
        if (win.length >= settleFrames * 0.8 && Math.max(...win.map((p) => p.d)) - Math.min(...win.map((p) => p.d)) <= settleTol) {
            settled = { frame: after[i].f - cFrame, d: after[i].d };
            break;
        }
    }
    // The closest pass before settling, and the farthest swing-out after it.
    const before = settled ? after.filter((p) => p.f - cFrame < settled.frame) : after;
    const close = before.reduce((a, p) => (p.d < a.d ? p : a), before[0] ?? first);
    const out = before.filter((p) => p.f > close.f);
    const swing = out.reduce((a, p) => (p.d > a.d ? p : a), out[0] ?? close);
    // A gap in the track after the closest pass = the escort left the screen.
    let offScreen = false;
    for (let i = 1; i < out.length; i++) if (out[i].f - out[i - 1].f > 5) offScreen = true;
    return {
        first_on_screen: { frame: first.f - cFrame, d: first.d },
        closest: { frame: close.f - cFrame, d: close.d },
        overshoot: { frame: swing.f - cFrame, d: swing.d, left_screen: offScreen },
        settled,
    };
}

async function main() {
    const args = process.argv.slice(2);
    const file = args[0];
    const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
    if (!file) { console.error("usage: recall_frames.mjs <recording.mp4> --events recording.events.json [--key c] [--out f.json]"); process.exit(2); }
    const ev = JSON.parse(fs.readFileSync(opt("--events"), "utf8")).events;
    const key = opt("--key", "c");
    const cFrame = ev.filter((e) => e.kind === "press" && e.what === key).map((e) => e.frame).at(-1);
    const frames = [];
    await streamFrames(file, (f, buf) => frames.push({ f, discs: blueDiscs(buf) }));
    const tracks = linkDiscs(frames).filter((t) => t.pts.length >= 30);
    const shapes = tracks.map((t) => ({ track: t.id, n: t.pts.length, ...recallShape(t.pts, cFrame) }));
    if (opt("--out")) fs.writeFileSync(opt("--out"), JSON.stringify(frames) + "\n");
    console.log(JSON.stringify({ file, c_frame: cFrame, fps_note: "30.04 fps recording", escorts: shapes }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
