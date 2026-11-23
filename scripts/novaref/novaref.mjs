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
    pluginsDir: "Library/Application Support/EV Nova/Plug-ins",
    // Other app bundles `launch --app <name>` / a scenario's "app" can start.
    // Paths are relative to the remote $HOME unless absolute. "minimal" is a
    // COPY of the game whose Nova Files hold only AbsoluteMinimum
    // (`novaref app setup-minimal`); the real bundle is never modified.
    apps: { minimal: "novaref/apps/EV Nova Minimal.app" },
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
    const user = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const cfg = { ...DEFAULT_CONFIG, ...user, apps: { ...DEFAULT_CONFIG.apps, ...(user.apps ?? {}) } };
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
    // The old Mac's display sleeps after 10 idle minutes (energy-saver
    // setting, left alone) and the WindowServer then reports loginwindow as
    // frontmost. A user-activity assertion (`caffeinate -u`) wakes it
    // without touching any setting; no password is involved.
    const wakePrefix = front ? "(caffeinate -u -t 2 >/dev/null 2>&1 &); " : "";
    let res = ssh(wakePrefix + cmd, { allowFail: true });
    let out = parseJsonLine(res.stdout + "\n");
    if (!out.ok && front && /frontmost: loginwindow/.test(out.error ?? "")) {
        // Display was asleep: give the wake a moment, then try once more.
        ssh("caffeinate -u -t 2 >/dev/null 2>&1");
        res = ssh(wakePrefix + cmd, { allowFail: true });
        out = parseJsonLine(res.stdout + "\n");
    }
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

/** PIDs of any EV Nova copy (the real app or one under ~/novaref/apps). */
function novaPids() {
    const out = ssh(`pgrep -f ${shq("EV Nova[^/]*\\.app/Contents/MacOS/")} || true`).stdout.trim();
    return out ? out.split("\n").map(Number) : [];
}

