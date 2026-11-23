// Specs for the novaref harness modules that run on the MacBook.
// Run: node --test scripts/novaref/test/
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("stepEntersShip spots a bare e key", () => {
    assert.equal(stepEntersShip({ keys: "e wait 4000" }), true);
    assert.equal(stepEntersShip({ keys: "Tab e@200" }), true);
    assert.equal(stepEntersShip({ keys: "Escape wait 500" }), false);
    assert.equal(stepEntersShip({ keys: "text:\"e\"" }), false);
    assert.equal(stepEntersShip({ shot: "e" }), false);
});
