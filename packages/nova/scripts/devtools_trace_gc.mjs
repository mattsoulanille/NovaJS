/**
 * Reads a Chrome DevTools performance trace (the JSON DevTools saves,
 * optionally .gz — hundreds of MB is fine, it is streamed) and prints
 * what matters for a "the game froze" report:
 *   - every MajorGC / MinorGC on every thread with duration and heap
 *     before/after, plus the phases inside the longest one (is it V8
 *     marking, sweeping, or CppGC.SweepInvokePreFinalizers = Blink
 *     objects' pre-finalizers?),
 *   - the main thread's UpdateCounters over time (JS heap, DOM nodes,
 *     JS event listeners),
 *   - the sampled CPU profile of a thread: top self / inclusive
 *     functions, and callers of any function matching --callers.
 * Also reads a DevTools sampling heap profile (.heapprofile) and prints
 * the top retaining sites (self and inclusive bytes) and heaviest paths.
 *
 * Usage:
 *   node scripts/devtools_trace_gc.mjs traces/major_gc.gz [--thread CrRendererMain]
 *        [--from 5 --to 18.5] [--callers 'EventListener|postMessage']
 *   node scripts/devtools_trace_gc.mjs traces/x.heapprofile
 * The pid/tid of the game's renderer main thread is picked as the
 * CrRendererMain with the most trace events; override with --pid/--tid.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const file = args[0];
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
if (!file) { console.error('usage: devtools_trace_gc.mjs <trace.json[.gz] | profile.heapprofile>'); process.exit(1); }

if (file.endsWith('.heapprofile')) {
    heapProfile(JSON.parse(fs.readFileSync(file, 'utf8')));
} else {
    trace(await streamTrace(file));
}

/** Streams the traceEvents array of a huge trace without JSON.parsing it whole. */
async function streamTrace(path) {
    const raw = fs.createReadStream(path);
    const input = path.endsWith('.gz') ? raw.pipe(zlib.createGunzip()) : raw;
    let started = false, depth = 0, inStr = false, esc = false, objStart = 0, carry = '';
    const events = [];
    const handle = s => { try { events.push(JSON.parse(s)); } catch { /* skip */ } };
    for await (const chunk of input) {
        let s = chunk.toString('utf8');
        if (!started) {
            const i = s.indexOf('"traceEvents":');
            if (i < 0) continue;
            s = s.slice(s.indexOf('[', i) + 1);
            started = true;
        }
        const startI = carry.length;
        s = carry + s;
        let done = false;
        for (let i = startI; i < s.length; i++) {
            const c = s[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') { if (depth === 0) objStart = i; depth++; }
            else if (c === '}') { depth--; if (depth === 0) handle(s.slice(objStart, i + 1)); }
            else if (c === ']' && depth === 0) { done = true; break; }
        }
        if (done) break;
        carry = depth === 0 ? '' : s.slice(objStart);
        objStart = 0;
    }
    return events;
}

function trace(events) {
    const threads = new Map(); // `${pid}/${tid}` -> name
    const counts = new Map();
    for (const ev of events) {
        if (ev.name === 'thread_name') threads.set(`${ev.pid}/${ev.tid}`, ev.args.name);
        const k = `${ev.pid}/${ev.tid}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const wanted = opt('--thread', 'CrRendererMain');
    let main = [...threads.entries()].filter(([, n]) => n === wanted)
        .sort((a, b) => (counts.get(b[0]) ?? 0) - (counts.get(a[0]) ?? 0))[0]?.[0];
    if (opt('--pid') && opt('--tid')) main = `${opt('--pid')}/${opt('--tid')}`;
    let T0 = Infinity;
    for (const e of events) if (e.ts > 0 && e.ts < T0) T0 = e.ts;
    const rel = ts => ((ts - T0) / 1e6).toFixed(3) + 's';
    console.log(`threads: ${[...threads.entries()].map(([k, n]) => `${k}=${n}(${counts.get(k) ?? 0})`).join(', ')}`);
    console.log(`analysing thread ${main} (${threads.get(main)})`);

    // GC events on every thread.
    const gcs = events.filter(e => e.ph === 'X' && /^(MajorGC|MinorGC)$/.test(e.name)).sort((a, b) => a.ts - b.ts);
    console.log('\n== GC events (all threads), sorted by time');
    for (const g of gcs) {
        const a = g.args ?? {};
        console.log(`${rel(g.ts)} ${(g.dur / 1000).toFixed(1).padStart(8)}ms ${g.pid}/${g.tid} ${threads.get(`${g.pid}/${g.tid}`) ?? ''} ${g.name} ${a.type ?? ''} `
            + `${(a.usedHeapSizeBefore / 1e6).toFixed(1)}MB -> ${(a.usedHeapSizeAfter / 1e6).toFixed(1)}MB`);
    }
    const longest = gcs.filter(g => g.name === 'MajorGC').sort((a, b) => b.dur - a.dur)[0];
    if (longest) {
        console.log(`\n== phases inside the longest MajorGC (${(longest.dur / 1000).toFixed(1)}ms at ${rel(longest.ts)} on ${longest.pid}/${longest.tid})`);
        const inside = events.filter(e => e.ph === 'X' && e.pid === longest.pid && e.tid === longest.tid
            && e.ts >= longest.ts && e.ts + (e.dur ?? 0) <= longest.ts + longest.dur && e.dur >= 500
            && !/INCREMENTAL|IncrementalMark|MarkTransitive/.test(e.name)).sort((a, b) => a.ts - b.ts);
        for (const e of inside) console.log(`  +${((e.ts - longest.ts) / 1000).toFixed(1).padStart(8)}ms ${(e.dur / 1000).toFixed(1).padStart(8)}ms ${e.name} ${JSON.stringify(e.args ?? {}).slice(0, 120)}`);
    }

    // Counters.
    const [pid, tid] = main.split('/').map(Number);
    const counters = events.filter(e => e.name === 'UpdateCounters' && e.pid === pid && e.tid === tid).sort((a, b) => a.ts - b.ts);
    if (counters.length) {
        console.log('\n== main-thread counters (every ~1s)');
        let last = -1;
        for (const c of counters) {
            const t = (c.ts - T0) / 1e6;
            if (t - last < 1) continue;
            last = t;
            const d = c.args.data;
            console.log(`${t.toFixed(1).padStart(6)}s heap ${(d.jsHeapSizeUsed / 1e6).toFixed(1).padStart(7)}MB nodes ${d.nodes} listeners ${d.jsEventListeners}`);
        }
    }

    // CPU profile.
    const prof = events.find(e => e.name === 'Profile' && e.pid === pid && e.tid === tid);
    if (!prof) { console.log('\n(no CPU profile for this thread)'); return; }
    const chunks = events.filter(e => e.name === 'ProfileChunk' && e.pid === pid && e.id === prof.id).sort((a, b) => a.ts - b.ts);
    const from = Number(opt('--from', '0')), to = Number(opt('--to', '1e9'));
    const callersRe = opt('--callers') ? new RegExp(opt('--callers')) : undefined;
    const nodes = new Map();
    let t = prof.args.data.startTime;
    const self = new Map(), incl = new Map(), callers = new Map();
    let n = 0;
    const fk = cf => `${cf.functionName || '(anon)'} ${(cf.url || '').replace(/^.*\//, '')}:${cf.lineNumber + 1}`;
    for (const c of chunks) {
        const cp = c.args.data.cpuProfile ?? {};
        for (const nd of cp.nodes ?? []) nodes.set(nd.id, nd);
        const samples = cp.samples ?? [], deltas = c.args.data.timeDeltas ?? [];
        for (let i = 0; i < samples.length; i++) {
            t += deltas[i] ?? 0;
            const r = (t - T0) / 1e6;
            if (r < from || r > to) continue;
            n++;
            let nd = nodes.get(samples[i]);
            const leaf = fk(nd.callFrame);
            self.set(leaf, (self.get(leaf) ?? 0) + 1);
            const seen = new Set();
            const stack = [];
            while (nd) {
                const k = fk(nd.callFrame);
                stack.push(k);
                if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + 1); }
                nd = nodes.get(nd.parent);
            }
            if (callersRe && callersRe.test(leaf)) {
                const key = stack.slice(0, 7).join(' <- ');
                callers.set(key, (callers.get(key) ?? 0) + 1);
            }
        }
    }
    const show = (m, title, k = 35) => {
        console.log(`\n== CPU profile ${title} (${n} samples in [${from}, ${to}]s)`);
        for (const [key, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)) console.log(`${String(v).padStart(7)} ${(100 * v / n).toFixed(1).padStart(5)}% ${key}`);
    };
    show(self, 'self');
    show(incl, 'inclusive', 50);
    if (callersRe) show(callers, `stacks under ${callersRe}`, 25);
}

function heapProfile(p) {
    const bySelf = new Map(), byTotal = new Map();
    const key = cf => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\//, '')}:${cf.lineNumber + 1}`;
    let grand = 0;
    const leaves = [];
    (function walk(node, stack) {
        grand += node.selfSize;
        const k = key(node.callFrame);
        let total = node.selfSize;
        for (const c of node.children) total += walk(c, stack.concat([k]));
        bySelf.set(k, (bySelf.get(k) ?? 0) + node.selfSize);
        if (!stack.includes(k)) byTotal.set(k, (byTotal.get(k) ?? 0) + total);
        if (node.selfSize > 0) leaves.push({ size: node.selfSize, path: stack.concat([k]) });
        return total;
    })(p.head, []);
    const fmt = b => (b / 1048576).toFixed(2).padStart(8) + 'MB';
    console.log(`sampled bytes ${fmt(grand)}`);
    const show = (m, title, k = 30) => {
        console.log(`\n== ${title}`);
        for (const [kk, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)) console.log(`${fmt(v)} ${(100 * v / grand).toFixed(1).padStart(5)}% ${kk}`);
    };
    show(bySelf, 'top self (bytes allocated at this frame)');
    show(byTotal, 'top inclusive', 40);
    console.log('\n== heaviest leaf paths');
    for (const l of leaves.sort((a, b) => b.size - a.size).slice(0, 15)) {
        console.log(fmt(l.size));
        for (const s of l.path.slice(-10)) console.log('    ' + s);
    }
}
