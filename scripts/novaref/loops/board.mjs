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
 * `b` and shoots again (the status line answers). A boarding dialog (the
 * play area lit by a few percent more than in the shot before the press)
 * ends the walk: `args.dialogClicks` ([x, y, label] window points) are
 * clicked in turn with a shot after each, or Return is pressed if none. Escape is never pressed (it quits to the title in flight).
 *
 * Returns {ok, legs, steps}: every leg's measured offsets and heading, and
 * every boarding stop's distance (read from the shot before `b`).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { statusText } from "../analysis/pointer.mjs";
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

/**
 * Whether the target panel shows a disabled target: the word "Disabled"
 * in its lower-left corner (window x 645-725, y 422-440). "No Target" is
 * drawn in the middle of the panel and leaves that corner dark.
 */
export function targetDisabledShown(png) {
    const { width: W, data } = png;
    let n = 0;
    for (let y = 422; y < 440; y++) for (let x = 645; x < 725; x++) {
        const i = (y * W + x) * 4;
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++;
    }
    return n >= 30;
}

/**
 * Whether anything is targeted: the target's name in white at the top of
 * the target panel (window x 645-825, y 334-348); "No Target" is grey.
 */
export function targetShown(png) {
    const { width: W, data } = png;
    let n = 0;
    for (let y = 334; y < 349; y++) for (let x = 645; x < 825; x++) {
        const i = (y * W + x) * 4;
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++;
    }
    return n >= 20;
}

/**
 * Whether the target panel's lower-left corner reads "Disabled" (white).
 * board.mjs `targetDisabledShown` also counts the white "100%" of a
 * "Shield: 100%" line (its grey label sits in the same corner), so this
 * only looks left of where the percentage starts (window x 645-690).
 * "Shields Down" and "No Shields" are white too but run on past x 705;
 * "Disabled" ends at about x 700 (wave 11).
 */
export function disabledWord(png) {
    const { width: W, data } = png;
    let n = 0, tail = 0;
    for (let y = 422; y < 440; y++) for (let x = 645; x < 740; x++) {
        const i = (y * W + x) * 4;
        if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) {
            if (x < 690) n++;
            else if (x >= 705) tail++;
        }
    }
    return n >= 30 && tail === 0;
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

/**
 * The key string for a full-speed pass over the target (wave 7, the
 * boarding speed gate): an optional turn, a short thrust (an inertialess
 * hull keeps the speed it reaches), `b` every `pressGapMs` until the hull
 * is `overPx` past the target's centre, then Down to stop. Returns
 * {seq, presses}.
 */
export function passKeys({ turn = null, dist, speedPxS, overPx = 60, pressGapMs = 100, thrustMs = 250, brakeMs = 500 }) {
    const crossMs = (dist + overPx) / speedPxS * 1000;
    const presses = Math.max(3, Math.ceil((crossMs - thrustMs) / pressGapMs));
    // hold 40 + gap 20 per key, so each press takes about 60 ms plus its wait.
    const each = `b wait ${Math.max(0, pressGapMs - 60)}`;
    const seq = `${turn ? turn + " wait 250 " : ""}hold:40 gap:20 down:Up wait ${thrustMs} up:Up ${Array(presses).fill(each).join(" ")} down:Down wait ${brakeMs} up:Down wait 300`;
    return { seq, presses };
}

/**
 * The keys of sweep press `i` (wave 8, `args.sweep`): the first `repeat`
 * presses stay put (does the same stop answer the same way twice?), every
 * later one is preceded by `between` (default: a `turnMs` tap of Right, so
 * the player turns in place about 10 degrees between presses).
 */
export function sweepKeys(i, { repeat = 3, turnMs = 115, between = null, waitMs = 700 } = {}) {
    const before = i < repeat ? "" : (between ?? `Right@${turnMs} wait 300`);
    return `${before ? before + " " : ""}b wait ${waitMs}`;
}

/**
 * Presses `b` again and again at one stop (wave 8). Each press is shot;
 * a dialog (the play area `dialogShare` brighter than at the start) is
 * shot and closed with Abort (`sweep.abort`, default the plunder dialog's
 * Abort button), so the next press can open it again. With
 * `sweep.dialogClicks` those buttons are clicked instead (each followed by
 * a shot) the first `sweep.clickTimes` times a dialog opens.
 */
