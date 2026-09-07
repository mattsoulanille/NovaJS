import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { WireWorldSnapshot, wireSnapshotWorld } from "nova_ecs/plugins/snapshot_plugin";
import { hashWorld } from "nova_ecs/plugins/world_hash";
import { World } from "nova_ecs/world";
import { PEER_LOCAL_COMPONENTS } from "../nova_plugin/player/index.js";
import { ArchiveBaseline, STATE_HASH_INTERVAL } from "./rollback_protocol.js";
import { RollbackRelay } from "./rollback_relay.js";
import { applyInputRecords, InputRecord, loadInputRecordsGameData } from "./simulation_input.js";

/** How often the archive captures a baseline: 30 seconds at 60Hz. */
const ARCHIVE_INTERVAL_TICKS = 1800;
/** How often the archive sim catches up to the relay clock. */
const UPDATE_INTERVAL_MS = 1000;

/**
 * The server's periodic snapshot archive for one room: a trailing
 * simulation of the room's deterministic world, wire-snapshotted every
 * interval so joiners (and desync resyncs) reconstruct from a recent
 * baseline instead of replaying the whole log from genesis — which
 * also lets the relay trim the log behind the newest baseline,
 * bounding both costs for long-lived rooms.
 *
 * The archive never rolls back: it steps only to the relay's current
 * tick, and the relay clamps every arriving record to a future tick,
 * so the inputs at or before the relay clock are final. Trailing the
 * clock (rather than pacing ahead like a player) costs nothing — the
 * archive has no inputs of its own.
 */
export class RoomArchive {
    /** The newest baseline; wire it to the relay's `baseline` option. */
    latest?: ArchiveBaseline;
    /**
     * The baseline before `latest`, retained for desync incident
     * records: the divergence window a conviction implies can begin
     * before `latest` (a baseline can be captured mid-window), and
     * offline analysis must replay from a baseline at or before the
     * window's first checkpoint.
     */
    previous?: ArchiveBaseline;
    private world?: World;
    private lastBaselineTick = 0;
    private updating = false;
    /**
     * The archive's world hashes at recent checkpoint ticks. The
     * archive is the log's true simulation, so these break desync
     * votes: with two disagreeing peers, majority alone cannot tell
     * which one diverged.
     */
    private recentHashes = new Map<number, string>();
    /**
     * Per-entity hashes at the same checkpoints, for incident records:
     * when the *archive* is the diverged party (it happens — a lagging
     * client's retime storms provoked it repeatedly), the combined
     * hash alone cannot name which entity its live world got wrong.
     */
    private recentEntityHashes = new Map<number, [string, string][]>();
    private updateInterval?: ReturnType<typeof setInterval>;

    constructor(
        private relay: RollbackRelay,
        private makeWorld: () => Promise<World>,
        { intervalTicks = ARCHIVE_INTERVAL_TICKS, autoUpdate = true, name }: {
            intervalTicks?: number,
            autoUpdate?: boolean,
            /** Label for log lines (e.g. the room's system id). */
            name?: string,
        } = {}) {
        this.intervalTicks = intervalTicks;
        this.name = name;
        if (autoUpdate) {
            this.updateInterval = setInterval(() => {
                // A rejected update (a genesis load that outlived its
                // retries, a record this world cannot stage, a plug-in
                // system that throws on construction) must not escape
                // as an unhandled rejection: under Node's default
                // --unhandled-rejections=throw that exits the server
                // process, taking every room's relay with it. Report it
                // and keep the interval alive; the next update retries
                // from the same tick — `this.world` stays unset until
                // makeWorld succeeds, so construction is attempted again
                // from scratch.
                this.update().catch(error => {
                    console.error(`Archive ${this.name ?? 'room'} update `
                        + `failed at tick ${this.tick}: ${error}`);
                });
            }, UPDATE_INTERVAL_MS);
        }
    }
    private readonly intervalTicks: number;
    private readonly name?: string;

