/**
 * ============================================================================
 * The frame pump
 * ============================================================================
 *
 * Every ticker frame: step the display world (always — motion stays
 * smooth across a missed simulation round trip), then, if no frame is
 * still in flight, run one simulation frame: the outer bookkeeping
 * world, the autopilot, the docking blocks (client/docking.ts), the
 * standing escort flushes, and the fixed-timestep step-and-snapshot
 * against the live system's bridge.
 *
 * The pump reads the live system OFF THE CLIENT STATE at the top of each
 * frame and captures it: a transition that takes the bridge away
 * mid-frame settles the frame's awaits with SimulationBridgeClosedError,
 * which is the frame's ordinary end. One pump per game session; the
 * teardown removes it from the ticker, stops the heartbeat, and waits
 * for the frame in flight (a lift-off mid-await holds a roster it has
 * taken, and the rosters must not be reset underneath it).
 */
import { MovementTimeLimitResource } from 'nova_ecs/plugins/movement_plugin';
import { TimeScaleResource } from 'nova_ecs/plugins/time_plugin';
import type { World } from 'nova_ecs/world';
import type * as PIXI from 'pixi.js';
import { UPDATE_PRIORITY } from 'pixi.js';
import type Stats from 'stats.js';
import type { Autopilot } from '../autopilot.js';
import {
    applySimulationFrame, movementSyncedSinceStep, stageSimulationFrameGameData,
} from '../communication/apply_simulation_frame.js';
import {
    SimulationBridgeClosedError,
} from '../communication/async_simulation_bridge_client.js';
import type { RoomSpeed } from '../communication/rollback_protocol.js';
import type {
    SimulationFrame, SimulationPacing,
} from '../communication/simulation_frame.js';
import {
    advanceDisplayClock, MAX_EXTRAPOLATION_DELTA_MS,
    shouldExtrapolate, snapshotMaxLeadMs,
} from '../display/movement_extrapolation_plugin.js';
import { RoomSpeedResource } from '../display/speed_indicator_plugin.js';
import { JumpComponent, JumpRouteComponent } from '../nova_plugin/travel/index.js';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { dockedShip, liveSystem, LiveSystem } from './client_state.js';
import { runDockingFrame } from './docking.js';
import { FrameBacklog } from './frame_backlog.js';
import {
    flushCarriedJumpEscorts, flushLandedEscorts, localPlayerShipUuid,
} from './fleet_ledger.js';
import type { PerfProbe } from './perf_telemetry.js';
import { onResyncFailed } from './resync_failure.js';
import type { ClientRuntime } from './runtime.js';

// Fixed-timestep bookkeeping: real elapsed ms not yet simulated.
const MAX_CATCHUP_STEPS = 6;
/**
 * Tick pacing against the room's clock (from the last frame). Small
 * drift is corrected by the rate factor — time runs imperceptibly fast
 * or slow. Only drift beyond SNAP_BEHIND_TICKS (a hidden tab, a long
 * stall) is snapped, bounded per frame by HARD_CATCHUP_STEPS. All three
 * tick limits scale with the room's speed (R1 #371) so they keep their
 * real-time meaning at 2x.
 */
const SNAP_BEHIND_TICKS = 30;
const HARD_CATCHUP_STEPS = 60;
/**
 * Right after a system entry the pump snaps far more eagerly: any drift
 * beyond ENTRY_SNAP_BEHIND_TICKS (scaled by speed) is stepped at once
 * rather than slewed, for the first ENTRY_SNAP_WINDOW_MS of a new live
 * system or a lift-off, and for as long as the player is docked (the
 * world is behind the spaceport or the gate map then, and drift left to
 * pile up there — a landed UI's long frames lose steps — would be the
 * lift-off's control lag). A system entry already stepped the world
 * onto the room's clock before its first in-space frame
 * (SimulationBridgeHost.catchUpToRoomClock); this mops up the few ticks
 * the last of the entry's work cost, which the ±5% slew would otherwise
 * take seconds over — seconds in which every input lands that many
 * ticks late. The window is two seconds so that it covers the room's
 * first periodic tickSync (one a second) after the join: the join
 * reply that anchored the clock estimate is a big message, late by its
 * own transfer and decode, and that first tickSync corrects the
 * estimate UP by however late it was. Steady state in space is
 * untouched.
 */
