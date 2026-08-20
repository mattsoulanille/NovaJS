import { WireWorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { InputRecord } from "./simulation_input.js";

export { InputRecord } from "./simulation_input.js";

/** A wire snapshot of the room's state at a tick: the starting point
 * for reconstruction, in place of replaying from genesis. */
export interface ArchiveBaseline {
    tick: number;
    snapshot: WireWorldSnapshot;
}

/**
 * Peers hash their world every this many ticks for desync detection.
 * The server's archive sim hashes the same ticks, so it can vote.
 */
export const STATE_HASH_INTERVAL = 60;

/**
 * Bumped whenever the rollback protocol or the simulation's
 * determinism-relevant behavior changes. A peer joining with a
 * different version (or none — a build predating versioning, e.g. a
 * browser serving a stale cached bundle against a new server) WILL
 * desync no matter how healthy the netcode is; the relay logs the
 * mismatch and incident records carry every reporter's version, so
 * "stale client build" stops masquerading as a netcode mystery.
 *
 * NOT the same thing as the BUILD version, and not the enforcement
 * point. This is a hand-maintained number describing the wire protocol,
 * and it is only read after a peer has already joined. The stale-cached-
 * bundle case it describes is now caught earlier and automatically, by
 * the build-version handshake in src/common/version_handshake.ts: the
 * server refuses any client whose build stamp differs from its own, so
 * such a client never reaches this code. Keep bumping this when the
 * protocol changes -- it remains the label on incident records -- but
 * rely on the handshake, not on this, to keep builds from mixing.
 */
// 3: escortAction input (release / sell / upgrade an escort).
// 4: escortAction's sell/upgrade became DEFERRED — the immediate
//    'sellEscort' / 'upgradeEscort' kinds were replaced by the queue
//    toggles 'queueSale' / 'cancelSale' / 'queueUpgrade' / 'cancelUpgrade'
//    (nova_plugin/escort_action.ts), and PlayerEscort gained the
//    pendingUpgrade / pendingSale fields the toggles write.
export const PROTOCOL_VERSION = 4;

/**
 * One notable event in a peer's rollback machinery, for the black-box
 * ring included in desync dumps: state alone shows *what* diverged,
 * the rollback log shows *how the peer got there* (late records,
 * rollback depths, joins, resyncs).
 */
export interface RollbackLogEntry {
    /** e.g. 'rollback', 'lateRecord', 'join', 'resync', 'rewind'. */
    event: string;
    /** The peer's local tick when it happened. */
    atTick: number;
    /** Event-specific context (target ticks, record counts...). */
    detail?: Record<string, number | string>;
}

/**
 * A peer's state history around a desync, uploaded to the server for
 * offline analysis (see analyze_desync.mjs): full wire snapshots at
 * its recent checkpoint ticks, plus the rollback event log.
 */
export interface DesyncDump {
    /** The peer's tick when the dump was captured. */
    tick: number;
    /** The convicted checkpoint, when a desync triggered the dump. */
    desyncTick?: number;
    /** What simulated this: user agent or node version. */
    engine: string;
    checkpoints: { tick: number, snapshot: WireWorldSnapshot }[];
    rollbackLog: RollbackLogEntry[];
}

/**
 * Rollback protocol messages travel on the same room channel as the
 * legacy multiplayer messages, wrapped in a `rollback` envelope. The
 * legacy Message codec is a t.partial, so it decodes these as empty
 * messages and ignores them; likewise this side ignores everything
 * without the envelope.
 */
export type RollbackProtocolMessage =
    | { kind: 'inputs', record: InputRecord }
    /** The server's clock, broadcast periodically. */
    | { kind: 'tickSync', tick: number }
    /** Ask the server for the input log from a tick (late join). */
    | { kind: 'inputLogRequest', fromTick: number }
    | { kind: 'inputLog', records: InputRecord[] }
    /** Join: the input log up to the server's current tick, plus the
     * newest archived baseline when the server has one. The joiner
     * replays the log over the baseline (or the deterministic genesis
     * world when there is none). `fresh` asks for a baseline captured
     * NOW instead of the last periodic one: a resync replaying a
     * ~30s-stale baseline's log tail costs 1-2s of blocked rebuild,
     * while a fresh baseline's tail is just the transit window. */
    | { kind: 'joinRequest', fresh?: boolean, protocol?: number }
    | {
        kind: 'catchUp', tick: number, records: InputRecord[],
        baseline?: ArchiveBaseline,
    }
    /** A peer's world hash for a settled tick (peer -> server). */
    | { kind: 'stateHash', tick: number, hash: string }
    /** The relay saw peers disagree about a tick's state
     * (server -> everyone). Non-canonical peers resync. `canonical`
     * is the relay's verdict, computed from timely voters only —
     * reports from clients running far behind the room's clock are
     * compared (and convicted) but get no vote. */
    | {
        kind: 'desync', tick: number, hashes: [string, string][],
        canonical?: string,
    }
    /** Ask a peer for its state history (server -> peer). Sent to a
     * healthy peer when the archive itself is outvoted, so the
     * incident record includes a canonical reference state. */
    | { kind: 'desyncDumpRequest' }
    /** A peer's state history for the incident record (peer ->
     * server). Diverged peers push this unprompted on conviction,
     * before resyncing discards the evidence. */
    | { kind: 'desyncDump', dump: DesyncDump };

export function wrapRollbackMessage(message: RollbackProtocolMessage): unknown {
    return { rollback: message };
}

export function unwrapRollbackMessage(raw: unknown): RollbackProtocolMessage | undefined {
    const envelope = raw as { rollback?: RollbackProtocolMessage } | undefined;
    return envelope?.rollback;
}

/**
 * Which hash in a desync report is the true state: the input log
 * deterministically defines it, but nobody simulated the log twice
 * client-side, so the report votes. The most common hash wins; ties
 * break first toward a `preferred` reporter (the server, whose archive
 * sim *is* the log's true simulation), then toward the lowest peerId.
 * Every peer computes the same answer from the same report, so exactly
 * the diverged minority resyncs.
 */
export function canonicalDesyncHash(hashes: [string, string][],
    preferred?: ReadonlySet<string>): string | undefined {
    const groups = new Map<string, string[]>();
    for (const [peerId, hash] of hashes) {
        groups.set(hash, [...(groups.get(hash) ?? []), peerId]);
    }
    let best: {
        hash: string, count: number,
        preferred: boolean, lowestPeer: string,
    } | undefined;
    for (const [hash, peers] of groups) {
        const candidate = {
            hash,
            count: peers.length,
            preferred: peers.some(peer => preferred?.has(peer) ?? false),
            lowestPeer: [...peers].sort()[0]!,
        };
        const wins = !best
            || candidate.count > best.count
            || (candidate.count === best.count && (
                (candidate.preferred && !best.preferred)
                || (candidate.preferred === best.preferred
                    && candidate.lowestPeer < best.lowestPeer)));
        if (wins) {
            best = candidate;
        }
    }
    return best?.hash;
}
