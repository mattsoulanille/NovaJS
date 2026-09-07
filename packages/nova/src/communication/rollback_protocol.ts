import { isLeft } from "fp-ts/lib/Either.js";
import * as t from 'io-ts';
import { formatIoTsErrors } from "nova_ecs/plugins/serializer_plugin";
import { WireWorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { warnThrottled } from "../common/log_throttle.js";
import { InputRecord, InputRecordType, WireTick } from "./simulation_input.js";

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
//    (nova_plugin/escorts/escort_action.ts), and PlayerEscort gained the
//    pendingUpgrade / pendingSale fields the toggles write.
// 5: the trust model (the "Trust model" section below). Validation,
//    membership, server-only acceptance and sim-side AUTHORISATION of
//    entity-level inputs. The last is determinism-relevant — a v4 peer
//    applies a forged removeEntity that a v5 peer drops — hence the
//    bump; the wire SHAPES are unchanged.
//    Also under 5, no further bump (both composed with it in the same
//    wave, and both are additive on the shapes the strict codecs accept):
//    - acceptMission's `accepted` gained the OPTIONAL missionsStarted /
//      missionsEnded / recordsDelta fields (nova_plugin/missions/mission_accept.ts;
//      an older record simply carries none of them), and
//    - wire snapshots carry the `$negzero` / `$nonfinite` sentinels
//      (nova_ecs snapshot_plugin toJsonSafe) so a joiner restores the
//      exact -0 / NaN bits the room holds, which hashWorld now
//      distinguishes from +0 / finite — a desync report between peers
//      that differ only there is real, not a hash artifact.
// 6: collision geometry (ruling #207): sprite frames with fewer than four
//    opaque pixels get a real convex hull (a point, a segment or a
//    counterclockwise triangle) instead of the sorted pixel list; the
//    hashed hulls of 81 stock frames changed (novaparse
//    sprite_sheet_multi_parse's makeConvexHull; the stock digest in
//    sprite_sheet_stock_identity_test was rebaselined). Also under 6, no
//    further bump: BoardingState's `capture` lost the 'refused' literal
//    (#250), a value only ever carried inside a session.
// 7: the wire is Avro BINARY (wire_codec.ts, avro_binary.ts): every
//    socket frame is the derived schema's encoding of the typed
//    envelope (wire_schemas.ts WireMessageType), never JSON text — a
//    text frame is refused with close code 1003. joinRequest gained the
//    OPTIONAL `schema` (the wire schema's CRC-64-AVRO fingerprint; a
//    relay answers a mismatch with the new `joinRefused` kind). And the
//    seven game-data components (ShipData, PlanetData, ProjectileData,
//    BeamData, ExplosionData, AnimationComponent — as references to the
//    peer's own game data — and BeamState, as its real shape) changed
//    their ENCODED form (nova_plugin/core/game_data_ref.ts), which every
//    input record, baseline and state hash carries.
export const PROTOCOL_VERSION = 7;

/**
 * ============================================================================
 * Trust model
 * ============================================================================
 *
 * The single statement of who may say what and who checks it; the code
 * comments at each enforcement point refer here by item number. The
 * server is trusted. A client is not: anyone holding the current build
 * stamp (served publicly at /version) can open a socket and speak this
 * protocol, so every property below must hold against a hostile client.
 *
 *  1. IDENTITY is stamped by the relay. Whatever `peerId` a record
 *     carries on the wire is discarded: the relay (rollback_relay.ts)
 *     overwrites it with the socket uuid the record arrived on and
 *     clamps its tick into the future. No client can speak for another
 *     peer, or into the past.
 *
 *  2. SHAPE is validated at every receiving boundary, before anything
 *     is dereferenced: RollbackProtocolMessageType (this file) and
 *     InputRecordType / SimulationInputType (simulation_input.ts) via
 *     unwrapRollbackMessage. What fails to decode is dropped with a
 *     rate-limited warning (common/log_throttle.ts). Unknown fields are
 *     stripped, so junk is never logged, relayed or archived. Below the
 *     protocol, SocketChannelServer survives unparseable and
 *     invalid-UTF-8 frames and bounds the frame size.
 *
 *  3. The RELAY listens to ROOM MEMBERS only (sockets that sent
 *     `inRoom` for that room); takes stateHash reports only for
 *     checkpoint-aligned ticks at or near its own clock; and takes a
 *     desyncDump only from a peer it convicted or asked (the recorder
 *     then bounds what it writes and where: server/desync_recorder.ts).
 *     Client-to-client delivery does not exist: CommunicatorServer
 *     delivers a client's message to the server alone, whatever
 *     destination the client named. The relay is the single fan-out.
 *
 *  4. A CLIENT accepts rollback-protocol messages — inputs, inputLog,
 *     tickSync, catchUp, desync, desyncDumpRequest — only from a source
 *     in `communicator.servers` (simulation_bridge.ts). Every
 *     legitimate one is relay-originated, so an input record is only
 *     ever applied with a relay-stamped peerId (or none, in local play
 *     before any connection exists).
 *
 *  5. OWNERSHIP is enforced when a record is APPLIED, deterministically
 *     (simulation_input.ts). A peer owns its player ship and every
 *     entity it inserted — hired and carried escorts, mission ships,
 *     the NPCs it spawned — i.e. the entities whose ControlledBy.peerId
 *     or MultiplayerData.owner is that peer (browser.ts and the bridge
 *     stamp each of those with the client's uuid; bay-launched fighters
 *     inherit their carrier's owner). removeEntity, and addEntity over
 *     an existing uuid, need ownership of the target; a fresh addEntity
 *     may not declare another peer as controller or owner; removePeer
 *     is accepted only from a server uuid; nothing peer-authored may
 *     name the singleton. A server-stamped record, and a record with no
 *     peerId, is exempt. Every check reads only synced state plus the
 *     stamped peer, so all peers drop or apply the same input on the
 *     same tick — the drop is itself deterministic.
 *
 * Deliberately NOT covered: the CONTENT of a peer's own inputs. A peer
 * may insert whatever it likes as its own (a hull with absurd stats,
 * an escort it never paid for). The rollback rooms are an input
 * exchange with integrity, not an anti-cheat layer; that would need a
 * server-authoritative economy, which is out of scope here.
 */

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
    /**
     * Ask the server for the input log from a tick; answered with an
     * `inputLog`, which the bridge integrates record by record. DORMANT
     * ON THE WIRE: no shipped client sends the request — late join and
     * resync both go through `joinRequest`/`catchUp`, which carry a
     * baseline as well as the log. The pair is kept as the log-only
     * resync path the bridge already understands (simulation_bridge.ts)
     * and the relay tests exercise; it exposes nothing `joinRequest`
     * does not (the same log, to a room member only, server-stamped).
     * Removing it is a protocol change: bump PROTOCOL_VERSION with it.
     */
    | { kind: 'inputLogRequest', fromTick: number }
    | { kind: 'inputLog', records: InputRecord[] }
    /** Join: the input log up to the server's current tick, plus the
     * newest archived baseline when the server has one. The joiner
     * replays the log over the baseline (or the deterministic genesis
     * world when there is none). `fresh` asks for a baseline captured
     * NOW instead of the last periodic one: a resync replaying a
     * ~30s-stale baseline's log tail costs 1-2s of blocked rebuild,
     * while a fresh baseline's tail is just the transit window. */
    /** `schema`: the joiner's wire-schema fingerprint (wire_schemas.ts
     * liveWireFingerprint), so a relay built from a different schema
     * refuses the join instead of misreading every frame. Absent from a
     * peer whose wire is not schema'd. */
    | { kind: 'joinRequest', fresh?: boolean, protocol?: number, schema?: string }
    /** The relay will not serve this joiner: its wire schema differs
     * (server -> peer). The peer gives up the join; nothing it sent
     * would have decoded alike on both ends. */
    | { kind: 'joinRefused', reason: string }
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

/**
 * ============================================================================
 * Wire validation
 * ============================================================================
 *
 * `unwrapRollbackMessage` used to be a cast: `{rollback:{kind:'inputs'}}`
 * (no record) threw a TypeError inside an rxjs subscriber, which rxjs 7
 * rethrows on a macrotask — an uncaught exception, i.e. the server
 * process exiting on one message from any admitted client. Everything
 * the relay and the bridge act on now decodes through these codecs
 * first; a failure is dropped (and warned about, rate-limited so the
 * drop path is not itself a log flood).
 *
 * The snapshot-bearing messages (catchUp, desyncDump) are validated
 * STRUCTURALLY — entity/component tuple shapes, not component contents,
 * which the serializer decodes with its own codecs on restore. A full
 * deep decode of a megabyte baseline on every join would cost more
 * than it protects; both messages are server-trusted or gated by the
 * relay anyway (see simulation_bridge.ts and rollback_relay.ts).
 */

const WireComponentType = t.tuple([
    t.string, t.unknown, t.union([t.literal('serializer'), t.literal('wire')]),
]);

const WireEntityType = t.intersection([
    t.type({
        uuid: t.string,
        components: t.array(WireComponentType),
    }),
    t.partial({ name: t.string }),
]);

const WireWorldSnapshotType: t.Type<WireWorldSnapshot, unknown> = t.type({
    entities: t.array(WireEntityType),
    singleton: t.array(WireComponentType),
    resources: t.array(t.unknown),
});

const ArchiveBaselineType: t.Type<ArchiveBaseline, unknown> = t.type({
    tick: WireTick,
    snapshot: WireWorldSnapshotType,
});

const RollbackLogEntryType: t.Type<RollbackLogEntry, unknown> = t.intersection([
    t.type({ event: t.string, atTick: t.number }),
    t.partial({ detail: t.record(t.string, t.union([t.number, t.string])) }),
]);

export const DesyncDumpType: t.Type<DesyncDump, unknown> = t.intersection([
    t.type({
        tick: WireTick,
        engine: t.string,
        checkpoints: t.array(t.type({
            tick: WireTick,
            snapshot: WireWorldSnapshotType,
        })),
        rollbackLog: t.array(RollbackLogEntryType),
    }),
    t.partial({ desyncTick: WireTick }),
]);

export const RollbackProtocolMessageType: t.Type<RollbackProtocolMessage, unknown> =
    t.union([
        t.strict({ kind: t.literal('inputs'), record: InputRecordType }),
        t.strict({ kind: t.literal('tickSync'), tick: WireTick }),
        t.strict({ kind: t.literal('inputLogRequest'), fromTick: WireTick }),
        t.strict({ kind: t.literal('inputLog'), records: t.array(InputRecordType) }),
        t.exact(t.intersection([
            t.type({ kind: t.literal('joinRequest') }),
            t.partial({ fresh: t.boolean, protocol: t.number, schema: t.string }),
        ])),
        t.strict({ kind: t.literal('joinRefused'), reason: t.string }),
        t.exact(t.intersection([
            t.type({
                kind: t.literal('catchUp'),
                tick: WireTick,
                records: t.array(InputRecordType),
            }),
            t.partial({ baseline: ArchiveBaselineType }),
        ])),
        t.strict({ kind: t.literal('stateHash'), tick: WireTick, hash: t.string }),
        t.exact(t.intersection([
            t.type({
                kind: t.literal('desync'),
                tick: WireTick,
                hashes: t.array(t.tuple([t.string, t.string])),
            }),
            t.partial({ canonical: t.string }),
        ])),
        t.strict({ kind: t.literal('desyncDumpRequest') }),
        t.strict({ kind: t.literal('desyncDump'), dump: DesyncDumpType }),
    ]);

export function wrapRollbackMessage(message: RollbackProtocolMessage): unknown {
    return { rollback: message };
}

/**
 * The validated rollback message inside `raw`'s envelope, or undefined
 * when `raw` carries no envelope (legacy room traffic — silent) or a
 * malformed one (dropped with a rate-limited warning).
 */
export function unwrapRollbackMessage(raw: unknown): RollbackProtocolMessage | undefined {
    if (typeof raw !== 'object' || raw === null || !('rollback' in raw)) {
        return undefined;
    }
    const decoded = RollbackProtocolMessageType.decode(
        (raw as { rollback: unknown }).rollback);
    if (isLeft(decoded)) {
        warnThrottled('rollback-message-malformed', () =>
            'Dropping malformed rollback message: '
            + formatIoTsErrors(decoded.left).slice(0, 3).join('; '));
        return undefined;
    }
    return decoded.right;
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