async function runSweep(api, shoot, sweep, basePng, dialogClicks, stopWhenEnabled = false) {
    const base = brightShare(basePng);
    const presses = sweep.presses ?? 36;
    const out = [];
    let opened = 0;
    for (let i = 0; i < presses; i++) {
        await api.step({ keys: sweepKeys(i, sweep) });
        const r = await shoot("sw");
        const lit = brightShare(r.png) - base;
        const dialog = lit > (sweep.dialogShare ?? 0.03);
        const rec = { i, dialog, lit: +lit.toFixed(3), shot: r.file };
        if (dialog) {
            const clicks = opened < (sweep.clickTimes ?? 0) ? (sweep.dialogClicks ?? dialogClicks ?? []) : [];
            for (const [x, y, label] of clicks) {
                await api.step({ click: [x, y], win: true });
                await api.step({ wait: 1000 });
                await shoot(`sw-${label}`);
            }
            if (!clicks.length) {
                await api.step({ click: sweep.abort ?? [418, 380], win: true });
                await api.step({ wait: 1000 });
                await shoot("sw-abort");
            }
            opened++;
        }
        // Wave 11: an own escort is repaired without a dialog; stop there.
        if (stopWhenEnabled && !dialog && targetShown(r.png) && !disabledWord(r.png)) {
            rec.enabled = true;
            out.push(rec);
            api.log({ sweep: i, enabled: true });
            break;
        }
        out.push(rec);
        api.log({ sweep: i, dialog, lit: rec.lit });
        if (sweep.stopAfter && opened >= sweep.stopAfter) break;
    }
    return out;
}

