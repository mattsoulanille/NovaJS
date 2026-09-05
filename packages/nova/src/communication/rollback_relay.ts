import { Communicator } from "nova_ecs/plugins/multiplayer_plugin";
import { Subscription } from "rxjs";
import { warnThrottled } from "../common/log_throttle.js";
import { SIMULATION_STEP_MS } from "../nova_plugin/make_system.js";
import { ArchiveBaseline, canonicalDesyncHash, DesyncDump, InputRecord, PROTOCOL_VERSION, STATE_HASH_INTERVAL, unwrapRollbackMessage, wrapRollbackMessage } from "./rollback_protocol.js";

/** Everything the relay knows about a convicted desync, for the
 * incident recorder. */
export interface DesyncInfo {
    tick: number;
    hashes: [string, string][];
    canonical: string;
    /** Peers whose mismatch streak crossed the threshold this tick. */
    convicted: string[];
    /** True when the timely majority outvoted the archive's hash. */
    archiveOutvoted: boolean;
    /** Each reporter's protocol version from its join request; 0 for
     * peers that never sent one (a build predating versioning — the
     * stale-cached-bundle signature). */
    peerProtocols: Record<string, number>;
}

/**
 * The server's role in rollback multiplayer: not a simulation
 * authority, but the room's input relay, tick clock, and input
 * archive.
 *
 * - Relay: forwards each peer's tick-stamped input records to the
 *   other peers, stamping the sender's identity and clamping the tick
 *   so nobody can inject inputs into the past.
 * - Clock: advances the canonical tick at the fixed simulation rate
 *   and broadcasts it periodically so peers can pace themselves.
 * - Archive: retains the input log and serves it to late joiners.
 */
/**
 * How long (in ticks) an incomplete set of state-hash reports waits
 * for stragglers before being compared as-is and dropped.
 */
const STATE_HASH_SWEEP_TICKS = 600;

/**
 * A peer is convicted of desync only after this many *consecutive*
 * mismatched checkpoints. A rollback correction that lands deeper
 * than the settle margin makes every peer's already-sent report
 * describe the abandoned timeline — a false positive that corrects
 * itself by the next checkpoint. Real divergence persists.
 */
const DEFAULT_DESYNC_THRESHOLD = 3;

/**
 * A checkpoint report arriving more than this many ticks after its
 * checkpoint comes from a client running well behind the room's
 * clock (a throttled tab, an overloaded machine). Such reports are
 * still compared — a stale client can be convicted — but they get no
 * vote in what the canonical state is.
 */
const TIMELY_REPORT_TICKS = 240;

export class RollbackRelay {
    tick = 0;
    private log: InputRecord[] = [];
    /** Peers' state-hash reports awaiting comparison, by tick. */
    private stateHashes =
        new Map<number, Map<string, { hash: string, arrivedAt: number }>>();
    private getBaseline?: () => ArchiveBaseline | undefined;
    private getFreshBaseline?: () => ArchiveBaseline | undefined;
    private getReferenceHash?: (tick: number) => string | undefined;
    private readonly desyncThreshold: number;
    private onArchiveOutvoted?: (tick: number) => void;
    private onDesync?: (info: DesyncInfo) => void;
    private onDesyncDump?: (peerId: string, dump: DesyncDump) => void;
    /** Consecutive mismatched checkpoints per reporter. */
    private mismatchStreaks = new Map<string, number>();
    /** Protocol versions peers declared at join (0 = never declared). */
    private peerProtocols = new Map<string, number>();
    /**
     * Peers whose state history the incident recorder is waiting for:
     * everyone a desync broadcast named as diverged (they push a dump
     * unprompted) plus anyone explicitly asked. A dump from anyone
     * else is dropped — an unsolicited dump is the largest message a
     * client can send, written to disk by the recorder, and nothing
     * legitimate ever sends one.
     */
    private dumpsExpected = new Set<string>();
    private readonly subscription: Subscription;
    private clockInterval?: ReturnType<typeof setInterval>;
    private syncInterval?: ReturnType<typeof setInterval>;
    private lastClockTime?: number;
    private clockDebt = 0;