const ENTRY_SNAP_BEHIND_TICKS = 2;
export const ENTRY_SNAP_WINDOW_MS = 2000;
/**
 * The most simulation work, in wall-clock ms at the worker's measured
 * cost per step, that one pump may ask for. The pump waits for its
 * batch before the next snapshot can land, so a batch IS the gap
 * between snapshots: ships extrapolate across it, and freeze outright
 * once it passes STALE_SNAPSHOT_MS. A worker that keeps up (a few ms a
 * tick) never meets this; one that cannot keep 60 ticks/s (a big
 * fight) used to be handed the full hard snap (HARD_CATCHUP_STEPS) on
 * every pump once it trailed the room — 66 ticks at 50 ms is a
 * 3.3-second batch, which is the "renders one frame every three
 * seconds" stall. Bounding the batch keeps snapshots flowing at about
 * this interval: the simulation runs no slower than it did (the
 * worker's throughput is the limit either way), but in slow motion
 * instead of in lurches.
 */
export const STEP_BATCH_BUDGET_MS = 100;

/**
 * How many steps fit in STEP_BATCH_BUDGET_MS at `msPerStep`, never
 * fewer than one. Unbounded while the cost is unknown.
 */
export function stepBatchCap(msPerStep: number | undefined): number {
    if (msPerStep === undefined || !(msPerStep > 0)) {
        return Infinity;
    }
    return Math.max(1, Math.floor(STEP_BATCH_BUDGET_MS / msPerStep));
}

/**
 * Pure fixed-timestep accumulator step for the frame pump: converts real
 * elapsed ms into a whole number of simulation steps while keeping
 * catch-up caps scaled to real time at both 1x and 2x (#371 R1).
 */
export function advanceSimulationDebt(input: {
    timeDebt: number;
    elapsedMs: number;
    paused: boolean;
    pendingSteps: number;
    pacing?: SimulationPacing;
    /** Just entered (or docked; see ENTRY_SNAP_BEHIND_TICKS): snap any
     * drift beyond ENTRY_SNAP_BEHIND_TICKS instead of slewing it. */
    eagerSnap?: boolean;
    /**
     * The worker's recent wall-clock cost per step (see stepBatchCap):
     * a frame's steps are bounded to STEP_BATCH_BUDGET_MS of it. Not
     * applied to debug stepping while paused.
     */
    msPerStep?: number;
}): { steps: number; timeDebt: number } {
    let timeDebt = input.timeDebt;
    if (!input.paused && input.elapsedMs > 0) {
        // Slew toward the room's clock: elapsed time counts slightly fast
        // or slow rather than ticks being skipped or doubled.
        timeDebt += input.elapsedMs * (input.pacing?.rate ?? 1);
    }
    // If we fall behind (heavy load, background tab), run at most a few
    // catch-up steps rather than spiraling (scaled by room speed so the
    // wall-clock cap stays ~100ms at 2x as well).
    const speed = input.pacing?.speed ?? 1;
    timeDebt = Math.min(timeDebt,
        SIMULATION_STEP_MS * MAX_CATCHUP_STEPS * speed);
    const ordinary = Math.floor(timeDebt / SIMULATION_STEP_MS);
    let steps = ordinary;
    timeDebt -= steps * SIMULATION_STEP_MS;
    if (input.paused) {
        return { steps: input.pendingSteps, timeDebt: 0 };
    }
    if (input.pacing && input.pacing.behindTicks
        > (input.eagerSnap ? ENTRY_SNAP_BEHIND_TICKS : SNAP_BEHIND_TICKS)
            * speed) {
        // Too far behind the room to slew: snap by stepping the backlog,
        // bounded per frame (also scaled by speed to keep real-time cap).
        steps += Math.min(Math.floor(input.pacing.behindTicks),
            HARD_CATCHUP_STEPS * speed);
    }
    const cap = stepBatchCap(input.msPerStep);
    if (steps > cap) {
        // A slow worker: hand it no more than the budget. Ordinary steps
        // left over stay owed (under the same debt cap); the snap's share
        // is re-read from the room's clock next frame.
        const deferred = Math.max(0, ordinary - cap);
        timeDebt = Math.min(timeDebt + deferred * SIMULATION_STEP_MS,
            SIMULATION_STEP_MS * MAX_CATCHUP_STEPS * speed);
        steps = cap;
    }
    return { steps, timeDebt };
}

/**
 * Applies the room's clock multiplier (1x or 2x) to the display world's
 * scaled wall clock and movement-extrapolation clamp (R2 #371): explosions,
 * particles, sprite animations, engine glow, bank timing, and movement
 * extrapolation between snapshots all run at the room's pace.
 */
export function applyDisplaySpeed(displayWorld: World, speed: RoomSpeed): void {
    const timeScale = displayWorld.resources.get(TimeScaleResource);
    if (timeScale) {
        timeScale.scale = speed;
    }
    const movementLimit = displayWorld.resources.get(MovementTimeLimitResource);
    if (movementLimit) {
        movementLimit.maxDeltaMs = MAX_EXTRAPOLATION_DELTA_MS * speed;
    }
}

