/**
 * The novaref drive lock: one exclusive lock file on the MacBook
 * (~/.config/novaref/lock by default) held around every command that drives
 * the old Mac, so two agents can never send it input, launch the game or
 * swap plug-ins at the same time.
 *
 * The file is created with O_EXCL and holds JSON {pid, owner, host, cmd,
 * start}. A lock whose pid is no longer a live novaref process on this host
 * is stale and is taken over (and the takeover is reported). Node builtins
 * only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LOCK_PATH = path.join(os.homedir(), ".config", "novaref", "lock");

/** True if `pid` is a live process on this machine. */
export function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM: it exists but belongs to someone else.
        return e.code === "EPERM";
    }
}

/** The command line of a live pid ("" if unknown). */
export function pidCommand(pid) {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return r.status === 0 ? r.stdout.trim() : "";
}

/**
 * Classifies an existing lock record: "free" (no lock), "stale" (its holder
 * is gone, or the pid was reused by something that is not novaref, or the
 * record is unreadable) or "held".
 */
export function lockVerdict(record, { isAlive = pidAlive, commandOf = pidCommand, hostname = os.hostname() } = {}) {
    if (record === null || record === undefined) return "free";
    if (typeof record !== "object" || !Number.isInteger(record.pid)) return "stale";
    // A lock taken on another machine (shared home dir) cannot be checked:
    // treat it as held.
    if (record.host && record.host !== hostname) return "held";
    if (!isAlive(record.pid)) return "stale";
    const cmd = commandOf(record.pid);
    if (cmd && !/novaref/.test(cmd)) return "stale";
    return "held";
}

function readRecord(lockPath) {
    let text;
    try {
        text = fs.readFileSync(lockPath, "utf8");
    } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
    }
    try {
        return JSON.parse(text);
    } catch {
        return { unreadable: text.slice(0, 200) };
    }
}

/**
 * Takes the lock or throws an Error whose `.holder` is the current record.
 * Waits up to `waitMs` (polling) for a held lock to be released. Returns
 * {release, record, tookOverStale}.
 */
export async function acquireLock({
    lockPath = DEFAULT_LOCK_PATH, owner, cmd, waitMs = 0, pollMs = 1000,
    isAlive, commandOf, hostname = os.hostname(), pid = process.pid,
} = {}) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const record = {
        pid, owner: owner ?? process.env.NOVAREF_OWNER ?? process.cwd(), host: hostname,
        cmd: cmd ?? null, start: new Date().toISOString(),
    };
    const deadline = Date.now() + waitMs;
    let tookOverStale = null;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, "wx", 0o644);
            fs.writeSync(fd, JSON.stringify(record) + "\n");
            fs.closeSync(fd);
            break;
        } catch (e) {
            if (e.code !== "EEXIST") throw e;
        }
        const existing = readRecord(lockPath);
        const verdict = lockVerdict(existing, { isAlive, commandOf, hostname });
        if (verdict === "free") continue; // released between open and read
        if (verdict === "stale") {
            // Rename-then-remove so two contenders can't both delete a
            // fresh lock: only one rename of the stale file succeeds.
            const grave = `${lockPath}.stale-${pid}-${Date.now()}`;
            try {
                fs.renameSync(lockPath, grave);
                fs.rmSync(grave, { force: true });
                tookOverStale = existing;
            } catch { /* someone else got there first */ }
            continue;
        }
        if (Date.now() >= deadline) {
            const err = new Error(`the old Mac is locked by pid ${existing.pid} (${existing.owner ?? "?"}, ` +
                `${existing.cmd ?? "?"}, since ${existing.start ?? "?"})`);
            err.holder = existing;
            throw err;
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        const now = readRecord(lockPath);
        if (now && now.pid === pid && now.start === record.start) fs.rmSync(lockPath, { force: true });
    };
    return { release, record, tookOverStale };
}

/** The current lock record and its verdict, for `novaref lock`. */
export function lockStatus({ lockPath = DEFAULT_LOCK_PATH, isAlive, commandOf, hostname } = {}) {
    const record = readRecord(lockPath);
    return { path: lockPath, record, verdict: lockVerdict(record, { isAlive, commandOf, hostname }) };
}
