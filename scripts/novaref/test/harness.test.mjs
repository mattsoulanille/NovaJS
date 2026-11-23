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

test("stepEntersShip spots a bare e key", () => {
    assert.equal(stepEntersShip({ keys: "e wait 4000" }), true);
    assert.equal(stepEntersShip({ keys: "Tab e@200" }), true);
    assert.equal(stepEntersShip({ keys: "Escape wait 500" }), false);
    assert.equal(stepEntersShip({ keys: "text:\"e\"" }), false);
    assert.equal(stepEntersShip({ shot: "e" }), false);
});
