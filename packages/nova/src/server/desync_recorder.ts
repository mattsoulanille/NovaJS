import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { WireWorldSnapshot } from "nova_ecs/plugins/snapshot_plugin";
import { ArchiveBaseline, DesyncDump, InputRecord } from "../communication/rollback_protocol.js";
import { DesyncInfo } from "../communication/rollback_relay.js";

/** How many incident directories to retain before pruning the oldest. */
const DEFAULT_MAX_INCIDENTS = 50;

/**
 * Minimum spacing between recorded incidents for one room. A peer
 * stuck diverged (e.g. mid-resync on a slow link) is re-convicted
 * every few checkpoints; the first record has all the evidence and
 * the repeats are noise (one Android session wrote 17 directories).
 */
const DEFAULT_ROOM_COOLDOWN_MS = 30_000;

/**
 * Bounds on what peers can make this write. A dump is peer-supplied
 * bytes; without these, every distinct desyncTick a peer chose was
 * another file, as large as the socket frame limit, as fast as it
 * liked. The relay already drops dumps from peers it neither convicted
 * nor asked (rollback_relay.ts); these are the disk-side bounds for
 * the ones that get through.
 */
/** Dump files per incident directory (a stuck peer re-convicted every
 * few checkpoints legitimately writes a few). */
const DEFAULT_MAX_DUMPS_PER_INCIDENT = 8;
/** Bytes per dump: the socket layer's frame limit
 * (socket_channel_server.ts MAX_PAYLOAD_BYTES), restated here so the
 * recorder is safe on its own. */
const DEFAULT_MAX_DUMP_BYTES = 16 * 1024 * 1024;
/** Total dump bytes this recorder will write in its lifetime: the hard
 * disk-fill bound, whatever the incident count. */
const DEFAULT_MAX_TOTAL_DUMP_BYTES = 512 * 1024 * 1024;

/**
 * A stable fingerprint of the game data an incident was recorded
 * under. Offline analysis replays incidents against a game-data
 * source; if that source differs from what the live session used
 * (changed plugins, a different parse), every replay conclusion is
 * suspect — the analyzer compares fingerprints and warns loudly.
 */
export function fingerprintGameData(ids: unknown): string {
    return crypto.createHash('sha256')
        .update(JSON.stringify(ids)).digest('hex').slice(0, 16);
}

/** Room ids (nova:130) and peer uuids become filesystem-safe names. */
function sanitize(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * The server's black-box recorder for desyncs: each conviction gets a
 * timestamped directory under `desyncs/` holding everything offline
 * analysis (analyze_desync.mjs) needs to name the diverged entity,
 * component, and tick:
 *
 * - desync.json: the verdict — tick, all reported hashes, canonical,
 *   who was convicted, whether the archive itself was outvoted.
 * - baselines.json: the archive's retained wire baselines. Replaying
 *   the oldest over log.json reproduces the server's view of the room
 *   at any tick in the incident window.
 * - log.json: the relay's input log (the room's ground truth).
 * - client_<peer>.json: the convicted peer's uploaded state history
 *   (checkpoint wire snapshots + rollback event log), written when it
 *   arrives — moments after desync.json, since diverged peers upload
 *   before resyncing.
 */
export class DesyncRecorder {
    /** Set by the server once its game data loads (fingerprintGameData);
     * recorded with each incident so offline analysis can detect a
     * data mismatch before trusting a replay. */
    gameDataFingerprint?: string;
    /** Most recent incident directory per room, for filing uploads. */
    private latestIncident = new Map<string, string>();
    /** Wall time of the last recorded incident per room. */
    private lastRecorded = new Map<string, number>();
    /** Serializes writes so pruning never races directory creation. */
    private queue: Promise<void> = Promise.resolve();
    /** Dump files accepted per incident directory. */
    private dumpCounts = new Map<string, number>();
    /** Dump bytes accepted so far, against the lifetime budget. */
    private dumpBytes = 0;

    constructor(
        private root = path.join(process.cwd(), 'desyncs'),
        private maxIncidents = DEFAULT_MAX_INCIDENTS,
        private roomCooldownMs = DEFAULT_ROOM_COOLDOWN_MS,
        private maxDumpsPerIncident = DEFAULT_MAX_DUMPS_PER_INCIDENT,
        private maxDumpBytes = DEFAULT_MAX_DUMP_BYTES,
        private maxTotalDumpBytes = DEFAULT_MAX_TOTAL_DUMP_BYTES,
    ) { }

    /** Chains async work, reporting rather than propagating errors. */
    private enqueue(work: () => Promise<void>) {
        this.queue = this.queue.then(work).catch(error => {
            console.error('DesyncRecorder failed:', error);
        });
    }