/**
 * Runs one ticker frame without the application's draw: every other
 * ticker listener (the frame pump, the held-jump arrival check) runs as
 * on any frame, and the stage is drawn by the next real animation frame.
 * For the frame pump's heartbeat (FramePump.install).
 */
export function updateWithoutDrawing(app: PIXI.Application, now: number): void {
    app.ticker.remove(app.render, app);
    try {
        app.ticker.update(now);
    } finally {
        app.ticker.add(app.render, app, UPDATE_PRIORITY.LOW);
    }
}

/** The pump the `novaSim` control talks to, while a session is open. */
let activePump: FramePump | undefined;

/**
 * Debug control over simulation stepping: `window.novaSim`. Page-
 * lifetime (a pause set from the console survives an exit to the title,
 * as it always did); the bridge-bound calls go to the live session.
 */
export const simulationControl = {
    paused: false,
    pendingSteps: 0,
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    /** While paused, runs `count` simulation steps on the next frame. */
    step(count = 1) { this.pendingSteps += count; },
    /** Rolls the simulation back `ticks` (~60/s) and resimulates. */
    async rewind(ticks = 60) {
        return await activePump?.bridge?.rewind(ticks) ?? false;
    },
    /** Desync recovery: rebuild from genesis plus the room's input log. */
    async resync() {
        return await activePump?.bridge?.resync() ?? false;
    },
    /** The current clock slew against the room's tick, if any. */
    get pacing() { return activePump?.pacing; },
    /** Worker diagnostics: tick, desyncs, join result, recent logs. */
    async status() {
        return await activePump?.bridge?.status() ?? null;
    },
    /** Per-entity world hashes, for diffing against another client's
     * (or the server's archive dump on desync). */
    async hashes() {
        return await activePump?.bridge?.entityHashes() ?? null;
    },
    /** Debug: is the frame pump wedged on an await? */
    get inFlight() { return activePump?.tickInFlight ?? false; },
    /** Debug: wall-clock ms since the pump last completed a frame. */
    get sinceLastPump() {
        const done = activePump?.lastPumpDone;
        return done === undefined ? null : performance.now() - done;
    },
};
export type SimulationControl = typeof simulationControl;

function getDisplayPlayerJumpRoute(displayWorld: World): string[] | undefined {
    for (const entity of displayWorld.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        return entity.components.get(JumpRouteComponent)?.route;
    }
    return undefined;
}

/**
 * The local player's next system as the display sees it: the destination
 * of a jump under way (whose start already shifted the route on to the
 * hop after it), else the selected route's first hop. A vanishing jump
 * names no system.
 */
export function displayPlayerNextHop(displayWorld: World): string | undefined {
    for (const entity of displayWorld.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const jump = entity.components.get(JumpComponent);
        if (jump && jump.stage !== 'arriving') {
            return jump.vanish ? undefined : jump.to || undefined;
        }
        return entity.components.get(JumpRouteComponent)?.route[0];
    }
    return undefined;
}

/**
 * Whether the local player's ship is running a hyperspace jump's
 * departure stages (stopping, aligning, spin-up, the burn) as the display
 * sees it — what canExitToTitle refuses Escape for (#344). The arrival
 * tick's 'arriving' stage is not: the jump is over by then.
 */
export function displayPlayerJumping(displayWorld: World): boolean {
    for (const entity of displayWorld.entities.values()) {
        if (!entity.components.has(PlayerShipSelector)) {
            continue;
        }
        const jump = entity.components.get(JumpComponent);
        return jump !== undefined && jump.stage !== 'arriving';
    }
    return false;
}

function routesEqual(a?: string[], b?: string[]): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    return a.every((entry, index) => entry === b[index]);
}

