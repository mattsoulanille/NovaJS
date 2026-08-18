import { isLeft } from "fp-ts/lib/Either.js";
import { Entity } from "nova_ecs/entity";
import { RollbackSimulation } from "nova_ecs/plugins/rollback_plugin";
import { restoreWireWorldSnapshot, restoreWorld, snapshotWorld, SnapshotPolicies, SnapshotPoliciesResource, wireSnapshotOfSnapshot, WorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { CommunicatorResource, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity, Serializer, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { Time, TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { v4 } from "uuid";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { loadEntityGameData, loadWireSnapshotGameData } from "../nova_plugin/entity_data_loader.js";
import { deriveEntityComponents } from "../nova_plugin/entity_factory.js";
import { applyInputRecords, InputRecord, loadInputRecordsGameData, SimulationInput } from "./simulation_input.js";
import { HailAction } from "../nova_plugin/hail_plugin.js";
import { EscortAction } from "../nova_plugin/escort_action.js";
import { loadShipGameData } from "../nova_plugin/entity_data_loader.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { AcceptedMission } from "../nova_plugin/mission_accept.js";
import { ArchiveBaseline, canonicalDesyncHash, DesyncDump, PROTOCOL_VERSION, RollbackLogEntry, STATE_HASH_INTERVAL, unwrapRollbackMessage, wrapRollbackMessage } from "./rollback_protocol.js";
import { makeNpc } from "../nova_plugin/npc_plugin.js";
import { SIMULATION_STEP_MS } from "../nova_plugin/make_system.js";
import { PEER_LOCAL_COMPONENTS } from "../nova_plugin/ship_control.js";
import { ControlEvent, ControlsSubject, EcsControlEvent } from "../nova_plugin/controls_plugin.js";
import { AnalogControlState } from "../nova_plugin/ship_control.js";
import { EncodedSimulationBridgeEvent, getRegisteredSimulationBridgeEvents } from "./simulation_bridge_events.js";


/**
 * ...and publish a checkpoint's hash once it is this many ticks old:
 * past any realistic rollback depth, so the hashed state is settled.
 * (Rollbacks that do cross a pending checkpoint recompute its hash
 * during resimulation.)
 */
const STATE_HASH_SETTLE_TICKS = 30;
/** Minimum time between automatic desync recoveries. */
const RESYNC_COOLDOWN_MS = 10_000;
/**
 * Reconstruction traffic is heavy (a baseline snapshot is megabytes)
 * and mobile links are slow: give a resync's join a generous window,
 * and keep retrying the whole resync — a peer that gives up plays on
 * a forked timeline, reporting mismatched hashes forever (the Android
 * incident: three timed-out resyncs, seventeen convictions).
 */
const RESYNC_JOIN_TIMEOUT_MS = 20_000;
const RESYNC_RETRY_MS = 3_000;
const RESYNC_MAX_ATTEMPTS = 8;
/**
 * Staging an insertion record loads game data over the network on
 * browser peers; a single failed fetch must not silently drop the
 * record — a peer missing one entity diverges permanently (the other
 * half of the Android incident: one dropped ship insertion).
 */
const STAGING_MAX_ATTEMPTS = 5;
const STAGING_RETRY_MS = 1_000;
/**
 * Reconstruction fast-forward yields a macrotask every this many
 * ticks, so a worker mid-rebuild keeps receiving room traffic (and
 * the clock estimate stays live) instead of blocking for the whole
 * replay.
 */
const FAST_FORWARD_YIELD_TICKS = 120;

/**
 * How many recent checkpoint states the peer pins for desync dumps:
 * 32 checkpoints = 1920 ticks (~32s). The window must reach back past
 * the *last matching* checkpoint despite conviction lag (threshold
 * mismatches, settle, reporting, the archive's trailing hash) AND
 * dump-delivery lag — over an internet link, a desyncDumpRequest's
 * reply arrived ~28s after the conviction it answered, and the
 * evidence window had already slid past the origin. Pinned in the
 * rollback ring's cheap structural form; wire-encoded only if a dump
 * is actually sent.
 */
const CHECKPOINT_SNAPSHOT_RETENTION = 32;
/** How many rollback-machinery events the black-box ring retains. */
const ROLLBACK_LOG_CAPACITY = 64;

/**
 * Tick pacing: the peer aims to run this many ticks ahead of the
 * extrapolated server clock, so its input records reach the relay
 * before the relay's clock passes their tick. (A record behind the
 * relay clock gets retimed for the room but not for its sender —
 * a divergence desync detection then has to clean up.)
 */
const PACING_LEAD_TICKS = 4;
/** Clock slew per tick of drift: 1% rate change per tick. */
const PACING_GAIN = 0.01;
/**
 * The pacing rate stays within ±5% of real time: drift is corrected
 * by running time imperceptibly fast or slow, never by visibly
 * skipping or doubling ticks. (Gross divergence is snapped instead;
 * see the pump.)
 */
const PACING_MAX_SLEW = 0.05;

export interface EntityDelta {
    /** Present only when the entity's name changed. */
    name?: string;
    /** Components whose encoded form changed since the last snapshot. */
    changed: [string, unknown][];
    /** Names of components removed since the last snapshot. */
    removed: string[];
}

/**
 * How the sim's clock should track the room's. Present only once a
 * tickSync has arrived (i.e. in a live multiplayer room).
 */
export interface SimulationPacing {
    /**
     * Multiply real elapsed time by this before accumulating
     * simulation steps: a smooth slew toward the room's clock.
     */
    rate: number;
    /**
     * Raw drift: how far the sim trails its target tick (negative
     * when ahead). Small values are corrected by `rate`; the pump
     * snaps only when this is beyond slewing (e.g. a hidden tab).
     */
    behindTicks: number;
}

/**
 * A delta frame. Entities absent from `added`, `changed`, and `removed`
 * are unchanged since the previous snapshot from the same host.
 */
export interface SimulationFrame {
    added: [string, EncodedEntity][];
    changed: [string, EntityDelta][];
    removed: string[];
    time?: Time;
    events: EncodedSimulationBridgeEvent[];
    pacing?: SimulationPacing;
}

export interface SimulationBridgeHostApi {
    controlEvents(events: ControlEvent[]): void;
    analogControl(control: AnalogControlState): void;
    setTarget(target: string | null): void;
    setPlanetTarget(target: string | null): void;
    hail(action: HailAction): void;
    escortAction(action: EscortAction): void | Promise<void>;
    acceptMission(accepted: AcceptedMission): void | Promise<void>;
    step(count?: number): void;
    snapshot(): SimulationFrame;
    addEntity(uuid: string, entity: EncodedEntity): void | Promise<void>;
    removeEntity(uuid: string): void;
    setPlayerJumpRoute(route: string[]): void;
    spawnNpc(shipId: string): void | Promise<void>;
    /** Debug/netcode: roll back `ticks` and resimulate. */
    rewind(ticks: number): boolean;
    /** Desync recovery: rebuild from genesis plus the room's input log. */
    resync(): Promise<boolean>;
    /** Diagnostics: sim tick, desyncs seen, last join result. */
    status(): SimulationStatus;
    /** Diagnostics: per-entity world hashes (peer-local excluded),
     * for diffing against another world's view. */
    entityHashes(): { tick: number, entities: [string, string][] };
}

export interface SimulationStatus {
    tick: number;
    desyncCount: number;
    /** Result of the most recent joinRoom, if one ran. */
    joined?: boolean;
    /** Recent worker-side log lines, newest last (worker entry only). */
    logs?: string[];
}

export interface AsyncSimulationBridgeHostApi {
    controlEvents(events: ControlEvent[]): Promise<void>;
    analogControl(control: AnalogControlState): Promise<void>;
    setTarget(target: string | null): Promise<void>;
    setPlanetTarget(target: string | null): Promise<void>;
    hail(action: HailAction): Promise<void>;
    escortAction(action: EscortAction): Promise<void>;
    acceptMission(accepted: AcceptedMission): Promise<void>;
    step(count?: number): Promise<void>;
    snapshot(): Promise<SimulationFrame>;
    addEntity(uuid: string, entity: EncodedEntity): Promise<void>;
    removeEntity(uuid: string): Promise<void>;
    setPlayerJumpRoute(route: string[]): Promise<void>;
    spawnNpc(shipId: string): Promise<void>;
    rewind(ticks: number): Promise<boolean>;
    resync(): Promise<boolean>;
    status(): Promise<SimulationStatus>;
    entityHashes(): Promise<{ tick: number, entities: [string, string][] }>;
}

interface SentEntityRecord {
    name: string | undefined;
    /** Component name -> JSON of the component's encoded form as last sent. */
    components: Map<string, string>;
}

export class SimulationBridgeHost implements SimulationBridgeHostApi {
    private queuedEvents: EncodedSimulationBridgeEvent[] = [];
    private lastSent = new Map<string, SentEntityRecord>();
    private rollback: RollbackSimulation<InputRecord[]>;
    /** Inputs that apply at the next stepped tick. */
    private pendingInputs: SimulationInput[] = [];
    /**
     * Remote peers' input records, relayed by the server. Buffered
     * here until per-peer input application lands (Phase 3 step 3).
     */
    private remoteInputs: InputRecord[] = [];
    /** Bumped whenever remoteInputs is cleared, so in-flight staged
     * records from before the clear discard themselves. */
    private remoteInputsGeneration = 0;
    /**
     * The room's clock: the server's canonical tick from its periodic
     * tickSync, and when it arrived — extrapolated between syncs.
     */
    private lastTickSync?: { tick: number, at: number };
    /** Lightly smoothed pacing drift; tickSync arrival jitter shifts
     * the raw estimate by a tick or two frame to frame. */
    private smoothedDrift?: number;
    /**
     * The pre-join genesis state. Desync recovery restores it and
     * resimulates the relay's input log — the late-join reconstruction,
     * repurposed.
     */
    private genesis: WorldSnapshot;
    /** World hashes at checkpoint ticks, awaiting settling. */
    private checkpointHashes = new Map<number, string>();
    /**
     * Structural snapshots pinned at recent checkpoint ticks, beyond
     * the rollback ring's horizon: evidence for a desync dump. A
     * rollback across a pinned checkpoint re-pins the corrected state,
     * mirroring the hash recompute.
     */
    private checkpointSnapshots = new Map<number, WorldSnapshot>();
    /** Recent rollback-machinery events, for desync dumps. */
    private rollbackLog: RollbackLogEntry[] = [];
    /** Sequence numbers for published records, so a relay echo of a
     * retimed record can name which local application to move. */
    private nextSeq = 0;
    /** Where each published record was applied locally, by seq. */
    private sentRecords = new Map<number, number>();
    /** Tick of the last uploaded dump, for deduping the relay's
     * request fallback against our own unprompted push. */
    private lastDumpTick = -Infinity;
    /** Desync notifications received (own divergence or another peer's). */
    desyncCount = 0;
    private lastJoinSucceeded?: boolean;
    private resyncing = false;
    // protected so failure-path tests can observe whether a resync proceeded
    // (a proceeding resync refreshes this; a cooldown no-op leaves it).
    protected lastResyncTime = -Infinity;

    private readonly resyncCooldownMs: number;
    private readonly resyncJoinTimeoutMs: number;
    private readonly resyncRetryMs: number;
    private readonly resyncMaxAttempts: number;
    private readonly stagingMaxAttempts: number;
    private readonly stagingRetryMs: number;

    constructor(
        private world: World,
        private simulationGameData: SimulationGameDataInterface,
        { resyncCooldownMs = RESYNC_COOLDOWN_MS,
            resyncJoinTimeoutMs = RESYNC_JOIN_TIMEOUT_MS,
            resyncRetryMs = RESYNC_RETRY_MS,
            resyncMaxAttempts = RESYNC_MAX_ATTEMPTS,
            stagingMaxAttempts = STAGING_MAX_ATTEMPTS,
            stagingRetryMs = STAGING_RETRY_MS }: {
                resyncCooldownMs?: number,
                resyncJoinTimeoutMs?: number,
                resyncRetryMs?: number,
                resyncMaxAttempts?: number,
                stagingMaxAttempts?: number,
                stagingRetryMs?: number,
            } = {},
    ) {
        this.resyncCooldownMs = resyncCooldownMs;
        this.resyncJoinTimeoutMs = resyncJoinTimeoutMs;
        this.resyncRetryMs = resyncRetryMs;
        this.resyncMaxAttempts = resyncMaxAttempts;
        this.stagingMaxAttempts = stagingMaxAttempts;
        this.stagingRetryMs = stagingRetryMs;
        // Bare test worlds may not have snapshot policies configured.
        if (!world.resources.has(SnapshotPoliciesResource)) {
            world.resources.set(SnapshotPoliciesResource, new SnapshotPolicies());
        }
        this.genesis = snapshotWorld(world);
        this.rollback = this.makeRollback();
        // Receive relayed rollback-protocol messages from the room.
        const communicator = world.resources.get(CommunicatorResource);
        communicator?.messages.subscribe(({ message }) => {
            const rollbackMessage = unwrapRollbackMessage(message);
            if (!rollbackMessage) {
                return;
            }
            switch (rollbackMessage.kind) {
                case 'inputs':
                    this.integrateStaged(rollbackMessage.record);
                    break;
                case 'tickSync':
                    this.lastTickSync = {
                        tick: rollbackMessage.tick,
                        at: performance.now(),
                    };
                    break;
                case 'inputLog':
                    for (const record of rollbackMessage.records) {
                        this.integrateStaged(record);
                    }
                    break;
                case 'desync':
                    this.handleDesync(rollbackMessage.tick,
                        rollbackMessage.hashes, rollbackMessage.canonical);
                    break;
                case 'desyncDumpRequest':
                    // The server wants this peer's state history as a
                    // reference (e.g. its own archive was outvoted).
                    this.sendDesyncDump();
                    break;
            }
        });
        for (const registration of getRegisteredSimulationBridgeEvents()) {
            world.events.get(registration.event).subscribe(({ data, entities }) => {
                const entityUuids = registration.includeEntityUuids
                    ? entities?.map(entity => typeof entity === "string" ? entity : entity.uuid)
                    : undefined;
                this.queuedEvents.push({
                    name: registration.name,
                    data: this.serializer.encodeEvent(registration.event, data),
                    ...(entityUuids ? { entityUuids } : {}),
                });
            });
        }
    }

    private makeRollback(): RollbackSimulation<InputRecord[]> {
        return new RollbackSimulation<InputRecord[]>(this.world, {
            applyInputs: applyInputRecords,
            complete: deriveEntityComponents,
            // Two seconds of history: enough for netcode rollback
            // margins and short novaSim.rewind time travel.
            capacity: 120,
            // Fires on resimulated ticks too, so a rollback across a
            // pending checkpoint recomputes its hash from the
            // corrected state.
            onStep: tick => {
                if (tick > 0 && tick % STATE_HASH_INTERVAL === 0) {
                    this.checkpointHashes.set(tick,
                        hashWorld(this.world, PEER_LOCAL_COMPONENTS).hash);
                    const snapshot = this.rollback.snapshotAt(tick);
                    if (snapshot) {
                        this.checkpointSnapshots.set(tick, snapshot);
                        for (const old of this.checkpointSnapshots.keys()) {
                            if (old <= tick - STATE_HASH_INTERVAL
                                * CHECKPOINT_SNAPSHOT_RETENTION) {
                                this.checkpointSnapshots.delete(old);
                            }
                        }
                    }
                }
            },
        });
    }

    private get serializer() {
        const serializer = this.world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error("Expected serializer resource to exist");
        }
        return serializer;
    }

    /**
     * Everything that changes the simulation goes through tick-stamped
     * input records: schedule() queues an input for the next stepped
     * tick, where the rollback driver records and applies it. This is
     * the same path resimulation replays.
     */
    private schedule(input: SimulationInput) {
        this.pendingInputs.push(input);
    }

    step(count = 1) {
        if (this.resyncing) {
            // Mid-recovery the world is being rebuilt from the input
            // log; stepping it would fork a fresh timeline.
            return;
        }
        this.integrateRemoteInputs();
        for (let i = 0; i < count; i++) {
            if (this.pendingInputs.length > 0) {
                // Never stamp inputs behind the room's clock: the
                // relay would retime them for everyone but us — a
                // guaranteed divergence. While catching up (join,
                // resync, a stall), inputs land at the clock's next
                // tick and apply when the catch-up reaches it; in
                // steady state the local tick leads the clock and
                // this is a no-op.
                const estimated = this.estimatedServerTick();
                const tick = Math.max(this.rollback.tick + 1,
                    estimated === undefined ? 0 : Math.ceil(estimated) + 1);
                const communicator = this.world.resources.get(CommunicatorResource);
                const record: InputRecord = {
                    peerId: communicator?.uuid,
                    tick,
                    seq: this.nextSeq++,
                    inputs: this.pendingInputs,
                };
                this.addRecord(tick, record);
                this.sentRecords.set(record.seq!, tick);
                this.publishInputs(record);
                this.pendingInputs = [];
            }
            this.rollback.step();
        }
        // Sent records that fell behind the rollback horizon can no
        // longer be moved by an echo.
        for (const [seq, tick] of this.sentRecords) {
            if (tick <= this.rollback.earliestTick) {
                this.sentRecords.delete(seq);
            }
        }
        this.publishStateHashes();
    }

    /**
     * Joins the room's shared timeline: requests a catch-up from the
     * relay and replays its input log — over the archived baseline
     * when the server has one, else over the deterministic genesis
     * world. If no relay responds (offline play), continues from
     * tick 0.
     */
    // `fresh` defaults on: joins (system entry, hyperjump arrivals)
    // and resyncs all replay the log tail over the baseline, and a
    // baseline captured now shrinks that tail from up-to-30s to the
    // transit window. Relays without a fresh provider fall back to
    // the periodic baseline.
    async joinRoom(timeoutMs = 5000,
        { fresh = true }: { fresh?: boolean } = {}): Promise<boolean> {
        const communicator = this.world.resources.get(CommunicatorResource);
        if (!communicator?.uuid) {
            return false;
        }
        const catchUp = await new Promise<
            {
                tick: number, records: InputRecord[],
                baseline?: ArchiveBaseline,
            } | undefined
        >(resolve => {
            const subscription = communicator.messages.subscribe(({ message }) => {
                const rollbackMessage = unwrapRollbackMessage(message);
                if (rollbackMessage?.kind === 'catchUp') {
                    clearInterval(retry);
                    clearTimeout(timeout);
                    subscription.unsubscribe();
                    // Records relayed to us before this reply were
                    // logged by the relay before it built the reply
                    // (messages are ordered), so they are already in
                    // the catch-up log: drop them or they apply twice.
                    this.remoteInputs = [];
                    this.remoteInputsGeneration++;
                    // Our published records are all in the catch-up
                    // log (retimed where the relay retimed them);
                    // in-flight echoes must not move anything.
                    this.sentRecords.clear();
                    // The reply carries the relay's clock: seed the
                    // estimate now rather than waiting up to a second
                    // for the first periodic tickSync. Without this,
                    // inputs recorded right after a join (the arriving
                    // ship's insertion after a hyperjump) are stamped
                    // with the local tick, which trails the relay —
                    // the relay then retimes the record for everyone
                    // but the sender, and the sender's own ship
                    // diverges until a resync rebuilds it from the
                    // log.
                    this.lastTickSync = {
                        tick: rollbackMessage.tick,
                        at: performance.now(),
                    };
                    resolve(rollbackMessage);
                }
            });
            const request = () => {
                const server = [...communicator.servers.value][0];
                if (server) {
                    // Resyncs ask for a baseline captured now: the log
                    // tail over a fresh baseline is just the transit
                    // window, so recovery costs ~200ms instead of the
                    // 1-2s rebuild of an up-to-30s-old baseline's tail.
                    communicator.sendMessage(wrapRollbackMessage({
                        kind: 'joinRequest',
                        protocol: PROTOCOL_VERSION,
                        ...(fresh ? { fresh } : {}),
                    }), server);
                }
            };
            // The relay may not exist yet when the first peer joins.
            // Space the retries out: every request costs the server a
            // full catch-up reply (baseline + log, megabytes), and
            // stacking those drowns exactly the slow links that need
            // the retry.
            const retry = setInterval(request, 3000);
            const timeout = setTimeout(() => {
                clearInterval(retry);
                subscription.unsubscribe();
                resolve(undefined);
            }, timeoutMs);
            request();
        });
        if (!catchUp) {
            console.warn('No rollback relay responded; starting at tick 0');
            this.lastJoinSucceeded = false;
            return false;
        }
        // Stage everything the reconstruction inserts — baseline
        // entities and replayed insertion records were loaded by other
        // worlds, not this one — so applying them is synchronous.
        if (catchUp.baseline) {
            await loadWireSnapshotGameData(this.world, catchUp.baseline.snapshot);
        }
        await loadInputRecordsGameData(this.world, catchUp.records);
        if (catchUp.baseline) {
            restoreWireWorldSnapshot(this.world, catchUp.baseline.snapshot,
                deriveEntityComponents);
            // The rollback driver's history belongs to the pre-restore
            // timeline; start fresh from the baseline.
            this.rollback = this.makeRollback();
        }
        for (const record of catchUp.records) {
            this.addRecord(record.tick, record);
        }
        // catchUp.tick is stale by however long staging took (seconds
        // of asset loading on a cold cache); fast-forward to the
        // room's clock *now*, or play begins far behind and the pump
        // snaps through the gap at a visible fast-forward. Chunked so
        // the worker keeps servicing room traffic mid-rebuild, and
        // re-targeted afterward since the clock moves while it runs.
        await this.rollback.fastForward(Math.max(catchUp.tick,
            Math.ceil(this.estimatedServerTick() ?? 0)),
            FAST_FORWARD_YIELD_TICKS);
        for (let pass = 0; pass < 3; pass++) {
            const target = Math.ceil(this.estimatedServerTick() ?? 0);
            if (target - this.rollback.tick <= 30) {
                break;
            }
            await this.rollback.fastForward(target, FAST_FORWARD_YIELD_TICKS);
        }
        // Events emitted during the replay describe history: a
        // resyncing display already showed the real versions before
        // the desync, and a fresh join should not open on 30 seconds
        // of stale explosions. Drop them rather than deliver a burst.
        this.queuedEvents = [];
        // The local tick just jumped; stale smoothed drift would slew
        // against the new position.
        this.smoothedDrift = undefined;
        this.lastJoinSucceeded = true;
        this.logRollbackEvent('join', {
            catchUpTick: catchUp.tick,
            baselineTick: catchUp.baseline?.tick ?? 'none',
            records: catchUp.records.length,
        });
        return true;
    }

    /**
     * Queues a relayed record for integration — after loading the game
     * data for any entity it inserts. The originating peer staged
     * before scheduling; every *other* world must stage from the
     * record itself, or the insertion derives against unloaded data
     * and silently diverges. Integration is tick-keyed, so a record
     * that finishes staging late simply integrates as a deeper
     * rollback correction.
     */
    private integrateStaged(record: InputRecord) {
        if (record.inputs.some(input => input.kind === 'addEntity'
            || input.kind === 'acceptMission'
            // An escort upgrade names a ship CLASS that must be buildable
            // synchronously on this peer too (see loadInputRecordsGameData).
            || (input.kind === 'escortAction'
                && input.action.kind === 'upgradeEscort'))) {
            // If the buffer is cleared while staging (a catch-up log
            // arrived, which contains this record), drop it: pushing
            // after the clear would apply it twice.
            const generation = this.remoteInputsGeneration;
            void (async () => {
                for (let attempt = 1; ; attempt++) {
                    try {
                        await this.stageRecords([record]);
                        break;
                    } catch (error) {
                        if (generation !== this.remoteInputsGeneration) {
                            return;
                        }
                        if (attempt >= this.stagingMaxAttempts) {
                            // A peer missing this entity is diverged for
                            // good; force a resync (bypassing the time
                            // cooldown) so the record is never silently
                            // dropped. A plain resync() would no-op if the
                            // cooldown were still cooling from a recent
                            // resync, leaving this peer forked for ~10s
                            // until checkpoint conviction notices. The
                            // resync re-requests the whole log and retries
                            // the loads (and itself retries until it lands);
                            // if a resync is already running, force still
                            // yields to it — that resync re-stages this
                            // record anyway.
                            console.error('Failed to stage insertion '
                                + 'record; resyncing:', error);
                            this.logRollbackEvent('stagingFailed', {
                                recordTick: record.tick,
                                peer: record.peerId ?? 'unknown',
                            });
                            void this.resync(true);
                            return;
                        }
                        await new Promise(resolve => setTimeout(resolve,
                            this.stagingRetryMs * attempt));
                    }
                }
                if (generation === this.remoteInputsGeneration) {
                    this.remoteInputs.push(record);
                }
            })();
        } else {
            this.remoteInputs.push(record);
        }
    }

    /** Stages records' game data; overridable for failure-path tests. */
    protected stageRecords(records: InputRecord[]): Promise<void> {
        return loadInputRecordsGameData(this.world, records);
    }

    /** Merges a record into the tick's record list. */
    private addRecord(tick: number, record: InputRecord) {
        const existing = this.rollback.getInputs(tick) ?? [];
        this.rollback.setInputs(tick, [...existing, record]);
    }

    /**
     * Folds relayed remote input records into the timeline. Records
     * for past ticks trigger a rollback: restore before the earliest
     * correction and resimulate with the true inputs — the core of
     * rollback netcode.
     */
    private integrateRemoteInputs() {
        if (this.remoteInputs.length === 0) {
            return;
        }
        const records = this.remoteInputs;
        this.remoteInputs = [];
        const communicator = this.world.resources.get(CommunicatorResource);
        let earliestCorrection: number | undefined;
        for (const record of records) {
            // The relay echoes our own record back only when it
            // retimed it: the room applies it at the echoed tick, so
            // move our local application there or fork silently.
            if (record.peerId !== undefined
                && record.peerId === communicator?.uuid
                && record.seq !== undefined) {
                const oldTick = this.sentRecords.get(record.seq);
                if (oldTick === undefined) {
                    // An echo from before a resync: the catch-up log
                    // already delivered this record at its true tick.
                    continue;
                }
                if (oldTick === record.tick) {
                    continue;
                }
                if (oldTick <= this.rollback.earliestTick) {
                    // The stale application is beyond the rollback
                    // horizon: this timeline has already forked from
                    // the room's. Resync now (cooldown-gated) instead
                    // of playing on a fork until checkpoint conviction
                    // says so seconds later — quieter, and no desync
                    // line for a divergence we already know about.
                    this.logRollbackEvent('retimeTooOld', {
                        seq: record.seq, from: oldTick, to: record.tick,
                    });
                    void this.resync();
                    continue;
                }
                this.logRollbackEvent('retimed', {
                    seq: record.seq, from: oldTick, to: record.tick,
                });
                this.rollback.setInputs(oldTick,
                    (this.rollback.getInputs(oldTick) ?? []).filter(
                        r => r.seq !== record.seq));
                this.addRecord(record.tick, record);
                this.sentRecords.set(record.seq, record.tick);
                if (oldTick <= this.rollback.tick) {
                    earliestCorrection =
                        Math.min(earliestCorrection ?? Infinity, oldTick);
                }
                continue;
            }
            // Too old to roll back to: apply as soon as possible so
            // the entity at least exists, and resync (cooldown-gated)
            // — applying at the wrong tick is a guaranteed fork, and
            // waiting for checkpoint conviction to say so costs
            // seconds on a fork we already know about. (Seen live: a
            // heavy plugin carrier's insertion staging outran the
            // ring horizon on a slow link, and every NPC that shot at
            // the not-yet-present carrier diverged.)
            const tick = Math.max(record.tick, this.rollback.earliestTick + 1);
            if (tick !== record.tick) {
                this.logRollbackEvent('lateRecord', {
                    recordTick: record.tick, appliedAt: tick,
                    peer: record.peerId ?? 'unknown',
                });
                void this.resync();
            }
            this.addRecord(tick, { ...record, tick });
            if (tick <= this.rollback.tick) {
                earliestCorrection = Math.min(earliestCorrection ?? Infinity, tick);
            }
        }
        if (earliestCorrection !== undefined) {
            const toTick = earliestCorrection - 1;
            const depth = this.rollback.tick - toTick;
            this.logRollbackEvent('rollback', {
                toTick,
                depth,
                records: records.length,
            });
            if (!this.rollback.rollbackTo(toTick)) {
                // The target tick is behind the ring-buffer horizon, so
                // the rollback did not happen and the corrected inputs
                // apply late. Log it so desync forensics can see why.
                this.logRollbackEvent('rollbackTooOld', { toTick, depth });
            }
        }
    }

    /**
     * Publishes this peer's inputs to the server relay only: the relay
     * is the single fan-out, so peers never receive a record twice
     * (once directly, once relayed).
     */
    private publishInputs(record: InputRecord) {
        const communicator = this.world.resources.get(CommunicatorResource);
        if (!communicator?.uuid) {
            return;
        }
        const server = [...communicator.servers.value][0];
        if (!server) {
            return;
        }
        communicator.sendMessage(wrapRollbackMessage({
            kind: 'inputs',
            record,
        }), server);
    }

    /**
     * Publishes checkpoint hashes that have settled: old enough that
     * no further rollback will cross them, so every honest peer hashed
     * the same timeline. The relay compares them across peers.
     */
    private publishStateHashes() {
        const communicator = this.world.resources.get(CommunicatorResource);
        const server = communicator?.uuid
            ? [...communicator.servers.value][0] : undefined;
        for (const [tick, hash] of this.checkpointHashes) {
            if (tick <= this.rollback.tick - STATE_HASH_SETTLE_TICKS) {
                this.checkpointHashes.delete(tick);
                if (communicator && server) {
                    communicator.sendMessage(wrapRollbackMessage(
                        { kind: 'stateHash', tick, hash }), server);
                }
            }
        }
    }

    /**
     * The relay saw peers disagree about the state at a tick. If this
     * peer's hash is not the canonical one, its timeline has diverged
     * from the input log's true simulation: recover with a full resync.
     */
    private handleDesync(tick: number, hashes: [string, string][],
        relayCanonical?: string) {
        this.desyncCount++;
        const communicator = this.world.resources.get(CommunicatorResource);
        const mine = hashes.find(
            ([peerId]) => peerId === communicator?.uuid)?.[1];
        // The relay's verdict excludes stale reporters from the vote;
        // recompute locally only for older relays that don't send it
        // (tie votes prefer the server's archive hash: the input
        // log's true simulation).
        const canonical = relayCanonical ?? canonicalDesyncHash(
            hashes, communicator?.servers.value);
        // A peer that never reported this tick (it joined afterwards)
        // has no evidence it diverged.
        const diverged = mine !== undefined && mine !== canonical;
        console.error(`Desync at tick ${tick}:`, Object.fromEntries(hashes),
            diverged ? '- this peer diverged; resyncing'
                : '- this peer matches the canonical state');
        if (diverged) {
            // Upload the evidence before resync discards it: the
            // pinned checkpoint states are this timeline's black box.
            this.sendDesyncDump(tick);
            void this.resync();
        }
    }

    /** Appends to the rollback black-box ring. */
    private logRollbackEvent(event: string,
        detail?: Record<string, number | string>) {
        this.rollbackLog.push({
            event,
            atTick: this.rollback.tick,
            ...(detail ? { detail } : {}),
        });
        if (this.rollbackLog.length > ROLLBACK_LOG_CAPACITY) {
            this.rollbackLog.splice(0,
                this.rollbackLog.length - ROLLBACK_LOG_CAPACITY);
        }
    }

    /**
     * Uploads this peer's recent checkpoint states and rollback log to
     * the server, which records them for offline desync analysis
     * (analyze_desync.mjs). The pinned structural snapshots are
     * wire-encoded here — the only time that cost is paid.
     */
    private sendDesyncDump(desyncTick?: number) {
        const communicator = this.world.resources.get(CommunicatorResource);
        const server = communicator?.uuid
            ? [...communicator.servers.value][0] : undefined;
        if (!communicator || !server) {
            return;
        }
        // The relay requests a dump from every convicted peer as a
        // fallback for lost pushes; having just pushed, skip the echo.
        if (this.rollback.tick - this.lastDumpTick < STATE_HASH_INTERVAL * 2) {
            return;
        }
        this.lastDumpTick = this.rollback.tick;
        const checkpoints = [...this.checkpointSnapshots]
            .sort(([a], [b]) => a - b)
            .map(([tick, snapshot]) => ({
                tick,
                snapshot: wireSnapshotOfSnapshot(this.world, snapshot),
            }));
        const dump: DesyncDump = {
            tick: this.rollback.tick,
            ...(desyncTick !== undefined ? { desyncTick } : {}),
            engine: typeof navigator === 'object' && navigator?.userAgent
                ? navigator.userAgent
                : typeof process === 'object'
                    ? `node ${process.version}` : 'unknown',
            checkpoints,
            rollbackLog: [...this.rollbackLog],
        };
        communicator.sendMessage(
            wrapRollbackMessage({ kind: 'desyncDump', dump }), server);
    }

    /**
     * Full desync recovery: restore the deterministic genesis world
     * and rejoin the room, resimulating the relay's input log — the
     * same reconstruction a late joiner performs.
     */
    // `force` bypasses the time cooldown but NOT the `resyncing` guard. It
    // exists solely for the staging-failure path (integrateStaged): a peer
    // that cannot load an inserted entity's data is diverged for good, so it
    // must resync even if the cooldown is still cooling from an earlier
    // resync — otherwise the record is dropped and the peer forks silently
    // until the desync detector fires ~10s later. The `resyncing` guard is
    // still honoured, so a burst of failed insertions can't storm: the first
    // forced resync sets `resyncing`, the rest fold into it (it rebuilds the
    // whole log and re-stages every record), and once it lands `lastResyncTime`
    // is fresh so the ordinary desync-detector callers are cooldown-gated
    // again. Not exposed on the public interface — internal callers only.
    async resync(force = false): Promise<boolean> {
        if (this.resyncing
            || (!force
                && Date.now() - this.lastResyncTime < this.resyncCooldownMs)) {
            return false;
        }
        this.lastResyncTime = Date.now();
        this.resyncing = true;
        this.logRollbackEvent('resync');
        try {
            // Retry the whole reconstruction until it lands: while
            // `resyncing`, step() is a no-op, so the sim pauses (and
            // publishes no checkpoint hashes) instead of playing on —
            // and reporting — a fork. A peer that "gives up" after a
            // failed join is convicted every third checkpoint forever.
            for (let attempt = 1; ; attempt++) {
                restoreWorld(this.world, this.genesis,
                    deriveEntityComponents);
                this.rollback = this.makeRollback();
                this.remoteInputs = [];
                this.remoteInputsGeneration++;
                this.checkpointHashes.clear();
                // The pinned states describe the abandoned timeline.
                this.checkpointSnapshots.clear();
                try {
                    if (await this.joinRoom(this.resyncJoinTimeoutMs,
                        { fresh: true })) {
                        return true;
                    }
                } catch (error) {
                    // Reconstruction staging can fail on a flaky
                    // link; the retry refetches.
                    console.error('Resync reconstruction failed:', error);
                }
                this.logRollbackEvent('resyncRetry', { attempt });
                if (attempt >= this.resyncMaxAttempts) {
                    console.error(`Resync failed after ${attempt} attempts`);
                    return false;
                }
                await new Promise(resolve =>
                    setTimeout(resolve, this.resyncRetryMs));
            }
        } finally {
            this.resyncing = false;
        }
    }

    status(): SimulationStatus {
        return {
            tick: this.rollback.tick,
            desyncCount: this.desyncCount,
            joined: this.lastJoinSucceeded,
        };
    }

    entityHashes(): { tick: number, entities: [string, string][] } {
        return {
            tick: this.rollback.tick,
            entities: [...hashWorld(this.world, PEER_LOCAL_COMPONENTS).entities],
        };
    }

    rewind(ticks: number): boolean {
        // True time travel: restore the past and continue from there,
        // discarding the abandoned future. (rollbackTo, by contrast,
        // replays the inputs back to the present - the netcode
        // primitive - which is a visual no-op.)
        const rewound = this.rollback.rewindTo(this.rollback.tick - ticks);
        if (rewound) {
            this.logRollbackEvent('rewind', { ticks });
            // Checkpoint hashes and pinned states from the discarded
            // future would report a timeline that no longer exists.
            for (const tick of this.checkpointHashes.keys()) {
                if (tick > this.rollback.tick) {
                    this.checkpointHashes.delete(tick);
                }
            }
            for (const tick of this.checkpointSnapshots.keys()) {
                if (tick > this.rollback.tick) {
                    this.checkpointSnapshots.delete(tick);
                }
            }
        }
        return rewound;
    }

    controlEvents(events: ControlEvent[]) {
        this.schedule({ kind: 'control', events });
    }

    analogControl(control: AnalogControlState) {
        this.schedule({
            kind: 'analogControl',
            heading: control.heading,
            throttle: control.throttle,
        });
    }

    setTarget(target: string | null) {
        this.schedule({ kind: 'setTarget', target });
    }

    setPlanetTarget(target: string | null) {
        this.schedule({ kind: 'setPlanetTarget', target });
    }

    hail(action: HailAction) {
        this.schedule({ kind: 'hail', action });
    }

    /**
     * An escort-management action from the comm dialog (escort_action.ts).
     * An UPGRADE stages the target ship class's game-data closure BEFORE
     * scheduling, exactly as acceptMission stages its ships: applying (and
     * replaying) the record has to be synchronous, and applyEscortAction
     * refuses an upgrade whose class is not cached.
     */
    async escortAction(action: EscortAction) {
        if (action.kind === 'upgradeEscort') {
            const gameData = this.world.resources
                .get(SimulationGameDataResource);
            if (gameData) {
                await loadShipGameData(gameData, action.toShip);
            }
        }
        this.schedule({ kind: 'escortAction', action });
    }

    /**
     * An in-flight mission acceptance (mission_accept.ts). Stages the
     * mission's special/aux ships BEFORE scheduling, exactly as addEntity
     * stages its single one — applying (and replaying) the input has to
     * be synchronous, so every entity's game-data closure must already be
     * loaded when the record lands.
     */
    async acceptMission(accepted: AcceptedMission) {
        for (const ship of accepted.ships ?? []) {
            const decoded = this.serializer.decode(ship.entity as EncodedEntity);
            if (isLeft(decoded)) {
                throw new Error('Failed to decode mission ship: '
                    + this.serializer.describeDecodeFailure(
                        ship.entity as EncodedEntity, decoded.left));
            }
            await loadEntityGameData(this.world, decoded.right);
        }
        this.schedule({ kind: 'acceptMission', accepted });
    }

    /**
     * How this peer's clock should slew to track the room's: a rate
     * factor proportional to the drift between the local tick and the
     * extrapolated server tick plus a small send-ahead lead, clamped
     * so correction is a gradual speed change rather than a skip.
     */
    /** The room's clock now, extrapolated from the last tickSync. */
    private estimatedServerTick(): number | undefined {
        if (!this.lastTickSync) {
            return undefined;
        }
        const elapsed = performance.now() - this.lastTickSync.at;
        return this.lastTickSync.tick + elapsed / SIMULATION_STEP_MS;
    }

    private pacing(): SimulationPacing | undefined {
        const estimatedServerTick = this.estimatedServerTick();
        if (estimatedServerTick === undefined) {
            return undefined;
        }
        const behindTicks =
            estimatedServerTick + PACING_LEAD_TICKS - this.rollback.tick;
        this.smoothedDrift = this.smoothedDrift === undefined ? behindTicks
            : this.smoothedDrift * 0.9 + behindTicks * 0.1;
        const rate = 1 + Math.max(-PACING_MAX_SLEW, Math.min(
            PACING_MAX_SLEW, this.smoothedDrift * PACING_GAIN));
        return { rate, behindTicks };
    }

    snapshot(): SimulationFrame {
        if (this.resyncing) {
            // Mid-resync the world is a genesis reconstruction being
            // replayed forward; serializing it would flash pre-join
            // state onto the display — and the autopilot, watching its
            // ship vanish from the frame stream, cancels itself. Hold
            // the frame (and the queued events) until the resync
            // lands; the first post-resync snapshot diffs against
            // lastSent as usual.
            return { added: [], changed: [], removed: [], events: [] };
        }
        const events = this.queuedEvents;
        this.queuedEvents = [];
        const serializer = this.serializer;

        const added: [string, EncodedEntity][] = [];
        const changed: [string, EntityDelta][] = [];
        const seen = new Set<string>();

        for (const [uuid, entity] of this.world.entities) {
            if (uuid === "singleton") {
                continue;
            }
            seen.add(uuid);
            const previous = this.lastSent.get(uuid);

            const encodedComponents: [string, unknown][] = [];
            const record: SentEntityRecord = {
                name: entity.name,
                components: new Map(),
            };
            for (const [component, data] of entity.components) {
                if (!serializer.hasComponent(component)) {
                    continue;
                }
                const encoded = serializer.encodeComponent(component, data);
                encodedComponents.push([component.name, encoded]);
                record.components.set(component.name,
                    JSON.stringify(encoded) ?? 'undefined');
            }

            if (!previous) {
                added.push([uuid, {
                    name: entity.name,
                    components: encodedComponents,
                } as EncodedEntity]);
            } else {
                const delta: EntityDelta = { changed: [], removed: [] };
                if (previous.name !== entity.name) {
                    delta.name = entity.name;
                }
                for (const [componentName, encoded] of encodedComponents) {
                    if (previous.components.get(componentName)
                        !== record.components.get(componentName)) {
                        delta.changed.push([componentName, encoded]);
                    }
                }
                for (const componentName of previous.components.keys()) {
                    if (!record.components.has(componentName)) {
                        delta.removed.push(componentName);
                    }
                }
                if (delta.name !== undefined || delta.changed.length > 0
                    || delta.removed.length > 0) {
                    changed.push([uuid, delta]);
                }
            }
            this.lastSent.set(uuid, record);
        }

        const removed: string[] = [];
        for (const uuid of this.lastSent.keys()) {
            if (!seen.has(uuid)) {
                removed.push(uuid);
                this.lastSent.delete(uuid);
            }
        }

        return {
            added,
            changed,
            removed,
            time: this.world.resources.get(TimeResource),
            events,
            pacing: this.pacing(),
        };
    }

    /**
     * Forgets all previously sent state so the next snapshot resends
     * every entity in full.
     */
    resetSync() {
        this.lastSent.clear();
    }

    async addEntity(uuid: string, entity: EncodedEntity) {
        // Peer-local markers (PlayerShipSelector) must not cross the
        // wire: every peer derives its own from ControlledBy, and a
        // marker arriving in a record would briefly crown this ship
        // "the local player" on every other peer. Solo play (no room)
        // keeps them: they are the no-peer fallback.
        const communicator = this.world.resources.get(CommunicatorResource);
        if (communicator?.uuid) {
            entity = {
                ...entity,
                components: [...entity.components].filter(
                    ([name]) => !PEER_LOCAL_COMPONENTS.has(name)),
            } as unknown as EncodedEntity;
        }
        const decoded = this.serializer.decode(entity);
        if (isLeft(decoded)) {
            throw new Error(`Failed to decode entity: ${this.serializer.describeDecodeFailure(entity, decoded.left)}`);
        }
        // Stage, load, then schedule: the entity's transitive game
        // data closure is loaded before the insertion input is
        // recorded, so applying (and replaying) the input is
        // synchronous.
        await loadEntityGameData(this.world, decoded.right);
        this.schedule({ kind: 'addEntity', uuid, entity });
    }

    removeEntity(uuid: string) {
        this.schedule({ kind: 'removeEntity', uuid });
    }

    setPlayerJumpRoute(route: string[]) {
        this.schedule({ kind: 'setJumpRoute', route });
    }

    async spawnNpc(shipId: string) {
        // Load through this world's own game data: the display side warming
        // its cache does not warm the worker's cache.
        const shipData = await this.simulationGameData.data.Ship.get(shipId);
        if (!shipData) {
            throw new Error(`Failed to load ship ${shipId} for NPC spawn`);
        }
        const npc = makeNpc(shipData);
        await loadEntityGameData(this.world, npc);
        const communicator = this.world.resources.get(CommunicatorResource);
        if (!communicator?.uuid) {
            throw new Error("Expected communicator uuid to exist before spawning NPC");
        }
        npc.components.set(MultiplayerData, { owner: communicator.uuid });
        // The spawn becomes an insertion input: staged host-side, then
        // scheduled, so replaying it is deterministic.
        this.schedule({
            kind: 'addEntity',
            uuid: v4(),
            entity: structuredClone(this.serializer.encode(npc)) as EncodedEntity,
        });
    }
}

export class SimulationBridgeClient {
    constructor(
        private host: SimulationBridgeHostApi,
        private serializer: Serializer,
    ) { }

    snapshot(): SimulationFrame {
        return structuredClone(this.host.snapshot()) as SimulationFrame;
    }

    step(count = 1) {
        this.host.step(count);
    }

    controlEvents(events: ControlEvent[]) {
        this.host.controlEvents(structuredClone(events));
    }

    analogControl(control: AnalogControlState) {
        this.host.analogControl(structuredClone(control));
    }

    setTarget(target: string | null) {
        this.host.setTarget(target);
    }

    setPlanetTarget(target: string | null) {
        this.host.setPlanetTarget(target);
    }

    hail(action: HailAction) {
        this.host.hail(structuredClone(action));
    }

    escortAction(action: EscortAction) {
        return this.host.escortAction(structuredClone(action));
    }

    acceptMission(accepted: AcceptedMission) {
        return this.host.acceptMission(structuredClone(accepted));
    }

    addEntity(uuid: string, entity: Entity) {
        return this.host.addEntity(uuid, structuredClone(this.serializer.encode(entity)) as EncodedEntity);
    }

    removeEntity(uuid: string) {
        this.host.removeEntity(uuid);
    }

    setPlayerJumpRoute(route: string[]) {
        this.host.setPlayerJumpRoute(structuredClone(route));
    }

    rewind(ticks: number) {
        return this.host.rewind(ticks);
    }

    resync() {
        return this.host.resync();
    }

    status() {
        return this.host.status();
    }

    entityHashes() {
        return this.host.entityHashes();
    }

    spawnNpc(shipId: string) {
        return this.host.spawnNpc(shipId);
    }

    getSerializer() {
        return this.serializer;
    }

    decodeEntity(entity: EncodedEntity) {
        const decoded = this.serializer.decode(entity);
        if (isLeft(decoded)) {
            throw new Error(`Failed to decode entity: ${this.serializer.describeDecodeFailure(entity, decoded.left)}`);
        }
        return decoded.right;
    }
}

/**
 * Thrown (as a rejection) by every in-flight or later call on an
 * AsyncSimulationBridgeClient once it has been closed. Callers that
 * race a system transition (the frame pump) catch this and bail out.
 */
export class SimulationBridgeClosedError extends Error {
    constructor() {
        super('Simulation bridge closed');
        this.name = 'SimulationBridgeClosedError';
    }
}

export class AsyncSimulationBridgeClient {
    /**
     * Rejects when close() runs. Every host call races against it:
     * closing a bridge whose worker is terminated mid-call would
     * otherwise leave the caller's promise unsettled FOREVER (a
     * message posted to a terminated worker gets no reply), which
     * wedged the browser's frame pump and froze every transit that
     * raced it (the hypergate black screen / jump white screen hang).
     */
    private closedRejection: Promise<never>;
    private rejectClosed!: (error: Error) => void;
    private closed = false;

    constructor(
        private host: AsyncSimulationBridgeHostApi,
        private serializer: Serializer,
        private closeImpl?: () => void | Promise<void>,
    ) {
        this.closedRejection = new Promise<never>((_, reject) => {
            this.rejectClosed = reject;
        });
        // If close() runs with no call in flight, the bare rejection
        // must not surface as an unhandled rejection.
        this.closedRejection.catch(() => { });
    }

    /**
     * Races a worker call against bridge closure so it always settles.
     */
    private guard<T>(call: () => Promise<T>): Promise<T> {
        if (this.closed) {
            return Promise.reject(new SimulationBridgeClosedError());
        }
        return Promise.race([call(), this.closedRejection]);
    }

    async snapshot(): Promise<SimulationFrame> {
        return await this.guard(() => this.host.snapshot());
    }

    async step(count = 1) {
        await this.guard(() => this.host.step(count));
    }

    async controlEvents(events: ControlEvent[]) {
        await this.guard(() => this.host.controlEvents(events));
    }

    async analogControl(control: AnalogControlState) {
        await this.guard(() => this.host.analogControl(control));
    }

    async setTarget(target: string | null) {
        await this.guard(() => this.host.setTarget(target));
    }

    async setPlanetTarget(target: string | null) {
        await this.guard(() => this.host.setPlanetTarget(target));
    }

    async hail(action: HailAction) {
        await this.guard(() => this.host.hail(action));
    }

    async escortAction(action: EscortAction) {
        await this.guard(() => this.host.escortAction(action));
    }

    async acceptMission(accepted: AcceptedMission) {
        await this.guard(() => this.host.acceptMission(accepted));
    }

    async addEntity(uuid: string, entity: Entity) {
        await this.guard(() =>
            this.host.addEntity(uuid, this.serializer.encode(entity)));
    }

    async removeEntity(uuid: string) {
        await this.guard(() => this.host.removeEntity(uuid));
    }

    async setPlayerJumpRoute(route: string[]) {
        await this.guard(() => this.host.setPlayerJumpRoute(route));
    }

    async spawnNpc(shipId: string) {
        await this.guard(() => this.host.spawnNpc(shipId));
    }

    async rewind(ticks: number) {
        return this.guard(() => this.host.rewind(ticks));
    }

    async resync() {
        return this.guard(() => this.host.resync());
    }

    async status() {
        return this.guard(() => this.host.status());
    }

    async entityHashes() {
        return this.guard(() => this.host.entityHashes());
    }

    getSerializer() {
        return this.serializer;
    }

    decodeEntity(entity: EncodedEntity) {
        const decoded = this.serializer.decode(entity);
        if (isLeft(decoded)) {
            throw new Error(`Failed to decode entity: ${this.serializer.describeDecodeFailure(entity, decoded.left)}`);
        }
        return decoded.right;
    }

    async close() {
        // Settle every in-flight (and future) call BEFORE terminating
        // the worker: terminate() silences the worker, so any call
        // still awaiting a reply would never settle.
        this.closed = true;
        this.rejectClosed(new SimulationBridgeClosedError());
        await this.closeImpl?.();
    }
}
