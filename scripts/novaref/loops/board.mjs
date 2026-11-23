/**
 * Closed-loop approach and boarding (wave 6, U9 leftover), run as a
 * scenario `{"script": "../loops/board.mjs", "args": {...}}` step (README
 * "Scenarios"). The harness can only press keys and read screenshots, so
 * the player is steered by measurement:
 *
 *  - the TARGET is a magenta disc hull (kits/testkit.mjs shïp 795 Kit
 *    Hulk), found by colour in a window shot; off screen it is the one
 *    radar blip away from the centre (about 33 world px per radar px);
 *  - the player's HEADING is measured, not assumed: thrust, brake, and the
 *    target's (or the stellar's) shift on screen is minus the player's
 *    displacement. Turns in between are dead-reckoned at the hull's turn
 *    rate (Turn 30 = 87.1 deg/s, #316) and re-measured after every leg;
 *  - an inertialess hull (Kit Crawler) stops dead on Down, so every leg
 *    ends at rest and the next shot is clean.
 *
 * Once within `args.near` px it steps in by `args.stepMs` of thrust at a
 * time, re-aiming each step, and at each stop shoots the window, presses
 * `b` and shoots again (the status line answers). A boarding dialog (a big
 * bright window over the play area) ends the walk: it is shot, then closed
 * with Return. Escape is never pressed (it quits to the title in flight).
 *
 * Returns {ok, legs, steps}: every leg's measured offsets and heading, and
 * every boarding stop's distance (read from the shot before `b`).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { RADAR, blipsIn } from "../analysis/radar_blips.mjs";

const { PNG } = createRequire(import.meta.url)("pngjs");

export const CX = 318, CY = 302, PLAY_W = 636, PLAY_H = 604;
const WORLD_PER_RADAR_PX = 33;

export const isMagenta = (r, g, b) => r > 170 && b > 170 && g < 90;

/**
 * Largest 4-connected component of pixels passing `test` in the play area
 * of an RGBA PNG, ignoring pixels within `exclude` px of the centre (the
 * player's own sprite): {x, y, n} or null.
 */
export function findColour(png, test, minN = 30, exclude = 0) {
    const { width: W, data } = png;
    const H = Math.min(png.height, PLAY_H);
    const mask = new Uint8Array(PLAY_W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < PLAY_W; x++) {
        if (exclude && (x - CX) ** 2 + (y - CY) ** 2 <= exclude * exclude) continue;
        const i = (y * W + x) * 4;
        if (test(data[i], data[i + 1], data[i + 2])) mask[y * PLAY_W + x] = 1;
    }
    let best = null;
    const seen = new Uint8Array(mask.length);
    for (let s = 0; s < mask.length; s++) {
        if (!mask[s] || seen[s]) continue;
        const st = [s];
        seen[s] = 1;
        let n = 0, sx = 0, sy = 0;
        while (st.length) {
            const q = st.pop();
            const qx = q % PLAY_W, qy = (q - qx) / PLAY_W;
            n++; sx += qx; sy += qy;
            for (const r of [qx > 0 ? q - 1 : -1, qx < PLAY_W - 1 ? q + 1 : -1, q - PLAY_W, q + PLAY_W]) {
                if (r >= 0 && r < mask.length && mask[r] && !seen[r]) { seen[r] = 1; st.push(r); }
            }
        }
        if (!best || n > best.n) best = { x: sx / n, y: sy / n, n };
    }
    return best && best.n >= minN ? best : null;
}

/** Share of play-area pixels brighter than `level` (a dialog over the play area lights most of it). */
export function brightShare(png, level = 60) {
    const { width: W, data } = png;
    let n = 0, tot = 0;
    for (let y = 0; y < Math.min(png.height, PLAY_H); y++) for (let x = 0; x < PLAY_W; x++) {
        const i = (y * W + x) * 4;
        tot++;
        if (Math.max(data[i], data[i + 1], data[i + 2]) > level) n++;
    }
    return n / tot;
}

/** Radar blips (radar px from the player) of an RGBA window PNG. */
export function radarOf(png) {
    const rgb = Buffer.alloc(png.width * png.height * 3);
    for (let p = 0, q = 0; p < png.data.length; p += 4, q += 3) {
        rgb[q] = png.data[p]; rgb[q + 1] = png.data[p + 1]; rgb[q + 2] = png.data[p + 2];
    }
    return blipsIn(rgb, png.width, RADAR);
}

export const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
export const bearing = ([dx, dy]) => Math.atan2(dy, dx) * 180 / Math.PI;

/**
 * Keys that turn the ship by `delta` degrees in screen angles (0 = east,
 * +90 = south, y down): Right turns clockwise on screen (the angle grows),
 * Left counter-clockwise. Returns null for turns under one frame.
 */
export function turnKeys(delta, degPerS) {
    const ms = Math.round(Math.abs(delta) / degPerS * 1000);
    if (ms < 35) return null;
    return `${delta > 0 ? "Right" : "Left"}@${ms}`;
}

/** Heading from a target's screen offset before and after a straight leg (null if it moved too little). */
export function headingFromShift(before, after, minPx = 12) {
    const d = [before[0] - after[0], before[1] - after[1]];
    return Math.hypot(...d) >= minPx ? bearing(d) : null;
}