export class FramePump {
    tickInFlight = false;
    lastPumpDone: number | undefined;
    pacing: SimulationPacing | undefined;
    private timeDebt = 0;
    private lastPumpTime: number | undefined;
    /**
     * The worker's recent wall-clock cost per simulation step (a moving
     * average of step round trips), which bounds each pump's batch
     * (STEP_BATCH_BUDGET_MS). Reset with each live system.
     */
    private msPerStep: number | undefined;
    /**
     * The display's presentation clock (advanceDisplayClock): the
     * simulation time the last display frame showed, the frame timestamp
     * it showed it at, and the snapshot that landed since, if any. Reset
     * with each live system (a fresh delta stream).
     */
    private displaySimTime: number | undefined;
    private lastFrameTime: number | undefined;
    private landedSnapshot: {
        /** The simulation time it carries (frame.time). */
        simTimeMs: number,
        /** The frame timestamp of the pump that requested it. */
        pumpFrameMs: number,
        /** Simulation ms that pump accrued but did not step. */
        debtMs: number,
        /** The simulation rate (simulation ms per real ms) it stepped at. */
        rate: number,
    } | undefined;
    /**
     * The route this client last sent the simulation, so a change made
     * on the display side (the starmap) is pushed exactly once. Seeded
     * from each new live system's initial frame.
     */
    private syncedPlayerJumpRoute: string[] | undefined;
    private syncedFor: LiveSystem | undefined;
    /** Frames taken from the simulation and not yet applied (their game
     * data would not load): client/frame_backlog.ts. Per live system. */
    private readonly backlog = new FrameBacklog();
    private backlogWarned = false;
    /** The frame time the current live system was taken up at (the
     * start of its entry snap window, ENTRY_SNAP_WINDOW_MS). */
    private liveSince: number | undefined;
    private prefetchedSystemId: string | undefined;
    /**
     * When an applied frame last carried authoritative MovementState —
     * the freshness signal the extrapolation gate reads. Not "when a
     * frame last arrived": a resync hold produces empty frames on
     * purpose, which is precisely the case that used to have ships coast
     * for twenty seconds and then snap. Undefined until the first real
     * snapshot lands.
     */
    private lastMovementSyncMs: number | undefined;
    /**
     * The frame in flight, for the teardown to wait on. ALWAYS the frame
     * in flight, if there is one: pumpSimulationFrame is called from
     * nowhere else, it sets `tickInFlight` synchronously (before its
     * first await) and clears it in its own finally, so a tick that
     * fires mid-frame leaves the handle alone and the next one that
     * starts a frame replaces it. The teardown removes the ticker
     * callback and stops the heartbeat synchronously, then reads the
     * handle in the same task, so no frame can start between the two.
     */
    frameInFlight: Promise<void> | undefined;
    /**
     * The performance telemetry (client/perf_telemetry.ts), told what the
     * display step, each state apply and each simulation round trip cost.
     * Timing only, read on the side: nothing measured here changes what
     * the pump does.
     */
    perf: PerfProbe | undefined;

    constructor(private readonly runtime: ClientRuntime,
        private readonly world: World,
        private readonly autopilot: Autopilot,
        private readonly stats: Stats) { }

    /** The live system's bridge, for the `novaSim` control. */
    get bridge() {
        return liveSystem(this.runtime.state.state)?.bridge;
    }

    /** A jump route the display just sent (SetJumpRouteEvent). */
    noteJumpRouteSent(route: string[]): void {
        this.syncedPlayerJumpRoute = route.slice();
    }

    /**
     * Installs the pump on the app ticker plus the background heartbeat.
     * Returns the disposer the session teardown runs.
     */
    install(app: PIXI.Application): () => void {
        activePump = this;
        const pumpTick = () => this.tick(performance.now());
        app.ticker.add(pumpTick);

        // A fully backgrounded (or occluded) window gets zero rAF, so the
        // ticker — and with it the frame pump — freezes: the peer stays
        // in the room but stops stepping, publishing inputs, and
        // reporting hashes, a zombie that only revives on refocus. Worker
        // timers are exempt from background throttling, so a tiny worker
        // heartbeat drives the ticker whenever real rAF stalls. The
        // staleness check covers occluded-but-not-hidden windows, and
        // keeps the heartbeat from stacking on healthy rAF (which would
        // run the sim fast). It never DRAWS (updateWithoutDrawing): a
        // hidden or occluded window shows nothing, and a visible one
        // whose rAF is merely slow is slow because drawing cannot keep
        // up — extra draws there only deepen the GPU's backlog, which
        // starves rAF further (seconds between presented frames).
        let lastAnimationFrame = performance.now();
        let heartbeatAlive = true;
        const animationFrameAlive = () => {
            if (!heartbeatAlive) {
                return;
            }
            lastAnimationFrame = performance.now();
            requestAnimationFrame(animationFrameAlive);
        };
        requestAnimationFrame(animationFrameAlive);
        const pumpWorker = new Worker(URL.createObjectURL(new Blob(
            ['setInterval(() => postMessage(0), 16)'],
            { type: 'text/javascript' })));
        pumpWorker.onmessage = () => {
            if (!heartbeatAlive) {
                return;
            }
            if (document.hidden
                || performance.now() - lastAnimationFrame > 100) {
                // (The telemetry counts these apart from real frames.)
                const perf = this.perf;
                perf?.beginHeartbeat();
                try {
                    updateWithoutDrawing(app, performance.now());
                } finally {
                    perf?.endHeartbeat();
                }
            }
        };
        return () => {
            app.ticker.remove(pumpTick);
            heartbeatAlive = false;
            pumpWorker.terminate();
            if (activePump === this) {
                activePump = undefined;
            }
        };
    }

