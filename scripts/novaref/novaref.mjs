#!/usr/bin/env node
/**
 * novaref: drive the original EV Nova on the reference Mac over ssh.
 *
 * Every subcommand prints ONE machine-readable JSON line on stdout
 * ({"ok":true|false, "cmd": ..., ...}); diagnostics go to stderr. Exit code
 * is 0 when ok, 1 otherwise. See scripts/novaref/README.md.
 *
 * Node builtins only; the remote side is scripts/novaref/remote/
 * novaref_helper.py, uploaded to ~/novaref on first use (and whenever its
 * hash changes).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER_LOCAL = path.join(HERE, "remote", "novaref_helper.py");
const CONFIG_PATH = path.join(os.homedir(), ".config", "novaref", "config.json");

const DEFAULT_CONFIG = {
    host: "10.77.0.2",
    user: "matthew",
    identityFile: "~/.ssh/fox",
    // Remote paths are relative to the remote $HOME unless absolute.
    remoteDir: "novaref",
    app: "/Applications/EV Nova.app",
    bundleId: "com.AmbrosiaSW.EV_Nova",
    pilotsDir: "Library/Application Support/EV Nova/Pilots",
    python: "/usr/bin/python",
    ffmpeg: "novaref/bin/ffmpeg",
    // Default per-key hold and inter-step gap for `keys`, in ms.
    keyHoldMs: 80,
    keyGapMs: 60,
    // Height of the window title bar above EV Nova's content (windowed mode).
    titleBarPt: 22,
};

// ---------------------------------------------------------------- config

function expandHome(p) {
    return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    }
    const cfg = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
    cfg.identityFile = expandHome(cfg.identityFile);
    return cfg;
}

const cfg = loadConfig();

// ---------------------------------------------------------------- output

class NovarefError extends Error {
    constructor(message, extra = {}) {
        super(message);
        this.extra = extra;
    }
}

function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

function log(...args) {
    process.stderr.write(`[novaref] ${args.join(" ")}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function timestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
        `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------- ssh

/** POSIX single-quote a string for a shell. */
export function shq(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** A remote path, shell-quoted, relative paths anchored at "$HOME". */
function rq(p) {
    return p.startsWith("/") ? shq(p) : `"$HOME"/${shq(p)}`;
}

const controlDir = path.join(os.homedir(), ".config", "novaref", "cm");

function sshArgs() {
    fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
    return [
        "-i", cfg.identityFile,
        "-o", "IdentitiesOnly=yes",
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "ControlMaster=auto",
        "-o", `ControlPath=${controlDir}/%C`,
        "-o", "ControlPersist=120",
    ];
}

const target = () => `${cfg.user}@${cfg.host}`;

/** Runs a remote shell command; returns {code, stdout, stderr}. */
function ssh(command, { input, allowFail = false, encoding = "utf8" } = {}) {
    const res = spawnSync("ssh", [...sshArgs(), target(), command], {
        input, encoding, maxBuffer: 256 * 1024 * 1024,
    });
    if (res.error) throw new NovarefError(`ssh failed: ${res.error.message}`);
    if (res.status !== 0 && !allowFail) {
        throw new NovarefError(`remote command failed (exit ${res.status})`, {
            stderr: String(res.stderr).trim().slice(-2000),
        });
    }
    return { code: res.status, stdout: res.stdout, stderr: String(res.stderr) };
}

function scpFrom(remotePath, localPath) {
    const res = spawnSync("scp", ["-q", ...sshArgs(), `${target()}:${remotePath}`, localPath],
        { encoding: "utf8" });
    if (res.status !== 0) {
        throw new NovarefError(`scp from ${remotePath} failed`, { stderr: res.stderr.trim() });
    }
}

function scpTo(localPath, remotePath) {
    const res = spawnSync("scp", ["-q", ...sshArgs(), localPath, `${target()}:${remotePath}`],
        { encoding: "utf8" });
    if (res.status !== 0) {
        throw new NovarefError(`scp to ${remotePath} failed`, { stderr: res.stderr.trim() });
    }
}

/** Parses the last JSON line of helper output. */
function parseJsonLine(text) {
    const lines = String(text).trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        try { return JSON.parse(lines[i]); } catch { /* keep looking */ }
    }
    throw new NovarefError("no JSON from remote helper", { output: String(text).slice(-1000) });
}

let helperReady = false;

/** Uploads the helper to ~/novaref if missing or out of date. */
function ensureHelper() {
    if (helperReady) return;
    const body = fs.readFileSync(HELPER_LOCAL);
    const sha = createHash("sha1").update(body).digest("hex");
    const dir = rq(cfg.remoteDir);
    const remoteSha = ssh(`mkdir -p ${dir}/tmp ${dir}/backups ${dir}/state && ` +
        `cat ${dir}/novaref_helper.sha1 2>/dev/null || true`).stdout.trim();
    if (remoteSha !== sha) {
        log("uploading helper to ~/" + cfg.remoteDir);
        ssh(`cat > ${dir}/novaref_helper.py && echo ${sha} > ${dir}/novaref_helper.sha1`,
            { input: body });
    }
    helperReady = true;
}

