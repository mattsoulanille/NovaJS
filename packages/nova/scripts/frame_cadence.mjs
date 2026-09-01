// Frame-cadence analyser for a Chrome DevTools trace of the NovaJS renderer.
// Extracts presented-frame intervals (PipelineReporter spans on the compositor),
// main-thread rAF work, GPU work, and attributes long frames.
//
// Usage: node frame_cadence.mjs <trace.json[.gz]> [fromSec] [toSec]
// NOTE: RENDERER/GPU_PID below are hardcoded for
// traces/Trace-20260831T193249-linux.json. For another trace, find the
// Renderer and "GPU Process" pids in its process_name metadata events
// (and CrRendererMain / Compositor / CrGpuMain tids in thread_name)
// and update the constants.
import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const FROM = Number(process.argv[3] ?? 0);   // seconds, relative
const TO = Number(process.argv[4] ?? 1e9);

async function* streamEvents(path) {
    const raw = fs.createReadStream(path, { highWaterMark: 1 << 20 });
    const input = path.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
    let started = false, depth = 0, inStr = false, esc = false, objStart = 0, carry = '';
    for await (const chunk of input) {
        let s = chunk.toString('utf8');
        if (!started) {
            const i = s.indexOf('"traceEvents":');
            if (i < 0) { carry = s.slice(-20); continue; }
            s = s.slice(s.indexOf('[', i) + 1);
            started = true;
            carry = '';
        }
        const startI = carry.length;
        s = carry + s;
        let done = false;
        for (let i = startI; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') { if (depth === 0) objStart = i; depth++; }
            else if (c === '}') { depth--; if (depth === 0) { try { yield JSON.parse(s.slice(objStart, i + 1)); } catch {} } }
            else if (c === ']' && depth === 0) { done = true; break; }
        }
        if (done) break;
        carry = depth === 0 ? '' : s.slice(objStart);
        objStart = 0;
    }
}

const RENDERER = 39440, MAIN = 1, COMP = 7, GPU_PID = 39083, GPU_MAIN = 39083;

const raf = [];              // {ts,dur} FireAnimationFrame on main
const ssa = [];              // {ts,dur} serviceScriptedAnimations on main
const present = [];          // AnimationFrame::Presentation instants on main {ts, seq}
const drawFrames = [];       // DrawFrame instants on compositor
const beginFrames = [];      // BeginFrame instants on compositor {ts, seq}
const gpuTasks = [];         // {ts,dur} on gpu main
const longTasks = [];        // RunTask > 10ms on renderer main {ts,dur}
const mainGC = [];           // gc-ish X events on renderer main {ts,dur,name}
const pipeline = new Map();  // id -> {b, e, args, subs: {name: dur}}
const animFrame = new Map(); // AnimationFrame async id -> {b,e,args}
let pipelineSampleB = null, pipelineSampleE = null;

const SUBSPANS = new Set(['BeginImplFrameToSendBeginMainFrame', 'SendBeginMainFrameToCommit', 'Commit',
    'EndCommitToActivation', 'EndActivateToSubmitCompositorFrame',
    'SubmitCompositorFrameToPresentationCompositorFrame', 'SubmitToReceiveCompositorFrame',
    'ReceiveCompositorFrameToStartDraw', 'StartDrawToSwapStart', 'Swap', 'SwapEndToPresentationCompositorFrame']);
const subOpen = new Map(); // `${id}/${name}` -> ts

let T0 = Infinity;
const evId = ev => ev.id ?? ev.id2?.local ?? ev.id2?.global ?? ev.bind_id;