export default async function board(api, args = {}) {
    const speed = args.speedPxS ?? 44; // Kit Crawler 100
    const turnRate = args.turnDegS ?? 87.1;
    const near = args.near ?? 160;
    const stepMs = args.stepMs ?? 250;
    // How long Down is held to stop: 400 ms stops an Accel-2000 Crawler;
    // a soft hull (Kit Crawler Soft, Accel 200) needs about 1.5 s.
    const brakeMs = args.brakeMs ?? 400;
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
        const d = findColour(png, isMagenta, 12); // 12: a disc half under the player still counts (wave 7)
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
    await api.step({ keys: `down:Up wait ${calMs} up:Up down:Down wait ${brakeMs} up:Down wait 300` });
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
        await api.step({ keys: `${keys ? keys + " wait 150 " : ""}down:Up wait ${ms} up:Up down:Down wait ${brakeMs} up:Down wait 300` });
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

    // Wave 8: a hulk 2,000+ px out at the start may not be Tab-able yet
    // (the target panel stayed "No Target"), and `b` with no target is
    // answered with nothing. Tab until the panel names a target (with
    // one ship around, Tab toggles between it and "No Target").
    for (let t = 0; t < (args.retarget ?? 0) && !targetShown(s.png); t++) {
        await api.step({ keys: "Tab wait 400" });
        s = await shoot("retarget");
        api.log({ retarget: t, targeted: targetShown(s.png), disabled: targetDisabledShown(s.png) });
    }

    // Step in, pressing b at each stop (or, with args.pass, cross the
    // target at full speed pressing b all the way).
    const steps = [];
    const pass = args.pass;
    const sweep = args.sweep;
    let fired = false;
    for (let k = 0; k < maxSteps; k++) {
        const dist = Math.hypot(...loc.o);
        const want = bearing(loc.o);
        if (pass) {
            const before = loc.o;
            const tk = turnKeys(wrapDeg(want - heading), turnRate);
            if (dist > pass.fromPx + 35) {
                // One aimed leg to about fromPx, then re-measure.
                const ms = Math.max(150, Math.round((dist - pass.fromPx) / speed * 1000));
                await api.step({ keys: `${tk ? tk + " wait 150 " : ""}down:Up wait ${ms} up:Up down:Down wait ${brakeMs} up:Down wait 300` });
                heading = want;
                s = await shoot("step");
                loc = locate(s.png);
                if (!loc.o || !loc.on) break;
                const measured = headingFromShift(before, loc.o, 5);
                if (measured !== null) heading = measured;
                continue;
            }
            const keys = passKeys({ turn: tk, dist, speedPxS: speed, brakeMs: Math.max(500, brakeMs), ...pass });
            api.log({ pass: { dist: +dist.toFixed(1), o: loc.o.map((v) => +v.toFixed(1)), aimed: Math.round(want), from: Math.round(heading), presses: keys.presses } });
            await api.step({ keys: keys.seq });
            const reply = await shoot("pass");
            const lit = brightShare(reply.png) - brightShare(s.png);
            const dialog = lit > (args.dialogShare ?? 0.03);
            steps.push({ k, pass: true, dist: +dist.toFixed(1), o: loc.o.map((v) => +v.toFixed(1)), presses: keys.presses, shot: reply.file, dialog, lit: +lit.toFixed(3) });
            if (dialog) {
                for (const [x, y, label] of args.dialogClicks ?? []) {
                    await api.step({ click: [x, y], win: true });
                    await api.step({ wait: 1000 });
                    await shoot(`dialog-${label}`);
                }
            }
            break;
        }
        if (args.fire && !fired && dist <= args.fire.atPx) {
            // Wave 8 (capture): damage the target once on the way in, e.g.
            // "Space@300" for one turret shot, then shoot the result.
            fired = true;
            await api.step({ keys: args.fire.keys });
            s = await shoot("fired");
            api.log({ fired: args.fire.keys, dist: Math.round(dist) });
        }
        if (sweep && (dist <= sweep.atPx || loc.hidden)) {
            const r = await runSweep(api, shoot, sweep, s.png, args.dialogClicks, args.stopWhenEnabled);
            steps.push({ k, dist: +dist.toFixed(1), o: loc.o.map((v) => +v.toFixed(1)), sweep: r });
            break;
        }
        // Wave 7: face the target at every stop, however close (was > 12 px):
        // close stops that skipped the turn often got no answer at all.
        const keys = dist > (args.faceMinPx ?? 3) ? turnKeys(wrapDeg(want - heading), turnRate) : null;
        if (keys) heading = want;
        await api.step({ keys: `${keys ? keys + " wait 150 " : ""}wait 200 b wait 700` });
        const reply = await shoot("b");
        // The plunder dialog (about 310x190 px in the 832x604 window) lights
        // a few percent of the play area that was dark in the shot before
        // the press (wave 6: a fixed 25% threshold never fired).
        const lit = brightShare(reply.png) - brightShare(s.png);
        const dialog = lit > (args.dialogShare ?? 0.03);
        steps.push({ k, dist: +dist.toFixed(1), o: loc.o.map((v) => +v.toFixed(1)), shot: reply.file, dialog, lit: +lit.toFixed(3) });
        api.log({ step: k, dist: Math.round(dist), dialog, lit: +lit.toFixed(3) });
        // Wave 8: a hulk boards only ONCE, even when the dialog is left with
        // Abort (every later press: "You can't board this ship."), so a
        // dialog during a sweep run ends it; nothing is left to sweep.
        // `sweep.startOnSilent` starts the sweep at the first press the game
        // answers with nothing (the status line is cleared, not rewritten).
        // Wave 11: boarding one's own disabled escort repairs it ("Escort
        // repaired.", no dialog); with args.stopWhenEnabled the walk ends
        // at the first press after which the panel no longer says Disabled.
        if (args.stopWhenEnabled && !dialog && targetShown(reply.png) && !disabledWord(reply.png)) {
            steps[steps.length - 1].enabled = true;
            api.log({ step: k, enabled: true });
            break;
        }
        const silent = !dialog && statusText(reply.png).n < 100;
        steps[steps.length - 1].silent = silent;
        if (sweep && !dialog && silent && sweep.startOnSilent) {
            const r = await runSweep(api, shoot, sweep, s.png, args.dialogClicks, args.stopWhenEnabled);
            steps[steps.length - 1].sweep = r;
            break;
        }
        if (dialog) {
            // Optional clicks on the dialog's buttons (window points), each
            // followed by a shot, e.g. Credits, Cargo, then Abort.
            for (const [x, y, label] of args.dialogClicks ?? []) {
                await api.step({ click: [x, y], win: true });
                await api.step({ wait: 1000 });
                await shoot(`dialog-${label}`);
            }
            if (!(args.dialogClicks ?? []).length) await api.step({ keys: "Return wait 1500" });
            await shoot("after-dialog");
            break;
        }
        if (dist < 6) break;
        const before = loc.o;
        await api.step({ keys: `down:Up wait ${dist < (args.fineBelowPx ?? 0) ? args.fineStepMs : stepMs} up:Up down:Down wait ${brakeMs} up:Down wait 300` });
        s = await shoot("step");
        loc = locate(s.png);
        if (!loc.o || !loc.on) {
            // Wave 7: a step that ends with the hulk hidden under the
            // player's sprite used to end the walk without a single `b` on
            // top of it. Press once more there (dist 0, then stop).
            if (dist < 30) { loc = { on: true, o: [0, 0], hidden: true }; continue; }
            break;
        }
        const measured = headingFromShift(before, loc.o, 5);
        if (measured !== null) heading = measured;
    }
    return { ok: true, legs, steps };
}
