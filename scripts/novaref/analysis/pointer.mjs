/**
 * Headings off window shots of the wave-8 pointer hulls (kits/testkit.mjs
 * wave8Resources): the player's Kit Ring Crawler (a cyan ring with a white
 * spoke at its nose, drawn at the play-area centre) and the Kit Hulk
 * Pointer (a magenta disc with a green spoke from its centre to its nose).
 *
 *   node scripts/novaref/analysis/pointer.mjs <shot.png>... [--big] [--hulk-big]
 *
 * Angles are screen degrees like loops/board.mjs: 0 = east, +90 = south
 * (y down). Per shot: the player's heading, the hulk's offset from the
 * player (dx, dy, dist) and its heading, the bearing to the hulk, the
 * status line (text pixels and extent) and the bright share of the play
 * area (a dialog lights a few percent more).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const { PNG } = createRequire(import.meta.url)("pngjs");

export const CX = 318, CY = 302, PLAY_W = 636, PLAY_H = 604;
const deg = (dx, dy) => Math.atan2(dy, dx) * 180 / Math.PI;
export const isWhite = (r, g, b) => r > 200 && g > 200 && b > 200;
export const isMagenta = (r, g, b) => r > 170 && b > 170 && g < 90;
export const isGreen = (r, g, b) => g > 170 && r < 90 && b < 90;

/** Mean direction of the pixels passing `test` in the annulus rMin..rMax around (cx, cy): degrees, or null under minN pixels. */
export function spokeAngle(png, cx, cy, rMin, rMax, test, minN = 3) {
    const { width: W, data } = png;
    let n = 0, sx = 0, sy = 0;
    for (let y = Math.max(0, Math.floor(cy - rMax)); y <= Math.min(PLAY_H - 1, Math.ceil(cy + rMax)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rMax)); x <= Math.min(PLAY_W - 1, Math.ceil(cx + rMax)); x++) {
            const d2 = (x - cx) ** 2 + (y - cy) ** 2;
            if (d2 < rMin * rMin || d2 > rMax * rMax) continue;
            const i = (y * W + x) * 4;
            if (test(data[i], data[i + 1], data[i + 2])) { n++; sx += x - cx; sy += y - cy; }
        }
    }
    return n >= minN ? { deg: deg(sx, sy), n } : null;
}

/** The player's heading: the white spoke of the Ring 24 (or, `big`, the Ring 96). */
export function playerHeading(png, big = false) {
    return big ? spokeAngle(png, CX, CY, 34, 49, isWhite) : spokeAngle(png, CX, CY, 3.5, 12, isWhite);
}

/**
 * The hulk: centre = centroid of its magenta and green pixels (the player's
 * thin ring hides a few), heading = its green spoke around that centre.
 */
export function hulkPose(png, big = false) {
    const { width: W, data } = png;
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < Math.min(png.height, PLAY_H); y++) for (let x = 0; x < PLAY_W; x++) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (isMagenta(r, g, b)) { n++; sx += x; sy += y; }
    }
    if (n < 12) return null;
    const hx = sx / n, hy = sy / n;
    const spoke = big ? spokeAngle(png, hx, hy, 4, 48, isGreen) : spokeAngle(png, hx, hy, 2, 12, isGreen);
    // Include the spoke's pixels in the centre (the magenta-only centroid
    // sits a little away from the spoke).
    let gx = 0, gy = 0, gn = 0;
    const R = big ? 48 : 12;
    for (let y = Math.max(0, Math.floor(hy - R)); y <= Math.min(PLAY_H - 1, Math.ceil(hy + R)); y++) {
        for (let x = Math.max(0, Math.floor(hx - R)); x <= Math.min(PLAY_W - 1, Math.ceil(hx + R)); x++) {
            const i = (y * W + x) * 4;
            if (isGreen(data[i], data[i + 1], data[i + 2])) { gn++; gx += x; gy += y; }
        }
    }
    const cx = (sx + gx) / (n + gn), cy = (sy + gy) / (n + gn);
    return { dx: cx - CX, dy: cy - CY, dist: Math.hypot(cx - CX, cy - CY), heading: spoke?.deg ?? null, px: n + gn };
}

/** Text pixels on the status line (y 540-566): {n, from, to}. A message leaves 300+. */
export function statusText(png) {
    const { width: W, data } = png;
    let n = 0, from = -1, to = -1;
    for (let y = 540; y < 566; y++) for (let x = 5; x < 630; x++) {
        const i = (y * W + x) * 4;
        if (isWhite(data[i], data[i + 1], data[i + 2])) { n++; if (from < 0 || x < from) from = x; if (x > to) to = x; }
    }
    return { n, from, to };
}