/** Runs the remote helper and returns its parsed JSON result. */
function helper(args, { front = null } = {}) {
    ensureHelper();
    const pre = front ? ["--front", front] : [];
    const cmd = [cfg.python, `${rq(cfg.remoteDir)}/novaref_helper.py`,
        ...[...pre, ...args].map(shq)].join(" ");
    const res = ssh(cmd, { allowFail: true });
    const out = parseJsonLine(res.stdout + "\n");
    if (!out.ok) throw new NovarefError(out.error || "helper failed", { helper: out });
    return out;
}

// ---------------------------------------------------------------- key parsing

/**
 * Parses a key sequence string into helper steps.
 *
 *   Return  Escape  Up  a  cmd+q  shift+Tab  F1
 *   Space@500            hold this key 500 ms
 *   Down*3               press 3 times
 *   wait 500 | wait:500  pause
 *   down:Up / up:Up      press / release without the other half (long holds)
 *   text:"hello"         type literal text (file dialogs, pilot names)
 *   hold:120 / gap:100   change default hold / inter-key gap from here on
 */
export function parseKeys(seq, { hold, gap }) {
    const tokens = [];
    const re = /\s*(?:(\w+):"((?:[^"\\]|\\.)*)"|"((?:[^"\\]|\\.)*)"|(\S+))/gy;
    let m;
    while ((m = re.exec(seq)) !== null && m[0].trim() !== "") {
        if (m[1] !== undefined) tokens.push({ kw: m[1], str: m[2].replace(/\\(.)/g, "$1") });
        else if (m[3] !== undefined) tokens.push({ str: m[3].replace(/\\(.)/g, "$1") });
        else tokens.push({ tok: m[4] });
    }
    const steps = [{ hold_default: hold }, { gap }];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kw === "text" || t.kw === "type") { steps.push({ text: t.str }); continue; }
        if (t.str !== undefined) throw new NovarefError(`bare string ${JSON.stringify(t.str)}; use text:"..."`);
        const tok = t.tok;
        let mm;
        if (tok === "wait" || tok === "text" || tok === "type") {
            const next = tokens[++i];
            if (!next) throw new NovarefError(`${tok} needs an argument`);
            if (tok === "wait") steps.push({ wait: parseMs(next.tok ?? next.str) });
            else steps.push({ text: next.str ?? next.tok });
        } else if ((mm = /^wait:(\d+)(ms)?$/i.exec(tok)) || (mm = /^(\d+)ms$/i.exec(tok))) {
            steps.push({ wait: Number(mm[1]) });
        } else if ((mm = /^hold:(\d+)$/i.exec(tok))) {
            steps.push({ hold_default: Number(mm[1]) });
        } else if ((mm = /^gap:(\d+)$/i.exec(tok))) {
            steps.push({ gap: Number(mm[1]) });
        } else if ((mm = /^(down|up):(.+)$/i.exec(tok))) {
            steps.push({ [mm[1].toLowerCase()]: mm[2] });
        } else if ((mm = /^(.+?)(?:@(\d+))?(?:\*(\d+))?$/.exec(tok))) {
            // "+" alone is the key itself, not a separator.
            const parts = mm[1] === "+" ? ["+"] : mm[1].split("+");
            const key = parts.pop();
            const step = { k: key };
            if (parts.length) step.mods = parts;
            if (mm[2]) step.hold = Number(mm[2]);
            if (mm[3]) step.repeat = Number(mm[3]);
            steps.push(step);
        }
    }
    return steps;
}

function parseMs(s) {
    const m = /^(\d+)(ms|s)?$/.exec(String(s));
    if (!m) throw new NovarefError(`bad duration ${s}`);
    return m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]);
}

// ---------------------------------------------------------------- arg helpers

function takeFlag(args, name) {
    const i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
}

function takeOpt(args, name) {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined) throw new NovarefError(`${name} needs a value`);
    args.splice(i, 2);
    return v;
}

// ---------------------------------------------------------------- commands

function novaPids() {
    const out = ssh(`pgrep -f ${shq(cfg.app + "/Contents/MacOS/")} || true`).stdout.trim();
    return out ? out.split("\n").map(Number) : [];
}

function info() {
    return helper(["info"]);
}

/** EV Nova's main window and its content origin, in screen points. */
function novaWindow(inf = info()) {
    const wins = inf.nova_windows.filter((w) => w.layer === 0);
    if (!wins.length) return null;
    const w = wins.reduce((a, b) => (a.bounds[2] * a.bounds[3] >= b.bounds[2] * b.bounds[3] ? a : b));
    const [x, y, wd, ht] = w.bounds;
    const fullscreen = x === 0 && y === 0 && wd === inf.screen_points[0] && ht === inf.screen_points[1];
    const tb = fullscreen ? 0 : cfg.titleBarPt;
    return { bounds: w.bounds, content: [x, y + tb, wd, ht - tb], fullscreen };
}

