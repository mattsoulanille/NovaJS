import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent }
    from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { getDefaultProjectileWeaponData, getDefaultSeekerFlags, SeekerFlags }
    from 'novadatainterface/weapon_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import {
    ATTACK_PARENT_IF_JAMMED_PROBABILITY,
    decideJamReaction,
    DECOY_RETARGET_PROBABILITY,
    deriveJamming,
    DecoyTargetComponent,
    effectiveJamming,
    findNearestDecoy,
    JamDecisionComponent,
    Jamming,
    JammingComponent,
    jamTypeProbability,
    jamTypeRollJams,
    MissileJammingSystem,
    missileJamProbability,
    RADAR_JAM_INDEX,
    rollMissileJammed,
    SystemInterferenceResource,
} from './jamming_plugin.js';
import { ProjectileDataComponent } from '../core/index.js';
import { SourceComponent } from './fire_weapon_plugin.js';
import { TargetComponent } from '../ship/index.js';

/** A stand-in for the simulation game data, exposing only Outfit.getCached. */
function mockGameData(outfits: Record<string, ReturnType<typeof getDefaultOutfitData>>) {
    return {
        data: {
            Outfit: {
                getCached: (id: string) => outfits[id],
            },
        },
    } as any;
}

function movement(x: number, y: number) {
    return {
        position: new Position(x, y),
        rotation: new Angle(0),
        velocity: new Vector(0, 0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    };
}

function jammer(jamming: [number, number, number, number]) {
    return { ...getDefaultOutfitData(), jamming };
}

describe('deriveJamming (the largest single jammer outfit, per type)', () => {
    it('takes the largest outfit per type, not the sum', () => {
        const gameData = mockGameData({
            'nova:irJammer': jammer([20, 0, 0, 0]),
            'nova:radarJammer': jammer([0, 15, 0, 0]),
            'nova:bigIr': jammer([35, 5, 0, 0]),
        });
        const outfits = new Map([
            ['nova:irJammer', { count: 1 }],
            ['nova:radarJammer', { count: 1 }],
            ['nova:bigIr', { count: 1 }],
        ]);
        expect(deriveJamming(outfits, gameData)).toEqual([35, 15, 0, 0]);
    });

    it('treats four +25 jammers as 25 (the count is not a multiplier)', () => {
        // The reference's stacked cell: 1-4 Kit Jammer 25s all behave like
        // J = 25 against the original's missiles.
        const gameData = mockGameData({ kit25: jammer([25, 0, 0, 0]) });
        expect(deriveJamming(new Map([['kit25', { count: 4 }]]), gameData))
            .toEqual([25, 0, 0, 0]);
    });

    it('lets one +100 jammer give 100', () => {
        const gameData = mockGameData({
            kit25: jammer([25, 0, 0, 0]),
            big: jammer([100, 0, 0, 0]),
        });
        const outfits = new Map([['kit25', { count: 3 }], ['big', { count: 1 }]]);
        expect(deriveJamming(outfits, gameData)).toEqual([100, 0, 0, 0]);
    });

    it('ignores an outfit entry with a zero count', () => {
        const gameData = mockGameData({ big: jammer([100, 0, 0, 0]) });
        expect(deriveJamming(new Map([['big', { count: 0 }]]), gameData))
            .toEqual([0, 0, 0, 0]);
    });

    it('never goes below zero for a negative outfit', () => {
        const gameData = mockGameData({
            jam: jammer([30, 0, 0, 0]),
            disruptor: jammer([-10, 0, 0, 0]),
        });
        const outfits = new Map([['jam', { count: 1 }], ['disruptor', { count: 1 }]]);
        expect(deriveJamming(outfits, gameData)).toEqual([30, 0, 0, 0]);
    });

    it('returns undefined when an outfit is not cached yet', () => {
        const gameData = mockGameData({});
        const outfits = new Map([['missing', { count: 1 }]]);
        expect(deriveJamming(outfits, gameData)).toBeUndefined();
    });

    it('returns all zeroes for a ship with no jamming outfits', () => {
        const gameData = mockGameData({ p: jammer([0, 0, 0, 0]) });
        const outfits = new Map([['p', { count: 3 }]]);
        expect(deriveJamming(outfits, gameData)).toEqual([0, 0, 0, 0]);
    });
});

describe('effectiveJamming', () => {
    const noSeeker = getDefaultSeekerFlags();

    it('clamps negative ship jamming to zero and caps at 100', () => {
        expect(effectiveJamming([-5, 200, 0, 0], noSeeker, 0))
            .toEqual([0, 100, 0, 0]);
    });

    it('adds system interference to the radar slot only for confusedByInterference missiles', () => {
        const radarSeeker: SeekerFlags = { ...noSeeker, confusedByInterference: true };
        const eff = effectiveJamming([0, 10, 0, 0], radarSeeker, 30);
        expect(eff[RADAR_JAM_INDEX]).toEqual(40); // 10 + 30
        // Other slots unaffected.
        expect(eff[0]).toEqual(0);
        expect(eff[2]).toEqual(0);
        expect(eff[3]).toEqual(0);
    });

    it('ignores system interference when the missile is not confusedByInterference', () => {
        const eff = effectiveJamming([0, 10, 0, 0], noSeeker, 30);
        expect(eff[RADAR_JAM_INDEX]).toEqual(10);
    });

    it('caps the interference-boosted radar slot at 100', () => {
        const radarSeeker: SeekerFlags = { ...noSeeker, confusedByInterference: true };
        const eff = effectiveJamming([0, 80, 0, 0], radarSeeker, 90);
        expect(eff[RADAR_JAM_INDEX]).toEqual(100);
    });
});

/** The share of `n` evenly spaced rolls in [0, 1) that jam: the exact
 * probability of jamTypeRollJams under a uniform roll, to 1/n. */
function rollShare(vuln: number, jam: number, n = 10000) {
    let jammed = 0;
    for (let i = 0; i < n; i++) {
        if (jamTypeRollJams(vuln, jam, (i + 0.5) / n)) {
            jammed++;
        }
    }
    return jammed / n;
}

describe('the jam threshold J > (100 - V) + r * V', () => {
    // The reference's measured anchors (docs/reference_experiments.md,
    // "J-series wave 3"): V 100 loses about J; V 50 loses nothing up to J 50
    // and everything at J 100.
    const anchors: Array<[number, number, number]> = [
        // [V, J, P]
        [100, 25, 0.25],
        [100, 75, 0.75],
        [100, 100, 1],
        [50, 25, 0],
        [50, 50, 0],
        [50, 75, 0.5],
        [50, 100, 1],
        [100, 0, 0],
    ];

    for (const [v, j, p] of anchors) {
        it(`gives P = ${p} at V ${v} / J ${j}`, () => {
            expect(jamTypeProbability(v, j)).toBeCloseTo(p, 10);
            // And the roll the sim makes realises that probability.
            expect(rollShare(v, j)).toBeCloseTo(p, 3);
        });
    }

    it('never jams a missile with no vulnerability, whatever the jamming', () => {
        expect(jamTypeProbability(0, 100)).toEqual(0);
        expect(jamTypeRollJams(0, 100, 0)).toBeFalse();
    });

    it('jams at V 100 / J 100 even on the highest roll', () => {
        expect(jamTypeRollJams(100, 100, 0.999999)).toBeTrue();
    });

    it('does not jam at V 50 / J 50 even on the lowest roll', () => {
        // 50 > 50 + 0 * 50 is false: the threshold is strict.
        expect(jamTypeRollJams(50, 50, 0)).toBeFalse();
    });

    it('rolls each type independently and jams if any type does', () => {
        // IR jams on its roll, radar does not on its.
        expect(rollMissileJammed([100, 100, 0, 0], [25, 25, 0, 0],
            [0.1, 0.9, 0, 0])).toBeTrue();
        expect(rollMissileJammed([100, 100, 0, 0], [25, 25, 0, 0],
            [0.9, 0.9, 0, 0])).toBeFalse();
        // A type the missile is not vulnerable to never jams.
        expect(rollMissileJammed([0, 100, 0, 0], [100, 0, 0, 0],
            [0, 0, 0, 0])).toBeFalse();
    });

    it('combines independent types as 1 - product(1 - P_k)', () => {
        expect(missileJamProbability([100, 100, 0, 0], [50, 50, 0, 0]))
            .toBeCloseTo(1 - 0.5 * 0.5, 10);
    });
});

describe('decideJamReaction (seeker-flag reaction slices)', () => {
    const flags = (over: Partial<SeekerFlags>): SeekerFlags =>
        ({ ...getDefaultSeekerFlags(), ...over });
    // A reaction roll inside the first (parent) slice / just past each slice.
    const inFirstSlice = ATTACK_PARENT_IF_JAMMED_PROBABILITY / 2;
    const pastParent = ATTACK_PARENT_IF_JAMMED_PROBABILITY
        + DECOY_RETARGET_PROBABILITY / 2;
    const pastBoth = ATTACK_PARENT_IF_JAMMED_PROBABILITY
        + DECOY_RETARGET_PROBABILITY;

    it('returns none when the missile is not jammed', () => {
        expect(decideJamReaction(false, 0, flags({})).kind).toEqual('none');
        expect(decideJamReaction(false, 0, flags({
            attackParentIfJammed: true, turnsAwayIfJammed: true,
        })).kind).toEqual('none');
    });

    it('flies straight by default when jammed with no special seeker flags', () => {
        expect(decideJamReaction(true, 0, flags({})).kind)
            .toEqual('flyStraight');
    });

    it('retargets the parent only when the reaction roll is in its slice', () => {
        const all = flags({
            attackParentIfJammed: true,
            decoyedByAsteroids: true,
            turnsAwayIfJammed: true,
        });
        expect(decideJamReaction(true, inFirstSlice, all).kind)
            .toEqual('retargetParent');
        // Past the parent slice but inside the decoy slice.
        expect(decideJamReaction(true, pastParent, all).kind)
            .toEqual('retargetDecoy');
        // Past both retarget slices: falls through to veer.
        expect(decideJamReaction(true, pastBoth, all).kind)
            .toEqual('veerAway');
    });

    it('gives decoy the first slice when the parent flag is unset', () => {
        const decoyVeer = flags({
            decoyedByAsteroids: true,
            turnsAwayIfJammed: true,
        });
        expect(decideJamReaction(true, DECOY_RETARGET_PROBABILITY / 2,
            decoyVeer).kind).toEqual('retargetDecoy');
        expect(decideJamReaction(true, DECOY_RETARGET_PROBABILITY,
            decoyVeer).kind).toEqual('veerAway');
    });

    it('flies straight when a retarget slice misses and turnsAway is unset', () => {
        expect(decideJamReaction(true, 0.99,
            flags({ decoyedByAsteroids: true })).kind).toEqual('flyStraight');
    });

    it('veers away when only turnsAwayIfJammed is set, whatever the reaction roll', () => {
        expect(decideJamReaction(true, 0, flags({ turnsAwayIfJammed: true }))
            .kind).toEqual('veerAway');
        expect(decideJamReaction(true, 0.99,
            flags({ turnsAwayIfJammed: true })).kind).toEqual('veerAway');
    });
});

describe('findNearestDecoy (decoy retargeting selection)', () => {
    function decoyEntity(x: number, y: number, weight = 1) {
        return new Entity()
            .addComponent(DecoyTargetComponent, { weight })
            .addComponent(MovementStateComponent, movement(x, y));
    }

    it('returns undefined when there are no decoys', () => {
        const entities = new Map<string, Entity>([
            ['plain', new Entity().addComponent(MovementStateComponent, movement(0, 0))],
        ]);
        expect(findNearestDecoy(entities, new Position(0, 0))).toBeUndefined();
    });

    it('ignores decoys out of range', () => {
        // 5000 units away, well beyond DECOY_DISTRACTION_RANGE (1000) but still
        // inside the wrapping ±10000 world, so it does not wrap back into range.
        const entities = new Map<string, Entity>([
            ['far', decoyEntity(5000, 0)],
        ]);
        expect(findNearestDecoy(entities, new Position(0, 0))).toBeUndefined();
    });

    it('picks the nearest in-range decoy at equal weight', () => {
        const entities = new Map<string, Entity>([
            ['near', decoyEntity(10, 0)],
            ['mid', decoyEntity(50, 0)],
        ]);
        expect(findNearestDecoy(entities, new Position(0, 0))).toEqual('near');
    });

    it('prefers higher weight even if farther', () => {
        const entities = new Map<string, Entity>([
            ['light-near', decoyEntity(10, 0, 1)],
            ['heavy-far', decoyEntity(200, 0, 5)],
        ]);
        expect(findNearestDecoy(entities, new Position(0, 0))).toEqual('heavy-far');
    });

    it('breaks exact ties by uuid for a total (deterministic) order', () => {
        const entities = new Map<string, Entity>([
            ['bbb', decoyEntity(10, 0)],
            ['aaa', decoyEntity(10, 0)],
        ]);
        // Same weight and distance: the lexicographically smaller id wins.
        expect(findNearestDecoy(entities, new Position(0, 0))).toEqual('aaa');
    });
});

/**
 * Builds a bare world with only what MissileJammingSystem needs: the random
 * generator, the interference resource, and the system itself.
 */
function makeJammingWorld(seed: number, interference = 0) {
    const world = new World('jamming-test');
    world.resources.set(RandomResource, new Random(seed));
    world.resources.set(SystemInterferenceResource, { interference });
    world.resources.set(TimeResource,
        { time: 0, delta_s: 1 / 60, delta_ms: 1000 / 60, frame: 0 });
    world.addSystem(MissileJammingSystem);
    return world;
}

/** A guided missile targeting `targetId`, vulnerable per the given vector. */
function makeMissile(targetId: string | undefined,
    jamVulnerabilities: [number, number, number, number],
    seeker: Partial<SeekerFlags> = {}) {
    const data = {
        ...getDefaultProjectileWeaponData(),
        guidance: 'guided' as const,
        jamVulnerabilities,
        seeker: { ...getDefaultSeekerFlags(), ...seeker },
    };
    const missile = new Entity('missile')
        .addComponent(ProjectileDataComponent, data)
        .addComponent(MovementStateComponent, movement(0, 0))
        .addComponent(TargetComponent, { target: targetId });
    return missile;
}

/** A jamming ship at a position. */
function makeShip(x: number, y: number, jamming: Jamming) {
    return new Entity('ship')
        .addComponent(MovementStateComponent, movement(x, y))
        .addComponent(JammingComponent, jamming);
}

function steerOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(JamDecisionComponent)
        ?.steer;
}

