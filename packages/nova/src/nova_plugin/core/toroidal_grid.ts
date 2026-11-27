import { BOUNDARY, WORLD_SIZE } from 'nova_ecs/datatypes/position';
import { mod } from 'nova_ecs/datatypes/mod';

/**
 * TEST HOOK, never cleared in production: with `enabled` false the hot
 * scans this module serves (the proximity fuse, point defense target
 * choice, the asteroid decoy search) run their original unindexed loops,
 * so the old-vs-new equivalence spec (spatial_broadphase_test.ts) can
 * step two worlds side by side and compare them tick for tick.
 */
export const spatialBroadphase = { enabled: true };

/**
 * A uniform grid over the toroidal world (positions wrap over
 * ±BOUNDARY), for BROADPHASE culling of "everything within r of here"
 * scans that used to test every entity.
 *
 * It answers with item INDICES (the order the items were inserted in),
 * ascending, so a caller can run its original per-candidate loop over
 * the answer in the original iteration order: the answer is a superset
 * of every item within `radius` of the query point, by plain Euclidean
 * distance or the shortest toroidal one (Position.subtract), so the
 * items it leaves out are exactly ones the caller's own distance test
 * would have skipped. Results, tie-breaks and iteration order are
 * therefore unchanged, which is what determinism needs.
 *
 * Items with a non-finite coordinate (NaN, ±Infinity) go in every
 * answer: a NaN distance fails a `distance > range` test, so the
 * original loops would have kept them. A non-finite query point or
 * radius, or a radius spanning the whole world, answers every item.
 *
 * Pure bookkeeping, no simulation state: callers build it from the
 * current positions and must rebuild it whenever those may have changed.
 */
export class ToroidalGrid {
    readonly cellsPerAxis: number;
    private readonly cells = new Map<number, number[]>();
    /** Items with a non-finite coordinate: in every answer. */
    private readonly unplaced: number[] = [];
    private count = 0;

    /**
     * @param cellSize side of a cell; must divide WORLD_SIZE exactly so
     * that the cells tile the torus without a seam.
     */
    constructor(readonly cellSize = 100) {
        this.cellsPerAxis = WORLD_SIZE / cellSize;
        if (!Number.isInteger(this.cellsPerAxis)) {
            throw new Error(`ToroidalGrid cell size ${cellSize} does not divide ${WORLD_SIZE}`);
        }
    }

    /** How many items have been inserted since the last clear. */
    get size() {
        return this.count;
    }

    clear() {
        this.cells.clear();
        this.unplaced.length = 0;
        this.count = 0;
    }

    private cell(coordinate: number) {
        return mod(Math.floor((coordinate + BOUNDARY) / this.cellSize),
            this.cellsPerAxis);
    }

    /** Adds an item at (x, y) and returns its index (0, 1, 2, ...). */
    insert(x: number, y: number): number {
        const index = this.count++;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            this.unplaced.push(index);
            return index;
        }
        const key = this.cell(x) * this.cellsPerAxis + this.cell(y);
        const bucket = this.cells.get(key);
        if (bucket) {
            bucket.push(index);
        } else {
            this.cells.set(key, [index]);
        }
        return index;
    }

    /**
     * Fills `out` with the indices, ascending, of every item that may lie
     * within `radius` of (x, y) (see the class doc for the guarantee) and
     * returns it.
     */
    near(x: number, y: number, radius: number, out: number[]): number[] {
        out.length = 0;
        const n = this.cellsPerAxis;
        // The cells spanned by [x - r, x + r] x [y - r, y + r], r padded
        // far past any floating-point rounding in the callers' distance
        // tests (coordinates are at most ~1e4, whose ulp is ~2e-12). A
        // negative radius reaches as far as its square does.
        const r = Math.abs(radius) * (1 + 1e-9) + 1e-6;
        const loX = Math.floor((x - r + BOUNDARY) / this.cellSize);
        const hiX = Math.floor((x + r + BOUNDARY) / this.cellSize);
        const loY = Math.floor((y - r + BOUNDARY) / this.cellSize);
        const hiY = Math.floor((y + r + BOUNDARY) / this.cellSize);
        // Written negated so that a NaN span (a non-finite point or
        // radius) answers every item too.
        if (!(hiX - loX + 1 < n && hiY - loY + 1 < n)) {
            for (let i = 0; i < this.count; i++) {
                out.push(i);
            }
            return out;
        }
        let sources = 0;
        for (let cx = loX; cx <= hiX; cx++) {
            const row = mod(cx, n) * n;
            for (let cy = loY; cy <= hiY; cy++) {
                const bucket = this.cells.get(row + mod(cy, n));
                if (bucket) {
                    sources++;
                    for (let i = 0; i < bucket.length; i++) {
                        out.push(bucket[i]);
                    }
                }
            }
        }
        if (this.unplaced.length) {
            sources++;
            for (let i = 0; i < this.unplaced.length; i++) {
                out.push(this.unplaced[i]);
            }
        }
        // Each bucket is ascending already (indices are handed out in
        // order); several buckets need merging.
        if (sources > 1) {
            out.sort(ascending);
        }
        return out;
    }
}

function ascending(a: number, b: number) {
    return a - b;
}

/**
 * Whether two points are CERTAINLY farther apart than `range` along one
 * axis (coordinates `a` and `b`), by the shortest toroidal distance and
 * so by the plain one too. A cheap, allocation-free reject for hot "all
 * within range" scans, ahead of their own exact distance test: when it
 * says true, that test (Position.subtract's wrapped delta, or a plain
 * difference, squared) would have exceeded range² as well, since the
 * range is padded far past floating-point rounding. It never says true
 * for a non-finite input, nor for points a whole world apart or more
 * (not wrapped Positions: left to the exact test).
 */
export function certainlyBeyond(a: number, b: number, range: number): boolean {
    const d = Math.abs(a - b);
    return spatialBroadphase.enabled && d < WORLD_SIZE
        && Math.min(d, WORLD_SIZE - d) > Math.abs(range) * (1 + 1e-9) + 1e-6;
}