async function cmdStatus() {
    const t0 = Date.now();
    let reachable = true;
    try {
        ssh("true");
    } catch (e) {
        reachable = false;
        return { ok: false, cmd: "status", reachable, error: e.message };
    }
    const inf = info();
    const pids = novaPids();
    const win = novaWindow(inf);
    return {
        ok: true, cmd: "status", reachable, rtt_ms: Date.now() - t0,
        console_user: inf.console_user, on_console: inf.on_console,
        screen_locked: inf.screen_locked, display_asleep: inf.display_asleep,
        nova_running: pids.length > 0, nova_pids: pids,
        frontmost: inf.frontmost?.name,
        screen_points: inf.screen_points, screen_pixels: inf.screen_pixels,
        nova_window: win?.bounds ?? null, nova_content: win?.content ?? null,
        mouse: inf.mouse,
    };
}

/**
 * Lossless PNG via `screencapture -x` (plain ssh reaches the console
 * user's WindowServer on 10.13; no launchctl asuser needed).
 * --window crops to EV Nova's content rect, --rect x,y,w,h to any rect.
 */
async function cmdShot(args) {
    const win = takeFlag(args, "--window");
    let rect = takeOpt(args, "--rect");
    const out = path.resolve(args[0] ?? `novaref-shot-${timestamp()}.png`);
    if (win) {
        const w = novaWindow();
        if (!w) throw new NovarefError("EV Nova window not found (is it running?)");
        rect = w.content.join(",");
    }
    ensureHelper();
    const remote = `${cfg.remoteDir}/tmp/shot-${process.pid}-${Date.now()}.png`;
    ssh(`screencapture -x -t png ${rect ? "-R" + shq(rect) : ""} ${rq(remote)}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    scpFrom(remote, out);
    ssh(`rm -f ${rq(remote)}`, { allowFail: true });
    const dims = pngSize(out);
    return { ok: true, cmd: "shot", path: out, width: dims[0], height: dims[1], rect: rect ?? null };
}

function pngSize(file) {
    const b = fs.readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

async function cmdKeys(args) {
    const anyApp = takeFlag(args, "--any-app");
    const hold = Number(takeOpt(args, "--hold") ?? cfg.keyHoldMs);
    const gap = Number(takeOpt(args, "--gap") ?? cfg.keyGapMs);
    const seq = args.join(" ");
    if (!seq.trim()) throw new NovarefError('usage: novaref keys "<sequence>"');
    const steps = parseKeys(seq, { hold, gap });
    const res = helper(["keys", JSON.stringify(steps)], { front: anyApp ? null : cfg.bundleId });
    return { ok: true, cmd: "keys", events: res.events, sequence: seq };
}

/** Converts --win (content-relative) coordinates to screen points. */
function toScreen(points, rel) {
    if (!rel) return points;
    const w = novaWindow();
    if (!w) throw new NovarefError("EV Nova window not found (is it running?)");
    return points.map((v, i) => v + (i % 2 === 0 ? w.content[0] : w.content[1]));
}

async function cmdClick(args) {
    const rel = takeFlag(args, "--win");
    const right = takeFlag(args, "--right");
    const dbl = takeFlag(args, "--double");
    const anyApp = takeFlag(args, "--any-app");
    if (args.length < 2) throw new NovarefError("usage: novaref click x y [--win] [--right] [--double]");
    const [x, y] = toScreen(args.slice(0, 2).map(Number), rel);
    helper(["click", String(x), String(y), right ? "right" : "left", dbl ? "2" : "1"],
        { front: anyApp ? null : cfg.bundleId });
    return { ok: true, cmd: "click", screen: [x, y], win: rel, button: right ? "right" : "left" };
}

async function cmdDrag(args) {
    const rel = takeFlag(args, "--win");
    const anyApp = takeFlag(args, "--any-app");
    const ms = takeOpt(args, "--ms") ?? "400";
    if (args.length < 4) throw new NovarefError("usage: novaref drag x1 y1 x2 y2 [--win] [--ms N]");
    const pts = toScreen(args.slice(0, 4).map(Number), rel);
    helper(["drag", ...pts.map(String), "20", ms], { front: anyApp ? null : cfg.bundleId });
    return { ok: true, cmd: "drag", from: pts.slice(0, 2), to: pts.slice(2), win: rel };
}

async function cmdMove(args) {
    const rel = takeFlag(args, "--win");
    const [x, y] = toScreen(args.slice(0, 2).map(Number), rel);
    helper(["move", String(x), String(y)]);
    return { ok: true, cmd: "move", screen: [x, y] };
}

async function waitForWindow(timeoutMs) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const w = novaWindow();
        if (w) return w;
        await sleep(1000);
    }
    return null;
}

async function cmdLaunch() {
    ensureHelper();
    const before = novaPids();
    if (before.length) {
        const w = novaWindow();
        return { ok: true, cmd: "launch", already_running: true, pids: before, nova_window: w?.bounds ?? null };
    }
    ssh(`open -a ${shq(cfg.app)}`);
    const w = await waitForWindow(30000);
    const pids = novaPids();
    // Remember what we launched so `quit` only ever force-kills our own PIDs.
    ssh(`echo ${shq(pids.join(" "))} > ${rq(cfg.remoteDir)}/state/launched.pids`);
    if (!w) return { ok: false, cmd: "launch", error: "no EV Nova window within 30 s", pids };
    await sleep(1500); // let the title screen finish drawing
    return { ok: true, cmd: "launch", already_running: false, pids, nova_window: w.bounds, nova_content: w.content };
}

async function cmdQuit(args = []) {
    const force = takeFlag(args, "--force");
    const pids = novaPids();
    if (!pids.length) return { ok: true, cmd: "quit", was_running: false };
    // Don't wait for the Apple Event reply: in-game EV Nova answers a quit
    // with its own "Are you sure you want to quit?" alert (OK is the default
    // button) and the reply would block for the 2-minute AE timeout.
    ssh(`osascript -e 'ignoring application responses' ` +
        `-e ${shq(`tell application id "${cfg.bundleId}" to quit`)} -e 'end ignoring'`, { allowFail: true });
    let confirmed = 0;
    for (let i = 0; i < 12; i++) {
        await sleep(1000);
        if (!novaPids().length) {
            return { ok: true, cmd: "quit", was_running: true, method: "applescript", confirmed_dialog: confirmed > 0 };
        }
        if (i % 3 === 1 && confirmed < 2) {
            // Confirm the alert with Return (the game's default button is OK).
            try {
                helper(["keys", JSON.stringify([{ k: "Return" }])], { front: cfg.bundleId });
                confirmed++;
            } catch { /* already gone */ }
        }
    }
    // Still up (an in-game confirm dialog, or wedged). Kill only PIDs that
    // novaref launched, unless --force.
    const ours = ssh(`cat ${rq(cfg.remoteDir)}/state/launched.pids 2>/dev/null || true`)
        .stdout.trim().split(/\s+/).filter(Boolean).map(Number);
    const alive = novaPids();
    const killable = force ? alive : alive.filter((p) => ours.includes(p));
    if (!killable.length) {
        return { ok: false, cmd: "quit", error: "EV Nova did not quit and was not launched by novaref (use --force)", pids: alive };
    }
    ssh(`kill ${killable.join(" ")}`, { allowFail: true });
    await sleep(2000);
    let left = novaPids().filter((p) => killable.includes(p));
    if (left.length) {
        ssh(`kill -9 ${left.join(" ")}`, { allowFail: true });
        await sleep(1000);
        left = novaPids();
    }
    return { ok: left.length === 0, cmd: "quit", was_running: true, method: "kill", killed: killable, remaining: left };
}

async function cmdRestart() {
    const q = await cmdQuit([]);
    if (!q.ok) return { ...q, cmd: "restart" };
    const l = await cmdLaunch();
    return { ...l, cmd: "restart" };
}

// ---------------------------------------------------------------- pilots

const MANAGED = () => `${rq(cfg.remoteDir)}/state/managed_pilots.txt`;

function backupPilots(reason) {
    const dest = `${cfg.remoteDir}/backups/${timestamp()}-${reason}`;
    ssh(`mkdir -p ${rq(dest)} && ditto ${rq(cfg.pilotsDir)} ${rq(dest + "/Pilots")} && ` +
        `(defaults export ${shq(cfg.bundleId)} ${rq(dest + "/prefs.plist")} || true)`);
    return "~/" + dest;
}

async function cmdPilotsList() {
    ensureHelper();
    const script = `cd ${rq(cfg.pilotsDir)} && for f in *; do ` +
        `[ -f "$f" ] || continue; ` +
        `printf '%s\\t%s\\t%s\\t%s\\n' "$f" "$(stat -f %z "$f")" ` +
        `"$(stat -f %z "$f/..namedfork/rsrc")" "$(stat -f %Sm -t %Y-%m-%dT%H:%M:%S "$f")"; done; ` +
        `echo '--managed--'; cat ${MANAGED()} 2>/dev/null || true`;
    const [list, managed] = ssh(script).stdout.split("--managed--\n");
    const managedSet = new Set((managed || "").split("\n").filter(Boolean));
    const pilots = list.split("\n").filter(Boolean).map((line) => {
        const [name, data, rsrc, mtime] = line.split("\t");
        return { name, data_bytes: Number(data), rsrc_bytes: Number(rsrc), mtime, novaref_managed: managedSet.has(name) };
    });
    return { ok: true, cmd: "pilots list", dir: "~/" + cfg.pilotsDir, pilots };
}

/**
 * Pulls a pilot with its resource fork intact: bsdtar on both ends carries
 * the fork + FinderInfo (type/creator) as AppleDouble and restores them.
 * --raw also writes <dest>.rsrc holding the bare resource fork as a data
 * fork (portable; readPilot() reads either).
 */
async function cmdPilotsPull(args) {
    const raw = takeFlag(args, "--raw");
    const name = args[0];
    if (!name) throw new NovarefError("usage: novaref pilots pull <name> [dest] [--raw]");
    let dest = path.resolve(args[1] ?? name);
    if (args[1]?.endsWith("/")) fs.mkdirSync(dest, { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, name);
    ssh(`test -f ${rq(cfg.pilotsDir + "/" + name)}`, { allowFail: false });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "novaref-pull-"));
    const res = spawnSync("bash", ["-c",
        `ssh ${sshArgs().map(shq).join(" ")} ${shq(target())} ` +
        `${shq(`cd ${rq(cfg.pilotsDir)} && tar -cf - ${shq(name)}`)} ` +
        `| tar -xf - -C ${shq(tmp)}`], { encoding: "utf8" });
    if (res.status !== 0) throw new NovarefError("pilot pull failed", { stderr: res.stderr.trim() });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { force: true });
    // fs.copyFileSync on macOS uses copyfile(), which keeps the fork.
    spawnSync("ditto", [path.join(tmp, name), dest]);
    fs.rmSync(tmp, { recursive: true, force: true });
    const rsrcPath = dest + "/..namedfork/rsrc";
    const rsrcBytes = fs.existsSync(rsrcPath) ? fs.statSync(rsrcPath).size : 0;
    let rawPath = null;
    if (raw) {
        rawPath = dest + ".rsrc";
        fs.writeFileSync(rawPath, fs.readFileSync(rsrcPath));
    }
    return { ok: rsrcBytes > 0, cmd: "pilots pull", name, path: dest, rsrc_bytes: rsrcBytes, raw_path: rawPath };
}

/** True if bytes look like a resource fork (header offsets/lengths sane). */
function looksLikeResourceFork(b) {
    if (b.length < 256) return false;
    const dataOff = b.readUInt32BE(0), mapOff = b.readUInt32BE(4);
    const dataLen = b.readUInt32BE(8), mapLen = b.readUInt32BE(12);
    return dataOff >= 16 && dataOff + dataLen <= b.length && mapOff + mapLen <= b.length && mapLen > 28;
}

/**
 * Pushes a local Mac pilot (a file with a resource fork, or a bare resource
 * fork saved as a data fork, e.g. from `pull --raw`) into the Pilots folder.
 * Backs up the whole Pilots folder first; refuses to overwrite any pilot
 * novaref did not itself push.
 */
async function cmdPilotsPush(args) {
    const local = args[0];
    if (!local) throw new NovarefError("usage: novaref pilots push <local pilot> [as <name>]");
    let name = path.basename(local).replace(/\.(rsrc|npil)$/i, "");
    if (args[1] === "as" && args[2]) name = args[2];
    else if (args[1]) throw new NovarefError("usage: novaref pilots push <local pilot> [as <name>]");
    if (/[/\n]/.test(name) || name === "Last Pilot" || name.startsWith(".")) {
        throw new NovarefError(`refusing pilot name ${JSON.stringify(name)}`);
    }
    const rsrcPath = local + "/..namedfork/rsrc";
    let fork = fs.existsSync(rsrcPath) ? fs.readFileSync(rsrcPath) : Buffer.alloc(0);
    if (!fork.length) {
        const data = fs.readFileSync(local);
        if (!looksLikeResourceFork(data)) {
            throw new NovarefError("local file has no resource fork and its data fork is not resource-fork data " +
                "(Windows .plt pilots are not readable by Mac EV Nova)");
        }
        fork = data;
    }
    ensureHelper();
    const remoteFinal = `${cfg.pilotsDir}/${name}`;
    const check = ssh(`if [ -e ${rq(remoteFinal)} ]; then grep -qxF ${shq(name)} ${MANAGED()} 2>/dev/null ` +
        `&& echo managed || echo REAL; else echo absent; fi`).stdout.trim();
    if (check === "REAL") {
        throw new NovarefError(`refusing: a pilot named ${JSON.stringify(name)} exists and was not pushed by novaref ` +
            "(never overwrite a real pilot; choose another name)");
    }
    const backup = backupPilots("push");
    // Stage under ~/novaref/tmp, then move into place in one rename.
    const stage = `${cfg.remoteDir}/tmp/push-${process.pid}`;
    const finderInfo = "4E70954C4E9A768A" + "00".repeat(24); // type 'NpïL', creator 'Nvä'
    ssh(`rm -f ${rq(stage)} && touch ${rq(stage)} && cat > ${rq(stage)}/..namedfork/rsrc && ` +
        `xattr -wx com.apple.FinderInfo ${finderInfo} ${rq(stage)} && ` +
        `mv -f ${rq(stage)} ${rq(remoteFinal)} && ` +
        `(grep -qxF ${shq(name)} ${MANAGED()} 2>/dev/null || echo ${shq(name)} >> ${MANAGED()})`,
    { input: fork });
    const size = ssh(`stat -f %z ${rq(remoteFinal)}/..namedfork/rsrc`).stdout.trim();
    return { ok: Number(size) === fork.length, cmd: "pilots push", name, remote: "~/" + remoteFinal,
        rsrc_bytes: Number(size), replaced: check === "managed", backup };
}

async function cmdPilots(args) {
    const sub = args.shift();
    if (sub === "list") return cmdPilotsList();
    if (sub === "pull") return cmdPilotsPull(args);
    if (sub === "push") return cmdPilotsPush(args);
    if (sub === "backup") return { ok: true, cmd: "pilots backup", backup: backupPilots("manual") };
    if (sub === "rm") return cmdPilotsRm(args);
    throw new NovarefError("usage: novaref pilots list | pull <name> [dest] [--raw] | push <local> [as <name>] | rm <name> | backup");
}

/**
 * Removes a pilot novaref pushed (never any other) by MOVING it into a
 * timestamped dir under ~/novaref/backups; nothing is deleted.
 */
async function cmdPilotsRm(args) {
    const name = args[0];
    if (!name) throw new NovarefError("usage: novaref pilots rm <name>");
    ensureHelper();
    if (novaPids().length) throw new NovarefError("quit EV Nova first");
    const managed = ssh(`grep -qxF ${shq(name)} ${MANAGED()} 2>/dev/null && echo yes || true`).stdout.trim();
    if (managed !== "yes") throw new NovarefError(`refusing: ${JSON.stringify(name)} was not pushed by novaref`);
    const dest = `${cfg.remoteDir}/backups/${timestamp()}-rm`;
    ssh(`mkdir -p ${rq(dest)} && mv ${rq(cfg.pilotsDir + "/" + name)} ${rq(dest + "/")} && ` +
        `grep -vxF ${shq(name)} ${MANAGED()} > ${MANAGED()}.new; mv ${MANAGED()}.new ${MANAGED()}`);
    return { ok: true, cmd: "pilots rm", name, moved_to: "~/" + dest };
}

// ---------------------------------------------------------------- record

const REC_DIR = () => `${cfg.remoteDir}/rec`;

/**
 * Screen recording with the hub-built ffmpeg at ~/novaref/bin/ffmpeg
 * (avfoundation device 1 = "Capture screen 0"; device 0 is the iSight camera
 * and must never be captured). Software VideoToolbox H.264; fragmented mp4
 * so even an unclean stop leaves a playable file. Stop = SIGINT, then scp.
 */
async function cmdRecord(args) {
    const sub = args.shift();
    ensureHelper();
    const ff = rq(cfg.ffmpeg);
    const pidFile = `${rq(REC_DIR())}/ffmpeg.pid`;
    const fileRec = `${rq(REC_DIR())}/current`;
    if (sub === "start") {
        const fps = takeOpt(args, "--fps") ?? "30";
        if (ssh(`test -x ${ff}`, { allowFail: true }).code !== 0) {
            throw new NovarefError(`ffmpeg not installed at ~/${cfg.ffmpeg}`);
        }
        const running = ssh(`test -f ${pidFile} && kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || true`).stdout.trim();
        if (running === "yes") throw new NovarefError("a recording is already running (novaref record stop)");
        const name = `rec-${timestamp()}.mp4`;
        const remote = `${REC_DIR()}/${name}`;
        // The `&` must cover ffmpeg alone (braces): backgrounding a whole
        // `a && b && ffmpeg` list forks a subshell that keeps the ssh
        // channel open, and the ssh call never returns.
        ssh(`mkdir -p ${rq(REC_DIR())} && cd ${rq(REC_DIR())} && ` +
            `{ nohup ${ff} -hide_banner -loglevel error -y -f avfoundation -pixel_format nv12 ` +
            `-capture_cursor 1 -framerate ${shq(fps)} -i 1:none -c:v h264_videotoolbox -allow_sw 1 -b:v 8M ` +
            `-movflags +frag_keyframe+empty_moov ${shq(name)} > ffmpeg.log 2>&1 < /dev/null & } ; ` +
            `echo $! > ${pidFile}; echo ${shq(remote)} > ${fileRec}`);
        await sleep(1500);
        const alive = ssh(`kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || (cat ${rq(REC_DIR())}/ffmpeg.log; true)`).stdout.trim();
        if (alive !== "yes") throw new NovarefError("ffmpeg exited immediately", { log: alive });
        return { ok: true, cmd: "record start", remote: "~/" + remote };
    }
    if (sub === "stop") {
        const out = args[0];
        const st = ssh(`echo "$(cat ${pidFile} 2>/dev/null)"; echo "$(cat ${fileRec} 2>/dev/null)"`).stdout.split("\n");
        const pid = st[0].trim(), remote = (st[1] || "").trim();
        if (!pid || !remote) throw new NovarefError("no recording in progress");
        ssh(`kill -INT ${shq(pid)} 2>/dev/null; for i in $(seq 1 40); do kill -0 ${shq(pid)} 2>/dev/null || break; sleep 0.25; done; ` +
            `kill -0 ${shq(pid)} 2>/dev/null && kill -TERM ${shq(pid)}; rm -f ${pidFile} ${fileRec}`, { allowFail: true });
        const dest = path.resolve(out ?? path.basename(remote));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        scpFrom(remote, dest);
        ssh(`rm -f ${rq(remote)}`, { allowFail: true });
        return { ok: true, cmd: "record stop", path: dest, bytes: fs.statSync(dest).size };
    }
    throw new NovarefError("usage: novaref record start [--fps N] | stop [out.mp4]");
}

// ---------------------------------------------------------------- run

/**
 * Opens a pilot from the title screen: "o" (Open Pilot) brings up the
 * standard open panel; cmd+shift+G, type the full path, Return selects it,
 * Return opens it. Each stage is checked (the panel is a second EV Nova
 * window) so a missed key never types a path into the title screen, whose
 * single-letter shortcuts include Enter Ship and Quit. Success is verified
 * from "Last Pilot", the alias the game rewrites to the pilot it loaded.
 */
async function openPilot(name) {
    // The panel is a separate EV Nova window (layer 8, named "Open").
    const windows = () => info().nova_windows.length;
    if (!novaPids().length) throw new NovarefError("EV Nova is not running");
    if (windows() !== 1) throw new NovarefError("open_pilot must start at the title screen with no dialog open");
    await cmdKeys(["o"]);
    await sleep(1500);
    if (windows() < 2) throw new NovarefError("Open Pilot panel did not appear (not at the title screen?)");
    const p = `~/${cfg.pilotsDir}/${name}`;
    await cmdKeys([`cmd+shift+g wait 900 cmd+a text:"${p.replace(/"/g, '\\"')}" wait 400 Return wait 1200`]);
    if (windows() < 2) throw new NovarefError("open panel closed unexpectedly");
    await cmdKeys(["Return"]);
    await sleep(2500);
    if (windows() !== 1) {
        await cmdKeys(["Escape wait 500 Escape"]);
        throw new NovarefError(`could not open pilot ${JSON.stringify(name)} (panel still open; cancelled)`);
    }
    const last = ssh(`strings ${rq(cfg.pilotsDir + "/Last Pilot")}/..namedfork/rsrc | head -3`,
        { allowFail: true }).stdout.split("\n");
    const verified = last.includes(name);
    return { ok: verified, cmd: "open_pilot", pilot: name, last_pilot_alias: last.filter(Boolean)[1] ?? null,
        ...(verified ? {} : { error: "Last Pilot does not name the requested pilot" }) };
}