    private leaveSubscription: Subscription;

    constructor(private room: Communicator,
        { autoClock = true, stepMs = SIMULATION_STEP_MS, baseline,
            freshBaseline, referenceHash, onArchiveOutvoted, onDesync,
            onDesyncDump,
            desyncThreshold = DEFAULT_DESYNC_THRESHOLD }: {
                autoClock?: boolean, stepMs?: number,
                /** The newest archived baseline, when an archive runs. */
                baseline?: () => ArchiveBaseline | undefined,
                /** A baseline captured on demand from the archive's
                 * live world, for `fresh` join requests (resyncs):
                 * the log tail over it is seconds shorter than over
                 * the periodic baseline, making recovery cheap. */
                freshBaseline?: () => ArchiveBaseline | undefined,
                /** The archive sim's hash at a checkpoint tick: the
                 * true simulation's vote in desync comparisons. */
                referenceHash?: (tick: number) => string | undefined,
                /** Consecutive mismatched checkpoints before a desync
                 * broadcast (1 = convict immediately). */
                desyncThreshold?: number,
                /** Called when unanimous peers outvote the archive:
                 * the hook for dumping archive-side diagnostics. */
                onArchiveOutvoted?: (tick: number) => void,
                /** Called on each conviction, with everything the
                 * incident recorder needs from the relay's side. */
                onDesync?: (info: DesyncInfo) => void,
                /** Called when a peer uploads its state history (its
                 * own conviction, or a desyncDumpRequest). */
                onDesyncDump?: (peerId: string, dump: DesyncDump) => void,
            } = {}) {
        this.getBaseline = baseline;
        this.getFreshBaseline = freshBaseline;
        this.getReferenceHash = referenceHash;
        this.desyncThreshold = desyncThreshold;
        this.onArchiveOutvoted = onArchiveOutvoted;
        this.onDesync = onDesync;
        this.onDesyncDump = onDesyncDump;
        this.subscription = room.messages.subscribe(({ source, message }) => {
            this.handleMessage(source, message);
        });
        // A disconnect is an input: the server authors a removePeer
        // record so every peer (and the log) deterministically removes
        // the ship.
        this.leaveSubscription = room.peers.leave.subscribe(peerId => {
            const record: InputRecord = {
                peerId: this.room.uuid,
                tick: this.tick + 1,
                inputs: [{ kind: 'removePeer', peerId }],
            };
            this.log.push(record);
            this.room.sendMessage(
                wrapRollbackMessage({ kind: 'inputs', record }));
            // Per-peer bookkeeping is keyed by socket uuid, which is
            // fresh on every reconnect: forget the departed.
            this.mismatchStreaks.delete(peerId);
            this.peerProtocols.delete(peerId);
            this.dumpsExpected.delete(peerId);
        });

        if (autoClock) {
            this.lastClockTime = performance.now();
            this.clockInterval = setInterval(() => {
                const now = performance.now();
                this.clockDebt = Math.min(
                    this.clockDebt + (now - this.lastClockTime!), stepMs * 600);
                this.lastClockTime = now;
                const ticks = Math.floor(this.clockDebt / stepMs);
                this.clockDebt -= ticks * stepMs;
                this.advanceTicks(ticks);
            }, stepMs);
            // (Stale and held hash reports are swept by advanceTicks,
            // which the clock drives.)
            this.syncInterval = setInterval(() => {
                this.room.sendMessage(
                    wrapRollbackMessage({ kind: 'tickSync', tick: this.tick }));
            }, 1000);
        }
    }

    advanceTicks(ticks: number) {
        this.tick += ticks;
        // Retry comparisons held for a trailing archive hash, and
        // force ones whose stragglers never reported.
        for (const tick of [...this.stateHashes.keys()]) {
            this.compareStateHashes(tick,
                tick < this.tick - STATE_HASH_SWEEP_TICKS);
        }
    }

    get inputLog(): readonly InputRecord[] {
        return this.log;
    }

