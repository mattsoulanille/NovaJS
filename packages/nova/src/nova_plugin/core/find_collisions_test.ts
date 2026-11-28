import 'jasmine';
import RBush from 'rbush';
import SAT from 'sat';
import { CollisionHitter, CollisionVulnerability } from './collision_interaction.js';
import { CompositeHull, findCollisions, Hull, RBushEntry } from './collisions_plugin.js';

/** A fixed LCG, so every run draws the same scenes. */
function lcg(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

type Hitbox = readonly [Hull, string, CollisionVulnerability];
type Hurtbox = readonly [Hull, string, CollisionHitter];

/**
 * The selection rule the pre-optimisation sweep implemented (both kinds
 * in one tree, every overlap discovered from both ends, one collision per
 * unordered pair, the smaller initiator winning a mutual pair), written
 * out by brute force over every hurtbox x hitbox, minus self-pairs.
 */
function referenceCollisions(hitboxes: readonly Hitbox[],
    hurtboxes: readonly Hurtbox[]) {
    const overlaps = (a: Hull, b: Hull) => {
        const p = a.bbox;
        const q = b.bbox;
        return p.minX <= q.maxX && p.minY <= q.maxY
            && p.maxX >= q.minX && p.maxY >= q.minY;
    };
    const chosen = new Map<string, { initiator: string, receiver: string }>();
    for (const [hurt, initiator, hitter] of hurtboxes) {
        for (const [hit, receiver, vulnerability] of hitboxes) {
            if (initiator === receiver || !overlaps(hurt, hit)) {
                continue;
            }
            const hits = [...hitter.hitTypes]
                .some(type => vulnerability.vulnerableTo.has(type));
            if (!hits || !hurt.collides(hit)) {
                continue;
            }
            const key = [initiator, receiver].sort().join();
            const existing = chosen.get(key);
            if (!existing || initiator < existing.initiator) {
                chosen.set(key, { initiator, receiver });
            }
        }
    }
    return [...chosen.values()].sort((p, q) =>
        p.initiator < q.initiator ? -1 : p.initiator > q.initiator ? 1 :
            p.receiver < q.receiver ? -1 : p.receiver > q.receiver ? 1 : 0);
}

function randomHull(random: () => number): Hull {
    const shape = random() < 0.5
        ? new SAT.Circle(new SAT.Vector(0, 0), 5 + random() * 40)
        : new SAT.Polygon(new SAT.Vector(), [
            new SAT.Vector(-10 - random() * 30, -10 - random() * 30),
            new SAT.Vector(10 + random() * 30, -10 - random() * 30),
            new SAT.Vector(random() * 20 - 10, 10 + random() * 30),
        ]);
    const hull = new CompositeHull([shape]);
    hull.angle = random() * 6 - 3;
    hull.pos.x = random() * 600 - 300;
    hull.pos.y = random() * 600 - 300;
    return hull;
}

describe('findCollisions', () => {
    it('picks the same collisions as the old both-ends sweep on random scenes', () => {
        const random = lcg(4242);
        const types = ['normal', 'pointDefense', 'debris', 'return_escorts'];
        let total = 0;
        let mutual = 0;
        for (let scene = 0; scene < 60; scene++) {
            const hitboxes: Hitbox[] = [];
            const hurtboxes: Hurtbox[] = [];
            const count = 10 + Math.floor(random() * 60);
            for (let i = 0; i < count; i++) {
                // Unsorted, collision-prone uuids.
                const uuid = `e${Math.floor(random() * 1000)}-${i}`;
                const kind = random();
                const hull = randomHull(random);
                const vulnerability = {
                    vulnerableTo: new Set(types.filter(() => random() < 0.5)),
                };
                const hitter = {
                    hitTypes: new Set(types.filter(() => random() < 0.4)),
                };
                if (kind < 0.4) {
                    hitboxes.push([hull, uuid, vulnerability]);
                } else if (kind < 0.7) {
                    hurtboxes.push([hull, uuid, hitter]);
                } else if (kind < 0.85) {
                    // Both, sharing ONE hull object (a returning fighter's
                    // hurtbox aliases its hitbox): never a self-collision.
                    hitboxes.push([hull, uuid, vulnerability]);
                    hurtboxes.push([hull, uuid, hitter]);
                } else {
                    // Both, with distinct hulls (a prox-fused missile).
                    hitboxes.push([hull, uuid, vulnerability]);
                    hurtboxes.push([randomHull(random), uuid, hitter]);
                }
            }
            const expected = referenceCollisions(hitboxes, hurtboxes);
            const actual = findCollisions(new RBush<RBushEntry>(),
                hitboxes, hurtboxes);
            expect(actual).toEqual(expected);
            total += expected.length;
            const initiators = new Set(expected.map(p => p.initiator));
            mutual += expected.filter(p => initiators.has(p.receiver)).length;
        }
        // The scenes really exercised the rule.
        expect(total).toBeGreaterThan(300);
        expect(mutual).toBeGreaterThan(10);
    });

    it('returns nothing (and leaves the tree empty) without both kinds', () => {
        const rbush = new RBush<RBushEntry>();
        const hull = new CompositeHull([new SAT.Circle(new SAT.Vector(0, 0), 10)]);
        expect(findCollisions(rbush,
            [[hull, 'a', { vulnerableTo: new Set(['normal']) }]], [])).toEqual([]);
        expect(rbush.all()).toEqual([]);
    });
});