    recordDesync(roomId: string, info: DesyncInfo, context: {
        baselines: ArchiveBaseline[],
        log: readonly InputRecord[],
        /** The archive's per-entity hashes at the convicted tick —
         * names the archive's own diverging entity when the archive
         * is the wrong one. */
        archiveEntityHashes?: [string, string][],
        /** The archive's full live state at recording time: the
         * component-level evidence for live-archive divergence. */
        archiveState?: { tick: number, snapshot: WireWorldSnapshot },
    }) {
        // A room's repeat convictions within the cooldown are the same
        // stuck divergence; the first record holds the evidence.
        const last = this.lastRecorded.get(roomId);
        if (last !== undefined && Date.now() - last < this.roomCooldownMs) {
            console.log(`Desync in ${roomId} at tick ${info.tick} not `
                + `recorded (within the room's incident cooldown)`);
            return;
        }
        this.lastRecorded.set(roomId, Date.now());
        // Stringify synchronously: the log and baselines mutate as the
        // room runs, and the writes happen later on the queue.
        const files = new Map<string, string>([
            ['desync.json', JSON.stringify({
                roomId,
                wallTime: new Date().toISOString(),
                ...(this.gameDataFingerprint
                    ? { gameDataFingerprint: this.gameDataFingerprint } : {}),
                ...info,
                ...(context.archiveEntityHashes
                    ? { archiveEntityHashes: context.archiveEntityHashes }
                    : {}),
            }, null, 2)],
            ['baselines.json', JSON.stringify(context.baselines)],
            ['log.json', JSON.stringify(context.log)],
            ...(context.archiveState ? [['archive_state.json',
                JSON.stringify(context.archiveState)] as [string, string]] : []),
        ]);
        const dir = path.join(this.root,
            `${new Date().toISOString().replace(/[:.]/g, '-')}_`
            + `${sanitize(roomId)}_tick${info.tick}`);
        this.latestIncident.set(roomId, dir);
        this.enqueue(async () => {
            await fs.mkdir(dir, { recursive: true });
            for (const [name, data] of files) {
                await fs.writeFile(path.join(dir, name), data);
            }
            console.log(`Recorded desync incident at ${dir}`);
            await this.prune();
        });
    }

    recordClientDump(roomId: string, peerId: string, dump: DesyncDump) {
        const data = JSON.stringify(dump);
        if (data.length > this.maxDumpBytes) {
            console.warn(`Dropping ${data.length}-byte desync dump from `
                + `${peerId}: over the ${this.maxDumpBytes}-byte cap`);
            return;
        }
        if (this.dumpBytes + data.length > this.maxTotalDumpBytes) {
            console.warn(`Dropping desync dump from ${peerId}: the `
                + `recorder's ${this.maxTotalDumpBytes}-byte lifetime dump `
                + 'budget is spent');
            return;
        }
        // A dump the relay solicited but that arrives after a restart
        // (no incident directory yet) still gets recorded, in its own
        // directory.
        let dir = this.latestIncident.get(roomId);
        if (!dir) {
            dir = path.join(this.root,
                `${new Date().toISOString().replace(/[:.]/g, '-')}_`
                + `${sanitize(roomId)}_dump`);
            this.latestIncident.set(roomId, dir);
        }
        const count = this.dumpCounts.get(dir) ?? 0;
        if (count >= this.maxDumpsPerIncident) {
            console.warn(`Dropping desync dump from ${peerId}: ${dir} `
                + `already holds ${count} dumps`);
            return;
        }
        // Keyed by the dump's own conviction tick: a stuck peer whose
        // repeat convictions fall inside the incident cooldown uploads
        // several dumps into this directory, each describing a
        // different divergence episode — overwriting one file lost all
        // but the last (and that last one postdated the incident's
        // recorded log, making the directory self-inconsistent).
        //
        // The tick is PEER-SUPPLIED. It is typed as a number, but it
        // arrives as JSON, and path.join normalises `..` segments: a
        // string here once wrote `<root>/../../../escaped.json`. Only
        // a safe integer may name the file, and the resolved path is
        // checked against the directory regardless.
        const safeTick = (value: unknown) =>
            Number.isSafeInteger(value) ? value as number : undefined;
        const tick = safeTick(dump.desyncTick) ?? safeTick(dump.tick)
            ?? 'invalid';
        const file = path.join(dir, `client_${sanitize(peerId)}`
            + `_tick${tick}.json`);
        if (!file.startsWith(dir + path.sep)) {
            console.error(`Refusing to write desync dump outside ${dir}: ${file}`);
            return;
        }
        this.dumpCounts.set(dir, count + 1);
        this.dumpBytes += data.length;
        this.enqueue(async () => {
            await fs.mkdir(dir!, { recursive: true });
            await fs.writeFile(file, data);
            console.log(`Recorded desync dump from ${peerId} at ${file}`);
        });
    }

    /** Removes the oldest incident directories beyond the cap. The
     * timestamp prefix makes lexicographic order chronological. */
    private async prune() {
        const entries = (await fs.readdir(this.root, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
        for (const name of entries.slice(0,
            Math.max(0, entries.length - this.maxIncidents))) {
            await fs.rm(path.join(this.root, name),
                { recursive: true, force: true });
        }
    }

    /** Resolves when all queued writes have settled (for tests). */
    flush(): Promise<void> {
        return this.queue;
    }
}
