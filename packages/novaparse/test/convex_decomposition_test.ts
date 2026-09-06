import "jasmine";
import { convexHull, decomposePolygon, isConvex, Point, signedArea2 } from "../src/hull/convex_decomposition.js";
import { simplifyPolygon, traceOutline } from "../src/hull/trace_outline.js";

const L_SHAPE: Point[] = [
    [0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
const U_SHAPE: Point[] = [
    [0, 0], [12, 0], [12, 10], [8, 10], [8, 3], [4, 3], [4, 10], [0, 10]];

function makeStar(points: number, outer: number, inner: number): Point[] {
    const star: Point[] = [];
    for (let i = 0; i < 2 * points; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = Math.PI * i / points - Math.PI / 2;
        star.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
    }
    return star;
}

/** Winding-agnostic point-in-polygon by ray casting. */
function inPolygon(polygon: Point[], [x, y]: Point): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if ((yi > y) !== (yj > y) &&
            x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Every grid point strictly inside `polygon` (sampled at `step` spacing,
 * offset to dodge edges) must be inside some component.
 */
function expectCovered(polygon: Point[], components: Point[][],
    step = 0.5) {
    const x = polygon.map(p => p[0]);
    const y = polygon.map(p => p[1]);
    let samples = 0;
    let missed = 0;
    for (let px = Math.min(...x) + step / 3; px < Math.max(...x);
        px += step) {
        for (let py = Math.min(...y) + step / 3; py < Math.max(...y);
            py += step) {
            if (!inPolygon(polygon, [px, py])) {
                continue;
            }
            samples++;
            if (!components.some(c => inPolygon(c, [px, py]))) {
                missed++;
            }
        }
    }
    expect(samples).toBeGreaterThan(0);
    expect(missed).toBe(0);
}

describe("convexHull", () => {
    it("matches the winding hull.js produced", () => {
        const points: Point[] = [
            [0, 0], [4, 1], [2, 5], [0, 4], [4, 4], [1, 2], [3, 0]];
        // hull(points, Infinity) from hull.js 1.0.6, minus its repeated
        // final point: counterclockwise from the (x, y)-greatest point.
        const expected: Point[] = [
            [4, 4], [2, 5], [0, 4], [0, 0], [3, 0], [4, 1]];
        // Rotation-invariant comparison: same cycle, same direction.
        const actual = convexHull(points);
        expect(actual.length).toEqual(expected.length);
        const offset = expected.findIndex(
            p => p[0] === actual[0][0] && p[1] === actual[0][1]);
        expect(offset).toBeGreaterThanOrEqual(0);
        const rotated = [...expected.slice(offset), ...expected.slice(0, offset)];
        expect(actual).toEqual(rotated);
    });
});

describe("decomposePolygon", () => {
    it("leaves a convex polygon whole", () => {
        const square: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
        const components = decomposePolygon(square, 0.5);
        expect(components.length).toBe(1);
        expectCovered(square, components);
    });

    for (const [name, polygon, maxParts] of [
        ["an L-shape", L_SHAPE, 2],
        ["a U-shape", U_SHAPE, 3],
        ["a five-pointed star", makeStar(5, 10, 4), 6],
    ] as const) {
        it(`decomposes ${name} into convex parts that cover it`, () => {
            const components = decomposePolygon(polygon, 0.1, 8);
            expect(components.length).toBeGreaterThan(1);
            expect(components.length).toBeLessThanOrEqual(maxParts);
            for (const component of components) {
                expect(isConvex(component, 1e-9)).toBeTrue();
            }
            expectCovered(polygon, components);
        });
    }

    it("is deterministic", () => {
        const star = makeStar(7, 20, 6);
        const first = decomposePolygon(star, 0.1, 16);
        const second = decomposePolygon(star.map(p => [...p] as Point),
            0.1, 16);
        expect(second).toEqual(first);
    });

    it("is independent of the input winding", () => {
        const forward = decomposePolygon(U_SHAPE, 0.1);
        const backward = decomposePolygon(U_SHAPE.slice().reverse(), 0.1);
        expect(backward).toEqual(forward);
    });

    it("respects maxComponents", () => {
        const components = decomposePolygon(makeStar(9, 30, 5), 0.1, 4);
        expect(components.length).toBe(4);
        for (const component of components) {
            expect(isConvex(component, 1e-9)).toBeTrue();
        }
        expectCovered(makeStar(9, 30, 5), components, 1);
    });

    it("tolerates concavity up to the tolerance", () => {
        // The L's notch is ~4.2 deep, so a looser tolerance keeps it
        // whole while a tighter one splits it.
        expect(decomposePolygon(L_SHAPE, 5).length).toBe(1);
        expect(decomposePolygon(L_SHAPE, 3).length).toBe(2);
    });
});

describe("traceOutline", () => {
    function maskFromRows(rows: string[]) {
        return {
            width: rows[0].length,
            height: rows.length,
            isFilled: (x: number, y: number) => y >= 0 && y < rows.length &&
                x >= 0 && x < rows[0].length && rows[y][x] === '#',
        };
    }

    it("traces a plus shape with collinear runs merged", () => {
        const outline = traceOutline(maskFromRows([
            '.#.',
            '###',
            '.#.',
        ]))!;
        expect(outline.length).toBe(12);
        // Closed loop over pixel corners: area matches the five pixels.
        expect(Math.abs(signedArea2(outline) / 2)).toBe(5);
    });

    it("returns the largest region and ignores holes", () => {
        const outline = traceOutline(maskFromRows([
            '####..',
            '#..#..',
            '####.#',
        ]))!;
        // The outer boundary of the ring, not its hole or the lone pixel.
        expect(Math.abs(signedArea2(outline) / 2)).toBe(12);
    });

    it("returns undefined for an empty mask", () => {
        expect(traceOutline(maskFromRows(['...', '...']))).toBeUndefined();
    });

    it("keeps loops simple at diagonal pixel contacts", () => {
        const outline = traceOutline(maskFromRows([
            '#.',
            '.#',
        ]))!;
        // Two diagonally-touching pixels pinch into two separate loops;
        // each is a single pixel's square.
        expect(Math.abs(signedArea2(outline) / 2)).toBe(1);
        expect(outline.length).toBe(4);
    });
});

describe("simplifyPolygon", () => {
    it("straightens a staircase within epsilon", () => {
        const staircase: Point[] = [[0, 0], [10, 0], [10, 10]];
        for (let i = 9; i >= 1; i--) {
            staircase.push([i + 1, i], [i, i]);
        }
        const simplified = simplifyPolygon(staircase, 1);
        expect(simplified.length).toBe(3);
    });

    it("keeps corners deeper than epsilon", () => {
        const simplified = simplifyPolygon(L_SHAPE, 1);
        expect(simplified).toEqual(L_SHAPE);
    });
});
