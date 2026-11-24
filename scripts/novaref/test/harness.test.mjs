// Specs for the novaref harness modules that run on the MacBook.
// Run: node --test scripts/novaref/test/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

import { frameAt, parseFfmpegStart, stepEntersShip, syncEvents } from "../frame_sync.mjs";
import { acquireLock, lockStatus, lockVerdict } from "../lock.mjs";
import { changeFrames, frameDiffs } from "../analysis/panel_hits.mjs";
import { largestBlob } from "../analysis/blob_offset.mjs";
import { blobs, leadFrame } from "../analysis/fleet_groups.mjs";
import { checkIdLimit } from "../plugin_make.mjs";

const tmpLock = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "novaref-lock-")), "lock");
const deadPid = () => {
    const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    return Number(r.stdout);
};

test("lockVerdict: free, held, stale", () => {
    const alive = () => true, dead = () => false, novaref = () => "node novaref.mjs run x";
    assert.equal(lockVerdict(null), "free");
    assert.equal(lockVerdict({ pid: 5, host: "h" }, { isAlive: alive, commandOf: novaref, hostname: "h" }), "held");
    assert.equal(lockVerdict({ pid: 5, host: "h" }, { isAlive: dead, commandOf: novaref, hostname: "h" }), "stale");
    // A reused pid running something else is stale.
    assert.equal(lockVerdict({ pid: 5, host: "h" }, { isAlive: alive, commandOf: () => "/bin/zsh", hostname: "h" }), "stale");
    // Unreadable record.
    assert.equal(lockVerdict({ unreadable: "x" }, { hostname: "h" }), "stale");
    // Another machine's lock can't be checked: held.
    assert.equal(lockVerdict({ pid: 5, host: "other" }, { isAlive: dead, hostname: "h" }), "held");
});

test("acquireLock is exclusive and release removes only our own lock", async () => {
    const lockPath = tmpLock();
    const a = await acquireLock({ lockPath, owner: "agent-a", cmd: "run x", commandOf: () => "node novaref.mjs" });
    assert.equal(lockStatus({ lockPath }).record.owner, "agent-a");
    await assert.rejects(
        acquireLock({ lockPath, owner: "agent-b", pid: process.pid + 1, commandOf: () => "node novaref.mjs" }),
        (e) => e.holder?.owner === "agent-a");
    a.release();
    assert.equal(lockStatus({ lockPath }).record, null);
    const b = await acquireLock({ lockPath, owner: "agent-b" });
    a.release(); // a second release by the old holder must not drop b's lock
    assert.equal(lockStatus({ lockPath }).record.owner, "agent-b");
    b.release();
});

test("acquireLock takes over a stale lock left by a dead process", async () => {
    const lockPath = tmpLock();
    const dead = deadPid();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: dead, owner: "crashed", host: os.hostname(), start: "then" }));
    const l = await acquireLock({ lockPath, owner: "me" });
    assert.equal(l.tookOverStale.owner, "crashed");
    assert.equal(lockStatus({ lockPath }).record.owner, "me");
    l.release();
});

test("acquireLock waits for a held lock when asked", async () => {
    const lockPath = tmpLock();
    const a = await acquireLock({ lockPath, owner: "first", commandOf: () => "novaref" });
    setTimeout(() => a.release(), 150);
    const b = await acquireLock({ lockPath, owner: "second", pid: process.pid + 1, waitMs: 3000, pollMs: 50,
        commandOf: () => "novaref" });
    assert.equal(lockStatus({ lockPath }).record.owner, "second");
    b.release();
});

test("parseFfmpegStart reads the avfoundation input start", () => {
    const log = "[avfoundation @ 0x7f] Stream #0: not enough frames\n" +
        "Input #0, avfoundation, from '1:none':\n  Duration: N/A, start: 3781.483667, bitrate: N/A\n" +
        "  Stream #0:0: Video: rawvideo\n";
    assert.equal(parseFfmpegStart(log), 3781.483667);
    assert.equal(parseFfmpegStart("Output #0, mp4\n  Duration: N/A, start: 5.0"), null);
});

