import { isLeft } from "fp-ts/lib/Either.js";
import { RollbackSimulation } from "nova_ecs/plugins/rollback_plugin";
import { restoreWireWorldSnapshot, restoreWorld, snapshotWorld, SnapshotPolicies, SnapshotPoliciesResource, wireSnapshotOfSnapshot, WorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { CommunicatorResource, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { v4 } from "uuid";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { loadEntityGameData, loadOutfitsGameData, loadWireSnapshotGameData } from "../nova_plugin/spawn/index.js";
import { deriveEntityComponents, ControlEvent } from '../nova_plugin/core/index.js';
import { applyInputRecords, grantedOutfitIds, InputRecord, loadInputRecordsGameData, SimulationInput } from "./simulation_input.js";
import { HailAction } from "../nova_plugin/encounters/index.js";
import { EscortAction } from "../nova_plugin/escorts/index.js";
import { AcceptedMission } from "../nova_plugin/missions/index.js";
import { canonicalDesyncHash, DesyncDump, RollbackLogEntry, STATE_HASH_INTERVAL, wrapRollbackMessage } from "./rollback_protocol.js";
import { relayServer, requestCatchUp, subscribeRollbackMessages } from "./rollback_messages.js";
import { makeNpc } from "../nova_plugin/npc/index.js";
import { PEER_LOCAL_COMPONENTS, AnalogControlState } from '../nova_plugin/player/index.js';
import { EncodedSimulationBridgeEvent, getRegisteredSimulationBridgeEvents } from "./simulation_bridge_events.js";
import { SimulationBridgeHostApi, SimulationStatus } from "./simulation_bridge_api.js";
import { DeltaFrameEncoder, SimulationFrame } from "./simulation_frame.js";
import { RoomClock } from "./room_clock.js";


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

export class SimulationBridgeHost implements SimulationBridgeHostApi {
    private queuedEvents: EncodedSimulationBridgeEvent[] = [];
    /**
     * The tick the rollback driver is currently stepping (its settle
     * tick), set by the driver's beforeStep hook; undefined between
     * steps and after every snapshot flush. Stamps queued events with
     * the tick they belong to — unambiguously, unlike reading
     * TimeResource mid-step (TimeSystem advances it partway through).
     */
    private steppingTick?: number;
    /**
     * Events for step ticks at or below this have been flushed to the
     * display (snapshot() advances it). An emission during the
     * RE-execution of such a tick — rollback resimulation — would be a
     * duplicate of an event the display already received, so it is
     * dropped. Forward execution only ever steps ticks above this
     * (snapshot() sets it to the tick already stepped and flushed), so
     * nothing is ever dropped on the live path and forward behaviour
     * is unchanged.
     */
    private eventsForwardedThrough = -1;
    private frameEncoder = new DeltaFrameEncoder();
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
    private roomClock = new RoomClock();
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
        this.eventsForwardedThrough = this.rollback.tick;
        // Receive relayed rollback-protocol messages from the room.
        const communicator = world.resources.get(CommunicatorResource);
        if (communicator) {
            subscribeRollbackMessages(communicator, {
                inputs: record => this.integrateStaged(record),
                tickSync: tick => this.roomClock.sync(tick),
                inputLog: records => {
                    for (const record of records) {
                        this.integrateStaged(record);
                    }
                },
                desync: (tick, hashes, canonical) =>
                    this.handleDesync(tick, hashes, canonical),
                desyncDumpRequest: () => this.sendDesyncDump(),
            });
        }
        for (const registration of getRegisteredSimulationBridgeEvents()) {
            world.events.get(registration.event).subscribe(({ data, entities }) => {
                const tick = this.steppingTick;
                if (tick !== undefined && tick <= this.eventsForwardedThrough) {
                    // Rollback resimulation re-executing a tick whose
                    // events the display already received: forwarding
                    // this re-emission would deliver it twice (the
                    // double-explosion / double-sound class of bug).
                    // Corrections to already-displayed ticks reach the
                    // display as state (the delta stream snaps), never
                    // as replayed events.
                    return;
                }
                const entityUuids = registration.includeEntityUuids
                    ? entities?.map(entity => typeof entity === "string" ? entity : entity.uuid)
                    : undefined;
                this.queuedEvents.push({
                    name: registration.name,
                    data: this.serializer.encodeEvent(registration.event, data),
                    ...(tick !== undefined ? { tick } : {}),
                    ...(entityUuids ? { entityUuids } : {}),
                });
            });
        }
    }

    private makeRollback(): RollbackSimulation<InputRecord[]> {
        return new RollbackSimulation<InputRecord[]>(this.world, {
            applyInputs: applyInputRecords,
            complete: deriveEntityComponents,
            // Stamps queued bridge events with the tick being stepped
            // (fires for live, resimulated and fast-forwarded ticks
            // alike, before the tick's inputs are applied, so input-
            // application emissions are stamped too).
            beforeStep: tick => { this.steppingTick = tick; },
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
                const estimated = this.roomClock.estimatedServerTick();
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
        const catchUp = await requestCatchUp(communicator, { timeoutMs, fresh },
            reply => {
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
                this.roomClock.sync(reply.tick);
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
            Math.ceil(this.roomClock.estimatedServerTick() ?? 0)),
            FAST_FORWARD_YIELD_TICKS);
        for (let pass = 0; pass < 3; pass++) {
            const target = Math.ceil(this.roomClock.estimatedServerTick() ?? 0);
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
        // The replayed history counts as delivered (dropped, above):
        // only ticks stepped from here on forward events.
        this.eventsForwardedThrough = this.rollback.tick;
        this.steppingTick = undefined;
        // The local tick just jumped; stale smoothed drift would slew
        // against the new position.
        this.roomClock.resetDrift();
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
        // (An escort action needs no staging: none of them builds a ship on
        // the tick it lands. Queueing an upgrade only records the target
        // class on the escort's marker; the class itself is loaded by the
        // client that settles the deal at lift-off — see
        // spaceport/escort_deals.ts.)
        if (record.inputs.some(input => input.kind === 'addEntity'
            || input.kind === 'acceptMission')) {
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
            // Queued-but-unflushed events from the ticks about to be
            // re-simulated describe the abandoned timeline; the
            // resimulation re-emits the corrected versions (their ticks
            // sit above the forwarded horizon, so they queue normally).
            // Keeping the originals would forward each such tick's
            // events twice.
            const heldEvents = this.queuedEvents;
            this.queuedEvents = heldEvents.filter(
                event => event.tick === undefined || event.tick <= toTick);
            if (!this.rollback.rollbackTo(toTick)) {
                // The target tick is behind the ring-buffer horizon, so
                // the rollback did not happen and the corrected inputs
                // apply late. Nothing was re-simulated, so the held
                // events are still the only copies: put them back.
                this.queuedEvents = heldEvents;
                // Log it so desync forensics can see why — and resync
                // (cooldown-gated), like the sibling too-old paths
                // (retimeTooOld, lateRecord): inputs applied at the
                // wrong tick are a known fork, and waiting for
                // checkpoint conviction costs seconds on a divergence
                // we already know about.
                this.logRollbackEvent('rollbackTooOld', { toTick, depth });
                void this.resync();
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
        const server = relayServer(communicator);
        if (!communicator || !server) {
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
        const server = relayServer(communicator);
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
        const server = relayServer(communicator);
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
                // The clock just jumped back to genesis; a horizon from
                // the abandoned timeline would silently swallow every
                // event if the rejoin fails and play continues offline.
                // (A successful joinRoom re-advances it.)
                this.eventsForwardedThrough = this.rollback.tick;
                this.steppingTick = undefined;
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
            // Queued events from the discarded future name ticks that
            // no longer exist; and the re-lived timeline's events
            // should fire afresh (time travel re-lives them), so the
            // forwarded horizon comes back with the clock.
            this.queuedEvents = this.queuedEvents.filter(event =>
                event.tick === undefined || event.tick <= this.rollback.tick);
            this.eventsForwardedThrough = Math.min(
                this.eventsForwardedThrough, this.rollback.tick);
            this.steppingTick = undefined;
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
     *
     * NOTHING IS STAGED, unlike acceptMission or addEntity: no escort
     * action builds a ship on the tick its record lands. A release only
     * drops components, and queueing an upgrade only writes the target
     * class's id onto the escort's ownership marker — the class is loaded
     * (and the hull actually swapped) by the client that settles the deal
     * at lift-off, spaceport/escort_deals.ts. Kept async so the bridge
     * interface, and every caller's `await`, are unchanged.
     */
    async escortAction(action: EscortAction) {
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
            const decoded = this.serializer.decode(ship.entity);
            if (isLeft(decoded)) {
                throw new Error('Failed to decode mission ship: '
                    + this.serializer.describeDecodeFailure(
                        ship.entity, decoded.left));
            }
            await loadEntityGameData(this.world, decoded.right);
        }
        // The outfits the accept GRANTS are staged like the ships: this
        // worker's cache is its own (the display side warming its
        // cache does not warm it), and applying the grant rebuilds the
        // player's weapons/physics from the cache on the very tick the
        // record lands. Same closure loadInputRecordsGameData stages
        // for every other world applying this record.
        await loadOutfitsGameData(this.world, grantedOutfitIds(accepted));
        this.schedule({ kind: 'acceptMission', accepted });
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
        // Everything stepped so far is now in the display's hands: any
        // re-execution of these ticks (rollback resimulation) must not
        // queue its events again. steppingTick is cleared so a stray
        // between-steps emission is never stamped with — and dropped
        // for — a tick it did not belong to.
        this.eventsForwardedThrough = this.rollback.tick;
        this.steppingTick = undefined;
        const { added, changed, removed } =
            this.frameEncoder.encode(this.world, this.serializer);

        return {
            added,
            changed,
            removed,
            time: this.world.resources.get(TimeResource),
            events,
            pacing: this.roomClock.pacing(this.rollback.tick),
        };
    }

    /**
     * Forgets all previously sent state so the next snapshot resends
     * every entity in full.
     */
    resetSync() {
        this.frameEncoder.reset();
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
            };
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
            entity: structuredClone(this.serializer.encode(npc)),
        });
    }
}
