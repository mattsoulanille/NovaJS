import 'jasmine';
import SAT from 'sat';
import { CompositeHull, MultiFrameHull } from './collisions_plugin.js';

/**
 * The hull updates skip work without changing the hull: a frame switch
 * no longer turns the new frame's polygons to the old angle first, and a
 * CompositeHull's rotated box is memoized on its angle. Compared here
 * with hulls driven the old way (frame, then angle; fresh boxes) on
 * random seeded frame/angle/position sequences.
 */

function lcg(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function makeFrames(random: () => number, frames: number) {
    const hulls: CompositeHull[] = [];
    for (let f = 0; f < frames; f++) {
        const polygons: SAT.Polygon[] = [];
        for (let p = 0; p < 2; p++) {
            const ox = (random() - 0.5) * 20;
            const oy = (random() - 0.5) * 20;
            polygons.push(new SAT.Polygon(new SAT.Vector(), [
                new SAT.Vector(ox - 5, oy - 8),
                new SAT.Vector(ox + 7, oy - 3),
                new SAT.Vector(ox + 2, oy + 9),
            ]));
        }
        hulls.push(new CompositeHull(polygons));
    }
    return hulls;
}

/** The active frame's world-space geometry, as collisions see it. */
function geometry(hull: MultiFrameHull) {
    return {
        shapes: hull.shapes.map(shape => (shape as SAT.Polygon).calcPoints
            .map(p => [p.x + shape.pos.x, p.y + shape.pos.y])),
        bbox: hull.bbox,
    };
}

describe('hull updates', () => {
    it('setFrameAndAngle leaves the hull as frame-then-angle did', () => {
        const warn = spyOn(console, 'warn');
        for (let seed = 1; seed <= 8; seed++) {
            const shapesRandom = lcg(seed);
            const oldHull = new MultiFrameHull(makeFrames(shapesRandom, 6));
            const newHull = new MultiFrameHull(makeFrames(lcg(seed), 6));
            const random = lcg(seed * 31);
            for (let step = 0; step < 400; step++) {
                // Frames repeat and angles stick often, like a ship
                // holding a heading; sometimes an out-of-range frame.
                const frame = random() < 0.02 ? 9 : Math.floor(random() * 6);
                const angle = random() < 0.5 ? 0.25 : random() * 2 * Math.PI;
                const x = (random() - 0.5) * 1000;
                const y = (random() - 0.5) * 1000;

                oldHull.frame = frame;
                oldHull.pos.x = x;
                oldHull.pos.y = y;
                oldHull.angle = angle;

                newHull.setFrameAndAngle(frame, angle);
                newHull.pos.x = x;
                newHull.pos.y = y;

                expect(geometry(newHull)).toEqual(geometry(oldHull));
                expect(oldHull.collides(newHull)).toBe(true);
            }
        }
        // Both paths warned about the same out-of-range frames.
        expect(warn.calls.count() % 2).toBe(0);
        expect(warn).toHaveBeenCalled();
    });

    it('memoizes the rotated box without changing it', () => {
        const random = lcg(5);
        const [memo] = makeFrames(random, 1);
        for (let step = 0; step < 300; step++) {
            memo.angle = random() < 0.5 ? 1 : random() * 7;
            memo.pos = new SAT.Vector(random() * 100, random() * 100);
            const fresh = new CompositeHull(memo.shapes.map(shape =>
                new SAT.Polygon(new SAT.Vector(), (shape as SAT.Polygon).points)));
            fresh.angle = memo.angle;
            fresh.pos = memo.pos;
            const box = memo.bbox;
            expect(box).toEqual(fresh.bbox);
            // A fresh object every call: CollisionSystem decorates it.
            expect(memo.bbox).not.toBe(box);
        }
    });
});