    /** How many checkpoint ticks have reports awaiting comparison
     * (diagnostics / memory-bound specs). */
    get pendingStateHashTicks(): number {
        return this.stateHashes.size;
    }

    /**
     * Drops records at or before `uptoTick` — safe once an archived
     * baseline at that tick exists, since reconstruction starts there.
     * Bounds the log's memory for long-lived rooms.
     */
    trimLog(uptoTick: number) {
        this.log = this.log.filter(record => record.tick > uptoTick);
    }

    /** The room's peers, excluding the relay itself. */
    private roomPeers(): Set<string> {
        const peers = new Set(this.room.peers.current.value);
        if (this.room.uuid) {
            peers.delete(this.room.uuid);
        }
        return peers;
    }

    private otherPeers(exclude: string): Set<string> {
        const peers = this.roomPeers();
        peers.delete(exclude);
        return peers;
    }

    /**
     * Compares a tick's state-hash reports once every current peer has
     * reported (or immediately, when forced by the stale sweep). On
     * mismatch, broadcasts a desync notification; the diverged peers
     * recover by resimulating the input log.
     */
    private compareStateHashes(tick: number, force = false) {
        const reports = this.stateHashes.get(tick);
        if (!reports) {
            return;
        }
        const reference = this.getReferenceHash?.(tick);
        if (!force) {
            for (const peer of this.roomPeers()) {
                if (!reports.has(peer)) {
                    return;
                }
            }
            // The archive trails the clock by up to its update
            // interval; comparing before its hash exists would count
            // a lone peer as self-agreement and reset its mismatch
            // streak. Hold the reports — advanceTicks retries, and
            // the sweep eventually forces a verdict regardless.
            if (this.getReferenceHash && reference === undefined) {
                return;
            }
        }
        this.stateHashes.delete(tick);

        // Only timely reports vote on the canonical state: a report
        // this far behind the room's clock comes from a throttled or
        // overloaded client, whose word shouldn't decide who resyncs.
        // (Stale reporters are still compared, and convicted, below.)
        // The archive's hash always joins as a standing witness: it
        // breaks two-peer ties (a tie-break alone can crown the
        // diverged peer canonical, making the divergence permanent),
        // and it convicts a lone diverged peer whose roommates report
        // nothing at all.
        const voters: [string, string][] = [...reports]
            .filter(([, report]) => report.arrivedAt - tick <= TIMELY_REPORT_TICKS)
            .map(([peerId, report]) => [peerId, report.hash]);
        const allHashes: [string, string][] = [...reports]
            .map(([peerId, report]) => [peerId, report.hash]);
        if (reference !== undefined && this.room.uuid) {
            voters.push([this.room.uuid, reference]);
            allHashes.push([this.room.uuid, reference]);
        }
        if (new Set(allHashes.map(([, hash]) => hash)).size <= 1) {
            for (const [peerId] of allHashes) {
                this.mismatchStreaks.delete(peerId);
            }
            return;
        }
        const canonical = canonicalDesyncHash(voters,
            this.room.uuid ? new Set([this.room.uuid]) : undefined);
        if (canonical === undefined) {
            // Nothing but stale reports and no archive: no one to
            // trust, so no verdict.
            return;
        }
        // Convict only after `desyncThreshold` consecutive mismatched
        // checkpoints: a rollback correction landing deeper than the
        // settle margin makes already-sent reports describe the
        // abandoned timeline — a false positive gone by the next
        // checkpoint. Real divergence keeps the streak alive.
        const convicted: string[] = [];
        for (const [peerId, hash] of allHashes) {
            if (hash === canonical) {
                this.mismatchStreaks.delete(peerId);
                continue;
            }
            const streak = (this.mismatchStreaks.get(peerId) ?? 0) + 1;
            this.mismatchStreaks.set(peerId, streak);
            if (streak >= this.desyncThreshold) {
                convicted.push(peerId);
                this.mismatchStreaks.delete(peerId);
            }
        }
        if (convicted.length === 0) {
            return;
        }
        console.log(`Desync at tick ${tick} (canonical ${canonical}):`,
            Object.fromEntries(allHashes));
        const archiveOutvoted =
            reference !== undefined && canonical !== reference;
        // The timely majority outvoting the archive means the
        // *archive* has diverged — and every baseline it captures from
        // here on reconstructs the wrong world. Loud, because recovery
        // (rebuilding the archive) is not automatic yet.
        if (archiveOutvoted) {
            console.error(
                `Archive diverged from all peers at tick ${tick}`);
            this.onArchiveOutvoted?.(tick);
            // The convicted party is the server's own sim, which the
            // incident record can already reconstruct — what it lacks
            // is a canonical *reference*. Ask one healthy timely peer
            // for its state history.
            const healthy = voters.find(([peerId, hash]) =>
                hash === canonical && peerId !== this.room.uuid);
            if (healthy) {
                this.dumpsExpected.add(healthy[0]);
                this.room.sendMessage(wrapRollbackMessage(
                    { kind: 'desyncDumpRequest' }), healthy[0]);
            }
        }
        // Every peer the broadcast shows off-canonical uploads its
        // history unprompted on seeing it (simulation_bridge.ts
        // handleDesync) — not only the convicted ones, whose streak
        // merely crossed the threshold first. Expect exactly those.
        for (const [peerId, hash] of allHashes) {
            if (hash !== canonical && peerId !== this.room.uuid) {
                this.dumpsExpected.add(peerId);
            }
        }
        this.onDesync?.({
            tick, hashes: allHashes, canonical, convicted, archiveOutvoted,
            peerProtocols: Object.fromEntries(allHashes.map(([peerId]) =>
                [peerId, this.peerProtocols.get(peerId)
                    ?? (peerId === this.room.uuid ? PROTOCOL_VERSION : 0)])),
        });
        this.room.sendMessage(wrapRollbackMessage({
            kind: 'desync', tick, hashes: allHashes, canonical,
        }));
        // Fallback for lost dump pushes: convicted peers upload
        // unprompted on seeing the desync, but if that push never
        // arrives (it happened for a whole session), the incident is
        // evidence-free. An explicit request costs one message; peers
        // that just pushed ignore it (dump dedupe).
        for (const peerId of convicted) {
            if (peerId !== this.room.uuid) {
                this.room.sendMessage(wrapRollbackMessage(
                    { kind: 'desyncDumpRequest' }), peerId);
            }
        }
    }