export default async function board(api, args = {}) {
    const speed = args.speedPxS ?? 44; // Kit Crawler 100
    const turnRate = args.turnDegS ?? 87.1;
    const near = args.near ?? 160;
    const stepMs = args.stepMs ?? 250;
    const maxLegs = args.maxLegs ?? 14;
    const maxSteps = args.maxSteps ?? 30;
    let shotN = 0;
    const shoot = async (label) => {
        const r = await api.step({ shot: `${label}-${String(shotN++).padStart(2, "0")}`, window: true });
        return { png: PNG.sync.read(fs.readFileSync(r.path)), file: r.path };
    };
    // Dead-reckoned player position (world px from the start, i.e. from the
    // stellar it starts on), so the stellar's radar blip can be told from
    // the target's.
    let pos = [0, 0];
    const moved = (deg, ms) => {
        const r = deg * Math.PI / 180, d = speed * ms / 1000;
        pos = [pos[0] + d * Math.cos(r), pos[1] + d * Math.sin(r)];
    };
    /** Target offset from the player: on screen exact, else from the radar. */
    const locate = (png) => {
        const d = findColour(png, isMagenta);
        if (d) return { on: true, o: [d.x - CX, d.y - CY] };
        const st = [-pos[0] / WORLD_PER_RADAR_PX, -pos[1] / WORLD_PER_RADAR_PX];
        // The player's own blip sits at the centre; a stellar is a bigger
        // square than a ship's 1-2 px dot (wave 6: the dead-reckoned
        // stellar position alone was off by more than 3 radar px after a
        // 900 px leg, leaving two candidates).
        let blips = radarOf(png).filter((b) => Math.hypot(b.x, b.y) > 4);
        if (blips.length > 1) blips = blips.filter((b) => Math.hypot(b.x - st[0], b.y - st[1]) > 3);
        if (blips.length > 1) blips = blips.filter((b) => b.n <= 2);
        if (blips.length > 1) blips.sort((a, b) => Math.hypot(b.x - st[0], b.y - st[1]) - Math.hypot(a.x - st[0], a.y - st[1]));
        if (blips.length >= 1) return { on: false, o: [blips[0].x * WORLD_PER_RADAR_PX, blips[0].y * WORLD_PER_RADAR_PX], blips };
        return { on: false, o: null, blips };
    };
    const legs = [];
    let heading = null;

    // Calibrate the heading on a first leg (the target, or failing that the
    // stellar we start on, shifts by minus our displacement).
    const start = await shoot("start");
    let s = start;
    let loc = locate(s.png);
    api.log({ start: loc });
    if (!loc.o) return { ok: false, error: "target not found", legs };
    const calMs = args.calMs ?? 1500;
    await api.step({ keys: `down:Up wait ${calMs} up:Up down:Down wait 400 up:Down wait 300` });
    s = await shoot("cal");
    const after = locate(s.png);
    if (loc.on && after.on) heading = headingFromShift(loc.o, after.o);
    if (heading === null) {
        // The stellar (the largest bright blob outside the player's sprite)
        // shifts the same way.
        const bright = (r, g, b) => Math.max(r, g, b) > 70 && !isMagenta(r, g, b);
        const a = findColour(start.png, bright, 200, 22), b = findColour(s.png, bright, 200, 22);
        if (a && b) heading = headingFromShift([a.x, a.y], [b.x, b.y], 20);
    }
    if (heading === null && after.o && loc.o) heading = headingFromShift(loc.o, after.o, 40); // radar: coarse
    legs.push({ leg: "cal", before: loc.o, after: after.o, heading });
    if (heading !== null) moved(heading, calMs);
    loc = after;
    if (heading === null) return { ok: false, error: "heading not measured", legs };

    // Approach legs.
    for (let i = 0; i < maxLegs && loc.o; i++) {
        const dist = Math.hypot(...loc.o);
        if (dist <= near) break;
        const want = bearing(loc.o);
        const keys = turnKeys(wrapDeg(want - heading), turnRate);
        const run = Math.min(dist - near * 0.6, args.maxLegPx ?? 900);
        const ms = Math.max(200, Math.round(run / speed * 1000));
        await api.step({ keys: `${keys ? keys + " wait 150 " : ""}down:Up wait ${ms} up:Up down:Down wait 400 up:Down wait 300` });
        heading = want;
        s = await shoot("leg");
        const next = locate(s.png);
        const measured = loc.on && next.on ? headingFromShift(loc.o, next.o) : null;
        if (measured !== null) heading = measured;
        moved(heading, ms);
        legs.push({ leg: i, before: loc.o, after: next.o, on: next.on, aimed: want, measured, ms });
        api.log({ leg: i, dist: Math.round(dist), aimed: Math.round(want), measured: measured && Math.round(measured), ms });
        loc = next;
    }
    if (!loc.o || !loc.on) return { ok: false, error: "target not on screen after the approach", legs };

    // Step in, pressing b at each stop.
    const steps = [];
    for (let k = 0; k < maxSteps; k++) {
        const dist = Math.hypot(...loc.o);
        const want = bearing(loc.o);
        const keys = dist > 12 ? turnKeys(wrapDeg(want - heading), turnRate) : null;
        if (keys) heading = want;
        await api.step({ keys: `${keys ? keys + " wait 150 " : ""}wait 200 b wait 700` });
        const reply = await shoot("b");
        const dialog = brightShare(reply.png) > 0.25;
        steps.push({ k, dist: +dist.toFixed(1), o: loc.o.map((v) => +v.toFixed(1)), shot: reply.file, dialog });
        api.log({ step: k, dist: Math.round(dist), dialog });
        if (dialog) {
            await api.step({ wait: 1000 });
            await shoot("dialog");
            await api.step({ keys: "Return wait 1500" });
            await shoot("after-dialog");
            break;
        }
        if (dist < 6) break;
        const before = loc.o;
        await api.step({ keys: `down:Up wait ${stepMs} up:Up down:Down wait 400 up:Down wait 300` });
        s = await shoot("step");
        loc = locate(s.png);
        if (!loc.o || !loc.on) break;
        const measured = headingFromShift(before, loc.o, 5);
        if (measured !== null) heading = measured;
    }
    return { ok: true, legs, steps };
}