test("frameAt / syncEvents map host times onto frames", () => {
    const pts = [0, 0.0333, 0.0667, 0.1, 0.2]; // one dropped frame before 0.2
    assert.equal(frameAt(pts, -0.01), -1);
    assert.equal(frameAt(pts, 0), 0);
    assert.equal(frameAt(pts, 0.05), 1);
    assert.equal(frameAt(pts, 0.15), 3);
    assert.equal(frameAt(pts, 9), 4);
    const out = syncEvents([{ host: 100.05, kind: "press", what: "Tab" }, { host: 99, kind: "press", what: "e" },
        { host: 200, kind: "shot", what: "x" }], 100, pts);
    assert.deepEqual(out.map((e) => [e.video_t, e.frame]), [[0.05, 1], [-1, null], [100, null]]);
});

test("panel_hits: frameDiffs and changeFrames find each redraw once", () => {
    // 4-pixel crops: static, one redraw over two frames (h264 settling), static, a second redraw.
    const frames = [[0, 0, 0, 0], [0, 0, 0, 0], [90, 90, 0, 0], [100, 90, 0, 0], [100, 90, 0, 0],
        [100, 90, 0, 0], [0, 90, 90, 0], [0, 90, 90, 0]];
    const raw = Uint8Array.from(frames.flat());
    const diffs = frameDiffs(raw, 4);
    assert.equal(diffs.length, 8);
    assert.equal(diffs[0], 0);
    assert.equal(diffs[2], 45);
    assert.equal(diffs[3], 2.5);
    assert.deepEqual(changeFrames(diffs, 2, 3), [2, 6]);
    // A threshold above the settling diff, and no merging, still finds both.
    assert.deepEqual(changeFrames(diffs, 3, 1), [2, 6]);
    // Merging is by distance from the LAST changed frame.
    assert.deepEqual(changeFrames(Float64Array.from([0, 9, 0, 9, 0, 0, 9]), 1, 3), [1, 6]);
});

test("blob_offset: largestBlob picks the biggest 4-connected component", () => {
    const w = 6, h = 4;
    const mask = Uint8Array.from([
        1, 0, 0, 1, 1, 0,
        0, 0, 0, 1, 1, 0,
        1, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 1, 1,
    ]);
    const b = largestBlob(mask, w, h);
    assert.equal(b.n, 4);
    assert.deepEqual([b.cx, b.cy, b.x0, b.y0, b.x1, b.y1], [3.5, 0.5, 3, 0, 4, 1]);
    // Diagonal neighbours are not connected.
    assert.equal(largestBlob(Uint8Array.from([1, 0, 0, 1]), 2, 2).n, 1);
    assert.equal(largestBlob(new Uint8Array(4), 2, 2), null);
});

test("fleet_groups: blobs and the lead's frame", () => {
    // Two 2x2 blobs of colour 1 and a stray pixel (below min).
    const w = 6, h = 3;
    const L = Int8Array.from([
        1, 1, -1, -1, 1, 1,
        1, 1, -1, -1, 1, 1,
        -1, -1, -1, 1, -1, -1,
    ]);
    const b = blobs(L, w, h, 1, 2);
    assert.deepEqual(b.map(([x, y, n]) => [x, y, n]), [[0.5, 0.5, 4], [4.2, 0.8, 5]]);
    // Lead moving right (+x): a point behind and above it on screen is astern and LEFT of travel.
    assert.deepEqual(leadFrame([90, 90], [100, 100], 3, 0), { along: -10, across: 10 });
    // Moving down the screen (+y): screen +x is to the left of travel.
    const f = leadFrame([110, 100], [100, 100], 0, 2);
    assert.equal(f.along, 0);
    assert.equal(f.across, 10);
});

