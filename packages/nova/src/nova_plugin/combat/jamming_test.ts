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
    ASTEROID_DECOY_CAPTURE_HALF_ANGLE,
    ASTEROID_DECOY_CAPTURE_RANGE,
    ATTACK_PARENT_IF_JAMMED_PROBABILITY,
    captureCone,
    decideJamReaction,
    DECOY_DISTRACTION_RANGE,
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
    rollMissileJammed,
    rollInterferenceConfusion,
    INTERFERENCE_CONFUSION_PER_POINT_FITTED,
    interferenceConfusionProbability,
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
    it('clamps negative ship jamming to zero and caps at 100', () => {
        expect(effectiveJamming([-5, 200, 0, 0])).toEqual([0, 100, 0, 0]);
    });

    it('is zero for a target without jamming', () => {
        expect(effectiveJamming(undefined)).toEqual([0, 0, 0, 0]);
    });
});

describe('sensor interference (rule 5, Seeker 0x0008)', () => {
    const confusable: SeekerFlags = {
        ...getDefaultSeekerFlags(), confusedByInterference: true,
    };

    it('fits the measured points: none at Interference 0, 68% at 100', () => {
        expect(interferenceConfusionProbability(0)).toEqual(0);
        expect(interferenceConfusionProbability(100)).toBeCloseTo(0.68, 9);
        expect(interferenceConfusionProbability(50)).toBeCloseTo(0.34, 9);
        expect(INTERFERENCE_CONFUSION_PER_POINT_FITTED * 100)
            .toBeCloseTo(1 - 16 / 49.5, 2);
        // Out-of-range interference is clamped like a percentage.
        expect(interferenceConfusionProbability(-10)).toEqual(0);
        expect(interferenceConfusionProbability(500)).toBeCloseTo(0.68, 9);
    });

    it('confuses below P, splitting the directions evenly by the same roll', () => {
        const p = interferenceConfusionProbability(100);
        expect(rollInterferenceConfusion(confusable, 100, 0))
            .toEqual('circleClockwise');
        expect(rollInterferenceConfusion(confusable, 100, p / 2 - 1e-9))
            .toEqual('circleClockwise');
        expect(rollInterferenceConfusion(confusable, 100, p / 2))
            .toEqual('circleCounterclockwise');
        expect(rollInterferenceConfusion(confusable, 100, p - 1e-9))
            .toEqual('circleCounterclockwise');
        expect(rollInterferenceConfusion(confusable, 100, p)).toBeUndefined();
        expect(rollInterferenceConfusion(confusable, 0, 0)).toBeUndefined();
    });

    it('never confuses a missile without the 0x0008 flag', () => {
        expect(rollInterferenceConfusion(getDefaultSeekerFlags(), 100, 0))
            .toBeUndefined();
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

describe('decideJamReaction (seeker-flag reactions)', () => {
    const flags = (over: Partial<SeekerFlags>): SeekerFlags =>
        ({ ...getDefaultSeekerFlags(), ...over });
    // A reaction roll inside / just past the parent slice.
    const inFirstSlice = ATTACK_PARENT_IF_JAMMED_PROBABILITY / 2;
    const pastParent = ATTACK_PARENT_IF_JAMMED_PROBABILITY;

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
        // Past the parent slice: the decoy rule, falling back to veer.
        expect(decideJamReaction(true, pastParent, all))
            .toEqual({ kind: 'retargetDecoy', fallback: 'veerAway' });
        expect(decideJamReaction(true, 0.99, all))
            .toEqual({ kind: 'retargetDecoy', fallback: 'veerAway' });
    });

    it('sends every jammed decoyedByAsteroids missile to the decoy rule, whatever the roll', () => {
        for (const roll of [0, 0.05, 0.1, 0.5, 0.999]) {
            expect(decideJamReaction(true, roll,
                flags({ decoyedByAsteroids: true })))
                .toEqual({ kind: 'retargetDecoy', fallback: 'flyStraight' });
            expect(decideJamReaction(true, roll, flags({
                decoyedByAsteroids: true, turnsAwayIfJammed: true,
            }))).toEqual({ kind: 'retargetDecoy', fallback: 'veerAway' });
        }
    });

    it('falls back to veer/straight when the parent slice misses and there is no decoy flag', () => {
        expect(decideJamReaction(true, pastParent,
            flags({ attackParentIfJammed: true })).kind).toEqual('flyStraight');
        expect(decideJamReaction(true, pastParent, flags({
            attackParentIfJammed: true, turnsAwayIfJammed: true,
        })).kind).toEqual('veerAway');
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

    it('takes an explicit range (the asteroid capture range)', () => {
        const entities = new Map<string, Entity>([
            ['rock', decoyEntity(ASTEROID_DECOY_CAPTURE_RANGE + 1, 0)],
        ]);
        expect(findNearestDecoy(entities, new Position(0, 0),
            ASTEROID_DECOY_CAPTURE_RANGE)).toBeUndefined();
        expect(findNearestDecoy(entities, new Position(0, 0))).toEqual('rock');
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

    it('keeps only decoys inside a given cone', () => {
        const entities = new Map<string, Entity>([
            ['beside', decoyEntity(50, 0)],
            ['behind', decoyEntity(0, 40)],
            ['ahead', decoyEntity(10, -300)],
        ]);
        const cone = captureCone(new Angle(0));
        expect(findNearestDecoy(entities, new Position(0, 0))).toEqual('behind');
        expect(findNearestDecoy(entities, new Position(0, 0),
            DECOY_DISTRACTION_RANGE, cone)).toEqual('ahead');
        // Turned to face +x, 'beside' is dead ahead.
        expect(findNearestDecoy(entities, new Position(0, 0),
            DECOY_DISTRACTION_RANGE, captureCone(new Angle(Math.PI / 2))))
            .toEqual('beside');
    });

    it('counts a decoy at the very position as inside any cone', () => {
        const entities = new Map<string, Entity>([['on', decoyEntity(5, 5)]]);
        expect(findNearestDecoy(entities, new Position(5, 5),
            DECOY_DISTRACTION_RANGE, captureCone(new Angle(1)))).toEqual('on');
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

function targetOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(TargetComponent)?.target;
}

/** The uuid salvo() gives its i-th missile. */
function missileId(i: number) {
    return `m${String(i).padStart(3, '0')}`;
}

/** A stand-in asteroid: a decoy with a position. */
function makeRock(x: number, y: number) {
    return new Entity('rock')
        .addComponent(DecoyTargetComponent, { weight: 1 })
        .addComponent(MovementStateComponent, movement(x, y));
}

/** Launches `count` missiles (`m000`, `m001`, ...) at `target` in one tick
 * and returns their decisions. */
function salvo(world: World, count: number, target: string,
    vuln: [number, number, number, number],
    seeker: Partial<SeekerFlags> = {}) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const id = missileId(i);
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

        // The decision drew exactly six numbers; later ticks draw none.
        const expected = new Random(1);
        for (let i = 0; i < 6; i++) {
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

    it('sends every jammed decoyedByAsteroids missile to the nearest rock ahead in the field', () => {
        const world = makeJammingWorld(1);
        // J 50 against V 100: about half jammed. Rocks ahead (the missiles
        // head -y), beyond the capture range but inside the field, so only
        // the jammed ones go for them; a nearer rock behind is ignored.
        world.entities.set('ship', makeShip(0, -900, [50, 0, 0, 0]));
        world.entities.set('rock near', makeRock(0, -600));
        world.entities.set('rock far', makeRock(0, -800));
        world.entities.set('rock behind', makeRock(0, 300));
        const steers = salvo(world, 200, 'ship', [100, 0, 0, 0],
            { decoyedByAsteroids: true });
        const targets = steers.map((_, i) => targetOf(world, missileId(i)));
        const onRock = targets.filter(target => target === 'rock near').length;
        // Binomial sd at p = 0.5, n = 200 is about 0.035.
        expect(onRock).toBeGreaterThan(70);
        expect(onRock).toBeLessThan(130);
        // Every missile tracks: on the rock if jammed, on the ship if not.
        expect(steers.every(steer => steer === 'track')).toBeTrue();
        expect(targets.filter(target => target === 'ship').length)
            .toEqual(200 - onRock);
        expect(targets).not.toContain('rock far');
        expect(targets).not.toContain('rock behind');
    });

    it('flies a jammed decoyedByAsteroids missile straight when no rock is ahead in the field', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, -900, [100, 0, 0, 0]));
        // One rock ahead but beyond the field, one near but to the side.
        world.entities.set('rock', makeRock(0, -(DECOY_DISTRACTION_RANGE + 10)));
        world.entities.set('rock beside', makeRock(300, 0));
        expect(salvo(world, 20, 'ship', [100, 0, 0, 0],
            { decoyedByAsteroids: true })
            .every(steer => steer === 'flyStraight')).toBeTrue();
        const veer = makeJammingWorld(1);
        veer.entities.set('ship', makeShip(0, -900, [100, 0, 0, 0]));
        expect(salvo(veer, 20, 'ship', [100, 0, 0, 0],
            { decoyedByAsteroids: true, turnsAwayIfJammed: true })
            .every(steer => steer === 'veerAway')).toBeTrue();
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

    it('confuses about 68% of 0x0008 missiles at Interference 100, even at JamVuln 0', () => {
        // The original's wave-5 cell: JamVuln 0 (no jammer can touch it),
        // a jam-free target, Interference 100.
        const world = makeJammingWorld(11, /* interference */ 100);
        world.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        const steers = salvo(world, 800, 'ship', [0, 0, 0, 0],
            { confusedByInterference: true });
        const clockwise = steers.filter(s => s === 'circleClockwise').length;
        const counter = steers.filter(s => s === 'circleCounterclockwise')
            .length;
        // Binomial sd at p = 0.68, n = 800 is about 0.016.
        expect((clockwise + counter) / 800).toBeGreaterThan(0.62);
        expect((clockwise + counter) / 800).toBeLessThan(0.74);
        // Both directions, about evenly.
        expect(clockwise).toBeGreaterThan(220);
        expect(counter).toBeGreaterThan(220);
        expect(steers.filter(s => s === 'track').length)
            .toEqual(800 - clockwise - counter);
    });

    it('confuses none at Interference 0, and no missile without the 0x0008 flag', () => {
        const clear = makeJammingWorld(11, /* interference */ 0);
        clear.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        expect(salvo(clear, 200, 'ship', [0, 0, 0, 0],
            { confusedByInterference: true })
            .every(steer => steer === 'track')).toBeTrue();

        const unflagged = makeJammingWorld(11, /* interference */ 100);
        unflagged.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        expect(salvo(unflagged, 200, 'ship', [0, 100, 0, 0])
            .every(steer => steer === 'track')).toBeTrue();
    });

    it('no longer folds interference into radar jamming', () => {
        // A radar-V 100 0x0008 missile in Interference 100 at a jam-free
        // target: before wave 5 the static counted as 100 radar jamming,
        // so every one flew straight. Now none is jammed: each either
        // circles (confused) or tracks.
        const world = makeJammingWorld(1, /* interference */ 100);
        world.entities.set('ship', makeShip(0, 100, [0, 0, 0, 0]));
        const steers = salvo(world, 200, 'ship', [0, 100, 0, 0],
            { confusedByInterference: true });
        expect(steers).not.toContain('flyStraight');
        expect(steers).toContain('track');
    });

    it('lets confusion take precedence over jamming, at the same odds', () => {
        // Every missile is jammed (V 100 vs J 100), and Interference 100
        // confuses about 68% of them first: those circle, the rest fly
        // straight. Same seed without the flag: all fly straight.
        const world = makeJammingWorld(13, /* interference */ 100);
        world.entities.set('ship', makeShip(0, 100, [100, 0, 0, 0]));
        const steers = salvo(world, 400, 'ship', [100, 0, 0, 0],
            { confusedByInterference: true });
        const circling = steers.filter(s => s?.startsWith('circle')).length;
        expect(circling / 400).toBeGreaterThan(0.6);
        expect(circling / 400).toBeLessThan(0.76);
        expect(steers.filter(s => s === 'flyStraight').length)
            .toEqual(400 - circling);
    });

    it('draws the interference roll for every missile, so the flag never shifts the stream', () => {
        // The second missile's decision must not depend on whether the first
        // could be confused (same pattern as the jammer independence spec).
        const outcomes = (firstFlag: boolean) => {
            const world = makeJammingWorld(17, /* interference */ 100);
            world.entities.set('ship', makeShip(0, 100, [50, 0, 0, 0]));
            world.entities.set('a missile', makeMissile('ship', [0, 0, 0, 0],
                { confusedByInterference: firstFlag }));
            for (let i = 0; i < 100; i++) {
                world.entities.set(`b missile ${i}`, makeMissile('ship',
                    [100, 0, 0, 0], { confusedByInterference: true }));
            }
            world.step();
            return [...Array(100).keys()].map(i =>
                steerOf(world, `b missile ${i}`));
        };
        const withFlag = outcomes(true);
        expect(withFlag).toContain('flyStraight');
        expect(withFlag).toContain('track');
        expect(withFlag.some(s => s?.startsWith('circle'))).toBeTrue();
        expect(outcomes(false)).toEqual(withFlag);
    });

    /**
     * PRNG-STREAM INDEPENDENCE, the reason every decision draws the same
     * six numbers whatever the jamming: one missile's roll must not move
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

describe('asteroid capture of decoyedByAsteroids (Seeker 0x0002) missiles', () => {
    /** Moves an entity (rock or missile) to a new position. */
    function moveTo(world: World, uuid: string, x: number, y: number) {
        world.entities.get(uuid)!.components.get(MovementStateComponent)!
            .position = new Position(x, y);
    }

    /** One unjammed (V 0) missile at the origin aimed at a ship 900 px off. */
    function unjammedWorld(seeker: Partial<SeekerFlags>) {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, -900, [0, 0, 0, 0]));
        world.entities.set('missile',
            makeMissile('ship', [0, 0, 0, 0], seeker));
        return world;
    }

    it('captures an unjammed missile when a rock ahead is within the capture range, on the launch tick', () => {
        const world = unjammedWorld({ decoyedByAsteroids: true });
        // The missile heads -y (Angle 0).
        world.entities.set('rock',
            makeRock(0, -(ASTEROID_DECOY_CAPTURE_RANGE - 1)));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock');
        expect(steerOf(world, 'missile')).toEqual('track');
    });

    it('does not capture beyond the capture range, and captures the first tick a rock comes within it', () => {
        const world = unjammedWorld({ decoyedByAsteroids: true });
        world.entities.set('rock',
            makeRock(0, -(ASTEROID_DECOY_CAPTURE_RANGE + 1)));
        for (let i = 0; i < 30; i++) {
            world.step();
            expect(targetOf(world, 'missile')).toEqual('ship');
        }
        // The rock drifts (or the missile flies) within range mid-flight.
        moveTo(world, 'rock', 0, -(ASTEROID_DECOY_CAPTURE_RANGE - 1));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock');
    });

    it('is permanent: the missile stays on its rock whatever comes nearer', () => {
        const world = unjammedWorld({ decoyedByAsteroids: true });
        world.entities.set('rock a', makeRock(0, -150));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock a');
        // A nearer rock, and the first one drifting far away: no switch.
        world.entities.set('rock b', makeRock(0, -10));
        moveTo(world, 'rock a', 3000, 0);
        for (let i = 0; i < 30; i++) {
            world.step();
            expect(targetOf(world, 'missile')).toEqual('rock a');
        }
    });

    it('picks the nearest rock in range, and breaks a tie by uuid', () => {
        const world = unjammedWorld({ decoyedByAsteroids: true });
        // 'rock z' and 'rock a' mirror each other 10 degrees either side of
        // the heading: exactly the same distance.
        const x = 100 * Math.sin(10 * Math.PI / 180);
        const y = -100 * Math.cos(10 * Math.PI / 180);
        world.entities.set('rock far', makeRock(0, -190));
        world.entities.set('rock z', makeRock(x, y));
        world.entities.set('rock a', makeRock(-x, y));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock a');
    });

    it('captures a jammed missile flying straight when a rock comes within range later', () => {
        const world = makeJammingWorld(1);
        world.entities.set('ship', makeShip(0, -900, [100, 0, 0, 0]));
        world.entities.set('missile', makeMissile('ship', [100, 0, 0, 0],
            { decoyedByAsteroids: true }));
        world.step();
        // No rock anywhere: the plain jammed behaviour.
        expect(steerOf(world, 'missile')).toEqual('flyStraight');
        world.entities.set('rock', makeRock(0, -150));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock');
        expect(steerOf(world, 'missile')).toEqual('track');
    });

    it('leaves plain and 0x0001 missiles alone, jammed or not', () => {
        for (const seeker of [{}, { passOverAsteroids: true }]) {
            const world = makeJammingWorld(1);
            world.entities.set('ship', makeShip(0, -900, [100, 0, 0, 0]));
            world.entities.set('rock', makeRock(0, -20));
            const jammed = salvo(world, 20, 'ship', [100, 0, 0, 0], seeker);
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            expect(jammed.every(steer => steer === 'flyStraight')).toBeTrue();
            for (let i = 0; i < 20; i++) {
                expect(targetOf(world, missileId(i))).toEqual('ship');
            }

            const cleanWorld = makeJammingWorld(1);
            cleanWorld.entities.set('ship', makeShip(0, -900, [0, 0, 0, 0]));
            cleanWorld.entities.set('rock', makeRock(0, -20));
            const clean = salvo(cleanWorld, 20, 'ship', [100, 0, 0, 0], seeker);
            for (let i = 0; i < 30; i++) {
                cleanWorld.step();
            }
            expect(clean.every(steer => steer === 'track')).toBeTrue();
            for (let i = 0; i < 20; i++) {
                expect(targetOf(cleanWorld, missileId(i))).toEqual('ship');
            }
        }
    });

    /** A rock `distance` px from the origin, `degrees` clockwise of the
     * missile's heading (-y). */
    function rockAt(degrees: number, distance: number) {
        const radians = degrees * Math.PI / 180;
        return makeRock(distance * Math.sin(radians),
            -distance * Math.cos(radians));
    }

    it('ignores a rock beside or behind the missile, however close', () => {
        // The original's wave-5 side rocks: 59-84 px off the launch point,
        // 78-107 degrees off the heading, never captured; and rocks just
        // behind it.
        for (const [degrees, distance] of [[78, 84], [-90, 59], [107, 70],
            [180, 79], [-150, 30], [40, 60]]) {
            const world = unjammedWorld({ decoyedByAsteroids: true });
            world.entities.set('rock', rockAt(degrees, distance));
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            expect(targetOf(world, 'missile'))
                .withContext(`rock ${degrees} deg, ${distance} px`)
                .toEqual('ship');
        }
    });

    it('captures only inside the forward cone of ASTEROID_DECOY_CAPTURE_HALF_ANGLE', () => {
        const edge = ASTEROID_DECOY_CAPTURE_HALF_ANGLE * 180 / Math.PI;
        expect(edge).toBeCloseTo(25, 9);
        for (const [degrees, captured] of [[0, true], [20, true], [-20, true],
            [edge - 0.5, true], [-(edge - 0.5), true], [edge + 0.5, false],
            [-(edge + 0.5), false], [29, false]] as const) {
            const world = unjammedWorld({ decoyedByAsteroids: true });
            world.entities.set('rock', rockAt(degrees, 150));
            world.step();
            expect(targetOf(world, 'missile'))
                .withContext(`rock ${degrees} deg off the heading`)
                .toEqual(captured ? 'rock' : 'ship');
        }
    });

    it('follows the missile heading, not its target bearing', () => {
        // A missile that has turned east (Angle pi/2): a rock east of it is
        // ahead, one north of it (towards the ship) is beside.
        const world = unjammedWorld({ decoyedByAsteroids: true });
        world.entities.get('missile')!.components.get(MovementStateComponent)!
            .rotation = new Angle(Math.PI / 2);
        world.entities.set('rock north', makeRock(0, -120));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('ship');
        world.entities.set('rock east', makeRock(150, 0));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock east');
    });

    it('draws no random numbers for a capture', () => {
        const world = unjammedWorld({ decoyedByAsteroids: true });
        world.step();
        const random = world.resources.get(RandomResource)!;
        const after = random.getState();
        world.entities.set('rock', makeRock(0, -100));
        world.step();
        expect(targetOf(world, 'missile')).toEqual('rock');
        expect(random.getState()).toEqual(after);
    });
});