    get tick(): number {
        return this.world?.resources.get(TimeResource)?.frame ?? 0;
    }

    /** The archive's hash at a checkpoint tick, if still retained. */
    hashAt(tick: number): string | undefined {
        return this.recentHashes.get(tick);
    }

    /** Per-entity hashes at a retained checkpoint, for incident records. */
    entityHashesAt(tick: number): [string, string][] | undefined {
        return this.recentEntityHashes.get(tick);
    }

    /**
     * The live world's full wire state right now: incident records
     * (component-level archive evidence) and `fresh` join baselines
     * for cheap resyncs both use it. Memoized per tick — several
     * peers resyncing after one desync broadcast all arrive within
     * the same archive step.
     */
    private lastCapture?: { tick: number, snapshot: WireWorldSnapshot };
    captureState(): { tick: number, snapshot: WireWorldSnapshot } | undefined {
        if (!this.world) {
            return undefined;
        }
        if (this.lastCapture?.tick !== this.tick) {
            this.lastCapture = {
                tick: this.tick,
                snapshot: wireSnapshotWorld(this.world),
            };
        }
        return this.lastCapture;
    }

    /** The trailing sim itself, for tests and diagnostics. */
    get archiveWorld(): World | undefined {
        return this.world;
    }

    /** Retained baselines, oldest first, for desync incident records. */
    baselines(): ArchiveBaseline[] {
        return [this.previous, this.latest]
            .filter((b): b is ArchiveBaseline => b !== undefined);
    }

    /**
     * Steps the archive sim up to the relay's current tick, applying
     * the logged inputs, and captures a baseline when the interval has
     * elapsed. Reentrancy-guarded: updates skip while one is running.
     */
    async update(): Promise<void> {
        if (this.updating) {
            return;
        }
        this.updating = true;
        try {
            if (!this.world) {
                this.world = await this.makeWorld();
            }
            const world = this.world;
            const target = this.relay.tick;
            if (this.tick < target) {
                const pending = this.relay.inputLog.filter(
                    record => record.tick > this.tick && record.tick <= target);
                // Insertions replayed here were staged by their
                // originating peer, not by this world: stage them now
                // so applying them is synchronous.
                await loadInputRecordsGameData(world, pending);
                const byTick = new Map<number, InputRecord[]>();
                for (const record of pending) {
                    byTick.set(record.tick,
                        [...byTick.get(record.tick) ?? [], record]);
                }
                while (this.tick < target) {
                    const records = byTick.get(this.tick + 1);
                    if (records) {
                        applyInputRecords(world, records);
                    }
                    world.step();
                    if (this.tick % STATE_HASH_INTERVAL === 0) {
                        const hashed = hashWorld(world, PEER_LOCAL_COMPONENTS);
                        this.recentHashes.set(this.tick, hashed.hash);
                        this.recentEntityHashes.set(this.tick,
                            [...hashed.entities]);
                        for (const tick of this.recentHashes.keys()) {
                            if (tick < this.tick - STATE_HASH_INTERVAL * 20) {
                                this.recentHashes.delete(tick);
                                this.recentEntityHashes.delete(tick);
                            }
                        }
                    }
                }
            }
            if (this.tick - this.lastBaselineTick >= this.intervalTicks) {
                this.previous = this.latest;
                this.latest = {
                    tick: this.tick,
                    snapshot: wireSnapshotWorld(world),
                };
                this.lastBaselineTick = this.tick;
                // Joiners reconstruct from `latest`, but desync
                // incident records replay from `previous`: trim only
                // behind it, keeping one interval of extra log.
                this.relay.trimLog(this.previous?.tick ?? 0);
                console.log(`Archived ${this.name ?? 'room'} at tick ${this.tick}`);
            }
        } finally {
            this.updating = false;
        }
    }

    close() {
        if (this.updateInterval !== undefined) {
            clearInterval(this.updateInterval);
        }
    }
}