test("plugin-make refuses ids the game can't load", () => {
    assert.doesNotThrow(() => checkIdLimit({ type: "rlëD", id: 1999 }));
    assert.throws(() => checkIdLimit({ type: "rlëD", id: 2000 }), /limit of 1999/);
    assert.throws(() => checkIdLimit({ type: "wëap", id: 384 }), /limit of 383/);
    assert.throws(() => checkIdLimit({ type: "flët", id: 1000 }), /flët/);
    assert.doesNotThrow(() => checkIdLimit({ type: "düde", id: 639 }));
    assert.doesNotThrow(() => checkIdLimit({ type: "rlëD", id: 2000, unsafeId: true }));
    assert.doesNotThrow(() => checkIdLimit({ type: "dësc", id: 9999 }));
});

test("the test kit stays inside the game's id limits", async () => {
    const kit = (await import("../kits/testkit.mjs")).default;
    for (const r of kit.resources) checkIdLimit(r);
    const keys = kit.resources.map((r) => `${r.type}:${r.id}`);
    assert.equal(new Set(keys).size, keys.length, "duplicate kit resource");
    // A bay's AmmoType is the carried shïp's id itself (stock wëap 149 holds
    // 144); wave 6 found the kit writing id - 128. Every kit bay must name a
    // kit hull or a stock one (the stock block is 128-414).
    const kitShips = new Set(kit.resources.filter((r) => r.type === "shïp").map((r) => r.id));
    for (const r of kit.resources.filter((x) => x.type === "wëap" && (x.set?.guidance === 99 || x.clone === "wëap:149"))) {
        const ammo = r.set.ammoType;
        assert.ok(kitShips.has(ammo) || (ammo >= 128 && ammo <= 414), `bay wëap ${r.id} carries shïp ${ammo}`);
    }
});

test("every kit shän has its running lights switched off (wave 11)", async () => {
    const kit = (await import("../kits/testkit.mjs")).default;
    const shans = kit.resources.filter((r) => r.type === "shän");
    assert.ok(shans.length > 100);
    for (const r of shans) {
        assert.equal(r.set["@30:i16"], -1, `shän ${r.id} LightImage`);
        assert.equal(r.set["@32:i16"], -1, `shän ${r.id} LightMask`);
        assert.equal(r.set["@54:i16"], 0, `shän ${r.id} BlinkMode`);
    }
});

test("board.mjs disabledWord tells Disabled from Shields Down / No Shields", async () => {
    const { disabledWord } = await import("../loops/board.mjs");
    // A synthetic 832 x 604 RGBA shot with white pixels in the panel corner
    // from x 651 to `endX` (Disabled ends near 700, the others past 705).
    const shot = (endX) => {
        const width = 832, height = 604, data = Buffer.alloc(width * height * 4);
        for (let y = 426; y < 436; y++) for (let x = 651; x < endX; x += 2) data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
        return { width, height, data };
    };
    assert.equal(disabledWord(shot(700)), true);
    assert.equal(disabledWord(shot(728)), false);
    assert.equal(disabledWord(shot(651)), false);
});

test("expandSteps unrolls repeat blocks and numbers labels", async () => {
    const { expandSteps } = await import("../steps.mjs");
    const got = expandSteps([
        { keys: "e" },
        { repeat: 2, steps: [{ keys: "l wait 150" }, { shot: "pass-{i}", window: true }] },
        { repeat: 0, steps: [{ keys: "x" }] },
        { shot: "end" },
    ]);
    assert.deepEqual(got, [
        { keys: "e" },
        { keys: "l wait 150" }, { shot: "pass-00", window: true },
        { keys: "l wait 150" }, { shot: "pass-01", window: true },
        { shot: "end" },
    ]);
    // Nested: the inner repeat substitutes its own {i}.
    const nested = expandSteps([{ repeat: 2, steps: [{ repeat: 2, steps: [{ shot: "s{i}" }] }] }]);
    assert.deepEqual(nested.map((s) => s.shot), ["s00", "s01", "s00", "s01"]);
    assert.throws(() => expandSteps([{ repeat: 2 }]), /steps/);
    assert.throws(() => expandSteps([{ repeat: -1, steps: [] }]), /non-negative/);
    assert.deepEqual(expandSteps(undefined), []);
});

