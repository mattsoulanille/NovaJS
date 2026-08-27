import { Entity } from '../entity.js';
import { World } from '../world.js';
import { restoreWorld, snapshotWorld, WorldSnapshot } from './snapshot_plugin.js';
import { TimeResource } from './time_plugin.js';

export interface RollbackOptions<Inputs> {
    /** How many past ticks of snapshots and inputs to keep. */
    capacity?: number;
    /**
     * Applies a tick's inputs to the world. Called immediately before
     * the world steps that tick, both during normal stepping and during
     * resimulation, so it must be deterministic given the same inputs.
     */
    applyInputs: (world: World, inputs: Inputs) => void;
    /** Completes restored entities (e.g. reattaches derived components). */
    complete?: (world: World, entity: Entity) => void;
    /**
     * Called immediately before each stepped tick — before that tick's
     * inputs are applied, during normal stepping, rollback
     * resimulation, and fastForward alike — with the tick number the
     * step will settle at. Lets the owner attribute work done during
     * the step (e.g. events emitted by systems) to its tick
     * unambiguously: reading the world's TimeResource mid-step is
     * ambiguous, because TimeSystem advances it partway through the
     * step. Bookkeeping only; must not touch simulation state.
     */
    beforeStep?: (tick: number) => void;
    /**
     * Called after every stepped tick — including ticks re-stepped
     * during rollback resimulation, whose state supersedes the
     * abandoned timeline's. Lets the owner observe the settled state
     * per tick (e.g. periodic state hashes for desync detection).
     * Not called during fastForward, which replays a bulk history.
     */
    onStep?: (tick: number) => void;
}

/**
 * Drives a fixed-timestep world with a snapshot ring buffer and an
 * input history, supporting rollback: restore a past tick's state,
 * then resimulate to the present replaying the (possibly amended)
 * input history. This is the core of rollback netcode, but has no
 * networking itself: whoever owns the network (or a test harness)
 * decides what the inputs are and when to roll back.
 *
 * The tick counter is the world's TimeResource frame, which advances
 * exactly once per step on a fixed timestep.
 */
export class RollbackSimulation<Inputs> {
    private snapshots: { tick: number, snapshot: WorldSnapshot }[] = [];
    private inputs = new Map<number, Inputs>();
    private readonly capacity: number;

    constructor(private world: World,
        private options: RollbackOptions<Inputs>) {
        this.capacity = options.capacity ?? 64;
        // Baseline snapshot so rollbackTo(currentTick) always works.
        this.takeSnapshot();
    }

    get tick(): number {
        const time = this.world.resources.get(TimeResource);
        if (!time) {
            throw new Error('RollbackSimulation requires TimeResource');
        }
        return time.frame;
    }

    /** The oldest tick that can be rolled back to. */
    get earliestTick(): number {
        return this.snapshots[0]?.tick ?? this.tick;
    }

    /**
     * The ring's snapshot at a tick, if still retained. Snapshots are
     * detached from the live world, so a caller may hold one past its
     * eviction from the ring (e.g. pinning checkpoint states for
     * desync diagnostics).
     */
    snapshotAt(tick: number): WorldSnapshot | undefined {
        return this.snapshots.find(s => s.tick === tick)?.snapshot;
    }

    /**
     * Records the inputs for a tick. For future ticks they apply when
     * that tick is stepped; amending a past tick's inputs takes effect
     * on the next rollback across it.
     */
    setInputs(tick: number, inputs: Inputs) {
        this.inputs.set(tick, inputs);
    }

    getInputs(tick: number): Inputs | undefined {
        return this.inputs.get(tick);
    }

    /** Advances one tick, applying that tick's recorded inputs. */
    step() {
        this.options.beforeStep?.(this.tick + 1);
        const inputs = this.inputs.get(this.tick + 1);
        if (inputs !== undefined) {
            this.options.applyInputs(this.world, inputs);
        }
        this.world.step();
        this.takeSnapshot();
        this.options.onStep?.(this.tick);
    }

    /**
     * Restores the state at `tick` and resimulates to the present,
     * replaying the input history. Returns false if `tick` is older
     * than the snapshot buffer.
     */
    rollbackTo(tick: number): boolean {
        const target = this.tick;
        if (tick > target) {
            return false;
        }
        const entry = this.snapshots.find(s => s.tick === tick);
        if (!entry) {
            return false;
        }

        restoreWorld(this.world, entry.snapshot, this.options.complete);
        // Snapshots after the restore point belong to the abandoned
        // timeline; resimulation records fresh ones.
        this.snapshots = this.snapshots.filter(s => s.tick <= tick);

        while (this.tick < target) {
            this.step();
        }
        return true;
    }

    /**
     * Restores the state at `tick` and abandons the timeline after it:
     * no replay, and the inputs after `tick` are discarded. The
     * time-travel variant of rollbackTo, for debugging (and perhaps,
     * someday, gameplay).
     */
    rewindTo(tick: number): boolean {
        const entry = this.snapshots.find(s => s.tick === tick);
        if (!entry) {
            return false;
        }
        restoreWorld(this.world, entry.snapshot, this.options.complete);
        this.snapshots = this.snapshots.filter(s => s.tick <= tick);
        for (const inputTick of this.inputs.keys()) {
            if (inputTick > tick) {
                this.inputs.delete(inputTick);
            }
        }
        return true;
    }

    /**
     * Advances to `tick` as fast as possible, applying recorded inputs
     * but only snapshotting the final `capacity` ticks. Used to catch
     * up from an input log when joining a room: genesis plus the log
     * deterministically reconstructs the present.
     *
     * With `yieldEvery` set, the loop yields a macrotask every that
     * many ticks so a long reconstruction doesn't block its thread
     * (a worker mid-rebuild must still receive room messages).
     * Without it the entire loop runs synchronously, so callers that
     * do not await keep their old behavior.
     */
    async fastForward(tick: number, yieldEvery?: number) {
        let sinceYield = 0;
        while (this.tick < tick) {
            this.options.beforeStep?.(this.tick + 1);
            const inputs = this.inputs.get(this.tick + 1);
            if (inputs !== undefined) {
                this.options.applyInputs(this.world, inputs);
            }
            this.world.step();
            if (tick - this.tick < this.capacity) {
                this.takeSnapshot();
            }
            if (yieldEvery !== undefined && ++sinceYield >= yieldEvery) {
                sinceYield = 0;
                await new Promise(resolve => setTimeout(resolve));
            }
        }
    }

    private takeSnapshot() {
        this.snapshots.push({ tick: this.tick, snapshot: snapshotWorld(this.world) });
        while (this.snapshots.length > this.capacity) {
            this.snapshots.shift();
        }
        // Inputs older than the oldest snapshot can never be replayed.
        const earliest = this.earliestTick;
        for (const tick of this.inputs.keys()) {
            if (tick <= earliest) {
                this.inputs.delete(tick);
            }
        }
    }
}
