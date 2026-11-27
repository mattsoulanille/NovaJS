# Performance stats from every player

NovaJS collects a compact performance summary from every player's client
while they play, so slowdowns seen on someone else's machine (the "a frame
every few seconds with lots on screen" kind) can be read off real sessions
instead of reproduced.

## What a client sends

`packages/nova/src/client/perf_telemetry.ts` samples continuously and sends
one summary (`PerfSample`, `src/common/perf_stats.ts`) every ~12 s while any
of the window was in space, every ~30 s when it was all landed or in
transit, one when the player changes system (if the window is at least 3 s
long), and a last one as a beacon when the session ends or the page hides.
A sample is ~4 KB of JSON:

- **Frames** (animation frames only; a hidden tab's time is counted apart as
  `hiddenMs`): count, mean, p50 / p95 / p99, worst, frames over 100 ms and
  over 1 s, a 10-bucket histogram (bounds 8.5, 12, 17.5, 25, 34, 50, 100,
  250, 1000 ms), rAF frames per second, and the drawless ticker updates the
  frame pump's background heartbeat drove (per second, never counted as
  frames).
- **The main thread per frame**: all ticker work, the display world's step,
  PIXI's render, the rest of the ticker; the state applies (simulation frames
  applied to the display world, off the ticker) per call; and the time
  between landed snapshots in one system, with how many gaps passed 500 ms
  (the frame pump's `STALE_SNAPSHOT_MS`, where ships stop extrapolating).
- **Stalls**: the 8 worst frame intervals over 100 ms, each with the ticker
  work of the frame before it, the applies in the gap, the long tasks that
  overlapped it, and what the world held (ships, projectiles, missiles,
  beams, entities, on screen, particles).
- **The simulation**: pump round trips, ticks per second, steps per pump
  (mean / max), the worker's own ms per step as `bridge.step` returns it
  (mean, worst per step, worst batch), `pacing.behindTicks` (mean / max), and
  the worker's own counters (`SimulationBridgeHost.perfCounters()`: step and
  snapshot cost, rollbacks, their depth, and the rollback events such as
  `holdForRelay` and `resync`).
- **Counts**, 4x a second in space, mean and max over the window: ships,
  projectiles, missiles (the projectiles with ProxRadius > 0, which the
  worker's `ProjectileProximityFuseSystem` scans against every collidable
  each tick; in stock data that is most of them), beams, explosions,
  asteroids, planets, all display entities, the on-screen subset of each,
  GPU particles alive and spawned.
- **Long tasks** (`PerformanceObserver('longtask')`, Chromium) and the **JS
  heap** (`performance.memory`, Chromium; drops over 4 MB count as GC
  hints). Null where the browser cannot say.
- **Context**: build stamp, system id and how often it changed, room speed,
  players in space (the speed vote's voter count), the user agent, the WebGL
  renderer string, device pixel ratio, canvas size, `hardwareConcurrency`,
  `deviceMemory`.

It is display-side only: nothing is synced or reaches the simulation's
state, the per-frame hooks allocate nothing (`src/client/perf_sampler.ts`),
and a failed send is dropped.

**Privacy.** No pilot name, no chat, no position, nothing from the save. The
only id is `sid`, a random UUID made once per page load. The server stores
the validated sample and the time it arrived, nothing about the request
(Cloud Run's own request log still records the requesting address, as it
does for every request). Players switch the whole thing off with
**Preferences > Display > Send performance stats** (on by default; saved for
the browser, like the display scales).

## Where it goes

`POST /perf_stats` (`src/server/perf_stats_route.ts`): a 16 KB body limit,
strict validation (every number finite and bounded, strings and arrays
capped, unknown keys stripped), a rate limit per session (burst 6, then one
per 4 s) and for everyone together (burst 100, then 20/s). It answers 204 at
once; the write happens after. An HTTP route rather than a socket message:
no wire-schema change, nothing on the relay's message path, and a beacon can
carry the last window as the page closes.

The sink follows `NOVA_PERF_STATS` (`file`, `stdout`, `both`, `off`):

- **Local server** (default `file`): one JSON line per sample appended to
  `packages/nova/perf_stats/<UTC date>.jsonl` (gitignored; override the
  directory with `NOVA_PERF_STATS_DIR`), capped at 256 MB a day and 1 GB a
  process.
- **Cloud Run** (default `stdout` when `K_SERVICE` is set): one structured
  JSON line per sample, which Cloud Logging keeps as a `jsonPayload`
  (`logType: "novajs_perf_stats"`). Export them with:

```
gcloud logging read 'resource.type="cloud_run_revision" AND
  resource.labels.service_name="nova" AND
  jsonPayload.logType="novajs_perf_stats" AND timestamp>="2026-11-27T00:00:00Z"' \
  --project novajs-303605 --format=json --limit 10000 > perf.json
```

## The report

```
cd packages/nova
node scripts/perf_stats_report.mjs                 # perf_stats/*.jsonl
node scripts/perf_stats_report.mjs perf.json       # a Cloud Logging export
node scripts/perf_stats_report.mjs a.jsonl b.json --stalls 30 --json
```

Per build and per session: the frame-rate distribution, stalls per minute,
heartbeat updates per second, snapshot gaps over 500 ms, the simulation's
rate and per-step cost, steps per pump and drift; the worst stalls across
everything, with their split and what was in the world; frame time binned
by entities on screen, in the system, and by missiles; and least-squares
fits (frame / render ms against on-screen entities, worker ms per tick
against entities, ms per step against missiles x (ships + asteroids)).

A stall's **unaccounted** time is the gap less the larger of (the ticker
work before it + the applies in it) and the long tasks that overlapped it:
time the page cannot see, i.e. the GPU, the compositor, or the browser
throttling the page.