for await (const ev of streamEvents(file)) {
    if (ev.ts > 0 && ev.ts < T0) T0 = ev.ts;
    const pid = ev.pid, tid = ev.tid;
    if (pid === RENDERER && tid === MAIN) {
        if (ev.name === 'FireAnimationFrame' && ev.ph === 'X') raf.push({ ts: ev.ts, dur: ev.dur ?? 0 });
        else if (ev.name === 'PageAnimator::serviceScriptedAnimations' && ev.ph === 'X') ssa.push({ ts: ev.ts, dur: ev.dur ?? 0 });
        else if (ev.name === 'AnimationFrame::Presentation') present.push({ ts: ev.ts, seq: ev.args?.begin_frame_id?.sequence_number });
        else if (ev.name === 'RunTask' && ev.ph === 'X' && (ev.dur ?? 0) > 10000) longTasks.push({ ts: ev.ts, dur: ev.dur });
        else if (ev.ph === 'X' && /GC|Gc/.test(ev.name) && (ev.dur ?? 0) > 1000) mainGC.push({ ts: ev.ts, dur: ev.dur, name: ev.name });
        else if (ev.name === 'AnimationFrame' && (ev.ph === 'b' || ev.ph === 'e')) {
            const id = evId(ev);
            let e = animFrame.get(id);
            if (!e) { e = {}; animFrame.set(id, e); }
            if (ev.ph === 'b') { e.b = ev.ts; if (ev.args) e.args = ev.args; }
            else { e.e = ev.ts; if (ev.args?.animation_frame_timing_info) e.args = ev.args; }
        }
    } else if (pid === RENDERER && tid === COMP) {
        if (ev.name === 'DrawFrame' && ev.ph === 'I') drawFrames.push(ev.ts);
        else if (ev.name === 'BeginFrame' && ev.ph === 'I') beginFrames.push({ ts: ev.ts, seq: ev.args?.frameSeqId });
        else if (ev.name === 'PipelineReporter') {
            const id = evId(ev);
            let p = pipeline.get(id);
            if (!p) { p = { subs: {} }; pipeline.set(id, p); }
            if (ev.ph === 'b') { p.b = ev.ts; p.argsB = ev.args?.frame_reporter; if (!pipelineSampleB) pipelineSampleB = JSON.stringify(ev.args); }
            else if (ev.ph === 'e') { p.e = ev.ts; p.argsE = ev.args?.frame_reporter ?? ev.args; if (!pipelineSampleE) pipelineSampleE = JSON.stringify(ev.args); }
        } else if (SUBSPANS.has(ev.name) && (ev.ph === 'b' || ev.ph === 'e')) {
            const id = evId(ev);
            const k = `${id}/${ev.name}`;
            if (ev.ph === 'b') subOpen.set(k, ev.ts);
            else {
                const b = subOpen.get(k);
                if (b !== undefined) {
                    subOpen.delete(k);
                    const p = pipeline.get(id);
                    if (p) { p.subs[ev.name] = (ev.ts - b) / 1000; if (ev.name === 'Swap') p.swapEnd = ev.ts; }
                }
            }
        }
    } else if (pid === GPU_PID && tid === GPU_MAIN) {
        if (ev.name === 'GPUTask' && ev.ph === 'X') gpuTasks.push({ ts: ev.ts, dur: ev.dur ?? 0 });
    }
}

const rel = ts => (ts - T0) / 1e6;
const inWin = ts => rel(ts) >= FROM && rel(ts) <= TO;

console.log('== sample PipelineReporter args b:', pipelineSampleB);
console.log('== sample PipelineReporter args e:', pipelineSampleE);

// ---- presented frames from pipeline reporters ----
const presented = [...pipeline.values()]
    .filter(p => p.b && p.e && p.subs['Swap'] !== undefined)
    .sort((a, b) => a.b - b.b);
console.log(`\npipeline reporters: ${pipeline.size} total, ${presented.length} with Swap`);

// Dropped-frame states from argsE
const states = new Map();
for (const p of pipeline.values()) {
    const s = p.argsE?.state ?? p.argsE?.frame_drop_reason ?? JSON.stringify(p.argsE)?.slice(0, 60);
    states.set(s, (states.get(s) ?? 0) + 1);
}
console.log('pipeline end states:', [...states.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));