test("prefsWrites builds typed defaults-write arguments", async () => {
    const { prefsWrites } = await import("../novaref.mjs");
    assert.deepEqual(prefsWrites({ RunInAWindow: 0, IntroMusic: false, Name: "a b" }),
        ["RunInAWindow -int 0", "IntroMusic -bool NO", "Name -string 'a b'"]);
    assert.throws(() => prefsWrites({ "x; rm -rf ~": 1 }), /bad prefs key/);
    assert.throws(() => prefsWrites({ Ratio: 0.5 }), /unsupported/);
});

test("decoy_track: components, mergeNear and assignRock", async () => {
    const { components, mergeNear, assignRock, PW, PH } = await import("../analysis/decoy_track.mjs");
    const on = new Uint8Array(PW * PH);
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) on[y * PW + x] = 1; // 100 px square
    on[50 * PW + 50] = 1; on[51 * PW + 51] = 1; // two diagonal pixels: one 8-connected component
    const cs = components(on);
    assert.equal(cs.length, 2);
    assert.deepEqual(cs.map((c) => c.n).sort((a, b) => a - b), [2, 100]);
    assert.equal(components(on, 50).length, 1);
    // The red and blue halves of a missile sprite become one detection.
    const m = mergeNear([{ x: 0, y: 0, n: 2 }, { x: 6, y: 0, n: 4 }, { x: 40, y: 0, n: 3 }], 9);
    assert.equal(m.length, 2);
    assert.equal(m[0].x, 4);
    // A track ending on a rock follows THAT rock back, not a nearer passer-by.
    const pts = [
        { x: 0, y: 0, rocks: [[100, 0], [5, 5]] },
        { x: 50, y: 0, rocks: [[95, 0], [50, 8]] },
        { x: 90, y: 0, rocks: [[91, 0]] },
    ];
    assert.equal(pts.length, 3);
    assignRock(pts);
    assert.deepEqual(pts.map((p) => p.rock), [[100, 0], [95, 0], [91, 0]]);
    // Otherwise the nearest rock in each frame.
    const free = [{ x: 0, y: 0, rocks: [[100, 0], [5, 5]] }, { x: 300, y: 300, rocks: [[0, 0]] }];
    assignRock(free);
    assert.deepEqual(free.map((p) => p.rock), [[5, 5], [0, 0]]);
});

test("bolt_births: discs and orange bolts in a frame", async () => {
    const { discsAndBolts } = await import("../analysis/bolt_births.mjs");
    const { PW, PH } = await import("../analysis/decoy_track.mjs");
    const buf = Buffer.alloc(PW * PH * 3);
    const put = (x, y, rgb) => { const q = (y * PW + x) * 3; buf[q] = rgb[0]; buf[q + 1] = rgb[1]; buf[q + 2] = rgb[2]; };
    for (let y = 100; y < 114; y++) for (let x = 100; x < 114; x++) put(x, y, [0, 0, 250]); // 196 px blue disc
    for (let x = 200; x < 208; x++) put(x, 50, [250, 150, 40]); // 8 px orange streak
    const { discs, bolts } = discsAndBolts(buf);
    assert.equal(discs.length, 1);
    assert.equal(discs[0].colour, "blue");
    assert.equal(bolts.length, 1);
    assert.equal(Math.round(bolts[0].x), 204);
});

test("stepEntersShip spots a bare e key", () => {
    assert.equal(stepEntersShip({ keys: "e wait 4000" }), true);
    assert.equal(stepEntersShip({ keys: "Tab e@200" }), true);
    assert.equal(stepEntersShip({ keys: "Escape wait 500" }), false);
    assert.equal(stepEntersShip({ keys: "text:\"e\"" }), false);
    assert.equal(stepEntersShip({ shot: "e" }), false);
});