/** Launches `count` missiles (`m000`, `m001`, ...) at `target` in one tick
 * and returns their decisions. */
function salvo(world: World, count: number, target: string,
    vuln: [number, number, number, number],
    seeker: Partial<SeekerFlags> = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const id = `m${String(i).padStart(3, '0')}`;
        world.entities.set(id, makeMissile(target, vuln, seeker));
        ids.push(id);
    }
    world.step();
    return ids.map(id => steerOf(world, id));
}

describe('MissileJammingSystem (one decision per missile)', () => {
    it('decides a missile the tick it is launched, and never again', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        world.entities.set('missile', makeMissile('ship', [100, 0, 0, 0]));

        world.step();
        expect(steerOf(world, 'missile')).toEqual('flyStraight');

        // The decision drew exactly five numbers; later ticks draw none.
        const expected = new Random(1);
        for (let i = 0; i < 5; i++) {
            expected.next();
        }
        const random = world.resources.get(RandomResource)!;
        expect(random.getState()).toEqual(expected.getState());
        for (let i = 0; i < 200; i++) {
            world.step();
            expect(steerOf(world, 'missile')).toEqual('flyStraight');
        }
        expect(random.getState()).toEqual(expected.getState());
    });

    it('keeps a missile that passed its roll tracking for life, even if the target jams harder later', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        world.entities.set('missile', makeMissile('ship', [100, 0, 0, 0]));
        world.step();
        expect(steerOf(world, 'missile')).toEqual('track');

        // A jammer switched on mid-flight changes nothing: no re-roll.
        world.entities.get('ship')!.components.set(JammingComponent,
            [100, 0, 0, 0]);
        for (let i = 0; i < 100; i++) {
            world.step();
        }
        expect(steerOf(world, 'missile')).toEqual('track');
    });

    it('never jams a missile whose vulnerabilities do not match the ship jamming', () => {
        const world = makeJammingWorld(1);
        // Ship jams IR (index 0); missile vulnerable only to radar (index 1).
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        expect(salvo(world, 200, 'ship', [0, 100, 0, 0])
            .every(steer => steer === 'track')).toBeTrue();
    });

    it('jams about J of V 100 missiles against J 25, and none of V 50', () => {
        const world = makeJammingWorld(3);
        world.entities.set('ship', makeShip(0, 100, [25, 0, 0, 0]));
        const v100 = salvo(world, 800, 'ship', [100, 0, 0, 0]);
        const share = v100.filter(s => s === 'flyStraight').length / 800;
        // Binomial sd at p = 0.25, n = 800 is about 0.015.
        expect(share).toBeGreaterThan(0.19);
        expect(share).toBeLessThan(0.31);

        const world50 = makeJammingWorld(3);
        world50.entities.set('ship', makeShip(0, 100, [25, 0, 0, 0]));
        expect(salvo(world50, 400, 'ship', [50, 0, 0, 0])
            .every(steer => steer === 'track')).toBeTrue();
    });

    it('jams every V 50 missile against J 100', () => {
        const world = makeJammingWorld(5);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        expect(salvo(world, 200, 'ship', [50, 0, 0, 0])
            .every(steer => steer === 'flyStraight')).toBeTrue();
    });

    it('turns a jammed turnsAwayIfJammed missile away for life', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        world.entities.set('missile',
            makeMissile('ship', [100, 0, 0, 0], { turnsAwayIfJammed: true }));
        for (let i = 0; i < 50; i++) {
            world.step();
            expect(steerOf(world, 'missile')).toEqual('veerAway');
        }
    });

    it('decides a missile launched without a target when it first acquires one', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        world.entities.set('missile', makeMissile(undefined, [100, 0, 0, 0]));
        for (let i = 0; i < 10; i++) {
            world.step();
        }
        expect(steerOf(world, 'missile')).toBeUndefined();
        world.entities.get('missile')!.components.set(TargetComponent,
            { target: 'ship' });
        world.step();
        expect(steerOf(world, 'missile')).toEqual('flyStraight');
    });

    it('is deterministic: identical seed and setup give identical decisions', () => {
        const outcomes = (seed: number) => {
            const world = makeJammingWorld(seed);
            world.entities.set('ship', makeShip(0, 100, [50, 0, 0, 0]));
            return salvo(world, 200, 'ship', [100, 0, 0, 0]);
        };
        expect(outcomes(42)).toEqual(outcomes(42));
        expect(outcomes(42)).not.toEqual(outcomes(43));
    });

    it('retargets some jammed decoy-vulnerable missiles onto a nearby decoy', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        world.entities.set('decoy', new Entity('decoy')
            .addComponent(DecoyTargetComponent, { weight: 1 })
            .addComponent(MovementStateComponent, movement(0, 50)));
        const steers = salvo(world, 200, 'ship', [100, 0, 0, 0],
            { decoyedByAsteroids: true });
        const decoyed = steers.map((steer, i) => [steer,
            world.entities.get(`m${String(i).padStart(3, '0')}`)!
                .components.get(TargetComponent)!.target] as const)
            .filter(([, target]) => target === 'decoy');
        // DECOY_RETARGET_PROBABILITY of 200: about 20.
        expect(decoyed.length).toBeGreaterThan(5);
        expect(decoyed.length).toBeLessThan(50);
        // A decoyed missile tracks the decoy; the rest fly straight.
        expect(decoyed.every(([steer]) => steer === 'track')).toBeTrue();
        expect(steers.filter(steer => steer === 'flyStraight').length)
            .toEqual(200 - decoyed.length);
    });

    it('retargets some jammed attackParentIfJammed missiles onto their parent', () => {
        const world = makeJammingWorld(1);
        world.entities.set('parent', makeShip(0, 200, [0, 0, 0, 0]));
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        for (let i = 0; i < 200; i++) {
            const missile = makeMissile('ship', [100, 0, 0, 0],
                { attackParentIfJammed: true });
            missile.components.set(SourceComponent, 'parent');
            world.entities.set(`m${String(i).padStart(3, '0')}`, missile);
        }
        world.step();
        const onParent = [...world.entities.values()].filter(entity =>
            entity.components.get(TargetComponent)?.target === 'parent');
        expect(onParent.length).toBeGreaterThan(5);
        expect(onParent.length).toBeLessThan(50);
        expect(onParent.every(entity =>
            entity.components.get(JamDecisionComponent)?.steer === 'track'))
            .toBeTrue();
    });

    it('adds system interference to jam a radar missile that a jam-free ship would not', () => {
        const world = makeJammingWorld(1, /* interference */ 100);
        world.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        world.entities.set('missile',
            makeMissile('ship', [0, 100, 0, 0], { confusedByInterference: true }));
        world.step();
        expect(steerOf(world, 'missile')).toEqual('flyStraight');
    });

    it('does NOT let system interference jam a radar missile without the confused flag', () => {
        const world = makeJammingWorld(1, /* interference */ 100);
        world.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        world.entities.set('missile',
            makeMissile('ship', [0, 100, 0, 0], { confusedByInterference: false }));
        world.step();
        expect(steerOf(world, 'missile')).toEqual('track');
    });

    /**
     * PRNG-STREAM INDEPENDENCE, the reason every decision draws the same
     * five numbers whatever the jamming: one missile's roll must not move
     * when a DIFFERENT missile's jamming situation changes (a player adding
     * or removing a jammer anywhere in the system would otherwise silently
     * rewrite unrelated missiles' outcomes).
     */
    it('keeps one missile\'s roll independent of another\'s jamming', () => {
        // 'a...' sorts before 'b...', so A's draws come first and any
        // shift in the stream lands on the B missiles.
        const outcomes = (aCanBeJammed: boolean) => {
            const world = makeJammingWorld(7);
            world.entities.set('ship a', makeShip(0, 100,
                aCanBeJammed ? [100, 0, 0, 0] : [0, 0, 0, 0]));
            world.entities.set('ship b', makeShip(0, 200, [50, 0, 0, 0]));
            world.entities.set('a missile',
                makeMissile('ship a', [100, 0, 0, 0]));
            for (let i = 0; i < 100; i++) {
                world.entities.set(`b missile ${i}`,
                    makeMissile('ship b', [100, 0, 0, 0]));
            }
            world.step();
            return {
                a: steerOf(world, 'a missile'),
                b: [...Array(100).keys()].map(i =>
                    steerOf(world, `b missile ${i}`)),
            };
        };
        const withJammer = outcomes(true);
        const withoutJammer = outcomes(false);
        expect(withJammer.a).toEqual('flyStraight');
        expect(withoutJammer.a).toEqual('track');
        // Not vacuous: B's decisions are mixed.
        expect(withJammer.b).toContain('flyStraight');
        expect(withJammer.b).toContain('track');
        expect(withoutJammer.b).toEqual(withJammer.b);
    });
});