// ---- per-second fps table over whole trace (to pick stable window) ----
const secs = new Map();
for (const p of presented) { const s = Math.floor(rel(p.e)); secs.set(s, (secs.get(s) ?? 0) + 1); }
const ssaSecs = new Map();
for (const s of ssa) { const k = Math.floor(rel(s.ts)); ssaSecs.set(k, (ssaSecs.get(k) ?? 0) + 1); }
console.log('\n== per-second: presented compositor frames | main rAF frames');
for (let s = 0; s <= Math.max(...secs.keys()); s++)
    console.log(`${String(s).padStart(3)}s  ${String(secs.get(s) ?? 0).padStart(4)}  ${String(ssaSecs.get(s) ?? 0).padStart(4)}`);

// ---- interval histogram in window (presentation-to-presentation of main frames) ----
// Use AnimationFrame::Presentation instants on main = when a main frame actually hit the screen.
const pres = present.filter(p => inWin(p.ts)).map(p => p.ts).sort((a, b) => a - b);
const intervals = [];
for (let i = 1; i < pres.length; i++) intervals.push((pres[i] - pres[i - 1]) / 1000);
const buckets = [[0, 5], [5, 9], [9, 13], [13, 20], [20, 28], [28, 40], [40, 60], [60, 1e9]];
console.log(`\n== main-frame presentation intervals in [${FROM},${TO}]s  (n=${intervals.length}, mean=${(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(2)}ms)`);
for (const [lo, hi] of buckets) {
    const n = intervals.filter(v => v >= lo && v < hi).length;
    console.log(`  ${String(lo).padStart(3)}-${hi === 1e9 ? 'inf' : String(hi).padStart(3)}ms  ${String(n).padStart(5)}  ${(100 * n / intervals.length).toFixed(1)}%`);
}

// rAF cadence: intervals between serviceScriptedAnimations starts
const ssaW = ssa.filter(s => inWin(s.ts));
const ssaInt = [];
for (let i = 1; i < ssaW.length; i++) ssaInt.push((ssaW[i].ts - ssaW[i - 1].ts) / 1000);
console.log(`\n== main rAF (serviceScriptedAnimations) start intervals (n=${ssaInt.length})`);
for (const [lo, hi] of buckets) {
    const n = ssaInt.filter(v => v >= lo && v < hi).length;
    console.log(`  ${String(lo).padStart(3)}-${hi === 1e9 ? 'inf' : String(hi).padStart(3)}ms  ${String(n).padStart(5)}  ${(100 * n / ssaInt.length).toFixed(1)}%`);
}
const durs = ssaW.map(s => s.dur / 1000).sort((a, b) => a - b);
const q = p => durs[Math.floor(p * durs.length)] ?? 0;
console.log(`rAF callback duration ms: p50=${q(.5).toFixed(2)} p90=${q(.9).toFixed(2)} p99=${q(.99).toFixed(2)} max=${durs[durs.length - 1]?.toFixed(2)}`);

// total main work per frame: FireAnimationFrame durations
const rafW = raf.filter(r => inWin(r.ts)).map(r => r.dur / 1000).sort((a, b) => a - b);
const qr = p => rafW[Math.floor(p * rafW.length)] ?? 0;
console.log(`FireAnimationFrame duration ms: n=${rafW.length} p50=${qr(.5).toFixed(2)} p90=${qr(.9).toFixed(2)} p99=${qr(.99).toFixed(2)} max=${rafW[rafW.length - 1]?.toFixed(2)}`);