    /**
     * `frameTime` is read once, synchronously, at the top of the frame: the
     * display's presentation clock and the simulation pump's step debt both
     * run on it, on the same footing as the display world's wall clock. (The
     * pump used to read performance.now() after its own awaits, a reading
     * that wandered by however long they took.)
     */
    private tick(frameTime: number): void {
        // Step the display world every ticker frame, decoupled from the
        // asynchronous simulation round trip below. The 2026-08-31 Linux
        // playtest trace showed roughly one rAF in ten getting no fresh
        // snapshot (a steps=0 pump, or a worker reply landing a frame
        // late), always as an isolated single frame: when the display
        // only stepped after a completed pump, each of those frames
        // rendered a pixel-identical duplicate and the next double-
        // stepped — motion that "switches between 60 and 30 fps" on a
        // metronomic 60Hz presentation. Stepping here, with
        // MovementExtrapolationPlugin integrating positions on the
        // display's wall clock, keeps motion smooth across missed pumps.
        // Same guard as the simulation frame's early return: mid-
        // transition (no live system) neither stepped before.
        const live = liveSystem(this.runtime.state.state);
        if (live && this.syncedFor !== live) {
            this.beginLiveSystem(live, frameTime);
        }
        if (live) {
            try {
                // WHEN prediction may run at all. A paused simulation
                // (novaSim.pause) sends no correcting snapshots, so wall-
                // clock extrapolation must freeze with it — otherwise
                // every ship drifts (and a turning one pirouettes) across
                // the paused picture. A multiplayer RESYNC is the same
                // situation without the pause: snapshot() deliberately
                // returns EMPTY frames for as long as the recovery runs
                // (up to 20 seconds), so freshness is measured rather
                // than asked for — see shouldExtrapolate. The rest of the
                // display step (animations, UI) runs as it always did.
                //
                // WHICH entities it may run on: not the ones a snapshot
                // has already placed since the last step. See
                // movementSyncedSinceStep.
                const now = frameTime;
                if (movementSyncedSinceStep.size > 0) {
                    this.lastMovementSyncMs = now;
                }
                const displaySpeed =
                    live.world.resources.get(RoomSpeedResource)?.status?.speed
                    ?? this.pacing?.speed ?? 1;
                applyDisplaySpeed(live.world, displaySpeed);
                const movementLimit =
                    live.world.resources.get(MovementTimeLimitResource);
                if (movementLimit) {
                    movementLimit.enabled = shouldExtrapolate({
                        paused: simulationControl.paused, now,
                        lastMovementSyncMs: this.lastMovementSyncMs,
                    });
                    movementLimit.skipUuids = movementSyncedSinceStep;
                    movementLimit.syncedLeadMs =
                        this.advanceDisplayClock(frameTime, movementLimit.enabled,
                            displaySpeed);
                }
                const perf = this.perf;
                const stepStarted = perf ? performance.now() : 0;
                live.world.step();
                perf?.noteDisplayStep(performance.now() - stepStarted);
            } catch (e) {
                // A throwing display system must not kill the ticker (and
                // with it the render + sim pump).
                console.error('Display world step error:', e);
            }
            // Outside the catch, so a throwing display system cannot
            // leave stamps standing: the set means "synced since the last
            // step", and a step has been attempted.
            movementSyncedSinceStep.clear();
        }
        if (!this.tickInFlight) {
            this.frameInFlight = this.pumpSimulationFrame(frameTime);
        }
    }

    /**
     * Moves the presentation clock to this frame and returns how far the
     * entities synced since the last step are to be drawn ahead of their
     * snapshot (see advanceDisplayClock). Frozen prediction (paused, a
     * resync hold) drops the clock: it re-anchors on the next snapshot.
     */
    private advanceDisplayClock(frameTime: number, predicting: boolean,
        displaySpeed: number): number {
        const previousFrame = this.lastFrameTime;
        this.lastFrameTime = frameTime;
        const landed = this.landedSnapshot;
        this.landedSnapshot = undefined;
        if (!predicting) {
            this.displaySimTime = undefined;
            return 0;
        }
        const clock = advanceDisplayClock({
            previousSimTimeMs: this.displaySimTime,
            frameDeltaMs: previousFrame === undefined ? 0
                : frameTime - previousFrame,
            rate: this.pacing?.rate ?? displaySpeed,
            snapshot: landed && {
                simTimeMs: landed.simTimeMs,
                maxLeadMs: snapshotMaxLeadMs({
                    debtMs: landed.debtMs,
                    pumpFrameMs: landed.pumpFrameMs,
                    previousFrameMs: previousFrame ?? frameTime,
                    rate: landed.rate,
                }),
            },
        });
        this.displaySimTime = clock.simTimeMs;
        return clock.syncedLeadMs;
    }