/** Smallest difference between two axes (lines, so 0-90): how far from parallel or anti-parallel. */
export const axisGap = (a, b) => {
    const d = ((((a - b) % 180) + 180) % 180);
    return Math.min(d, 180 - d);
};

/** Signed difference a - b wrapped to -180..180. */
export const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * A spoke angle snapped to the sprite sheet's frame (36 frames, frame 0
 * north): the game draws only these, and the raw mean is off by a few
 * degrees (the spoke is 2 px wide, the frame centre is half a pixel off).
 */
export const snapFrame = (d) => wrap(Math.round((d + 90) / 10) * 10 - 90);

export function readShot(file, { big = false, hulkBig = false } = {}) {
    const png = PNG.sync.read(fs.readFileSync(file));
    const player = playerHeading(png, big);
    const hulk = hulkPose(png, hulkBig);
    const bearing = hulk ? deg(hulk.dx, hulk.dy) : null;
    return {
        player: player ? snapFrame(player.deg) : null,
        playerRaw: player ? +player.deg.toFixed(1) : null,
        hulk: hulk && { dx: +hulk.dx.toFixed(1), dy: +hulk.dy.toFixed(1), dist: +hulk.dist.toFixed(1), heading: hulk.heading === null ? null : snapFrame(hulk.heading), headingRaw: hulk.heading === null ? null : +hulk.heading.toFixed(1) },
        bearing: bearing === null ? null : +bearing.toFixed(0),
        status: statusText(png),
    };
}

/**
 * Every press of a board_sweep / board_capture run (loops/board.mjs
 * `sweep`): the walk's stops, then the sweep's presses, each with what the
 * shot after it shows. `answer` is "dialog", "msg" (a status line) or
 * "silent"; a message stays up until something replaces it, and a press
 * the game answers with nothing CLEARS it (wave 8), so "msg" after a press
 * is that press's own answer.
 */
export function sweepTable(runDir, opts = {}) {
    const lines = fs.readFileSync(`${runDir}/log.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const st = lines.find((l) => l.phase === "step" && l.result?.steps);
    if (!st) return [];
    const rows = [];
    const row = (kind, k, shot, dialog) => {
        const r = readShot(shot, opts);
        rows.push({
            kind, k, dialog, player: r.player, hulkDist: r.hulk?.dist ?? null, hulkHeading: r.hulk?.heading ?? null,
            bearing: r.bearing, rel: r.player !== null && r.bearing !== null ? wrap(r.bearing - r.player) : null,
            axisGap: r.player !== null && r.hulk?.heading != null ? axisGap(r.player, r.hulk.heading) : null,
            answer: dialog ? "dialog" : r.status.n > 100 ? "msg" : "silent", shot: shot.split("/").pop(),
        });
    };
    for (const s of st.result.steps) {
        if (s.shot) row("stop", s.k, s.shot.replace(/^.*\//, `${runDir}/`), s.dialog);
        for (const w of s.sweep ?? []) row("sweep", w.i, w.shot.replace(/^.*\//, `${runDir}/`), w.dialog);
    }
    return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const big = args.includes("--big"), hulkBig = args.includes("--hulk-big");
    const ri = args.indexOf("--run");
    if (ri >= 0) {
        for (const r of sweepTable(args[ri + 1], { big, hulkBig })) {
            console.log([r.kind, String(r.k).padStart(2), "player", r.player, "hulk", r.hulkDist, "hdg", r.hulkHeading,
                "rel", r.rel?.toFixed(0), "axisGap", r.axisGap?.toFixed(0), r.answer, r.shot].join(" "));
        }
        process.exit(0);
    }
    for (const f of args.filter((a) => !a.startsWith("--"))) {
        const r = readShot(f, { big, hulkBig });
        const rel = r.player !== null && r.bearing !== null ? wrap(r.bearing - r.player).toFixed(0) : "";
        const ax = r.player !== null && r.hulk?.heading != null ? axisGap(r.player, r.hulk.heading).toFixed(0) : "";
        console.log([f.split("/").pop(), "player", r.player?.toFixed(0), "hulk", r.hulk && `${r.hulk.dx},${r.hulk.dy}`, "dist", r.hulk?.dist,
            "hulkHdg", r.hulk?.heading, "bearing-rel", rel, "axisGap", ax, "status", r.status.n > 100 ? `${r.status.from}-${r.status.to}` : "none"].join(" "));
    }
}