/** Remote path of the app to launch: the real one, or a named copy. */
function appPath(name) {
    if (!name || name === "stock") return cfg.app;
    const p = cfg.apps[name];
    if (!p) throw new NovarefError(`unknown app ${JSON.stringify(name)} (known: stock, ${Object.keys(cfg.apps).join(", ")})`);
    return p; // relative to the remote $HOME; quote with rq()
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

/**
 * The pilot the title screen will auto-load: the names in the "Last
 * Pilot" alias, or null when there is no alias (title screen loads none).
 */
function lastPilotNames() {
    const r = ssh(`f=${rq(cfg.pilotsDir + "/Last Pilot")}; [ -e "$f" ] && strings "$f/..namedfork/rsrc" || echo __NONE__`,
        { allowFail: true }).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    return r[0] === "__NONE__" ? null : r;
}

/**
 * Safety rule: with any test plug-in installed, the game may only start
 * when the title screen will load nothing or an experiment pilot (one
 * novaref manages) -- never Matthew's real pilot, which a landing would
 * save with the test universe baked in.
 */
function assertSafeToLaunch(appName) {
    const installed = listPluginFiles();
    const minimal = appName && appName !== "stock";
    if (!installed.length && !minimal) return;
    const names = lastPilotNames();
    if (names === null) return;
    const managed = new Set(managedPilots());
    const pilots = ssh(`ls ${rq(cfg.pilotsDir)}`).stdout.split("\n").filter((n) => n && n !== "Last Pilot");
    const real = pilots.filter((n) => !managed.has(n) && names.includes(n));
    if (real.length || !pilots.some((n) => managed.has(n) && names.includes(n))) {
        throw new NovarefError(`refusing to launch: ${installed.length ? "test plug-ins are installed" : "the minimal app was requested"} ` +
            `and "Last Pilot" would auto-load ${JSON.stringify(real[0] ?? names[1] ?? "?")}, not an experiment pilot. ` +
            "Use `novaref run` (it parks Last Pilot) or `novaref pilots park-last` first.", { plugins: installed });
    }
}

async function cmdLaunch(args = [], { inRun = false } = {}) {
    ensureHelper();
    const appName = takeOpt(args, "--app") ?? "stock";
    const before = novaPids();
    if (before.length) {
        const w = novaWindow();
        return { ok: true, cmd: "launch", already_running: true, pids: before, nova_window: w?.bounds ?? null };
    }
    // A bare launch outside a run must not start on top of a dead run's
    // leftovers (a run itself parks Last Pilot and installs plug-ins).
    if (!inRun) assertClean("launch");
    assertSafeToLaunch(appName);
    ssh(`open -a ${rq(appPath(appName))}`);
    const w = await waitForWindow(30000);
    const pids = novaPids();
    // Remember what we launched so `quit` only ever force-kills our own PIDs.
    ssh(`echo ${shq(pids.join(" "))} > ${rq(cfg.remoteDir)}/state/launched.pids`);
    if (!w) return { ok: false, cmd: "launch", error: "no EV Nova window within 30 s", pids };
    await sleep(1500); // let the title screen finish drawing
    return { ok: true, cmd: "launch", app: appName, already_running: false, pids, nova_window: w.bounds, nova_content: w.content };
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

async function cmdRestart(args = []) {
    const q = await cmdQuit([]);
    if (!q.ok) return { ...q, cmd: "restart" };
    const l = await cmdLaunch(args);
    return { ...l, cmd: "restart" };
}

// ---------------------------------------------------------------- plug-ins

const INSTALLED = () => `${rq(cfg.remoteDir)}/state/installed_plugins.txt`;

function managedPilots() {
    return ssh(`cat ${MANAGED()} 2>/dev/null || true`).stdout.split("\n").filter(Boolean);
}

/** Top-level entries in the Plug-ins folder (excluding .DS_Store). */
function listPluginFiles() {
    return ssh(`mkdir -p ${rq(cfg.pluginsDir)} && ls -A ${rq(cfg.pluginsDir)} | grep -v '^\\.DS_Store$' || true`)
        .stdout.split("\n").filter(Boolean);
}

async function cmdPluginList() {
    ensureHelper();
    const installed = new Set(ssh(`cat ${INSTALLED()} 2>/dev/null || true`).stdout.split("\n").filter(Boolean));
    const files = listPluginFiles().map((name) => {
        const st = ssh(`f=${rq(cfg.pluginsDir + "/" + name)}; printf '%s %s %s' "$(stat -f %z "$f")" ` +
            `"$(stat -f %z "$f/..namedfork/rsrc" 2>/dev/null || echo 0)" ` +
            `"$(xattr -px com.apple.FinderInfo "$f" 2>/dev/null | tr -d ' \\n' | cut -c1-16)"`).stdout.split(" ");
        return { name, data_bytes: Number(st[0]), rsrc_bytes: Number(st[1]), finder_info: st[2] || null,
            novaref_managed: installed.has(name) };
    });
    return { ok: true, cmd: "plugin list", dir: "~/" + cfg.pluginsDir, plugins: files };
}

/**
 * Copies a local plug-in (resource fork + FinderInfo, or a data-fork
 * .ndat/.rez) into the Plug-ins folder. Refuses to replace a plug-in
 * novaref didn't install. Plug-ins are read only at game start.
 */
async function cmdPluginInstall(args) {
    const local = args[0];
    if (!local) throw new NovarefError("usage: novaref plugin install <local plug-in> [as <name>]");
    let name = path.basename(local);
    if (args[1] === "as" && args[2]) name = args[2];
    if (/[/\n]/.test(name) || name.startsWith(".")) throw new NovarefError(`bad plug-in name ${JSON.stringify(name)}`);
    ensureHelper();
    if (novaPids().length) throw new NovarefError("quit EV Nova first (plug-ins load at launch)");
    const rsrcPath = local + "/..namedfork/rsrc";
    const fork = fs.existsSync(rsrcPath) ? fs.readFileSync(rsrcPath) : Buffer.alloc(0);
    const finder = spawnSync("xattr", ["-px", "com.apple.FinderInfo", local], { encoding: "utf8" });
    const finderHex = finder.status === 0 ? finder.stdout.replace(/\s+/g, "") : null;
    const remoteFinal = `${cfg.pluginsDir}/${name}`;
    const exists = ssh(`[ -e ${rq(remoteFinal)} ] && (grep -qxF ${shq(name)} ${INSTALLED()} 2>/dev/null && echo managed || echo REAL) || echo absent`).stdout.trim();
    if (exists === "REAL") throw new NovarefError(`refusing: ${name} is in Plug-ins and novaref did not install it`);
    const stage = `${cfg.remoteDir}/tmp/plugin-${process.pid}`;
    let script;
    let input;
    if (fork.length) {
        input = fork;
        script = `rm -f ${rq(stage)} && touch ${rq(stage)} && cat > ${rq(stage)}/..namedfork/rsrc`;
    } else {
        input = fs.readFileSync(local);
        script = `rm -f ${rq(stage)} && cat > ${rq(stage)}`;
    }
    if (finderHex) script += ` && xattr -wx com.apple.FinderInfo ${shq(finderHex)} ${rq(stage)}`;
    script += ` && mkdir -p ${rq(cfg.pluginsDir)} && mv -f ${rq(stage)} ${rq(remoteFinal)} && ` +
        `(grep -qxF ${shq(name)} ${INSTALLED()} 2>/dev/null || echo ${shq(name)} >> ${INSTALLED()})`;
    ssh(script, { input });
    const size = ssh(`stat -f %z ${rq(remoteFinal)}${fork.length ? "/..namedfork/rsrc" : ""}`).stdout.trim();
    return { ok: Number(size) === input.length, cmd: "plugin install", name, remote: "~/" + remoteFinal,
        bytes: Number(size), layout: fork.length ? "resource-fork" : "data-fork", finder_info: finderHex?.slice(0, 16) ?? null,
        replaced: exists === "managed" };
}

/**
 * Moves plug-ins novaref installed out of Plug-ins into
 * ~/novaref/backups/<ts>-plugin-uninstall/ (never deletes). `--all`
 * removes every novaref-installed plug-in. Refuses plug-ins it didn't
 * install.
 */
async function cmdPluginUninstall(args) {
    ensureHelper();
    if (novaPids().length) throw new NovarefError("quit EV Nova first");
    const all = takeFlag(args, "--all");
    const installed = ssh(`cat ${INSTALLED()} 2>/dev/null || true`).stdout.split("\n").filter(Boolean);
    const present = new Set(listPluginFiles());
    const names = all ? installed.filter((n) => present.has(n)) : args;
    if (!all && !names.length) throw new NovarefError("usage: novaref plugin uninstall <name>... | --all");
    for (const n of names) {
        if (!installed.includes(n)) throw new NovarefError(`refusing: ${JSON.stringify(n)} was not installed by novaref`);
    }
    const dest = `${cfg.remoteDir}/backups/${timestamp()}-plugin-uninstall`;
    const moved = [];
    for (const n of names) {
        if (!present.has(n)) continue;
        ssh(`mkdir -p ${rq(dest)} && mv ${rq(cfg.pluginsDir + "/" + n)} ${rq(dest + "/")}`);
        moved.push(n);
    }
    ssh(`for n in ${names.map(shq).join(" ")}; do grep -vxF "$n" ${INSTALLED()} > ${INSTALLED()}.new; ` +
        `mv ${INSTALLED()}.new ${INSTALLED()}; done`, { allowFail: true });
    const left = listPluginFiles();
    return { ok: true, cmd: "plugin uninstall", moved, moved_to: moved.length ? "~/" + dest : null, plugins_left: left };
}

async function cmdPlugin(args) {
    const sub = args.shift();
    if (sub === "list") return cmdPluginList();
    if (sub === "install") return cmdPluginInstall(args);
    if (sub === "uninstall") return cmdPluginUninstall(args);
    throw new NovarefError("usage: novaref plugin list | install <local> [as <name>] | uninstall <name>... | --all");
}

/**
 * Builds ~/novaref/apps/EV Nova Minimal.app: a copy of the real bundle
 * (rsync -aE keeps xattrs/forks) WITHOUT its Nova Files, whose Nova Files
 * then hold only the given data file (AbsoluteMinimum converted with
 * rez_to_ndat.mjs). The real /Applications bundle is only read.
 */
async function cmdAppSetupMinimal(args) {
    const local = args[0];
    if (!local) throw new NovarefError("usage: novaref app setup-minimal <AbsoluteMinimum.ndat>");
    ensureHelper();
    const dest = cfg.apps.minimal;
    const freeKb = Number(ssh(`df -k "$HOME" | tail -1 | awk '{print $4}'`).stdout.trim());
    if (freeKb < 2 * 1024 * 1024) throw new NovarefError(`only ${freeKb} KB free on the old Mac`);
    const data = fs.readFileSync(local);
    ssh(`mkdir -p ${rq(path.dirname(dest))} && ` +
        `rsync -aE --delete --exclude '/Contents/Resources/Nova Files/' ${shq(cfg.app + "/")} ${rq(dest + "/")} && ` +
        `mkdir -p ${rq(dest + "/Contents/Resources/Nova Files")} && ` +
        `cat > ${rq(dest + "/Contents/Resources/Nova Files/" + path.basename(local))}`, { input: data });
    const listing = ssh(`ls -la ${rq(dest + "/Contents/Resources/Nova Files")}; du -sh ${rq(dest)}`).stdout.trim();
    return { ok: true, cmd: "app setup-minimal", app: "~/" + dest, nova_files: listing.split("\n") };
}

async function cmdApp(args) {
    const sub = args.shift();
    if (sub === "setup-minimal") return cmdAppSetupMinimal(args);
    if (sub === "list") return { ok: true, cmd: "app list", apps: { stock: cfg.app, ...cfg.apps } };
    throw new NovarefError("usage: novaref app list | setup-minimal <data.ndat>");
}

/**
 * Moves "Last Pilot" out of the Pilots folder (into ~/novaref/state/) so
 * the title screen loads no pilot at all; `pilots unpark-last` puts it back.
 */
function parkLastPilot() {
    const r = ssh(`f=${rq(cfg.pilotsDir + "/Last Pilot")}; d=${rq(cfg.remoteDir + "/state/parked")}; ` +
        `if [ -e "$f" ]; then mkdir -p "$d" && rm -rf "$d/Last Pilot" && mv "$f" "$d/" && echo parked; else echo none; fi`).stdout.trim();
    return r;
}

function unparkLastPilot() {
    return ssh(`f=${rq(cfg.pilotsDir + "/Last Pilot")}; p=${rq(cfg.remoteDir + "/state/parked/Last Pilot")}; ` +
        `if [ -e "$p" ]; then mv -f "$p" "$f" && echo unparked; else echo none; fi`).stdout.trim();
}

// ---------------------------------------------------------------- recovery

/**
 * The known-good state to recover to: a `pilots backup` directory holding
 * Pilots/Last Pilot and prefs.plist, recorded in ~/novaref/state/baseline.
 */
const BASELINE_FILE = () => `${rq(cfg.remoteDir)}/state/baseline`;
// Managed pilots that predate an experiment and stay where they are.
const KEEP_PILOTS = () => cfg.keepPilots ?? ["novaref-scenario"];

/**
 * What a dead or interrupted run can leave behind. Empty list = clean.
 * (An unexpected running EV Nova, e.g. reopened by macOS at login, counts.)
 */
function leftovers({ duringRun = false } = {}) {
    const out = [];
    const pids = novaPids();
    if (pids.length) out.push(`EV Nova is running (pids ${pids.join(" ")})`);
    const plugins = listPluginFiles();
    if (plugins.length) out.push(`Plug-ins not empty: ${plugins.join(", ")}`);
    const st = ssh(`d=${rq(cfg.remoteDir)}; [ -e "$d/state/parked/Last Pilot" ] && echo parked; ` +
        `[ -f "$d/rec/ffmpeg.pid" ] && echo recording; ` +
        `[ -e ${rq(cfg.pilotsDir + "/Last Pilot")} ] || echo no-last-pilot; true`).stdout.split("\n").filter(Boolean);
    if (st.includes("parked") && !duringRun) out.push("Last Pilot is parked in ~/novaref/state/parked (a run did not finish)");
    if (st.includes("recording")) out.push("a recording pid file exists (~/novaref/rec/ffmpeg.pid)");
    if (st.includes("no-last-pilot") && !duringRun) out.push("Pilots has no Last Pilot");
    return out;
}

function assertClean(what) {
    const left = leftovers();
    if (left.length) {
        throw new NovarefError(`refusing to ${what}: leftovers from an earlier run; run \`novaref recover\` first`, { leftovers: left });
    }
}

/**
 * `novaref recover [--baseline <backup dir>]`: puts the old Mac back to the
 * baseline after a run died (power loss, crash, killed CLI). Nothing is
 * deleted; everything replaced goes to ~/novaref/backups/<ts>-recover/.
 *  1. Stops any EV Nova (AppleScript quit, then SIGTERM, then SIGKILL; a
 *     killed game saves nothing, so no pilot can be written).
 *  2. Stops a novaref ffmpeg and clears its pid files.
 *  3. Moves novaref-installed plug-ins out of Plug-ins (others: reported).
 *  4. Restores Last Pilot from the baseline (the current one and any parked
 *     copy are backed up first).
 *  5. Restores the prefs domain if it differs from the baseline export.
 *  6. Moves experiment pilots (managed, not in keepPilots) out of Pilots.
 *  7. Verifies: Matt == Pilots-backup/Matt, Plug-ins empty, Last Pilot ==
 *     baseline, prefs == baseline.
 */
async function cmdRecover(args) {
    ensureHelper();
    let baseline = takeOpt(args, "--baseline");
    if (baseline) {
        baseline = baseline.replace(/^~\//, "");
        ssh(`echo ${shq(baseline)} > ${BASELINE_FILE()}`);
    } else {
        baseline = ssh(`cat ${BASELINE_FILE()} 2>/dev/null || true`).stdout.trim();
    }
    if (!baseline) throw new NovarefError("no baseline recorded; pass --baseline novaref/backups/<ts>-manual once");
    const check = ssh(`[ -e ${rq(baseline + "/Pilots/Last Pilot")} ] && [ -f ${rq(baseline + "/prefs.plist")} ] && echo ok || true`).stdout.trim();
    if (check !== "ok") throw new NovarefError(`baseline ${baseline} lacks Pilots/Last Pilot or prefs.plist`);
    const dest = `${cfg.remoteDir}/backups/${timestamp()}-recover`;
    ssh(`mkdir -p ${rq(dest)}`);
    const actions = [];

    // 1. Stop the game.
    if (novaPids().length) {
        ssh(`osascript -e 'ignoring application responses' -e ${shq(`tell application id "${cfg.bundleId}" to quit`)} -e 'end ignoring'`, { allowFail: true });
        for (let i = 0; i < 6 && novaPids().length; i++) {
            await sleep(1000);
            if (i === 2) { try { helper(["keys", JSON.stringify([{ k: "Return" }])], { front: cfg.bundleId }); } catch { /* gone or hung */ } }
        }
        let pids = novaPids();
        if (pids.length) { ssh(`kill ${pids.join(" ")}`, { allowFail: true }); await sleep(2000); pids = novaPids(); }
        if (pids.length) { ssh(`kill -9 ${pids.join(" ")}`, { allowFail: true }); await sleep(1000); }
        actions.push(novaPids().length ? "EV Nova STILL RUNNING" : "stopped EV Nova");
    }
    // 2. Recording.
    const rec = ssh(`d=${rq(cfg.remoteDir + "/rec")}; if [ -f "$d/ffmpeg.pid" ]; then p=$(cat "$d/ffmpeg.pid"); ` +
        `kill -0 "$p" 2>/dev/null && ps -p "$p" -o command= | grep -q ffmpeg && kill -INT "$p"; sleep 2; ` +
        `mv "$d/ffmpeg.pid" ${rq(dest)}/ 2>/dev/null; mv "$d/current" ${rq(dest)}/ 2>/dev/null; echo cleared-recording; fi; ` +
        `for f in "$d"/rec-*.mp4; do [ -e "$f" ] && mv "$f" ${rq(dest)}/ && echo "moved $(basename "$f")"; done; true`).stdout.trim();
    if (rec) actions.push(...rec.split("\n"));
    // 3. Plug-ins.
    const installed = ssh(`cat ${INSTALLED()} 2>/dev/null || true`).stdout.split("\n").filter(Boolean);
    const foreign = [];
    for (const p of listPluginFiles()) {
        if (installed.includes(p)) {
            ssh(`mv ${rq(cfg.pluginsDir + "/" + p)} ${rq(dest + "/")}`);
            actions.push(`uninstalled plug-in ${p}`);
        } else foreign.push(p);
    }
    ssh(`: > ${INSTALLED()}`);
    // 4. Last Pilot.
    const lp = ssh(`f=${rq(cfg.pilotsDir + "/Last Pilot")}; b=${rq(baseline + "/Pilots/Last Pilot")}; p=${rq(cfg.remoteDir + "/state/parked/Last Pilot")}; ` +
        `r=""; if [ -e "$p" ]; then mkdir -p ${rq(dest + "/parked")} && mv "$p" ${rq(dest + "/parked/")} && r="$r archived-parked"; fi; ` +
        `if [ -e "$f" ] && cmp -s "$f/..namedfork/rsrc" "$b/..namedfork/rsrc" && [ "$(xattr -px com.apple.FinderInfo "$f" 2>/dev/null)" = "$(xattr -px com.apple.FinderInfo "$b" 2>/dev/null)" ]; then r="$r last-pilot-ok"; ` +
        `else if [ -e "$f" ]; then mkdir -p ${rq(dest + "/Pilots")} && mv "$f" ${rq(dest + "/Pilots/")}; fi; ditto "$b" "$f" && r="$r last-pilot-restored"; fi; echo $r`).stdout.trim();
    actions.push(...lp.split(" ").filter(Boolean));
    // 5. Prefs.
    const pr = ssh(`b=${rq(baseline + "/prefs.plist")}; n=${rq(dest + "/prefs-before.plist")}; defaults export ${shq(cfg.bundleId)} "$n"; ` +
        `if [ "$(plutil -p "$b")" = "$(plutil -p "$n")" ]; then echo prefs-ok; else defaults import ${shq(cfg.bundleId)} "$b" && echo prefs-restored; fi`).stdout.trim();
    actions.push(pr);
    // 6. Experiment pilots.
    const keep = new Set(KEEP_PILOTS());
    const managed = managedPilots();
    const present = new Set(ssh(`ls ${rq(cfg.pilotsDir)}`).stdout.split("\n").filter(Boolean));
    for (const n of managed) {
        if (keep.has(n) || !present.has(n)) continue;
        ssh(`mkdir -p ${rq(dest + "/experiment-pilots")} && mv ${rq(cfg.pilotsDir + "/" + n)} ${rq(dest + "/experiment-pilots/")} && ` +
            `grep -vxF ${shq(n)} ${MANAGED()} > ${MANAGED()}.new; mv ${MANAGED()}.new ${MANAGED()}`);
        actions.push(`moved pilot ${n}`);
    }
    // 7. Verify.
    const v = ssh(`P=${rq(cfg.pilotsDir)}; B="$(dirname "$P")/Pilots-backup"; ` +
        `a=$(shasum "$P/Matt/..namedfork/rsrc" 2>/dev/null | cut -c1-40); b=$(shasum "$B/Matt/..namedfork/rsrc" 2>/dev/null | cut -c1-40); ` +
        `echo "matt=$a backup=$b"; ls "$P" | tr '\\n' '|'; echo`).stdout.trim().split("\n");
    const [mattLine, pilotsLine] = v;
    const matt = /matt=(\w*) backup=(\w*)/.exec(mattLine);
    const left = leftovers();
    const ok = !!matt && matt[1] === matt[2] && matt[1].length === 40 && left.length === 0 && foreign.length === 0;
    return { ok, cmd: "recover", baseline: "~/" + baseline, backed_up_to: "~/" + dest, actions,
        foreign_plugins: foreign, matt_sha1: matt?.[1] ?? null, matt_matches_backup: !!matt && matt[1] === matt[2],
        pilots: (pilotsLine ?? "").split("|").filter(Boolean), leftovers: left };
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
    if (sub === "park-last") {
        if (novaPids().length) throw new NovarefError("quit EV Nova first");
        return { ok: true, cmd: "pilots park-last", result: parkLastPilot() };
    }
    if (sub === "unpark-last") {
        if (novaPids().length) throw new NovarefError("quit EV Nova first");
        return { ok: true, cmd: "pilots unpark-last", result: unparkLastPilot() };
    }
    throw new NovarefError("usage: novaref pilots list | pull <name> [dest] [--raw] | push <local> [as <name>] | rm <name> | backup | park-last | unpark-last");
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
        // --window crops to EV Nova's content rect before encoding: about
        // a quarter of the pixels, so the 2010 iMac's software encoder keeps
        // up and drops fewer frames (matters for frame-timing measurements).
        let crop = "";
        if (takeFlag(args, "--window")) {
            const w = novaWindow();
            if (!w) throw new NovarefError("EV Nova window not found (is it running?)");
            const [x, y, cw, ch] = w.content;
            crop = `-vf ${shq(`crop=${cw}:${ch}:${x}:${y}`)} `;
        }
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
            `-capture_cursor 1 -framerate ${shq(fps)} -i 1:none ${crop}-c:v h264_videotoolbox -allow_sw 1 -b:v 8M ` +
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
    // {"move": [x, y]} moves the mouse; {"move": true} parks it at (40, 40),
    // outside the game window, so it never shows up in shots/recordings.
    if (step.move) return cmdMove(step.move === true ? ["40", "40"] : [...step.move.map(String), ...(step.win ? ["--win"] : [])]);
    if (step.open_pilot) return openPilot(step.open_pilot);
    if (step.record === "start") return cmdRecord(["start", ...(step.window ? ["--window"] : [])]);
    if (step.record === "stop") {
        ctx.recN = (ctx.recN ?? 0) + 1;
        const base = step.label ? `recording-${step.label}.mp4` : ctx.recN === 1 ? "recording.mp4" : `recording-${ctx.recN}.mp4`;
        return cmdRecord(["stop", path.join(ctx.dir, base)]);
    }
    if (step.launch) return cmdLaunch(ctx.app ? ["--app", ctx.app] : [], { inRun: true });
    if (step.pull) {
        // Mid-run pilot snapshot (the game saves the pilot when it lands).
        const name = ctx.pilotName;
        if (!name) throw new NovarefError("pull step needs a scenario pilot");
        return cmdPilotsPull([name, path.join(ctx.dir, `pilot-${step.pull}`, name), "--raw"]);
    }
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
    const plugins = (sc.plugins ?? []).map((p) => path.resolve(path.dirname(file), expandHome(p)));
    const appName = sc.app ?? "stock";
    // Test plug-ins and the minimal app must never meet Matthew's pilot:
    // the title screen is made to load nothing (Last Pilot parked), and
    // the game is always quit so the plug-ins can always be removed.
    const parkLast = plugins.length > 0 || appName !== "stock" || sc.park_last_pilot === true;
    if (plugins.length && sc.quit === false) throw new NovarefError("a scenario with plug-ins must quit (they are always uninstalled)");
    const ctx = { dir, shotN: 0, app: appName, pilotName: sc.pilot?.as ?? sc.pilot?.name };
    let failed = null;
    const installedNames = [];

    ensureHelper();
    // Keep the display awake for the run (an assertion held by this
    // caffeinate process only; killed at the end, capped at 2 h).
    const awakePid = Number(ssh(`{ nohup caffeinate -d -u -t 7200 >/dev/null 2>&1 < /dev/null & } ; echo $!`).stdout.trim()) || 0;
    await sleep(1000);
    // Pre-flight: a run starts only from a clean state. A running EV Nova
    // (e.g. reopened by macOS at login after a power cut, possibly hung at
    // the splash with a test plug-in loaded), a parked Last Pilot, a stale
    // recording or a non-empty Plug-ins all mean an earlier run died:
    // `novaref recover` reconciles them against the baseline.
    try {
        assertClean("run");
    } catch (e) {
        ssh(`kill ${awakePid} 2>/dev/null || true`, { allowFail: true });
        record({ phase: "preflight", error: e.message, ...e.extra });
        throw e;
    }
    const snapshot = backupPilots(`run-${name}`);
    record({ phase: "snapshot", backup: snapshot });
    try {
        if (sc.pilot?.push) {
            const pushPath = path.resolve(path.dirname(file), expandHome(sc.pilot.push));
            const r = await cmdPilotsPush([pushPath, ...(sc.pilot.as ? ["as", sc.pilot.as] : [])]);
            record({ phase: "push", result: r });
            if (!r.ok) throw new NovarefError("pilot push failed", r);
        }
        const leftovers = listPluginFiles();
        if (leftovers.length) throw new NovarefError("Plug-ins is not empty before the run", { plugins: leftovers });
        for (const p of plugins) {
            let local = p;
            if (/\.(json|mjs)$/.test(p)) {
                const { pluginMake } = await import("./plugin_make.mjs");
                const made = await pluginMake([p, path.join(dir, "plugins", path.basename(p).replace(/\.(json|mjs)$/, ""))]);
                record({ phase: "plugin-make", result: made });
                local = made.path;
            }
            const r = await cmdPluginInstall([local]);
            record({ phase: "plugin-install", result: r });
            installedNames.push(r.name);
            if (!r.ok) throw new NovarefError("plug-in install failed", r);
        }
        if (parkLast) record({ phase: "park-last-pilot", result: parkLastPilot() });
        if (sc.launch !== false) {
            const r = await cmdLaunch(["--app", appName], { inRun: true });
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
        let q = await cmdQuit([]);
        record({ phase: "quit", result: q });
        if (!q.ok && (installedNames.length || parkLast)) {
            // Plug-ins must come out: kill the game this run launched.
            q = await cmdQuit([]);
            record({ phase: "quit-retry", result: q });
        }
        results.quit = q.ok;
    }
    if (installedNames.length || plugins.length) {
        try {
            const r = await cmdPluginUninstall(["--all"]);
            record({ phase: "plugin-uninstall", result: r });
            results.plugins_uninstalled = r.moved;
            results.plugins_left = r.plugins_left;
            if (r.plugins_left.length) results.ok = false;
        } catch (e) {
            record({ phase: "plugin-uninstall", error: e.message });
            results.ok = false;
            results.plugin_uninstall_error = e.message;
        }
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
            `if [ -e ${rq(cfg.remoteDir + "/state/parked/Last Pilot")} ]; then ` +
            `mv ${rq(cfg.remoteDir + "/state/parked/Last Pilot")} ${rq(snapAbs + "/parked-Last Pilot")} && echo parked-copy-archived; fi; ` +
            `if [ -f ${rq(snapAbs + "/prefs.plist")} ]; then ` +
            `defaults export ${shq(cfg.bundleId)} ${rq(snapAbs + "/prefs-after.plist")}; ` +
            `[ "$(plutil -p ${rq(snapAbs + "/prefs.plist")})" = "$(plutil -p ${rq(snapAbs + "/prefs-after.plist")})" ] ` +
            `&& echo prefs-unchanged || ` +
            `{ defaults import ${shq(cfg.bundleId)} ${rq(snapAbs + "/prefs.plist")} && echo prefs-restored; }; fi`,
        { allowFail: true });
        results.restored = r.stdout.trim().split("\n").filter(Boolean);
        record({ phase: "restore", result: results.restored });
    }
    ssh(`kill ${awakePid} 2>/dev/null || true`, { allowFail: true });
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
  launch [--app stock|minimal] | quit [--force] | restart [--app ...]
  pilots list | pull <name> [dest] [--raw] | push <local> [as <name>] | rm <name> | backup | park-last | unpark-last
  pilot-make <spec.json> [out]
  plugin-make <spec.json> [out] [--data]
  plugin list | install <local> [as <name>] | uninstall <name>... | --all
  app list | setup-minimal <data.ndat>
  recover [--baseline novaref/backups/<ts>-manual]   reconcile after a dead run
  record start [--fps N] [--window] | record stop [out.mp4]
  run <scenario.json> [--out dir] [--pilot local-pilot]
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
        case "launch": return cmdLaunch(args);
        case "quit": return cmdQuit(args);
        case "restart": return cmdRestart(args);
        case "pilots": return cmdPilots(args);
        case "plugin": return cmdPlugin(args);
        case "app": return cmdApp(args);
        case "recover": return cmdRecover(args);
        // These two need the repo's built packages (scripts/setup_worktree.sh).
        case "pilot-make": return (await import("./pilot_make.mjs")).pilotMake(args);
        case "plugin-make": return (await import("./plugin_make.mjs")).pluginMake(args);
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