    private async pumpSimulationFrame(frameTime: number): Promise<void> {
        if (this.tickInFlight) {
            return;
        }
        const { runtime } = this;
        const live = liveSystem(runtime.state.state);
        if (!live) {
            return;
        }
        this.tickInFlight = true;
        this.stats.begin();
        const { bridge, world: displayWorld } = live;
        try {
            this.world.step();
            this.autopilot.step(displayWorld,
                runtime.communicator.uuid ?? undefined);
            // (Read through a call: the state changes under the await.)
            const stateKind = () => runtime.state.state.kind;
            const kindBefore = stateKind();
            await runDockingFrame(runtime, live);
            if (kindBefore !== 'inSpace' && stateKind() === 'inSpace') {
                // A lift-off is a system entry too: the same eager snap
                // for its first moments in space.
                this.liveSince = frameTime;
            }
            const fleetContext = {
                fleet: runtime.fleet, gameData: runtime.gameData,
                ownerUuid: () => runtime.communicator.uuid ?? undefined,
            };
            // A landed escort whose capture arrived after the launch
            // already consumed the roster (it slipped into the landing
            // window in the very step that relaunched the player) still
            // gets put back beside its player. Only runs in flight.
            if (runtime.fleet.landed.length > 0
                && runtime.state.state.kind === 'inSpace') {
                await flushLandedEscorts(fleetContext, bridge, displayWorld);
            }
            // A batch held on the jump roster (a gate arrival, a failed
            // insertion) is put back down once the player settles. Same
            // in-flight, not-docked guard: the
            // dock/launch blocks above have already run this frame, so a
            // player who is on their way into a spaceport or a gate map
            // keeps holding until they are back in space.
            if (runtime.fleet.jumping.length > 0
                && runtime.state.state.kind === 'inSpace') {
                await flushCarriedJumpEscorts(fleetContext, bridge,
                    displayWorld);
            }
            // The simulation runs on a fixed timestep, so convert real
            // elapsed time into a whole number of simulation steps and
            // carry the remainder. Render rate and simulation rate are
            // independent.
            // Real time as of the top of this frame (see tick), not
            // performance.now() after the awaits above.
            const now = frameTime;
            const elapsedMs = this.lastPumpTime !== undefined
                ? now - this.lastPumpTime : 0;
            this.lastPumpTime = now;
            const stepRate = this.pacing?.rate ?? 1;
            const pendingSteps = simulationControl.paused
                ? simulationControl.pendingSteps : 0;
            if (simulationControl.paused) {
                simulationControl.pendingSteps = 0;
            }
            const next = advanceSimulationDebt({
                timeDebt: this.timeDebt,
                elapsedMs,
                paused: simulationControl.paused,
                pendingSteps,
                pacing: this.pacing,
                // Eager snapping while docked, too: the world is behind
                // the spaceport or the gate map, and drift left to pile
                // up there (a landed UI's long frames lose steps) would
                // be the lift-off's control lag.
                eagerSnap: stateKind() !== 'inSpace'
                    || (this.liveSince !== undefined
                        && now - this.liveSince < ENTRY_SNAP_WINDOW_MS),
                msPerStep: this.msPerStep,
            });
            this.timeDebt = next.timeDebt;
            const steps = next.steps;

            if (steps > 0) {
                const stepStart = performance.now();
                const hostMs = await bridge.step(steps);
                this.noteStepCost(hostMs ?? performance.now() - stepStart,
                    steps);
                const frame = await bridge.snapshot();
                this.perf?.notePump(performance.now() - stepStart, steps,
                    frame.pacing?.behindTicks, hostMs ?? undefined);
                if (liveSystem(runtime.state.state) !== live) {
                    return;
                }
                if (frame.resyncFailed) {
                    // The host's desync recovery gave up and it is frozen
                    // for good (#333): save, freeze, offer a reload. The
                    // frame carries no state; nothing is applied, and the
                    // `desynced` state stops this pump from here on.
                    onResyncFailed(runtime, live);
                    return;
                }
                this.backlog.push(frame);
            }
            if (this.backlog.length > 0) {
                // The frame's game-data references resolve in the
                // display's own caches: stage them before applying. A
                // frame whose staging fails is held, never dropped
                // (client/frame_backlog.ts).
                const blocked = await this.backlog.drain(
                    frame => stageSimulationFrameGameData(runtime.gameData,
                        frame),
                    frame => this.applyFrame(live, frame, {
                        pumpFrameMs: frameTime, debtMs: this.timeDebt,
                        rate: stepRate,
                    }),
                    () => liveSystem(runtime.state.state) === live);
                if (liveSystem(runtime.state.state) !== live) {
                    return;
                }
                if (blocked !== undefined && !this.backlogWarned) {
                    this.backlogWarned = true;
                    console.warn('Holding simulation frames until their '
                        + 'game data loads:', blocked);
                } else if (blocked === undefined) {
                    this.backlogWarned = false;
                }
            }
            // The display world is NOT stepped here: tick() steps it every
            // ticker frame, whether or not this round trip made it back in
            // time, so a missed pump no longer freezes the picture.
            const displayedJumpRoute = getDisplayPlayerJumpRoute(displayWorld);
            if (!routesEqual(displayedJumpRoute, this.syncedPlayerJumpRoute)) {
                await bridge.setPlayerJumpRoute(displayedJumpRoute ?? []);
                this.syncedPlayerJumpRoute = displayedJumpRoute?.slice() ?? [];
            }
            // The one-jump-ahead warm-up follows the hop (#370).
            runtime.nextHopPrefetch?.noteNextHop(live.systemId,
                displayPlayerNextHop(displayWorld));
        } catch (e) {
            // A system transition closes the bridge this frame captured;
            // its in-flight calls settle with SimulationBridgeClosedError.
            // That is expected — bail out and let the next frame pick up
            // the new bridge. Anything else is a real error, but the pump
            // must never die (a frame pump that stops ends the game), so
            // log and go on.
            if (!(e instanceof SimulationBridgeClosedError
                || liveSystem(runtime.state.state) !== live)) {
                console.error('Simulation frame pump error:', e);
            }
        } finally {
            this.tickInFlight = false;
            this.lastPumpDone = performance.now();
            this.stats.end();
        }
    }

