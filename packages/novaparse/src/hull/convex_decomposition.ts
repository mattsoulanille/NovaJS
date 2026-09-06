/**
 * Approximate convex decomposition of simple polygons, after
 * Lien & Amato, "Approximate convex decomposition of polygons",
 * Computational Geometry 35 (2006).
 *
 * The polygon's concavity is measured per boundary "pocket" (the chains
 * between consecutive convex-hull vertices) as the straight-line distance
 * from each pocket vertex to its bridge. The most concave vertex is
 * resolved first by cutting a diagonal from it, recursing until every
 * component's concavity is below a tolerance. Components are then
 * replaced by their convex hulls, so the output is exactly convex and
 * covers the input polygon (overestimating it by at most the tolerance).
 *
 * Everything here is a pure, deterministic function of its inputs: no
 * randomness, and all ties are broken by vertex index. Collision geometry
 * derived from it must be identical across clients.
 */

export type Point = [number, number];

/** Twice the signed area. Positive means counterclockwise (y-up). */
export function signedArea2(polygon: Point[]): number {
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
        const [x0, y0] = polygon[i];
        const [x1, y1] = polygon[(i + 1) % polygon.length];
        area += x0 * y1 - x1 * y0;
    }
    return area;
}

/** Cross product of (a - o) and (b - o). */
function cross(o: Point, a: Point, b: Point): number {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function distance(a: Point, b: Point): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Distance from `p` to the segment `a`-`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared === 0) {
        return distance(p, a);
    }
    let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return distance(p, [a[0] + t * abx, a[1] + t * aby]);
}

/**
 * Indices of the convex hull of `points`, in hull order (Andrew's
 * monotone chain). Collinear points are excluded. Deterministic.
 */
function convexHullIndices(points: Point[]): number[] {
    const indices = points.map((_, i) => i);
    indices.sort((a, b) =>
        points[a][0] - points[b][0] || points[a][1] - points[b][1]);

    const lower: number[] = [];
    for (const i of indices) {
        while (lower.length >= 2 && cross(points[lower[lower.length - 2]],
            points[lower[lower.length - 1]], points[i]) <= 0) {
            lower.pop();
        }
        lower.push(i);
    }
    const upper: number[] = [];
    for (let k = indices.length - 1; k >= 0; k--) {
        const i = indices[k];
        while (upper.length >= 2 && cross(points[upper[upper.length - 2]],
            points[upper[upper.length - 1]], points[i]) <= 0) {
            upper.pop();
        }
        upper.push(i);
    }
    lower.pop();
    upper.pop();
    return [...lower, ...upper];
}

/**
 * Convex hull of `points`: counterclockwise (for y-up coordinates) from
 * the (x, y)-least point, with no repeated final point. Collinear points
 * are dropped. This is the winding the retired hull.js produced (up to
 * rotation), which the pinned collision geometry still carries — see
 * sprite_sheet_multi_parse's makeConvexHull.
 */
export function convexHull(points: Point[]): Point[] {
    return convexHullIndices(points).map(i => points[i]);
}

/** Is the polygon convex, allowing dents of up to `tolerance`? */
export function isConvex(polygon: Point[], tolerance = 0): boolean {
    return polygonConcavity(normalize(polygon)).concavity <= tolerance;
}

/** Counterclockwise, with duplicate and collinear vertices removed. */
function normalize(polygon: Point[]): Point[] {
    const ccw = signedArea2(polygon) < 0
        ? polygon.slice().reverse() : polygon.slice();
    const cleaned: Point[] = [];
    for (const point of ccw) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last[0] !== point[0] || last[1] !== point[1]) {
            cleaned.push(point);
        }
    }
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (cleaned.length > 1 &&
        first[0] === last[0] && first[1] === last[1]) {
        cleaned.pop();
    }
    // Drop exactly-collinear vertices. They carry no shape information
    // but would show up as spurious zero-concavity pocket vertices.
    const result: Point[] = [];
    for (let i = 0; i < cleaned.length; i++) {
        const prev = cleaned[(i + cleaned.length - 1) % cleaned.length];
        const next = cleaned[(i + 1) % cleaned.length];
        if (cross(prev, cleaned[i], next) !== 0) {
            result.push(cleaned[i]);
        }
    }
    return result;
}

interface Concavity {
    concavity: number;
    /** Index of the deepest vertex, or -1 when the polygon is convex. */
    witness: number;
    /** Concavity of each vertex (0 for hull vertices). */
    vertexConcavity: number[];
}

/**
 * Straight-line concavity of each vertex of a counterclockwise simple
 * polygon: its distance to the convex hull bridge over its pocket.
 */
function polygonConcavity(polygon: Point[]): Concavity {
    const vertexConcavity = new Array<number>(polygon.length).fill(0);
    if (polygon.length < 4) {
        return { concavity: 0, witness: -1, vertexConcavity };
    }
    // Hull vertices appear in the same cyclic order as in the polygon, so
    // sorting their indices recovers the bridges as consecutive pairs.
    const hullIndices = [...convexHullIndices(polygon)].sort((a, b) => a - b);
    let concavity = 0;
    let witness = -1;
    for (let h = 0; h < hullIndices.length; h++) {
        const start = hullIndices[h];
        const end = hullIndices[(h + 1) % hullIndices.length];
        const bridgeStart = polygon[start];
        const bridgeEnd = polygon[end];
        for (let i = (start + 1) % polygon.length; i !== end;
            i = (i + 1) % polygon.length) {
            const depth = distanceToSegment(polygon[i], bridgeStart, bridgeEnd);
            vertexConcavity[i] = depth;
            if (depth > concavity) {
                concavity = depth;
                witness = i;
            }
        }
    }
    return { concavity, witness, vertexConcavity };
}

/** Does the direction from vertex `i` to `p` point into the polygon? */
function inCone(polygon: Point[], i: number, p: Point): boolean {
    const n = polygon.length;
    const prev = polygon[(i + n - 1) % n];
    const at = polygon[i];
    const next = polygon[(i + 1) % n];
    if (cross(prev, at, next) > 0) { // Convex vertex.
        return cross(at, p, prev) > 0 && cross(at, next, p) > 0;
    }
    // Reflex vertex: anywhere except the exterior cone.
    return !(cross(at, p, next) >= 0 && cross(at, prev, p) >= 0);
}

/** Do the open segments `a`-`b` and `c`-`d` properly intersect? */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }
    const onSegment = (p: Point, q: Point, r: Point) =>
        cross(p, q, r) === 0 &&
        Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) &&
        Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
    return onSegment(c, d, a) || onSegment(c, d, b) ||
        onSegment(a, b, c) || onSegment(a, b, d);
}

/** Is `i`-`j` a diagonal: strictly inside the polygon, crossing nothing? */
function isDiagonal(polygon: Point[], i: number, j: number): boolean {
    if (!inCone(polygon, i, polygon[j]) || !inCone(polygon, j, polygon[i])) {
        return false;
    }
    const n = polygon.length;
    for (let k = 0; k < n; k++) {
        const kNext = (k + 1) % n;
        if (k === i || k === j || kNext === i || kNext === j) {
            continue;
        }
        if (segmentsCross(polygon[i], polygon[j],
            polygon[k], polygon[kNext])) {
            return false;
        }
    }
    return true;
}

/**
 * Cut the polygon at its concavity witness `r`. Candidate cuts are
 * diagonals from `r` to other vertices; cuts that fully resolve the notch
 * (leaving `r` convex in both pieces) are preferred, and among those the
 * paper's heuristic applies: short cuts to deeply concave vertices score
 * best, since they may resolve two notches at once. Returns undefined if
 * no diagonal exists (degenerate geometry).
 */
function splitAtWitness(polygon: Point[], r: number,
    vertexConcavity: number[]): [Point[], Point[]] | undefined {
    const n = polygon.length;
    let best = -1;
    let bestScore = -Infinity;
    let bestResolves = false;
    for (let offset = 2; offset <= n - 2; offset++) {
        const v = (r + offset) % n;
        if (!isDiagonal(polygon, r, v)) {
            continue;
        }
        const resolves =
            cross(polygon[v], polygon[r], polygon[(r + 1) % n]) >= 0 &&
            cross(polygon[(r + n - 1) % n], polygon[r], polygon[v]) >= 0;
        const score = (1 + vertexConcavity[v]) /
            distance(polygon[r], polygon[v]);
        if (resolves !== bestResolves ? resolves : score > bestScore) {
            best = v;
            bestScore = score;
            bestResolves = resolves;
        }
    }
    if (best === -1) {
        return undefined;
    }
    const pieceA: Point[] = [];
    for (let i = r; ; i = (i + 1) % n) {
        pieceA.push(polygon[i]);
        if (i === best) break;
    }
    const pieceB: Point[] = [];
    for (let i = best; ; i = (i + 1) % n) {
        pieceB.push(polygon[i]);
        if (i === r) break;
    }
    return [pieceA, pieceB];
}

/**
 * Decompose a simple polygon into convex parts whose union covers it.
 *
 * Resolves the globally worst concavity first, splitting until every
 * component's concavity is at most `tolerance` (or `maxComponents` is
 * reached, in which case the deepest remaining dents are absorbed).
 * Each component is returned as its convex hull, in hull.js winding.
 */
export function decomposePolygon(polygon: Point[], tolerance: number,
    maxComponents = 8): Point[][] {
    const initial = normalize(polygon);
    if (initial.length < 3) {
        return [];
    }
    interface Component {
        points: Point[];
        concavity: Concavity;
    }
    const makeComponent = (points: Point[]): Component =>
        ({ points, concavity: polygonConcavity(points) });

    const components = [makeComponent(initial)];
    while (components.length < maxComponents) {
        // Resolve the worst concavity first. Ties break toward the
        // earliest component; pieces replace their parent in place, so
        // component order is deterministic.
        let worst = 0;
        for (let i = 1; i < components.length; i++) {
            if (components[i].concavity.concavity >
                components[worst].concavity.concavity) {
                worst = i;
            }
        }
        const { concavity: { concavity, witness, vertexConcavity }, points } =
            components[worst];
        if (concavity <= tolerance || witness === -1) {
            break;
        }
        const pieces = splitAtWitness(points, witness, vertexConcavity);
        if (!pieces) {
            break; // Degenerate; the component's hull absorbs the dent.
        }
        components.splice(worst, 1,
            makeComponent(pieces[0]), makeComponent(pieces[1]));
    }
    return components
        .map(component => convexHull(component.points))
        .filter(hullPoints => hullPoints.length >= 3);
}