async function runStep(step, ctx) {
    if (step.keys !== undefined) return cmdKeys([...(step.hold ? ["--hold", String(step.hold)] : []), step.keys]);
    if (step.wait !== undefined) { await sleep(step.wait); return { ok: true, cmd: "wait", ms: step.wait }; }
    if (step.shot !== undefined) {
        ctx.shotN++;
        const base = `${String(ctx.shotN).padStart(2, "0")}-${step.shot || "shot"}.png`;
        return cmdShot([path.join(ctx.dir, base), ...(step.window ? ["--window"] : [])]);
    }
    if (step.click) return cmdClick([...step.click.map(String), ...(step.win ? ["--win"] : []),
        ...(step.right ? ["--right"] : []), ...(step.double ? ["--double"] : [])]);
    if (step.drag) return cmdDrag([...step.drag.map(String), ...(step.win ? ["--win"] : [])]);
    if (step.open_pilot) return openPilot(step.open_pilot);
    if (step.record === "start") return cmdRecord(["start"]);
    if (step.record === "stop") return cmdRecord(["stop", path.join(ctx.dir, "recording.mp4")]);
    if (step.launch) return cmdLaunch();
    if (step.quit) return cmdQuit([]);
    throw new NovarefError(`unknown step ${JSON.stringify(step)}`);
}