    /**
     * Folds one batch's cost into the per-step estimate. The cost is the
     * worker's OWN time for the batch, as it reports it: the round trip
     * also carries however long the reply queued behind this thread's
     * work (a slow render), and sizing batches by that would shrink them
     * for a slowness they cannot help — and, every round trip paying
     * that queueing once, cut the simulation's rate. (A host that does
     * not report falls back to the round trip.) Every batch counts, one
     * step too (a cap of one must see the cost fall when the fight
     * ends), and the average leans on the newest batch: a fight that
     * just started must shrink the next batch at once.
     */
    private noteStepCost(elapsedMs: number, steps: number): void {
        const perStep = elapsedMs / steps;
        this.msPerStep = this.msPerStep === undefined ? perStep
            : this.msPerStep * 0.5 + perStep * 0.5;
    }

    /**
     * Takes up a newly published live system, on its first ticker frame
     * and BEFORE that frame's display step: a fresh delta stream and a
     * fresh route (the pacing from the previous system's frames is
     * stale, and the route is re-seeded from what the entry placed),
     * a fresh step clock (the previous system's last pump frame is no
     * measure of the time this one owes), the start of the entry snap
     * window, and the system entry's ENTRY FRAMES.
     *
     * The entry frames are what the simulation stepped while the
     * transition screen was still up, catching the world up to the
     * room's clock (system_entry.ts, catchUpToRoomClock): applied here,
     * with the same bookkeeping and events as any pumped frame, so the
     * first in-space frame drawn is already on the clock — and so is
     * the player's first input.
     */
    private beginLiveSystem(live: LiveSystem, frameTime: number): void {
        this.syncedFor = live;
        this.backlog.clear();
        this.backlogWarned = false;
        // The presentation clock re-anchors on this system's snapshots.
        this.displaySimTime = undefined;
        this.lastFrameTime = undefined;
        this.landedSnapshot = undefined;
        this.pacing = undefined;
        this.timeDebt = 0;
        this.msPerStep = undefined;
        this.lastPumpTime = frameTime;
        this.liveSince = frameTime;
        try {
            for (const frame of live.entryFrames ?? []) {
                if (frame.resyncFailed) {
                    onResyncFailed(this.runtime, live);
                    return;
                }
                this.applyFrame(live, frame, {
                    pumpFrameMs: frameTime, debtMs: 0,
                    rate: frame.pacing?.rate ?? 1,
                });
            }
        } catch (e) {
            console.error('Entry frame apply error:', e);
        }
        this.syncedPlayerJumpRoute =
            getDisplayPlayerJumpRoute(live.world)?.slice();
    }