// ---- attribution of long intervals ----
// For each presentation gap > 24ms in window, look at what happened between the two presents:
// main-thread rAF work, long tasks, GC, GPU busy, compositor sub-span times of the pipeline ending in that present.
let attr = { workload: 0, gpu: 0, pacing: 0, longtask: 0 };
const examples = [];
for (let i = 1; i < pres.length; i++) {
    const gap = (pres[i] - pres[i - 1]) / 1000;
    if (gap < 24) continue;
    const a = pres[i - 1], b = pres[i];
    const mainWork = raf.filter(r => r.ts >= a && r.ts < b).reduce((s, r) => s + r.dur, 0) / 1000
        + ssa.filter(r => r.ts >= a && r.ts < b).reduce((s, r) => s + r.dur, 0) / 1000 * 0; // raf covers it
    const lt = longTasks.filter(t => t.ts + t.dur >= a && t.ts < b).reduce((s, t) => s + t.dur, 0) / 1000;
    const gpu = gpuTasks.filter(t => t.ts >= a && t.ts < b).reduce((s, t) => s + t.dur, 0) / 1000;
    const gc = mainGC.filter(t => t.ts >= a && t.ts < b).reduce((s, t) => s + t.dur, 0) / 1000;
    let cause;
    if (lt > gap * 0.5) { cause = 'longtask'; attr.longtask++; }
    else if (mainWork > gap * 0.6) { cause = 'workload'; attr.workload++; }
    else if (gpu > gap * 0.6) { cause = 'gpu'; attr.gpu++; }
    else { cause = 'pacing'; attr.pacing++; }
    if (examples.length < 40) examples.push({ t: rel(a).toFixed(3), gap: gap.toFixed(1), mainWork: mainWork.toFixed(1), lt: lt.toFixed(1), gpu: gpu.toFixed(1), gc: gc.toFixed(1), cause });
}
console.log(`\n== long presentation gaps (>24ms) attribution: ${JSON.stringify(attr)}`);
console.log('  t(s)      gap   mainWork  longTask  gpuBusy  mainGC  cause');
for (const e of examples) console.log(`  ${e.t.padStart(8)} ${e.gap.padStart(6)} ${e.mainWork.padStart(8)} ${e.lt.padStart(8)} ${e.gpu.padStart(8)} ${e.gc.padStart(6)}  ${e.cause}`);

// ---- pipeline sub-span breakdown for presented frames in window ----
const pw = presented.filter(p => inWin(p.b));
const subNames = [...SUBSPANS];
console.log(`\n== compositor pipeline sub-span p50/p90/p99 (ms) over ${pw.length} presented frames in window`);
for (const n of subNames) {
    const vals = pw.map(p => p.subs[n]).filter(v => v !== undefined).sort((a, b) => a - b);
    if (!vals.length) continue;
    const qq = p => vals[Math.floor(p * vals.length)] ?? 0;
    console.log(`  ${n.padEnd(50)} n=${String(vals.length).padStart(5)} p50=${qq(.5).toFixed(2).padStart(7)} p90=${qq(.9).toFixed(2).padStart(7)} p99=${qq(.99).toFixed(2).padStart(7)}`);
}

// AnimationFrame async timing info: blocking durations
const afs = [...animFrame.values()].filter(a => a.b && inWin(a.b) && a.args?.animation_frame_timing_info);
const blk = afs.map(a => a.args.animation_frame_timing_info.blocking_duration_ms).sort((a, b) => a - b);
if (blk.length) {
    const qb = p => blk[Math.floor(p * blk.length)] ?? 0;
    console.log(`\nAnimationFrame blocking_duration_ms: n=${blk.length} p50=${qb(.5)} p90=${qb(.9)} p99=${qb(.99)} max=${blk[blk.length - 1]}`);
}

// BeginFrame interval on compositor (the vsync source cadence)
const bfW = beginFrames.filter(b => inWin(b.ts)).map(b => b.ts).sort((a, b) => a - b);
const bfInt = [];
for (let i = 1; i < bfW.length; i++) bfInt.push((bfW[i] - bfW[i - 1]) / 1000);
bfInt.sort((a, b) => a - b);
const qf = p => bfInt[Math.floor(p * bfInt.length)] ?? 0;
console.log(`\ncompositor BeginFrame intervals ms: n=${bfInt.length} p10=${qf(.1).toFixed(2)} p50=${qf(.5).toFixed(2)} p90=${qf(.9).toFixed(2)}`);