Sample output: two headless (SwiftShader) sessions on a local server, 30
extra NPCs fighting in one system:

```
NovaJS performance stats: 8 samples, 2 sessions
2026-11-27T21:47:16.779Z .. 2026-11-27T21:49:03.596Z

== Per build
build                         sessions  samples  minutes  fps    p50     p95    p99  >100ms  >1s  stalls/min  worst ms  heartbeat/s  gaps>500/min  ticks/s  ms/step  rollbacks
----------------------------  --------  -------  -------  ---  -----  ------  -----  ------  ---  ----------  --------  -----------  ------------  -------  -------  ---------
08c79d14-dirty-1795815936577         2        8      1.1  8.6  <=100  <=1000  >1000     146    6      134.56      2674         23.2          2.77     59.6     3.31          2
  08c79d14-dirty-1795815936577 frame times: <=8.5ms 4.8% | <=12ms 0.4% | <=17.5ms 0.4% | <=34ms 2.7% | <=50ms 22.8% | <=100ms 42.8% | <=250ms 18.5% | <=1000ms 6.6% | >1000ms 1.1%

== Simulation per session (ms/step: bridge.step's own figure; gaps: time between landed snapshots)
session   ticks/s  min t/s  steps/pump  max steps  ms/step  worst batch  worker tick  snapshot  behind  max behind  gaps>500  max gap  rollbk  max depth
--------  -------  -------  ----------  ---------  -------  -----------  -----------  --------  ------  ----------  --------  -------  ------  ---------
115950eb     59.5     55.9         3.0         33     3.47          108         3.48      1.13    13.0        57.8         2     1052       1         13
fafc43ed     59.7     59.0         1.9         31     3.16          113         3.11      1.10    13.4        70.3         1      844       1         19

== Worst stalls (frame intervals over 100 ms; split is the ticker work before the gap)
ms     session    system  ticker  display  render  apply  longtask  unaccounted  ships  proj  missiles  beams  ents  on-scr  particles                   at
----  --------  --------  ------  -------  ------  -----  --------  -----------  -----  ----  --------  -----  ----  ------  ---------  -------------------
2674  115950eb  nova:184     1.4      1.1     0.3  136.6       0.1       2536.1     37    29        29      0   211      41        512  2026-11-27T21:47:16
2139  fafc43ed  nova:184     1.8      1.2     0.5  115.0       0.0       2022.4     34    52        52      0   231      79        256  2026-11-27T21:48:38
927   115950eb  nova:184   925.5      0.9   924.5    0.0       0.0          1.2     37    29        29      0   211      41        512  2026-11-27T21:47:16
```

(SwiftShader draws on the CPU, so these multi-second stalls are almost all
"unaccounted": the main thread was idle and the frames were waiting on the
software GPU, while the heartbeat kept the simulation at ~60 ticks/s.)