    /**
     * Applies one simulation frame (staged already) to the live system's
     * display world, with everything the client keeps alongside it.
     */
    private applyFrame(live: LiveSystem, frame: SimulationFrame,
        clock: { pumpFrameMs: number, debtMs: number, rate: number }): void {
        const perf = this.perf;
        const applyStarted = perf ? performance.now() : 0;
        try {
            this.applyFrameUntimed(live, frame, clock);
        } finally {
            perf?.noteApply(performance.now() - applyStarted, live);
        }
    }

    private applyFrameUntimed(live: LiveSystem, frame: SimulationFrame,
        clock: { pumpFrameMs: number, debtMs: number, rate: number }): void {
        const { runtime } = this;
        const { world: displayWorld, serializer } = live;
        // emitEvents: the frame's events are emitted between its
        // state changes and its removals, so events targeting
        // entities removed this same frame still find them (see
        // apply_simulation_frame.ts). onRemove: the same ordering
        // is what lets the ledger tell a removal that a death or
        // a carry event explained from one that nothing did — a
        // LOST escort, to be respawned at the next system entry
        // (FleetLedger.lost, ruling #148). The local player is
        // the ship in the world, or the docked one; between
        // worlds the marker's own player is trusted and the take
        // filters.
        const localPlayer = localPlayerShipUuid(displayWorld)
            ?? dockedShip(runtime.state.state)?.uuid;
        applySimulationFrame(frame, serializer, displayWorld, {
            emitEvents: true,
            onRemove: (uuid, entity) => runtime.fleet.noteRemoved(
                uuid, entity, localPlayer, serializer, displayWorld.entities),
        });
        // For the presentation clock: what instant this snapshot
        // represents, and what the pump knew about it.
        this.landedSnapshot = frame.time ? {
            simTimeMs: frame.time.time, ...clock,
        } : undefined;
        for (const [uuid] of frame.added) {
            runtime.fleet.escortReturned(uuid,
                displayWorld.entities.get(uuid));
        }
        this.pacing = frame.pacing;
        const speedHolder = displayWorld.resources.get(RoomSpeedResource);
        if (speedHolder) {
            speedHolder.status = frame.roomSpeed;
        }
        this.syncedPlayerJumpRoute =
            getDisplayPlayerJumpRoute(displayWorld)?.slice();
        this.prefetchJumpDestination(displayWorld);
    }

    /**
     * Starts loading the destination system's data and sprite assets
     * while the jump sequence plays. Display-side only: the simulation
     * never waits on these loads. Arrival is inherently load-gated
     * regardless — the system entry builds the destination world and
     * completes the room join before the player's ship is inserted, and
     * that insertion is an input record, so a slow load only delays the
     * arrival tick without desyncing anyone. Prefetching just shortens
     * the time spent on the white screen.
     */
    private prefetchJumpDestination(displayWorld: World): void {
        const { gameData, displayAssetData } = this.runtime;
        for (const entity of displayWorld.entities.values()) {
            if (!entity.components.has(PlayerShipSelector)) {
                continue;
            }
            const jump = entity.components.get(JumpComponent);
            // A VANISHING jump is a ship leaving the world, not
            // travelling (see JumpStateType): its `to` is the
            // VANISH_DESTINATION sentinel and names no system to load.
            // The `!destination` half also catches the sentinel on its
            // own, which is why it is falsy — it stays as the belt-and-
            // braces guard against ever asking the game data for the
            // empty system id.
            const destination = jump?.to;
            if (!jump || jump.vanish || !destination
                || jump.stage === 'arriving'
                || this.prefetchedSystemId === destination) {
                return;
            }
            this.prefetchedSystemId = destination;
            void (async () => {
                try {
                    const system = await gameData.data.System.get(destination);
                    await Promise.all([
                        ...system.links.map(link =>
                            gameData.data.System.get(link)),
                        ...system.planets.map(async planetId => {
                            const planet =
                                await gameData.data.Planet.get(planetId);
                            await Promise.all(
                                Object.values(planet.animation.images).flatMap(
                                    image => image ? [
                                        displayAssetData.data.SpriteSheetFrames
                                            .get(image.id),
                                        displayAssetData.data.SpriteSheetImage
                                            .get(image.id),
                                    ] : []));
                        }),
                    ]);
                } catch (e) {
                    console.warn(`Failed to prefetch system ${jump.to}`, e);
                }
            })();
            return;
        }
    }
}
