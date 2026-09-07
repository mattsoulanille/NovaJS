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
import type { World } from 'nova_ecs/world';
import type * as PIXI from 'pixi.js';
import type Stats from 'stats.js';
import type { Autopilot } from '../autopilot.js';
import {
    applySimulationFrame, movementSyncedSinceStep, stageSimulationFrameGameData,
} from '../communication/apply_simulation_frame.js';
import {
    SimulationBridgeClosedError,
} from '../communication/async_simulation_bridge_client.js';
import type { SimulationPacing } from '../communication/simulation_frame.js';
import { shouldExtrapolate } from '../display/movement_extrapolation_plugin.js';
import { JumpComponent, JumpRouteComponent } from '../nova_plugin/travel/jump_plugin.js';
import { SIMULATION_STEP_MS } from '../nova_plugin/make_system.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { dockedShip, liveSystem, LiveSystem } from './client_state.js';
import { runDockingFrame } from './docking.js';
import {
    flushCarriedJumpEscorts, flushLandedEscorts, localPlayerShipUuid,
} from './fleet_ledger.js';
import type { ClientRuntime } from './runtime.js';

// Fixed-timestep bookkeeping: real elapsed ms not yet simulated.
const MAX_CATCHUP_STEPS = 6;
/**
 * Tick pacing against the room's clock (from the last frame). Small
 * drift is corrected by the rate factor — time runs imperceptibly fast
 * or slow. Only drift beyond SNAP_BEHIND_TICKS (a hidden tab, a long
 * stall) is snapped, bounded per frame by HARD_CATCHUP_STEPS.
 */
const SNAP_BEHIND_TICKS = 30;
const HARD_CATCHUP_STEPS = 60;

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
     * The route this client last sent the simulation, so a change made
     * on the display side (the starmap) is pushed exactly once. Seeded
     * from each new live system's initial frame.
     */
    private syncedPlayerJumpRoute: string[] | undefined;
    private syncedFor: LiveSystem | undefined;
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
        const pumpTick = () => this.tick();
        app.ticker.add(pumpTick);

        // A fully backgrounded (or occluded) window gets zero rAF, so the
        // ticker — and with it the frame pump — freezes: the peer stays
        // in the room but stops stepping, publishing inputs, and
        // reporting hashes, a zombie that only revives on refocus. Worker
        // timers are exempt from background throttling, so a tiny worker
        // heartbeat drives the ticker whenever real rAF stalls. The
        // staleness check covers occluded-but-not-hidden windows, and
        // keeps the heartbeat from stacking on healthy rAF (which would
        // run the sim fast).
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
                app.ticker.update(performance.now());
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

    private tick(): void {
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
                const now = performance.now();
                if (movementSyncedSinceStep.size > 0) {
                    this.lastMovementSyncMs = now;
                }
                const movementLimit =
                    live.world.resources.get(MovementTimeLimitResource);
                if (movementLimit) {
                    movementLimit.enabled = shouldExtrapolate({
                        paused: simulationControl.paused, now,
                        lastMovementSyncMs: this.lastMovementSyncMs,
                    });
                    movementLimit.skipUuids = movementSyncedSinceStep;
                }
                live.world.step();
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
            this.frameInFlight = this.pumpSimulationFrame();
        }
    }

    private async pumpSimulationFrame(): Promise<void> {
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
        const { bridge, world: displayWorld, serializer } = live;
        // A fresh live system means a fresh delta stream and a fresh
        // route: the pacing from the previous system's frames is stale,
        // and the route is re-seeded from what its initial frame placed.
        if (this.syncedFor !== live) {
            this.syncedFor = live;
            this.pacing = undefined;
            this.syncedPlayerJumpRoute =
                getDisplayPlayerJumpRoute(displayWorld)?.slice();
        }
        try {
            this.world.step();
            this.autopilot.step(displayWorld,
                runtime.communicator.uuid ?? undefined);
            await runDockingFrame(runtime, live);
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
            // A batch riding out a multi-jump chain is put back down once
            // the chain settles. Same in-flight, not-docked guard: the
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
            const now = performance.now();
            if (this.lastPumpTime !== undefined && !simulationControl.paused) {
                // Slew toward the room's clock: elapsed time counts
                // slightly fast or slow rather than ticks being skipped
                // or doubled.
                this.timeDebt +=
                    (now - this.lastPumpTime) * (this.pacing?.rate ?? 1);
            }
            this.lastPumpTime = now;
            // If we fall behind (heavy load, background tab), run at most
            // a few catch-up steps rather than spiraling.
            this.timeDebt = Math.min(this.timeDebt,
                SIMULATION_STEP_MS * MAX_CATCHUP_STEPS);
            let steps = Math.floor(this.timeDebt / SIMULATION_STEP_MS);
            this.timeDebt -= steps * SIMULATION_STEP_MS;
            if (simulationControl.paused) {
                steps = simulationControl.pendingSteps;
                simulationControl.pendingSteps = 0;
                this.timeDebt = 0;
            } else if (this.pacing
                && this.pacing.behindTicks > SNAP_BEHIND_TICKS) {
                // Too far behind the room to slew: snap by stepping the
                // backlog, bounded per frame.
                steps += Math.min(Math.floor(this.pacing.behindTicks),
                    HARD_CATCHUP_STEPS);
            }

            if (steps > 0) {
                await bridge.step(steps);
                const frame = await bridge.snapshot();
                if (liveSystem(runtime.state.state) !== live) {
                    return;
                }
                // The frame's game-data references resolve in the
                // display's own caches (ExplosionData in its asset
                // data): stage them before applying.
                await stageSimulationFrameGameData(runtime.gameData, frame,
                    runtime.displayAssetData);
                if (liveSystem(runtime.state.state) !== live) {
                    return;
                }
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
                        uuid, entity, localPlayer, serializer),
                });
                for (const [uuid] of frame.added) {
                    runtime.fleet.escortReturned(uuid);
                }
                this.pacing = frame.pacing;
                this.syncedPlayerJumpRoute =
                    getDisplayPlayerJumpRoute(displayWorld)?.slice();
                this.prefetchJumpDestination(displayWorld);
            }
            // The display world is NOT stepped here: tick() steps it every
            // ticker frame, whether or not this round trip made it back in
            // time, so a missed pump no longer freezes the picture.
            const displayedJumpRoute = getDisplayPlayerJumpRoute(displayWorld);
            if (!routesEqual(displayedJumpRoute, this.syncedPlayerJumpRoute)) {
                await bridge.setPlayerJumpRoute(displayedJumpRoute ?? []);
                this.syncedPlayerJumpRoute = displayedJumpRoute?.slice() ?? [];
            }
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