test("board loop: turn keys, heading from a shift, colour blobs", async () => {
    const { turnKeys, headingFromShift, wrapDeg, findColour, isMagenta, brightShare } = await import("../loops/board.mjs");
    assert.equal(wrapDeg(190), -170);
    assert.equal(wrapDeg(-190), 170);
    // Clockwise on screen (y down) is Right: 87.1 deg/s -> 90 deg in 1033 ms.
    assert.equal(turnKeys(90, 87.1), "Right@1033");
    assert.equal(turnKeys(-45, 87.1), "Left@517");
    assert.equal(turnKeys(2, 87.1), null);
    // The target moved up-left on screen by (-30, -40): we moved (+30, +40),
    // i.e. down-right: atan2(40, 30) = 53.13 deg.
    assert.equal(+headingFromShift([100, 100], [70, 60]).toFixed(2), 53.13);
    assert.equal(headingFromShift([100, 100], [99, 99]), null);
    // A 10x10 magenta square at (400..409, 50..59) and a white one at the centre.
    const W = 832, H = 604, data = Buffer.alloc(W * H * 4);
    const paint = (x0, y0, n, rgb) => { for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) data.set([...rgb, 255], (y * W + x) * 4); };
    paint(400, 50, 10, [255, 0, 255]);
    paint(313, 297, 10, [255, 255, 255]);
    const png = { width: W, height: H, data };
    const m = findColour(png, isMagenta);
    assert.deepEqual([m.x, m.y, m.n], [404.5, 54.5, 100]);
    assert.equal(findColour(png, (r, g, b) => r > 200 && g > 200, 30, 22), null); // the player's sprite is excluded
    assert.ok(brightShare(png) < 0.01);
});

test("magenta_track: finds the hulk even on top of the player's sprite", async () => {
    const { magentaIn } = await import("../analysis/magenta_track.mjs");
    const W = 832, H = 604, rgb = Buffer.alloc(W * H * 3);
    const paint = (x0, y0, n, c) => { for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) rgb.set(c, (y * W + x) * 3); };
    paint(300, 290, 30, [200, 200, 200]); // the player's sprite at the centre
    paint(320, 295, 6, [255, 0, 255]); // a hulk 5 px right of centre, under the player
    const m = magentaIn(rgb);
    assert.deepEqual([m.x, m.y, m.n], [322.5, 297.5, 36]);
    assert.equal(magentaIn(Buffer.alloc(W * H * 3)), null);
});

test("board loop: passKeys crosses the target pressing b at the given spacing", async () => {
    const { passKeys } = await import("../loops/board.mjs");
    // 75 px before + 60 px after at 44 px/s = 3068 ms; 250 ms of thrust, then b every 100 ms.
    const k = passKeys({ turn: "Left@200", dist: 75, speedPxS: 44, overPx: 60, pressGapMs: 100 });
    assert.equal(k.presses, 29);
    assert.equal((k.seq.match(/\bb wait 40\b/g) ?? []).length, 29);
    assert.ok(k.seq.startsWith("Left@200 wait 250 hold:40 gap:20 down:Up wait 250 up:Up b wait 40"));
    assert.ok(k.seq.endsWith("down:Down wait 500 up:Down wait 300"));
    assert.ok(!/Escape/.test(k.seq));
    // No turn, and a floor of three presses.
    const short = passKeys({ dist: 1, speedPxS: 1000, overPx: 0 });
    assert.equal(short.presses, 3);
    assert.ok(short.seq.startsWith("hold:40"));
});