    private handleMessage(source: string, raw: unknown) {
        // Validated: a malformed envelope is dropped here, never
        // dereferenced (one used to throw inside this subscriber and
        // take the server process down — rxjs rethrows on a macrotask).
        const message = unwrapRollbackMessage(raw);
        if (!message) {
            return;
        }
        // Trust model item 3 (rollback_protocol.ts): only room MEMBERS
        // speak here. The room filter upstream keys
        // on the room name alone, so a socket that never sent `inRoom`
        // for this room could otherwise log inputs into it (which are
        // then relayed, archived, and replayed to every joiner).
        if (!this.roomPeers().has(source)) {
            warnThrottled(`relay-nonmember:${source}`, () =>
                `Dropping ${message.kind} from ${source}: not in this room`);
            return;
        }
        switch (message.kind) {
            case 'inputs': {
                // Stamp identity and clamp time: peers cannot speak for
                // others or inject inputs into the past.
                const record: InputRecord = {
                    peerId: source,
                    tick: Math.max(message.record.tick, this.tick + 1),
                    ...(message.record.seq !== undefined
                        ? { seq: message.record.seq } : {}),
                    inputs: message.record.inputs,
                };
                this.log.push(record);
                const others = this.otherPeers(source);
                if (others.size > 0) {
                    this.room.sendMessage(
                        wrapRollbackMessage({ kind: 'inputs', record }), others);
                }
                // A clamped record was retimed for the whole room —
                // echo it to the sender too, who applied it at the
                // stale tick and must move it, or the sender's own
                // timeline silently forks from the log.
                if (record.tick !== message.record.tick) {
                    this.room.sendMessage(
                        wrapRollbackMessage({ kind: 'inputs', record }),
                        source);
                }
                break;
            }
            case 'joinRequest': {
                const protocol = message.protocol ?? 0;
                this.peerProtocols.set(source, protocol);
                if (protocol !== PROTOCOL_VERSION) {
                    // A version-mismatched peer WILL desync no matter
                    // how healthy the netcode is. Loud, and stamped
                    // into any incident this peer causes.
                    //
                    // This check is FORENSIC and, since the build-version
                    // handshake landed, should now be unreachable in
                    // production: a peer only gets here after being
                    // admitted by SocketChannelServer, which refuses any
                    // client whose BUILD stamp differs from the server's
                    // (see src/common/version_handshake.ts). The handshake
                    // PREVENTS the skew this can only OBSERVE -- by the
                    // time a joinRequest arrives, a mismatched build has
                    // already been in a position to desync. Kept anyway:
                    // it is the last line of defense if a peer reaches the
                    // relay by some path that bypasses the socket gate,
                    // and `peerProtocols` still stamps every incident
                    // record. If this warning ever fires now, the
                    // handshake itself is the thing to suspect.
                    console.warn(`Peer ${source} joined with protocol `
                        + `${protocol || 'none (pre-versioning build — '
                        + 'stale cached bundle?)'}; server has `
                        + `${PROTOCOL_VERSION}`);
                }
                // With an archived baseline, reconstruction starts
                // there: only the log tail after it is needed. A
                // fresh request (resync) gets a baseline captured
                // now, shrinking the tail to the transit window.
                const baseline = (message.fresh
                    ? this.getFreshBaseline?.() : undefined)
                    ?? this.getBaseline?.();
                this.room.sendMessage(wrapRollbackMessage({
                    kind: 'catchUp',
                    tick: this.tick,
                    records: baseline
                        ? this.log.filter(record => record.tick > baseline.tick)
                        : [...this.log],
                    ...(baseline ? { baseline } : {}),
                }), source);
                break;
            }
            case 'stateHash': {
                // A bucket lives until every member reports it or the
                // sweep passes it, so a tick nobody else will ever
                // report — off the checkpoint grid, or far enough in
                // the future that the sweep is ages away — was a
                // permanent Map entry per distinct value. Peers hash
                // only checkpoint ticks they have already SETTLED (30
                // ticks behind their own clock, which leads the relay's
                // by ~4), so a legitimate report is always at or behind
                // the relay clock; the margin only spares a joiner's
                // replayed checkpoints and clock jitter.
                if (message.tick % STATE_HASH_INTERVAL !== 0
                    || message.tick > this.tick + STATE_HASH_SWEEP_TICKS) {
                    warnThrottled(`relay-statehash:${source}`, () =>
                        `Dropping stateHash for tick ${message.tick} from `
                        + `${source}: not a reachable checkpoint (relay `
                        + `tick ${this.tick})`);
                    break;
                }
                let reports = this.stateHashes.get(message.tick);
                if (!reports) {
                    reports = new Map();
                    this.stateHashes.set(message.tick, reports);
                }
                reports.set(source,
                    { hash: message.hash, arrivedAt: this.tick });
                this.compareStateHashes(message.tick);
                break;
            }
            case 'desyncDump': {
                if (!this.dumpsExpected.delete(source)) {
                    warnThrottled(`relay-dump:${source}`, () =>
                        `Dropping unsolicited desync dump from ${source}`);
                    break;
                }
                this.onDesyncDump?.(source, message.dump);
                break;
            }
            case 'inputLogRequest': {
                this.room.sendMessage(wrapRollbackMessage({
                    kind: 'inputLog',
                    records: this.log.filter(record => record.tick >= message.fromTick),
                }), source);
                break;
            }
            // 'tickSync' and 'inputLog' are server -> peer only.
        }
    }

    close() {
        this.subscription.unsubscribe();
        this.leaveSubscription.unsubscribe();
        if (this.clockInterval !== undefined) {
            clearInterval(this.clockInterval);
        }
        if (this.syncInterval !== undefined) {
            clearInterval(this.syncInterval);
        }
    }
}
