import { isLeft } from "fp-ts/lib/Either.js";
import { Entity } from "nova_ecs/entity";
import { RollbackSimulation } from "nova_ecs/plugins/rollback_plugin";
import { restoreWireWorldSnapshot, restoreWorld, snapshotWorld, SnapshotPolicies, SnapshotPoliciesResource, wireSnapshotOfSnapshot, WorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { CommunicatorResource, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { v4 } from "uuid";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import {
    loadEntityGameData, loadWeaponsGameData,
    loadWireSnapshotGameData,
} from "../nova_plugin/spawn/index.js";
import {
    deriveEntityComponents, ControlEvent, stageEncodedComponentsGameData,
} from '../nova_plugin/core/index.js';
import {
    applyInputRecords, InputRecord, inputNeedsStaging, loadInputRecordsGameData,
    loadSetStringEffectsGameData, SimulationInput,
} from "./simulation_input.js";
import { warnThrottled } from "../common/log_throttle.js";
import { HailAction } from "../nova_plugin/encounters/index.js";
import { EscortAction, FighterRefund } from "../nova_plugin/escorts/index.js";
import { AcceptedMission, RefusedMission } from "../nova_plugin/missions/index.js";
import { canonicalDesyncHash, DesyncDump, RollbackLogEntry, STATE_HASH_INTERVAL, wrapRollbackMessage } from "./rollback_protocol.js";
import { InputRefusedNotice, relayServer, requestCatchUp, subscribeRollbackMessages } from "./rollback_messages.js";
import { encodedEntityStamps, entityStamps, restampEncodedEntity } from "./peer_identity.js";
import { classifyPeerDeparture } from "./peer_departure.js";
import { DeathEvent } from "../nova_plugin/ship/index.js";
import { systemOrderHash } from "./system_order.js";
import { makeNpc } from "../nova_plugin/npc/index.js";
import {
    PEER_LOCAL_COMPONENTS, AnalogControlState, ControlledByComponent,
} from '../nova_plugin/player/index.js';
import { EncodedSimulationBridgeEvent, getRegisteredSimulationBridgeEvents } from "./simulation_bridge_events.js";
import { SimulationBridgeHostApi, SimulationStatus } from "./simulation_bridge_api.js";
import { DeltaFrameEncoder, SimulationFrame } from "./simulation_frame.js";
import { RoomClock } from "./room_clock.js";
import { inputThroughWire } from "./wire_schemas.js";


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
/**
 * How long a re-entry's re-insertion waits for this peer's OLD copy of an
 * entity to leave the room (#354): the relay authors removePeer for the
 * old uuid when the server notices the old socket is gone — at once for a
 * clean close, within its keepalive (two 30 s timeouts,
 * socket_channel_server.ts) for a connection that died half-open. 90 s
 * covers that with margin; past it the entity is given up, loudly.
 */
const REINSERTION_HOLD_TICKS = 90 * 60;
/** Staging attempts for one re-insertion batch before it is given up. */
const REINSERTION_MAX_ATTEMPTS = 5;
/**
 * How many times a refusal notice may send this peer back through a
 * re-entry (#354, handleRefusal) before it stops and reports the failure.
 * A re-entry under the right identity is refused zero times; a refusal
 * that keeps coming back means this peer's identity itself is wrong, and
 * looping would never end.
 */
const MAX_REFUSAL_REENTRIES = 3;
/**
 * How long a refusal naming an identity this host has never held waits for
 * that identity to be forwarded (it is normally milliseconds behind the
 * socket) before the failure is reported (#354, handleRefusal).
 */
const IDENTITY_GRACE_MS = 5_000;

/**
 * One of this peer's own entities, captured for a re-entry (#354): its
 * insertion-record encoding, and whether it is part of this peer's FLEET
 * — its player ship, escorts and their fighters (peer_departure.ts), what
 * a departure removes and a re-entry always brings back — rather than
 * another ship it owned, which a departure merely disowns.
 */
interface CapturedEntity {
    entity: EncodedEntity;
    fleet: boolean;
}
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
    /**
     * The worker's own joinRoom while it runs (#333). A reconstruction
     * like a resync's, but it used to run outside the `resyncing` guard:
     * a staging failure mid-join forced a resync that restored genesis
     * and swapped `this.rollback` under the join's fast-forward. A resync
     * now waits for it before touching the world.
     */
    private joinInFlight?: Promise<boolean>;
    /**
     * TERMINAL (#333, ruling admin1): a resync ran out of attempts. The
     * world is a genesis reconstruction with no player in it, and nothing
     * here can be trusted again, so the host freezes for good: step() and
     * every input are no-ops, no further resync runs, and snapshot()
     * sends no state — the display keeps the last real frame it got. The
     * client is told once, on the next frame ({@link SimulationFrame.
     * resyncFailed}), saves, and offers a page reload.
     */
    private resyncFailed = false;
    /** Whether a snapshot has already carried `resyncFailed`. */
    private resyncFailureReported = false;
    /**
     * ============================================================
     * Identity (#354): ownership follows the CURRENT connection
     * ============================================================
     * The server assigns a peer uuid per socket, so a reconnect hands
     * this peer a NEW one mid-game (communicator_client.ts identity,
     * forwarded to a browser worker by worker_room_communicator.ts).
     * Every entity it owns is still stamped with the old one, and the
     * room — which stamps every record with the socket it arrived on —
     * would refuse each of them as somebody else's. So on a change the
     * host RE-ENTERS (reenter): it captures its own fleet from the
     * timeline it was on, rebuilds the world from the room (a resync,
     * under the new id) and re-inserts the fleet, re-stamped, as
     * ordinary insertion records every peer and the archive apply alike.
     *
     * `ownPeerIds` is every id this peer has held: what its entities
     * may still be stamped with. `actingPeerId` is the one it last
     * acted under.
     */
    private ownPeerIds = new Set<string>();
    private actingPeerId?: string;
    /** Own entities waiting to be re-inserted after a re-entry's
     * rejoin, by uuid, in insertion order (player ships first). */
    private reinsertions = new Map<string, {
        entity: EncodedEntity, fleet: boolean,
        /** The room timeline this host was on when it captured the
         * entity (rollback_relay.ts `timeline`). */
        timeline?: string,
        heldSince?: number, attempts: number,
    }>();
    /** The timeline (rollback_relay.ts) of the room last joined. */
    private roomTimeline?: string;
    /** Uuids of insertions the room told this peer it refused
     * (handleRefusal): never in the room, so their absence from it is no
     * verdict on them. */
    private refusedInsertions = new Set<string>();
    /**
     * ============================================================
     * Un-destroyed return (#354, the maintainer's ruling 2)
     * ============================================================
     * "Player and escorts return un-destroyed if they were somehow
     * destroyed after the player disconnected." The room's half of that
     * needs nothing here: whatever the room does to the old connection's
     * copy while this peer is away (a destruction included) never reaches
     * this world, so the re-entry's capture still has the ship, and puts
     * it back. THIS world's half: while disconnected it plays on alone,
     * and a fleet ship it sees die then (on inputs and predictions the
     * room never confirmed) would be missing from that capture. So the
     * fleet is captured again the moment the connection drops, every
     * fleet ship that dies from then on is noted, and the re-entry
     * restores those from the disconnect-time capture. A ship destroyed
     * BEFORE the disconnect is in neither capture and stays destroyed.
     * (Player ships never leave the world on death — they respawn,
     * death_plugin.ts PlayerDeathSystem — so in practice this is the
     * escorts and the fighters.)
     */
    private disconnectFleet?: Map<string, CapturedEntity>;
    private diedSinceDisconnect = new Set<string>();
    private wasConnected = false;
    private reinsertionInFlight = false;
    /** The identity changed while a resync was running: run another once
     * it ends, so the rejoin happens under the new id. */
    private resyncAgain = false;
    /** This peer's fleet as it stood when the last resync began: what an
     * identity change mid-resync re-inserts (the world being rebuilt
     * holds nothing worth capturing). */
    private preResyncFleet?: Map<string, CapturedEntity>;
    /** Re-entries a refusal notice has caused (handleRefusal). */
    private refusalReentries = 0;
    /** A refusal named an identity this host has not (yet) learned. */
    private unknownIdentity?: { peer: string, since: number };
    private identityRecoveryFailed = false;
    // protected so failure-path tests can observe whether a resync proceeded
    // (a proceeding resync refreshes this; a cooldown no-op leaves it).
    protected lastResyncTime = -Infinity;

    private readonly resyncCooldownMs: number;
    private readonly resyncJoinTimeoutMs: number;
    private readonly resyncRetryMs: number;
    private readonly resyncMaxAttempts: number;
    private readonly stagingMaxAttempts: number;
    private readonly stagingRetryMs: number;
    private readonly identityGraceMs: number;

    constructor(
        private world: World,
        private simulationGameData: SimulationGameDataInterface,
        { resyncCooldownMs = RESYNC_COOLDOWN_MS,
            resyncJoinTimeoutMs = RESYNC_JOIN_TIMEOUT_MS,
            resyncRetryMs = RESYNC_RETRY_MS,
            resyncMaxAttempts = RESYNC_MAX_ATTEMPTS,
            stagingMaxAttempts = STAGING_MAX_ATTEMPTS,
            stagingRetryMs = STAGING_RETRY_MS,
            identityGraceMs = IDENTITY_GRACE_MS }: {
                resyncCooldownMs?: number,
                resyncJoinTimeoutMs?: number,
                resyncRetryMs?: number,
                resyncMaxAttempts?: number,
                stagingMaxAttempts?: number,
                stagingRetryMs?: number,
                identityGraceMs?: number,
            } = {},
    ) {
        this.identityGraceMs = identityGraceMs;
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
                inputRefused: notice => this.handleRefusal(notice),
            });
            // The identity this host starts under: no re-entry for it.
            this.noteIdentity();
            communicator.connected.subscribe(
                connected => this.noteConnected(connected));
        }
        world.events.get(DeathEvent).subscribe(({ entities }) => {
            if (!this.disconnectFleet || this.resyncing) {
                return;
            }
            for (const target of entities ?? []) {
                const uuid = typeof target === 'string' ? target : target.uuid;
                if (this.disconnectFleet.get(uuid)?.fleet) {
                    this.diedSinceDisconnect.add(uuid);
                }
            }
        });
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
     *
     * The one choke point for this peer's own inputs, so the one place
     * they are checked (#295): every input runs the wire's own codec
     * (wire_schemas.ts inputThroughWire) BEFORE it is applied or
     * published. The authoring host's records never cross the receiving
     * codecs, so an input the wire refuses used to apply here while the
     * room never saw it — the sender's socket throws on it (drops it in
     * production, #272) or the relay's decode drops it — a
     * self-inflicted desync the relay convicts (#270, the e2e 'stop'
     * control). Refused per input, with a warning naming its kind; the
     * rest of the tick's inputs are unaffected. An admitted input is
     * scheduled as the wire hands it back, so this timeline applies
     * exactly what every other peer's does.
     */
    private schedule(input: SimulationInput) {
        if (this.resyncFailed) {
            // Frozen for good (#333): nothing is applied or published.
            return;
        }
        const received = inputThroughWire(input);
        if (isLeft(received)) {
            const kind = String((input as { kind?: unknown }).kind);
            warnThrottled(`bridge-input-invalid:${kind}`, () =>
                `Dropping a local ${kind} input the wire would refuse: `
                + received.left);
            return;
        }
        // What the room receives, which is what it applies (stripped of
        // anything the strict codecs drop): the same input here.
        this.pendingInputs.push(received.right);
    }

    step(count = 1) {
        if (this.resyncFailed) {
            // Frozen for good (#333): no stepping, and no re-entry either.
            return;
        }
        // A reconnect changed this peer's uuid (#354): re-enter under it.
        this.noteIdentity();
        this.checkUnknownIdentity();
        if (this.resyncing) {
            // Mid-recovery the world is being rebuilt from the input
            // log; stepping it would fork a fresh timeline.
            return;
        }
        this.scheduleReinsertions();
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
                const peerId = communicator?.uuid;
                const record: InputRecord = {
                    peerId,
                    tick,
                    seq: this.nextSeq++,
                    // An insertion stamped with one of this peer's OLD
                    // ids (scheduled before a reconnect landed) is
                    // re-stamped to the id the record goes out under:
                    // the room applies it under that id, and so must we.
                    inputs: peerId === undefined ? this.pendingInputs
                        : this.pendingInputs.map(
                            input => this.restampInput(input, peerId)),
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
        // One reconstruction at a time (#333): a join started while a
        // resync (or another join) is rebuilding the world would
        // interleave with it on the same world and rollback driver.
        if (this.resyncing || this.joinInFlight || this.resyncFailed) {
            console.warn('joinRoom while a reconstruction is in flight '
                + 'or after a failed resync; ignored');
            return false;
        }
        const join = this.reconstructFromRoom(timeoutMs, { fresh });
        this.joinInFlight = join;
        try {
            return await join;
        } finally {
            this.joinInFlight = undefined;
        }
    }

    /**
     * The body of a join: catch-up request, staging, baseline restore,
     * log replay. Called by joinRoom (guarded) and by resync (which holds
     * `resyncing` itself); protected so a spec can observe whether two
     * ever overlap.
     */
    protected async reconstructFromRoom(timeoutMs: number,
        { fresh }: { fresh: boolean }): Promise<boolean> {
        const communicator = this.world.resources.get(CommunicatorResource);
        if (!communicator?.uuid) {
            return false;
        }
        const catchUp = await requestCatchUp(communicator, {
            timeoutMs, fresh,
            // #155: lets the relay notice a peer whose world runs its
            // systems in a different order from the room's.
            systems: systemOrderHash(this.world.systemNames),
        },
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
        this.roomTimeline = catchUp.timeline;
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
        if (this.resyncFailed) {
            // Frozen for good (#333): nothing integrates any more, and
            // buffering would only grow until the page reloads.
            return;
        }
        // (An escort action needs no staging: none of them builds a ship on
        // the tick it lands. Queueing an upgrade only records the target
        // class on the escort's marker; the class itself is loaded by the
        // client that settles the deal at lift-off — see
        // spaceport/escort_deals.ts.)
        if (record.inputs.some(inputNeedsStaging)) {
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
                // A seq is only unique PER PEER (every peer numbers its
                // records from 0), so the stale application is the
                // record at oldTick with OUR peerId and this seq — not
                // every record there with this seq. Filtering on seq
                // alone dropped another peer's record that happened to
                // share the tick and the number: two peers' first
                // records (their ship insertions, seq 0 each) stamped
                // for the same tick, one of them retimed, and the
                // sender silently never inserted the other's ship (the
                // binary_wire_e2e checkpoint-420 desync).
                this.rollback.setInputs(oldTick,
                    (this.rollback.getInputs(oldTick) ?? []).filter(
                        r => r.peerId !== record.peerId || r.seq !== record.seq));
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
        if (this.resyncing || this.resyncFailed
            || (!force
                && Date.now() - this.lastResyncTime < this.resyncCooldownMs)) {
            return false;
        }
        this.lastResyncTime = Date.now();
        // What this peer owns on the timeline being abandoned, should its
        // identity change before the rebuild lands (reenter).
        this.preResyncFleet = this.captureOwnFleet();
        this.resyncing = true;
        this.logRollbackEvent('resync');
        try {
            // The worker's initial join is a reconstruction too (#333):
            // restoring genesis under it would swap the world and the
            // rollback driver out from under its fast-forward. Let it
            // finish; this resync then rebuilds from the full log anyway
            // (which is what re-stages the record whose failure forced
            // it).
            if (this.joinInFlight) {
                await this.joinInFlight.catch(() => false);
            }
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
                    if (await this.reconstructFromRoom(
                        this.resyncJoinTimeoutMs, { fresh: true })) {
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
                    // Terminal (#333): stepping on from here would play
                    // the bare genesis world — no player ship, the clock
                    // at zero — as if it were the session.
                    this.resyncFailed = true;
                    this.lastJoinSucceeded = false;
                    this.remoteInputs = [];
                    this.remoteInputsGeneration++;
                    this.pendingInputs = [];
                    this.queuedEvents = [];
                    this.logRollbackEvent('resyncFailed', { attempts: attempt });
                    return false;
                }
                await new Promise(resolve =>
                    setTimeout(resolve, this.resyncRetryMs));
            }
        } finally {
            this.resyncing = false;
            this.preResyncFleet = undefined;
            if (this.resyncAgain) {
                // The identity changed mid-rebuild: that rebuild may have
                // joined under the old id. Once more, under the new one.
                this.resyncAgain = false;
                void this.resync(true);
            }
        }
    }

    /**
     * Follows this peer's identity (#354). The first id seen is simply
     * adopted; a CHANGE — a reconnect — re-enters the room under the new
     * one.
     */
    private noteIdentity() {
        const current = this.world.resources.get(CommunicatorResource)?.uuid;
        if (current === undefined || current === this.actingPeerId) {
            return;
        }
        const previous = this.actingPeerId;
        this.actingPeerId = current;
        this.ownPeerIds.add(current);
        if (previous === undefined) {
            return;
        }
        this.logRollbackEvent('identityChanged');
        this.reenter();
    }

    /** Whether `peerId` is one of this peer's own ids other than `current`. */
    private isStaleOwnId(peerId: string, current: string): boolean {
        return peerId !== current && this.ownPeerIds.has(peerId);
    }

    /**
     * The re-entry: this peer's fleet captured from the timeline it was on
     * (or, mid-resync, from the one that resync abandoned), the world
     * rebuilt from the room under the current identity (a forced resync —
     * on a restarted server, a room with no memory of this peer at all;
     * on the same server, a log that may already hold the removePeer for
     * the old id), then the fleet re-inserted under its own uuids,
     * re-stamped (scheduleReinsertions). The rebuild is unavoidable either
     * way: records relayed while the socket was down went to the dead one.
     */
    private reenter() {
        const current = this.world.resources.get(CommunicatorResource)?.uuid;
        const fleet = new Map(
            (this.resyncing ? this.preResyncFleet : this.captureOwnFleet()) ?? []);
        // The fleet ships this world saw die after the connection dropped,
        // as they stood at the drop (ruling 2; see disconnectFleet).
        for (const uuid of [...this.diedSinceDisconnect].sort()) {
            const captured = this.disconnectFleet?.get(uuid);
            if (captured?.fleet && !fleet.has(uuid)) {
                fleet.set(uuid, captured);
            }
        }
        this.disconnectFleet = undefined;
        this.diedSinceDisconnect.clear();
        for (const [uuid, { entity, fleet: inFleet }] of fleet) {
            // Only what is stamped with a STALE own id: whatever already
            // carries the current one is the room's business, and its log
            // has the truth about it (re-inserting it could resurrect a
            // ship the room destroyed).
            const stale = current !== undefined && encodedEntityStamps(entity)
                .some(id => this.isStaleOwnId(id, current));
            if (stale && !this.reinsertions.has(uuid)) {
                this.reinsertions.set(uuid, {
                    entity, fleet: inFleet, timeline: this.roomTimeline,
                    attempts: 0,
                });
            }
        }
        this.logRollbackEvent('reenter', { entities: this.reinsertions.size });
        if (this.resyncing) {
            this.resyncAgain = true;
            return;
        }
        void this.resync(true);
    }

    /**
     * The connection went down (or came up). On the drop, the fleet is
     * captured as it stands, for the un-destroyed return (disconnectFleet).
     */
    private noteConnected(connected: boolean) {
        if (!connected && this.wasConnected) {
            this.disconnectFleet = this.resyncing
                ? this.preResyncFleet : this.captureOwnFleet();
            this.diedSinceDisconnect.clear();
        }
        this.wasConnected = connected;
    }

    /**
     * Every entity in this world stamped with one of this peer's ids, wire
     * encoded as an insertion record carries it (peer-local markers
     * stripped), each marked fleet or not (peer_departure.ts). Player
     * ships first — escorts' formations and fighters' bays name them —
     * then by uuid.
     */
    private captureOwnFleet(): Map<string, CapturedEntity> {
        const fleet = new Map<string, CapturedEntity>();
        const serializer = this.world.resources.get(SerializerResource);
        if (!serializer || this.ownPeerIds.size === 0) {
            return fleet;
        }
        const fleetUuids = new Set(classifyPeerDeparture(this.world.entities,
            id => this.ownPeerIds.has(id)).fleet);
        const own = [...this.world.entities].filter(([uuid, entity]) =>
            uuid !== 'singleton'
            && entityStamps(entity).some(id => this.ownPeerIds.has(id)));
        const controlled = (entity: Entity) =>
            entity.components.has(ControlledByComponent) ? 0 : 1;
        own.sort(([a, entityA], [b, entityB]) =>
            controlled(entityA) - controlled(entityB)
            || (a < b ? -1 : a > b ? 1 : 0));
        for (const [uuid, entity] of own) {
            const encoded = structuredClone(serializer.encode(entity));
            fleet.set(uuid, {
                entity: {
                    ...encoded,
                    components: encoded.components.filter(
                        ([name]) => !PEER_LOCAL_COMPONENTS.has(name)),
                },
                fleet: fleetUuids.has(uuid),
            });
        }
        return fleet;
    }

    /** `input`, with any insertion stamped with a stale own id re-stamped
     * to `peerId`. The same object when nothing is stale. */
    private restampInput(input: SimulationInput, peerId: string): SimulationInput {
        const isStale = (id: string) => this.isStaleOwnId(id, peerId);
        if (input.kind === 'addEntity') {
            const entity = restampEncodedEntity(input.entity, isStale, peerId);
            return entity === input.entity ? input : { ...input, entity };
        }
        if (input.kind === 'acceptMission' && input.accepted.ships) {
            let changed = false;
            const ships = input.accepted.ships.map(ship => {
                const entity = restampEncodedEntity(
                    ship.entity as EncodedEntity, isStale, peerId);
                changed ||= entity !== ship.entity;
                return entity === ship.entity ? ship : { ...ship, entity };
            });
            return changed
                ? { ...input, accepted: { ...input.accepted, ships } }
                : input;
        }
        return input;
    }

    /**
     * Puts a re-entry's captured fleet back into the room, once the rejoin
     * has landed. An entity whose uuid the room still holds under one of
     * this peer's OLD ids — the server has not yet noticed the old socket
     * is gone, so its removePeer has not landed — waits for it: inserting
     * over it would be refused (an entity this peer no longer owns), and a
     * fresh uuid would leave a duplicate. One already back under the
     * current id is done. One the room holds for somebody else is not this
     * peer's to replace. The rest go in as ONE batch, staged first, so the
     * whole fleet lands on one tick.
     *
     * The FLEET (player ships, escorts, their fighters) always comes back
     * — the room removed it with the old connection, and the maintainer's
     * ruling returns it as this peer last had it, un-destroyed. Any OTHER
     * own entity (mission ships, spawned NPCs) the old connection's
     * removePeer DISOWNED and left in the room (peer_departure.ts): if
     * the room is on the timeline this peer captured it from, it is the
     * room's now — held there unowned (left alone), or gone since
     * (destroyed, departed: not resurrected). Only a room on a DIFFERENT
     * timeline (a restarted server, a room that emptied and started over)
     * never knew it, and gets it back like the fleet.
     */
    private scheduleReinsertions() {
        if (this.reinsertions.size === 0 || this.reinsertionInFlight
            || this.lastJoinSucceeded !== true) {
            return;
        }
        const current = this.world.resources.get(CommunicatorResource)?.uuid;
        if (current === undefined) {
            return;
        }
        const batch: [string, EncodedEntity][] = [];
        for (const [uuid, pending] of [...this.reinsertions]) {
            const existing = this.world.entities.get(uuid);
            const roomRemembers = !pending.fleet
                && pending.timeline !== undefined
                && pending.timeline === this.roomTimeline
                && !this.refusedInsertions.has(uuid);
            if (existing) {
                const stamps = entityStamps(existing);
                if (stamps.length > 0 && stamps.every(id => id === current)) {
                    this.reinsertions.delete(uuid);
                    continue;
                }
                if (stamps.length === 0) {
                    // Disowned by the old connection's removePeer: a world
                    // ship now, nobody's to replace.
                    this.logRollbackEvent('disowned', { uuid });
                    this.reinsertions.delete(uuid);
                    continue;
                }
                if (stamps.some(id => this.isStaleOwnId(id, current))) {
                    pending.heldSince ??= this.rollback.tick;
                    if (this.rollback.tick - pending.heldSince
                        > REINSERTION_HOLD_TICKS) {
                        console.error(`Giving up re-inserting ${uuid}: the `
                            + 'room still holds it under this peer\'s old '
                            + 'identity');
                        this.reinsertions.delete(uuid);
                    }
                    continue;
                }
                console.warn(`Not re-inserting ${uuid}: the room holds it `
                    + 'for another peer');
                this.reinsertions.delete(uuid);
                continue;
            }
            if (roomRemembers) {
                // Disowned and then gone from the room (destroyed, or it
                // left): the room's verdict stands.
                this.logRollbackEvent('disownedGone', { uuid });
                this.reinsertions.delete(uuid);
                continue;
            }
            batch.push([uuid, restampEncodedEntity(pending.entity,
                id => this.isStaleOwnId(id, current), current)]);
        }
        if (batch.length === 0) {
            return;
        }
        this.reinsertionInFlight = true;
        void this.reinsertBatch(batch).finally(() => {
            this.reinsertionInFlight = false;
        });
    }

    private async reinsertBatch(batch: [string, EncodedEntity][]) {
        try {
            // Stage every entity's game data in this world first (a
            // resync's genesis restore keeps the caches, but a capture
            // replayed onto a rebuilt world must not assume it), then
            // schedule the whole batch synchronously: one record.
            await stageEncodedComponentsGameData(this.simulationGameData,
                batch.map(([, entity]) => entity.components));
            for (const [, entity] of batch) {
                const decoded = this.serializer.decode(entity);
                if (isLeft(decoded)) {
                    throw new Error('Failed to decode a re-inserted entity: '
                        + this.serializer.describeDecodeFailure(
                            entity, decoded.left));
                }
                await loadEntityGameData(this.world, decoded.right);
            }
        } catch (error) {
            for (const [uuid] of batch) {
                const pending = this.reinsertions.get(uuid);
                if (pending && ++pending.attempts >= REINSERTION_MAX_ATTEMPTS) {
                    this.reinsertions.delete(uuid);
                }
            }
            console.error('Failed to stage a re-entry\'s fleet:', error);
            return;
        }
        for (const [uuid, entity] of batch) {
            // Still wanted (a later re-entry may have re-queued it, and the
            // world may have changed while staging awaited)?
            if (!this.reinsertions.has(uuid) || this.world.entities.has(uuid)) {
                continue;
            }
            this.reinsertions.delete(uuid);
            this.refusedInsertions.delete(uuid);
            this.schedule({ kind: 'addEntity', uuid, entity });
        }
        this.logRollbackEvent('reinserted', { entities: batch.length });
    }

    /**
     * The room refused one of this peer's insertions (#354; the archive
     * reports every refusal once, rollback_relay.ts reportRefusal). Logged
     * once per notice. Then, by what the notice says about identity:
     *
     *  - The room stamped the record with an id this host has NEVER held:
     *    its view of its own identity is behind the socket's. Normally the
     *    forwarded identity is a moment away (and its change re-enters);
     *    if it has not arrived within the grace (IDENTITY_GRACE_MS), no
     *    re-entry under the id this host has can ever be accepted, and the
     *    failure is reported (giveUpIdentityRecovery) instead of looping.
     *  - The refused entity is in this world under one of this peer's
     *    other, STALE ids: it re-enters, re-stamped — at most
     *    MAX_REFUSAL_REENTRIES times, then the failure is reported.
     *  - Anything else is the room's deterministic verdict, which no
     *    re-entry would change.
     */
    private handleRefusal(notice: InputRefusedNotice) {
        console.warn(`The room refused this peer's ${notice.input} of `
            + `${notice.uuid} (record tick ${notice.tick}): ${notice.reason}`);
        this.logRollbackEvent('inputRefused', {
            uuid: notice.uuid, recordTick: notice.tick,
        });
        // Whatever else follows, the room never took this entity from us:
        // its absence there is no verdict (scheduleReinsertions).
        this.refusedInsertions.add(notice.uuid);
        if (this.identityRecoveryFailed) {
            return;
        }
        if (!this.ownPeerIds.has(notice.peer)) {
            this.unknownIdentity ??= { peer: notice.peer, since: Date.now() };
            return;
        }
        const local = this.world.entities.get(notice.uuid);
        const insertedStale = local !== undefined && entityStamps(local)
            .some(id => this.isStaleOwnId(id, notice.peer));
        if (!insertedStale) {
            return;
        }
        if (this.refusalReentries >= MAX_REFUSAL_REENTRIES) {
            this.giveUpIdentityRecovery(`giving up after `
                + `${MAX_REFUSAL_REENTRIES} re-entries`);
            return;
        }
        this.refusalReentries++;
        this.reenter();
    }

    /** handleRefusal's wait for an identity the room knows and this host
     * does not (yet): cleared once it arrives, fatal past the grace. */
    private checkUnknownIdentity() {
        if (!this.unknownIdentity || this.identityRecoveryFailed) {
            return;
        }
        if (this.ownPeerIds.has(this.unknownIdentity.peer)) {
            this.unknownIdentity = undefined;
            return;
        }
        if (Date.now() - this.unknownIdentity.since > this.identityGraceMs) {
            this.giveUpIdentityRecovery('the room knows this peer as '
                + `${this.unknownIdentity.peer}, which this host never learned`);
        }
    }

    /**
     * The room keeps refusing this peer's fleet, and re-entering cannot
     * change that: stop.
     *
     * HOOK (#333): this is where the resync give-up's terminal path belongs
     * — save, the in-game desync dialog, the frozen universe and its Reload
     * button (client/resync_failure.ts and the client's `desynced` state,
     * on branch fix/resync-giveup-dialog, not merged on this base). Until
     * then the failure is reported through status().identityRecoveryFailed
     * and the console only.
     */
    private giveUpIdentityRecovery(why: string) {
        this.identityRecoveryFailed = true;
        this.unknownIdentity = undefined;
        console.error('The room refuses this peer\'s fleet under the identity '
            + `this host has; ${why}.`);
        this.logRollbackEvent('identityRecoveryFailed');
    }

    status(): SimulationStatus {
        return {
            tick: this.rollback.tick,
            desyncCount: this.desyncCount,
            joined: this.lastJoinSucceeded,
            ...(this.resyncFailed ? { resyncFailed: true } : {}),
            ...(this.identityRecoveryFailed
                ? { identityRecoveryFailed: true } : {}),
        };
    }

    entityHashes(): { tick: number, entities: [string, string][] } {
        return {
            tick: this.rollback.tick,
            entities: [...hashWorld(this.world, PEER_LOCAL_COMPONENTS).entities],
        };
    }

    rewind(ticks: number): boolean {
        if (this.resyncFailed) {
            return false;
        }
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
     * A lost bay fighter's round back to its carrier's bay (issue #258,
     * escorts/bay_plugin.ts applyRefundFighter). Stages the bay wëap
     * first — the refund's ceiling reads it from this worker's own
     * cache — the same closure loadInputRecordsGameData stages for every
     * other world applying the record.
     */
    async refundFighter(refund: FighterRefund) {
        await loadWeaponsGameData(this.world, [refund.bayWeaponId]);
        this.schedule({ kind: 'refundFighter', refund });
    }

    /**
     * An in-flight mission acceptance (mission_accept.ts). Stages the
     * mission's special/aux ships BEFORE scheduling, exactly as addEntity
     * stages its single one — applying (and replaying) the input has to
     * be synchronous, so every entity's game-data closure must already be
     * loaded when the record lands.
     */
    async acceptMission(accepted: AcceptedMission) {
        // The ships' game-data references resolve during the decode
        // (core/game_data_ref.ts): stage them first.
        await stageEncodedComponentsGameData(this.simulationGameData,
            (accepted.ships ?? []).map(ship => (ship.entity as EncodedEntity).components));
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
        // record lands — and so is the class an OnAccept `Cxxx` / `Exxx`
        // / `Hxxx` changes the player to. Same closure
        // loadInputRecordsGameData stages for every other world applying
        // this record.
        await loadSetStringEffectsGameData(this.world, accepted);
        this.schedule({ kind: 'acceptMission', accepted });
    }

    /**
     * An in-flight mission refusal whose OnRefuse did something
     * (mission_accept.ts RefusedMissionType). Stages what the result
     * names — granted outfits, the class a change of ship goes to —
     * BEFORE scheduling, as acceptMission does, so applying it (and
     * replaying it) is synchronous.
     */
    async refuseMission(refused: RefusedMission) {
        await loadSetStringEffectsGameData(this.world, refused);
        this.schedule({ kind: 'refuseMission', refused });
    }

    snapshot(): SimulationFrame {
        if (this.resyncFailed) {
            // Frozen (#333): no state ever leaves the genesis world the
            // failed recovery left behind, so the display holds the last
            // real frame. The failure itself is announced exactly once.
            const announce = !this.resyncFailureReported;
            this.resyncFailureReported = true;
            return {
                added: [], changed: [], removed: [], events: [],
                ...(announce ? { resyncFailed: true } : {}),
            };
        }
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
        // The entity's game-data references (ShipData & co., see
        // core/game_data_ref.ts) resolve during the decode: stage them
        // in THIS world's cache first — the display side warming its
        // own does not warm the worker's.
        await stageEncodedComponentsGameData(this.simulationGameData, [entity.components]);
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
