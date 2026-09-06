import "jasmine";
import SAT from "sat";
import { Vector } from 'nova_ecs/datatypes/vector';
import { beamHullHitFraction } from './beam_plugin.js';

// Helper: build a SAT.Polygon from world-space corner points.
function polygon(...corners: [number, number][]): SAT.Polygon {
    return new SAT.Polygon(new SAT.Vector(0, 0),
        corners.map(([x, y]) => new SAT.Vector(x, y)));
}

describe('beamHullHitFraction', () => {
    // A 100-unit beam pointing straight up (in Nova, -y is up / forward).
    // start (0, 0) -> end (0, -100). Fraction * 100 = distance travelled.
    const start = new Vector(0, 0);
    const end = new Vector(0, -100);

    describe('origin inside a single convex polygon', () => {
        it('registers an immediate hit at the origin (fraction 0)', () => {
            // A square from (-50,-50) to (50,50) that contains the origin.
            const square = polygon([-50, -50], [50, -50], [50, 50], [-50, 50]);
            const fraction = beamHullHitFraction(start, end, [square]);
            expect(fraction).toBe(0);
        });

        it('works regardless of vertex winding order', () => {
            // Same square but wound the opposite way.
            const square = polygon([-50, 50], [50, 50], [50, -50], [-50, -50]);
            const fraction = beamHullHitFraction(start, end, [square]);
            expect(fraction).toBe(0);
        });
    });

    describe('origin inside one component of a multi-polygon (ACD) hull', () => {
        it('registers an immediate hit even when other components are far away', () => {
            // Two disjoint squares (an approximate convex decomposition of some
            // larger shape). The origin is inside the second one only.
            const farAway = polygon([200, 200], [260, 200], [260, 260], [200, 260]);
            const containsOrigin = polygon([-30, -30], [30, -30], [30, 30], [-30, 30]);
            const fraction = beamHullHitFraction(start, end,
                [farAway, containsOrigin]);
            expect(fraction).toBe(0);
        });
    });

    describe('origin outside, beam ray crosses the hull', () => {
        it('returns the edge-crossing fraction unchanged', () => {
            // Square from y=-80..-40 (in front of the beam origin). The upward
            // beam enters its near edge at y=-40 => fraction 0.4.
            const square = polygon([-20, -80], [20, -80], [20, -40], [-20, -40]);
            const fraction = beamHullHitFraction(start, end, [square]);
            expect(fraction).toBeCloseTo(0.4, 10);
        });

        it('does not hit a hull entirely off to the side', () => {
            const square = polygon([100, -80], [140, -80], [140, -40], [100, -40]);
            const fraction = beamHullHitFraction(start, end, [square]);
            expect(fraction).toBe(Infinity);
        });
    });

    describe('origin in the concave gap of a decomposed hull', () => {
        it('does NOT immediately hit and proceeds to the far component', () => {
            // A U-shape opening downward (toward the beam origin), decomposed
            // into two vertical rectangles (the prongs) plus a top bar.
            //   left prong:  x in [-40,-20]
            //   right prong: x in [ 20, 40]
            //   top bar:     y in [-100,-80], joining the prongs
            // The origin (0,0) sits in the notch BETWEEN the prongs - outside
            // every convex component. The upward beam passes cleanly between the
            // prongs and hits the underside of the top bar at y=-80 (fraction .8).
            const leftProng = polygon([-40, -80], [-20, -80], [-20, 0], [-40, 0]);
            const rightProng = polygon([20, -80], [40, -80], [40, 0], [20, 0]);
            const topBar = polygon([-40, -100], [40, -100], [40, -80], [-40, -80]);

            const fraction = beamHullHitFraction(start, end,
                [leftProng, rightProng, topBar]);

            // Not an immediate origin hit...
            expect(fraction).toBeGreaterThan(0);
            // ...it reaches the far top bar instead.
            expect(fraction).toBeCloseTo(0.8, 10);
        });
    });

    describe('circle components', () => {
        it('registers an immediate hit when the origin is inside a circle', () => {
            const circle = new SAT.Circle(new SAT.Vector(0, 0), 50);
            const fraction = beamHullHitFraction(start, end, [circle]);
            expect(fraction).toBe(0);
        });

        it('returns the near-edge crossing when the origin is outside a circle', () => {
            // Circle centred at (0,-60), radius 20 => near edge at y=-40.
            const circle = new SAT.Circle(new SAT.Vector(0, -60), 20);
            const fraction = beamHullHitFraction(start, end, [circle]);
            expect(fraction).toBeCloseTo(0.4, 10);
        });
    });
});