test("board loop: sweepKeys stays put, then turns between presses", async () => {
    const { sweepKeys } = await import("../loops/board.mjs");
    assert.equal(sweepKeys(0), "b wait 700");
    assert.equal(sweepKeys(2), "b wait 700");
    assert.equal(sweepKeys(3), "Right@115 wait 300 b wait 700");
    assert.equal(sweepKeys(1, { repeat: 0, between: "Space@5000 wait 500", waitMs: 900 }), "Space@5000 wait 500 b wait 900");
    for (let i = 0; i < 40; i++) assert.ok(!/Escape/.test(sweepKeys(i)));
    // The target panel's "Disabled" corner: dark = no (or no disabled) target.
    const { targetDisabledShown, targetShown } = await import("../loops/board.mjs");
    const W = 832, H = 604, data = Buffer.alloc(W * H * 4);
    assert.equal(targetDisabledShown({ width: W, height: H, data }), false);
    assert.equal(targetShown({ width: W, height: H, data }), false);
    for (let y = 338; y < 346; y++) for (let x = 690; x < 760; x += 3) data.set([255, 255, 255, 255], (y * W + x) * 4);
    assert.equal(targetShown({ width: W, height: H, data }), true);
    for (let y = 426; y < 436; y++) for (let x = 650; x < 700; x += 2) data.set([255, 255, 255, 255], (y * W + x) * 4);
    assert.equal(targetDisabledShown({ width: W, height: H, data }), true);
});

test("pointer: reads the ring's and the hulk's headings off a shot", async () => {
    const { pointerFrames } = await import("../kits/testkit.mjs");
    const { readShot, axisGap, wrap } = await import("../analysis/pointer.mjs");
    const W = 832, H = 604;
    const png = new (createRequire(import.meta.url)("pngjs").PNG)({ width: W, height: H });
    png.data.fill(0);
    for (let p = 3; p < png.data.length; p += 4) png.data[p] = 255;
    const blit = (frame, cx, cy) => {
        for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
            const v = frame.pixels[y * frame.width + x];
            if (v < 0) continue;
            const i = ((cy - frame.height / 2 + y) * W + (cx - frame.width / 2 + x)) * 4;
            png.data.set([((v >> 10) & 31) << 3, ((v >> 5) & 31) << 3, (v & 31) << 3], i);
        }
    };
    // Hulk frame 9 (nose east) 40 px right of the player; player frame 18 (nose south).
    blit(pointerFrames(24, [31, 0, 31], [0, 31, 0], { outer: 11, spokeFrom: 0, spokeTo: 11 })[9], 358, 302);
    blit(pointerFrames(24, [0, 31, 31], [31, 31, 31], { outer: 11, inner: 9, spokeFrom: 5, spokeTo: 10 })[18], 318, 302);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "novaref-ptr-")), "shot.png");
    fs.writeFileSync(file, createRequire(import.meta.url)("pngjs").PNG.sync.write(png));
    const r = readShot(file);
    assert.equal(r.player, 90, `player ${r.playerRaw}`);
    assert.equal(r.hulk.heading, 0, `hulk ${r.hulk.headingRaw}`);
    assert.ok(Math.abs(wrap(r.playerRaw - 90)) <= 6);
    assert.ok(Math.abs(r.hulk.dist - 40) <= 1.5, `dist ${r.hulk.dist}`);
    assert.ok(Math.abs(r.bearing) <= 2, `bearing ${r.bearing}`);
    assert.equal(axisGap(90, 0), 90);
    assert.equal(axisGap(170, -5), 5);
    assert.equal(r.status.n, 0);
});

test("runScriptStep: a closed-loop script runs ordinary steps and may not press Escape", async () => {
    const { runScriptStep } = await import("../novaref.mjs");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "novaref-script-"));
    fs.writeFileSync(path.join(dir, "loop.mjs"),
        "export default async (api, args) => { await api.step({ wait: 1 }); api.log({ n: args.n }); return { ok: true, n: args.n * 2 }; };\n");
    fs.writeFileSync(path.join(dir, "bad.mjs"),
        "export default async (api) => { await api.step({ keys: 'Up wait 10 Escape' }); return { ok: true }; };\n");
    const logged = [];
    const ctx = { dir, shotN: 0, scenarioDir: dir, record: (o) => logged.push(o) };
    const r = await runScriptStep({ script: "loop.mjs", args: { n: 21 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.n, 42);
    assert.deepEqual(r.events_t, []);
    assert.deepEqual(logged, [{ phase: "script", script: "loop.mjs", n: 21 }]);
    await assert.rejects(runScriptStep({ script: "bad.mjs" }, ctx), /Escape/);
});