/**
 * Runs a scenario (see README). EV Nova's own state that the game rewrites
 * as a side effect ("Last Pilot" and its prefs domain) is snapshotted
 * before and restored after quitting, so Matthew's setup is unchanged.
 */
async function cmdRun(args) {
    const outRoot = takeOpt(args, "--out") ?? "novaref-results";
    const pilotOverride = takeOpt(args, "--pilot");
    const file = args[0];
    if (!file) throw new NovarefError("usage: novaref run <scenario.json> [--out dir] [--pilot local-pilot]");
    const sc = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pilotOverride) sc.pilot = { ...(sc.pilot ?? {}), push: path.resolve(pilotOverride) };
    const name = (sc.name ?? path.basename(file, ".json")).replace(/[^\w.-]+/g, "_");
    const dir = path.resolve(outRoot, `${timestamp()}-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(file, path.join(dir, "scenario.json"));
    const logPath = path.join(dir, "log.jsonl");
    const record = (obj) => fs.appendFileSync(logPath, JSON.stringify({ t: new Date().toISOString(), ...obj }) + "\n");
    const ctx = { dir, shotN: 0 };
    let failed = null;

    ensureHelper();
    if (novaPids().length && !sc.allow_running) {
        // A fresh game is the only way to know what's loaded.
        const q = await cmdQuit([]);
        record({ phase: "pre-quit", result: q });
        if (!q.ok) throw new NovarefError("EV Nova is running and could not be quit", { quit: q });
    }
    const snapshot = backupPilots(`run-${name}`);
    record({ phase: "snapshot", backup: snapshot });
    try {
        if (sc.pilot?.push) {
            const pushPath = path.resolve(path.dirname(file), sc.pilot.push);
            const r = await cmdPilotsPush([pushPath, ...(sc.pilot.as ? ["as", sc.pilot.as] : [])]);
            record({ phase: "push", result: r });
            if (!r.ok) throw new NovarefError("pilot push failed", r);
        }
        if (sc.launch !== false) {
            const r = await cmdLaunch();
            record({ phase: "launch", result: r });
            if (!r.ok) throw new NovarefError("launch failed", r);
        }
        if (sc.pilot && sc.pilot.open !== false) {
            const pname = sc.pilot.as ?? sc.pilot.name ?? path.basename(sc.pilot.push ?? "");
            const r = await runStep({ open_pilot: pname }, ctx);
            record({ phase: "open_pilot", pilot: pname, result: r });
            // Never go on with the wrong pilot loaded: the steps could save
            // over whatever real pilot the title screen had.
            if (!r.ok) throw new NovarefError("open_pilot failed", r);
        }
        for (const [i, step] of (sc.steps ?? []).entries()) {
            const r = await runStep(step, ctx);
            record({ phase: "step", i, step, result: r });
            if (!r.ok) throw new NovarefError(`step ${i} failed`, r);
        }
    } catch (e) {
        failed = { error: e.message, ...e.extra };
        record({ phase: "error", ...failed });
        try { await runStep({ shot: "error" }, ctx); } catch { /* best effort */ }
    }
    const results = { ok: !failed, cmd: "run", dir, snapshot };
    if (sc.quit !== false) {
        const q = await cmdQuit([]);
        record({ phase: "quit", result: q });
        results.quit = q.ok;
    }
    const pullName = sc.pull === true ? (sc.pilot?.as ?? sc.pilot?.name) : sc.pull;
    if (pullName) {
        try {
            const r = await cmdPilotsPull([pullName, path.join(dir, "pilot-after", pullName), "--raw"]);
            record({ phase: "pull", result: r });
            results.pilot_after = r.path;
        } catch (e) {
            record({ phase: "pull", error: e.message });
        }
    }
    if (sc.quit !== false && !novaPids().length) {
        // Restore the game's own bookkeeping from the snapshot.
        const lp = `${cfg.pilotsDir}/Last Pilot`;
        const snapAbs = snapshot.replace(/^~\//, "");
        const r = ssh(`if [ -e ${rq(snapAbs + "/Pilots/Last Pilot")} ]; then ` +
            `ditto ${rq(snapAbs + "/Pilots/Last Pilot")} ${rq(lp)} && echo last-pilot-restored; fi; ` +
            `if [ -f ${rq(snapAbs + "/prefs.plist")} ]; then ` +
            `defaults export ${shq(cfg.bundleId)} ${rq(snapAbs + "/prefs-after.plist")}; ` +
            `[ "$(plutil -p ${rq(snapAbs + "/prefs.plist")})" = "$(plutil -p ${rq(snapAbs + "/prefs-after.plist")})" ] ` +
            `&& echo prefs-unchanged || ` +
            `{ defaults import ${shq(cfg.bundleId)} ${rq(snapAbs + "/prefs.plist")} && echo prefs-restored; }; fi`,
        { allowFail: true });
        results.restored = r.stdout.trim().split("\n").filter(Boolean);
        record({ phase: "restore", result: results.restored });
    }
    if (failed) results.error = failed.error;
    fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(results, null, 2) + "\n");
    return results;
}

// ---------------------------------------------------------------- main

const USAGE = `novaref — drive the original EV Nova on the reference Mac
  status
  shot [out.png] [--window | --rect x,y,w,h]
  keys "<sequence>" [--hold ms] [--gap ms] [--any-app]
  click x y [--win] [--right] [--double]      drag x1 y1 x2 y2 [--win]   move x y [--win]
  launch | quit [--force] | restart
  pilots list | pull <name> [dest] [--raw] | push <local> [as <name>] | backup
  record start [--fps N] | record stop [out.mp4]
  run <scenario.json> [--out dir]
config: ${CONFIG_PATH}`;

async function main(argv) {
    const [cmd, ...args] = argv;
    switch (cmd) {
        case "status": return cmdStatus();
        case "shot": return cmdShot(args);
        case "keys": return cmdKeys(args);
        case "click": return cmdClick(args);
        case "drag": return cmdDrag(args);
        case "move": return cmdMove(args);
        case "launch": return cmdLaunch();
        case "quit": return cmdQuit(args);
        case "restart": return cmdRestart();
        case "pilots": return cmdPilots(args);
        case "record": return cmdRecord(args);
        case "run": return cmdRun(args);
        case "info": return info();
        default:
            process.stderr.write(USAGE + "\n");
            return { ok: false, cmd: cmd ?? null, error: "unknown command" };
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then((res) => {
        emit(res);
        process.exitCode = res.ok ? 0 : 1;
    }, (e) => {
        emit({ ok: false, cmd: process.argv[2] ?? null, error: e.message, ...(e.extra ?? {}) });
        process.exitCode = 1;
    });
}
