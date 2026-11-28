import 'jasmine';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { BOUNDARY, Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { makeSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { captureCone, DecoyCandidate, DecoyCone, inCone, nearestDecoy }
    from './jamming_plugin.js';
import { makeSystem } from '../make_system.js';
import { makeNpc } from '../npc/index.js';
import { completeEntity } from '../spawn/index.js';
import { certainlyBeyond, GovtComponent, ProjectileDataComponent, spatialBroadphase, ToroidalGrid }
    from '../core/index.js';

/**
 * The spatial broadphase (toroidal_grid.ts) must not change a single
 * choice: every peer has to pick the same point defense target, decoy
 * and fuse victim on the same tick as before. These specs compare the
 * new code with the old on random SEEDED scenes: the grid and the
 * prefilter against brute force, nearestDecoy against a copy of the old
 * loop, and whole synthetic missile fights stepped with the broadphase
 * on and off, hash for hash.
 */

/** A fixed LCG, so every run sees the same scenes. */
function lcg(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/** Coordinates that stress the edges: clusters, the wrap seam, extremes. */
function coordinate(random: () => number): number {
    const kind = random();
    if (kind < 0.4) {
        return (random() - 0.5) * 2 * BOUNDARY; // anywhere
    } else if (kind < 0.7) {
        return 300 * (random() - 0.5); // a dense brawl
    } else if (kind < 0.9) {
        // Straddling the seam at ±BOUNDARY.
        return (random() < 0.5 ? BOUNDARY : -BOUNDARY) + 200 * (random() - 0.5);
    }
    // Cell edges exactly.
    return Math.round(random() * 200 - 100) * 100;
}

const RADII = [0, 1e-9, 12, 37.5, 99.99, 100, 250, 1000, 3000, 9999,
    15000, -40, NaN, Infinity];

/** The old loops' acceptance test: kept unless distance² > r². */
function kept(distanceSquared: number, radius: number) {
    return !(distanceSquared > radius * radius);
}

describe('ToroidalGrid', () => {
    it('answers a superset of the brute-force neighbours, ascending', () => {
        for (let seed = 1; seed <= 12; seed++) {
            const random = lcg(seed);
            const grid = new ToroidalGrid(seed % 2 ? 100 : 250);
            const points: Position[] = [];
            const raw: [number, number][] = [];
            for (let i = 0; i < 300; i++) {
                let x = coordinate(random);
                let y = coordinate(random);
                if (i % 97 === 5) {
                    x = NaN;
                } else if (i % 89 === 7) {
                    y = Infinity;
                }
                raw.push([x, y]);
                points.push(new Position(x, y));
                expect(grid.insert(points[i].x, points[i].y)).toBe(i);
            }
            const out: number[] = [];
            for (let q = 0; q < 150; q++) {
                const from = new Position(coordinate(random), coordinate(random));
                const radius = RADII[q % RADII.length];
                const near = grid.near(from.x, from.y, radius, out);
                for (let k = 1; k < near.length; k++) {
                    expect(near[k]).toBeGreaterThan(near[k - 1]);
                }
                const answered = new Set(near);
                for (let i = 0; i < points.length; i++) {
                    const p = points[i];
                    const wrapped = p.subtract(from).lengthSquared;
                    const dx = p.x - from.x;
                    const dy = p.y - from.y;
                    const plain = dx * dx + dy * dy;
                    if (kept(wrapped, radius) || kept(plain, radius)) {
                        if (!answered.has(i)) {
                            fail(`seed ${seed}: point ${i} (${raw[i]}) within ${radius} of ${from.x},${from.y} not answered`);
                        }
                    }
                }
            }
        }
    });
});

describe('certainlyBeyond', () => {
    it('only rejects pairs the exact distance tests reject', () => {
        const random = lcg(99);
        let rejected = 0;
        for (let n = 0; n < 200000; n++) {
            const a = new Position(coordinate(random), coordinate(random));
            const b = new Position(coordinate(random), coordinate(random));
            const range = RADII[n % RADII.length];
            if (certainlyBeyond(a.x, b.x, range)
                || certainlyBeyond(a.y, b.y, range)) {
                rejected++;
                expect(kept(a.subtract(b).lengthSquared, range)).toBeFalse();
                const dx = a.x - b.x;
                const dy = a.y - b.y;
                expect(kept(dx * dx + dy * dy, range)).toBeFalse();
            }
        }
        // It does reject most of them (the point of it).
        expect(rejected).toBeGreaterThan(100000);
    });
});

/** nearestDecoy as it was before the prefilter, verbatim. */
function oldNearestDecoy(decoys: Iterable<DecoyCandidate>,
    from: Position, range: number, cone?: DecoyCone): string | undefined {
    const rangeSq = range * range;
    let bestId: string | undefined;
    let bestWeight = -Infinity;
    let bestDistSq = Infinity;
    for (const [id, decoy, movement] of decoys) {
        const offset = movement.position.subtract(from);
        const distSq = offset.lengthSquared;
        if (distSq > rangeSq) {
            continue;
        }
        if (cone && !inCone(offset, cone)) {
            continue;
        }
        const weight = decoy.weight;
        const better = weight > bestWeight
            || (weight === bestWeight && distSq < bestDistSq)
            || (weight === bestWeight && distSq === bestDistSq
                && (bestId === undefined || id < bestId));
        if (better) {
            bestId = id;
            bestWeight = weight;
            bestDistSq = distSq;
        }
    }
    return bestId;
}

describe('nearestDecoy with the prefilter', () => {
    it('picks what the old loop picked on random scenes', () => {
        let found = 0;
        for (let seed = 1; seed <= 40; seed++) {
            const random = lcg(seed * 7919);
            const decoys: DecoyCandidate[] = [];
            for (let i = 0; i < 120; i++) {
                decoys.push([`rock-${Math.floor(random() * 1000)}-${i}`,
                    { weight: random() < 0.8 ? 1 : 2 },
                    { position: new Position(coordinate(random), coordinate(random)) }]);
            }
            for (let q = 0; q < 60; q++) {
                const from = new Position(coordinate(random), coordinate(random));
                const range = [200, 1000, 0, 5000, NaN][q % 5];
                const cone = q % 3 === 0
                    ? captureCone(new Angle(random() * 2 * Math.PI))
                    : undefined;
                const expected = oldNearestDecoy(decoys, from, range, cone);
                if (expected !== undefined) {
                    found++;
                }
                expect(nearestDecoy(decoys, from, range, cone)).toBe(expected);
            }
        }
        expect(found).toBeGreaterThan(200);
    });
});

/**
 * A synthetic missile fight (the big_fight_benchmark scene, small): two
 * factions in Ossory Shoal's asteroid field, a scripted battery that
 * keeps Harrier missiles (made decoyable, in this spec's own game data
 * only) in flight, and scripted Flak point defense.
 */
async function makeFight(gameData: ReturnType<typeof makeSyntheticGameData>,
    brawlers: number) {
    const world = await makeSystem('nova:130', gameData, 'worker');
    const factions: string[][] = [[], []];
    const ring = [[1, 0], [0, 1], [-1, 0], [0, -1],
        [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
    for (let i = 0; i < brawlers; i++) {
        const side = i % 2;
        const shipData = await gameData.data.Ship.get(
            ['nova:129', 'nova:130'][Math.floor(i / 2) % 2]);
        const npc = makeNpc(shipData);
        npc.components.set(MultiplayerData, { owner: 'server' });
        npc.components.set(GovtComponent, { id: ['nova:128', 'nova:129'][side] });
        await completeEntity(world, npc);
        const [dx, dy] = ring[i % ring.length];
        const radius = 200 + 90 * Math.floor(i / ring.length);
        npc.components.set(MovementStateComponent, {
            position: new Position(dx * radius, dy * radius),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(`brawler-${i}`, npc);
        factions[side].push(`brawler-${i}`);
    }
    const weaponEntries = world.resources.get(WeaponEntries)!;
    await weaponEntries.get('nova:129');
    await weaponEntries.get('nova:132');
    return { world, factions, weaponEntries };
}

function liveMissiles(world: World) {
    let count = 0;
    for (const [, entity] of world.entities) {
        if (entity.components.get(ProjectileDataComponent)?.id === 'nova:129') {
            count++;
        }
    }
    return count;
}

describe('spatial broadphase in a missile fight', () => {
    afterEach(() => {
        spatialBroadphase.enabled = true;
    });

    for (const seed of [3, 11]) {
        it(`steps hash for hash with the old unindexed scans (seed ${seed})`, async () => {
            const gameData = makeSyntheticGameData();
            const missile = await gameData.data.Weapon.get('nova:129') as ProjectileWeaponData;
            missile.seeker = { ...missile.seeker, decoyedByAsteroids: true };
            const fights = [await makeFight(gameData, 16),
                await makeFight(gameData, 16)];
            const randoms = [lcg(seed), lcg(seed)];
            let fired = 0;
            for (let tick = 0; tick < 200; tick++) {
                const hashes: string[] = [];
                for (let f = 0; f < 2; f++) {
                    spatialBroadphase.enabled = f === 1;
                    const { world, factions, weaponEntries } = fights[f];
                    const random = randoms[f];
                    const alive = (uuid: string) => world.entities.has(uuid);
                    const pick = (list: string[]) => {
                        const live = list.filter(alive);
                        return live.length
                            ? live[Math.floor(random() * live.length)]
                            : undefined;
                    };
                    const want = Math.min(4, 60 - liveMissiles(world));
                    for (let n = 0; n < want; n++) {
                        const side = Math.floor(random() * 2);
                        const shooter = pick(factions[side]);
                        const target = pick(factions[1 - side]);
                        if (shooter && target) {
                            const shot = weaponEntries.getCached('nova:129')!
                                .fireFromEntity(shooter, true, target);
                            // Spawned, not just asked for: a full shot
                            // table (core/engine_limits.ts) refuses the
                            // missile.
                            if (f === 0 && shot) {
                                fired++;
                            }
                        }
                    }
                    for (let i = 0; i < 8; i++) {
                        const uuid = factions[i % 2][Math.floor(i / 2)];
                        if ((tick + i) % 5 === 0 && alive(uuid)) {
                            weaponEntries.getCached('nova:132')!
                                .fireFromEntity(uuid);
                        }
                    }
                    world.step();
                    if (tick % 10 === 9) {
                        hashes.push(hashWorld(world).hash);
                    }
                }
                if (hashes.length) {
                    expect(hashes[1]).withContext(`tick ${tick}`).toBe(hashes[0]);
                    if (hashes[1] !== hashes[0]) {
                        return;
                    }
                }
            }
            // The scans had work to do: missiles flew and most ended
            // early (a 240-tick missile ends inside 200 ticks only by
            // striking something). Counted as SPAWNED: the shot table
            // (core/engine_limits.ts), shared with the point-defense bolts,
            // can refuse some missiles (under the original's 128, seeds
            // 3 / 11 spawned 95 / 97, and 35 / 37 ended).
            expect(fired).toBeGreaterThan(80);
            expect(fired - liveMissiles(fights[0].world)).toBeGreaterThan(30);
        }, 120000);
    }
});