test("brackets: the four corner glyphs give the box, its glyph size and the art inside", async () => {
    const { bracketsIn, findBox, components } = await import("../analysis/brackets.mjs");
    const W = 636, H = 604;
    const data = new Uint8Array(W * H * 4);
    const put = (x, y, rgb) => { data.set([...rgb, 255], (y * W + x) * 4); };
    // The original's 9 x 9 neutral glyph (top-left corner), wave 9.
    const TL = ["#...#####", ".#...#...", "..#......", "...#.....", "#........", "##.......", "#........", "#........", "#........"];
    const yellow = [255, 255, 0];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (TL[r][c] !== "#") continue;
        // A 24 px frame's box: 24 + 30 = 54 px, (100, 120) to (153, 173).
        put(100 + c, 120 + r, yellow); put(153 - c, 120 + r, yellow);
        put(100 + c, 173 - r, yellow); put(153 - c, 173 - r, yellow);
    }
    // The target: a 20 px grey square, off the box's centre by (2, 3).
    for (let y = 139; y < 159; y++) for (let x = 118; x < 138; x++) put(x, y, [150, 150, 150]);
    // A lone star and a stray yellow pixel must not matter.
    put(400, 400, [255, 255, 255]); put(500, 50, yellow);
    const found = bracketsIn(data, W, H, { colours: ["yellow"] });
    assert.equal(found.length, 1);
    const [box] = found;
    assert.deepEqual([box.x0, box.y0, box.x1, box.y1], [100, 120, 153, 173]);
    assert.deepEqual([box.w, box.h, box.cx, box.cy], [54, 54, 126.5, 146.5]);
    assert.deepEqual([box.glyph.w, box.glyph.h, box.err], [9, 9, 0]);
    assert.deepEqual([box.art.w, box.art.h, box.art.cx, box.art.cy], [20, 20, 127.5, 148.5]);
    assert.deepEqual(box.glyphs.tl.rows, TL);
    // The glyph's diagonal and its L are 1-2 px apart: one component at reach 2.
    const mask = new Uint8Array(20 * 20);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (TL[r][c] === "#") mask[(r + 2) * 20 + c + 2] = 1;
    assert.equal(components(mask, 20, 20, 2).length, 1);
    assert.ok(components(mask, 20, 20, 1).length > 1);
    // One glyph alone is not a box.
    assert.equal(findBox(components(mask, 20, 20, 2)), null);
});

test("click_targets: shipBlobs finds sprites away from the player and the edge, largest first", async () => {
    const { shipBlobs } = await import("../loops/click_targets.mjs");
    const W = 832, H = 604;
    const data = Buffer.alloc(W * H * 4);
    const rect = (x0, y0, w, h, v = 200) => {
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set([v, v, v, 255], (y * W + x) * 4);
    };
    rect(100, 100, 40, 30);     // a ship, 1200 px
    rect(400, 300, 12, 10);     // a small ship, 120 px
    rect(310, 295, 16, 14);     // the player at the centre: left out
    rect(630, 200, 30, 30);     // across the play area's right edge: left out
    rect(200, 400, 5, 5);       // too small
    // A crescent: the click point must land on the sprite, not its empty middle.
    for (let y = 450; y < 510; y++) for (let x = 450; x < 510; x++) {
        if (Math.hypot(x - 480, y - 480) < 30 && Math.hypot(x - 492, y - 480) > 26) data.set([220, 220, 220, 255], (y * W + x) * 4);
    }
    const blobs = shipBlobs({ width: W, height: H, data }, { minN: 60 });
    assert.deepEqual(blobs.map(b => b.x0).sort((a, b) => a - b), [100, 400, 451]);
    assert.deepEqual(blobs.map(b => b.n), [...blobs.map(b => b.n)].sort((a, b) => b - a));
    for (const b of blobs) assert.ok(data[(b.y * W + b.x) * 4] > 100, `click point ${b.x},${b.y} is on the sprite`);
});
