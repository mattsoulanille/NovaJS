import 'jasmine';
import { RunQuery } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { ProjectileWeaponData, SeekerFlags } from 'novadatainterface/weapon_data';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { deriveEntityComponents, ProjectileDataComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { loadWeaponsGameData } from '../spawn/index.js';
import { WeaponConstructors } from './fire_weapon_plugin.js';
import {
    ASTEROID_DECOY_CAPTURE_HALF_ANGLE, ASTEROID_DECOY_CAPTURE_RANGE,
    DecoyTargetComponent, JamDecisionComponent, JammingComponent,
    SystemInterferenceResource,
} from './jamming_plugin.js';
import { AsteroidComponent, loadAsteroidGameData, makeAsteroid }
    from './asteroid_plugin.js';
import { TargetComponent } from '../ship/index.js';

/**
 * Jamming in a real simulation world: missiles fired through the real
 * projectile weapon entry, steered by the real guidance and movement systems,
 * and snapshotted/restored by the real rollback snapshot layer.
 *
 * The synthetic data set has one guided missile (the Harrier Missile) and it
 * has no jam vulnerability, so each spec fires a copy of it with JamVuln and
 * Seeker flags set; its wëap id stays the Harrier's, so the serializer and the
 * world hash treat it as that weapon. The target is a bare entity carrying a
 * JammingComponent (no outfits, so JammingProvider leaves it alone).
 */

const HARRIER = SYNTHETIC.weapons.missile;

/** Stock IR Missile (wëap 134) GuidedTurn 70, as the parser converts it:
 * 210 deg/s. */
const IR_TURN_RATE = 70 * 3 * Math.PI / 180;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('missile jamming in flight', () => {
    let gameData: GameData;
    let world: World;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach: no asteroids, and npcs off, so nothing else flies.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        await loadWeaponsGameData(world, [HARRIER]);
        await loadAsteroidGameData(gameData, SYNTHETIC.asteroid);
    });

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    function addTarget(uuid: string, x: number, y: number,
        jamming: [number, number, number, number]) {
        world.entities.set(uuid, new Entity(uuid)
            .addComponent(MovementStateComponent, {
                position: new Position(x, y),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0,
                turning: 0,
                turnBack: false,
            })
            .addComponent(JammingComponent, jamming));
    }

    /** A stand-in asteroid: a still decoy with a position (no hull, so
     * nothing collides with it). addAsteroid makes a real one. */
    function addRock(uuid: string, x: number, y: number) {
        world.entities.set(uuid, new Entity(uuid)
            .addComponent(MovementStateComponent, {
                position: new Position(x, y),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0,
                turning: 0,
                turnBack: false,
            })
            .addComponent(DecoyTargetComponent, { weight: 1 }));
    }

    function targetOf(uuid: string) {
        return world.entities.get(uuid)?.components.get(TargetComponent)
            ?.target;
    }

    /** A projectile weapon entry for a Harrier with the given jamming
     * vulnerabilities and seeker flags. */
    async function launcher(jamVulnerabilities: [number, number, number, number],
        seeker: Partial<SeekerFlags> = {}) {
        const harrier = await gameData.data.Weapon.get(HARRIER) as
            ProjectileWeaponData;
        expect(harrier.guidance).toBe('guided');
        const data: ProjectileWeaponData = {
            ...harrier,
            jamVulnerabilities,
            seeker: { ...harrier.seeker, ...seeker },
        };
        const construct = world.resources.get(WeaponConstructors)!
            .get('ProjectileWeaponData')!;
        return new construct(data, world.resources.get(RunQuery)!);
    }

    /** Fires one missile from (0, 0) facing -y (Angle 0) at `target`;
     * returns its uuid. */
    function fire(entry: Awaited<ReturnType<typeof launcher>>,
        target: string): string {
        const missile = entry.fire(new Position(0, 0), new Angle(0),
            undefined, target);
        expect(missile).toBeDefined();
        const found = [...world.entities].find(([, e]) => e === missile);
        expect(found).withContext('missile is in the world').toBeDefined();
        return found![0];
    }

    function flight(uuid: string) {
        const track: Array<{ x: number, y: number, rotation: number }> = [];
        for (let i = 0; i < 2000; i++) {
            world.step();
            const movement = world.entities.get(uuid)
                ?.components.get(MovementStateComponent);
            if (!movement) {
                break;
            }
            track.push({
                x: movement.position.x,
                y: movement.position.y,
                rotation: movement.rotation.angle,
            });
        }
        return track;
    }

    it('flies a jammed missile dead straight for its whole life', async () => {
        // V 100 against J 100: jammed on every roll.
        addTarget('target', 400, 0, [100, 0, 0, 0]);
        step(5);
        const uuid = fire(await launcher([100, 0, 0, 0]), 'target');
        const track = flight(uuid);

        const harrier = await gameData.data.Weapon.get(HARRIER) as
            ProjectileWeaponData;
        // It lived its full life (about shotDuration / 1000 s of ticks),
        // never hitting anything and never turning.
        expect(track.length).toBeGreaterThan(
            harrier.shotDuration / 1000 * 30);
        expect(track.every(p => p.rotation === track[0].rotation))
            .withContext('heading never changes').toBeTrue();
        expect(track.every(p => Math.abs(p.x) < 1e-6))
            .withContext('stays on the launch line').toBeTrue();
        // And it really went somewhere along that line.
        expect(track[track.length - 1].y).toBeLessThan(-1000);
    });

    it('steers an unjammed missile onto the same target (control)', async () => {
        addTarget('target', 400, 0, [0, 0, 0, 0]);
        step(5);
        const uuid = fire(await launcher([100, 0, 0, 0]), 'target');
        const track = flight(uuid);
        expect(track.some(p => p.rotation !== track[0].rotation))
            .withContext('it turns toward the target').toBeTrue();
        expect(track.some(p => p.x > 100)).toBeTrue();
    });

    it('turns a jammed turn-away missile directly away from its target', async () => {
        addTarget('target', 400, 0, [100, 0, 0, 0]);
        step(5);
        const uuid = fire(await launcher([100, 0, 0, 0],
            { turnsAwayIfJammed: true }), 'target');
        const track = flight(uuid);
        // Ends up heading away from the target (negative x).
        expect(track[track.length - 1].x).toBeLessThan(-200);
    });

    it('replays the same decisions after a rollback, and keeps them across a restore', async () => {
        // V 100 against J 50: half the missiles are jammed.
        addTarget('target', 400, 0, [50, 0, 0, 0]);
        step(5);
        const entry = await launcher([100, 0, 0, 0]);

        const beforeLaunch = snapshotWorld(world);
        const salvo = () => {
            const ids: string[] = [];
            for (let i = 0; i < 24; i++) {
                ids.push(fire(entry, 'target'));
            }
            step(1);
            return ids.map(id => [id, world.entities.get(id)!
                .components.get(JamDecisionComponent)?.steer] as const);
        };

        const first = salvo();
        const steers = first.map(([, steer]) => steer);
        expect(steers).toContain('flyStraight');
        expect(steers).toContain('track');

        // Mid-flight snapshot: decisions already made.
        const midFlight = snapshotWorld(world);
        const original: string[] = [];
        for (let i = 0; i < 90; i++) {
            world.step();
            original.push(hashWorld(world).hash);
        }

        // Restoring mid-flight keeps each missile's decision (no re-roll)
        // and retraces the original timeline exactly.
        restoreWorld(world, midFlight, deriveEntityComponents);
        expect(first.map(([id]) => world.entities.get(id)!
            .components.get(JamDecisionComponent)?.steer)).toEqual(steers);
        const resimulated: string[] = [];
        for (let i = 0; i < 90; i++) {
            world.step();
            resimulated.push(hashWorld(world).hash);
        }
        expect(resimulated).toEqual(original);

        // Rolling back past the launch and firing again re-makes the very
        // same decisions: same PRNG state, same order.
        restoreWorld(world, beforeLaunch, deriveEntityComponents);
        expect(salvo()).toEqual(first);

        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
        // The fired copies kept their jam vulnerabilities through restore.
        expect(world.entities.get(first[0][0])!
            .components.get(ProjectileDataComponent)!.jamVulnerabilities)
            .toEqual([100, 0, 0, 0]);
    });

    /** Flies `uuid` for up to `ticks` ticks; returns, per tick, its target
     * after the tick and its distance to `rock` going into the tick (what
     * MissileJammingSystem sees: it runs before movement). */
    function targetTrack(uuid: string, rock: string, ticks: number) {
        const rockPosition = world.entities.get(rock)!
            .components.get(MovementStateComponent)!.position;
        const track: Array<{ target?: string, rockDistance: number }> = [];
        for (let i = 0; i < ticks; i++) {
            const movement = world.entities.get(uuid)
                ?.components.get(MovementStateComponent);
            if (!movement) {
                break;
            }
            const rockDistance =
                movement.position.subtract(rockPosition).length;
            world.step();
            if (!world.entities.has(uuid)) {
                break;
            }
            track.push({ target: targetOf(uuid), rockDistance });
        }
        return track;
    }

    /** A real asteroid (the synthetic Shoal rock: hull, collisions, damage),
     * standing still at (x, y). */
    async function addAsteroid(uuid: string, x: number, y: number) {
        const data = await gameData.data.Asteroid.get(SYNTHETIC.asteroid);
        world.entities.set(uuid, makeAsteroid(gameData, data,
            world.resources.get(RandomResource)!, new Position(x, y),
            new Vector(0, 0)));
    }

    function asteroidHealth(uuid: string) {
        return world.entities.get(uuid)?.components.get(AsteroidComponent)
            ?.health;
    }

    /** A launcher for a Harrier with an IR Missile's flight (stock wëap
     * 134: 405 px/s, 210 deg/s, a 100-frame life), so its turning radius
     * is the stock missile's, about 110 px. */
    async function irLikeLauncher(seeker: Partial<SeekerFlags>) {
        const harrier = await gameData.data.Weapon.get(HARRIER) as
            ProjectileWeaponData;
        const data: ProjectileWeaponData = {
            ...harrier,
            seeker: { ...harrier.seeker, ...seeker },
            shotSpeed: 405,
            shotDuration: 100 / 30 * 1000,
            physics: {
                ...harrier.physics,
                speed: 405,
                turnRate: IR_TURN_RATE,
            },
        };
        const construct = world.resources.get(WeaponConstructors)!
            .get('ProjectileWeaponData')!;
        return new construct(data, world.resources.get(RunQuery)!);
    }

    /** Distance from `uuid` to `other` now. */
    function distance(uuid: string, other: string) {
        const a = world.entities.get(uuid)!.components
            .get(MovementStateComponent)!.position;
        const b = world.entities.get(other)!.components
            .get(MovementStateComponent)!.position;
        return a.subtract(b).length;
    }

    it('turns an unjammed 0x0002 missile onto a rock ahead once it is in range, and hits it', async () => {
        // The target dead ahead (the missile heads -y), a rock just off
        // the line of fire: ahead of the missile the whole way, but out of
        // capture range at launch.
        addTarget('target', 0, -900, [0, 0, 0, 0]);
        await addAsteroid('rock', 40, -500);
        const health = asteroidHealth('rock')!;
        step(5);
        const uuid = fire(await launcher([0, 0, 0, 0],
            { decoyedByAsteroids: true }), 'target');
        const track = targetTrack(uuid, 'rock', 600);
        const captured = track.findIndex(p => p.target === 'rock');
        expect(captured).withContext('captured mid-flight')
            .toBeGreaterThan(0);
        // Never closer than the capture range before the capture tick, and
        // within it on that tick.
        expect(track.slice(0, captured).every(p =>
            p.target === 'target'
            && p.rockDistance > ASTEROID_DECOY_CAPTURE_RANGE)).toBeTrue();
        expect(track[captured].rockDistance)
            .toBeLessThanOrEqual(ASTEROID_DECOY_CAPTURE_RANGE);
        // Then it hits the rock: gone well before the end of its life,
        // and the rock took the damage.
        expect(world.entities.has(uuid)).withContext('missile spent')
            .toBeFalse();
        expect(track.length).toBeLessThan(captured + 90);
        expect(asteroidHealth('rock')).toBeLessThan(health);
    });

    it('ignores a rock beside the launch point and flies on to its target', async () => {
        // The original's wave-5 case: rocks 59-84 px to the side of the
        // launch point (78-107 degrees off the heading) never captured.
        for (const [x, y] of [[70, 0], [-60, -15], [80, 20]]) {
            addTarget('target', 0, -500, [0, 0, 0, 0]);
            await addAsteroid('rock', x, y);
            step(5);
            const uuid = fire(await launcher([0, 0, 0, 0],
                { decoyedByAsteroids: true }), 'target');
            let closest = Infinity;
            for (let i = 0; i < 300; i++) {
                world.step();
                if (!world.entities.has(uuid)) {
                    break;
                }
                expect(targetOf(uuid)).toEqual('target');
                closest = Math.min(closest, distance(uuid, 'target'));
            }
            expect(closest).withContext(`rock at (${x}, ${y})`)
                .toBeLessThan(15);
            world.entities.delete(uuid);
            world.entities.delete('rock');
        }
    });

    it('hits a rock captured anywhere in the cone with an IR Missile turn rate (no orbit)', async () => {
        // The hardest rocks to reach sit at the edge of the cone, near the
        // missile: at r sin(25 deg), about 46 px, the rock lies deepest
        // inside the turning circle (radius r = 405 px/s / 3.665 rad/s,
        // about 110 px). Every placement must end in a hit, not a circle.
        const half = ASTEROID_DECOY_CAPTURE_HALF_ANGLE - 1e-6;
        const radius = 405 / IR_TURN_RATE;
        const placements = [
            [half, radius * Math.sin(half)],
            [-half, radius * Math.sin(half)],
            [half, 80], [-half, 150], [half, ASTEROID_DECOY_CAPTURE_RANGE - 1],
            [0.35, 120], [0, 190],
        ];
        for (const [angle, d] of placements) {
            addTarget('target', 0, -900, [0, 0, 0, 0]);
            await addAsteroid('rock', d * Math.sin(angle),
                -d * Math.cos(angle));
            const health = asteroidHealth('rock')!;
            step(5);
            const uuid = fire(await irLikeLauncher({ decoyedByAsteroids: true }),
                'target');
            let ticks = 0;
            let onRock = false;
            for (; ticks < 200 && world.entities.has(uuid); ticks++) {
                world.step();
                onRock ||= targetOf(uuid) === 'rock';
            }
            const context = `rock ${(angle * 180 / Math.PI).toFixed(1)} deg, `
                + `${d.toFixed(0)} px`;
            expect(onRock).withContext(context).toBeTrue();
            expect(world.entities.has(uuid)).withContext(context).toBeFalse();
            // Hit within about a second, not after a lap (one lap is
            // 2 pi / 3.665 rad/s, about 1.7 s = 103 ticks) or a life of laps.
            expect(ticks).withContext(context).toBeLessThan(60);
            expect(asteroidHealth('rock')).withContext(context)
                .toBeLessThan(health);
            world.entities.delete('rock');
        }
    });

    it('lets a plain or 0x0001 missile fly past the same rock onto its target', async () => {
        for (const seeker of [{}, { passOverAsteroids: true }]) {
            addTarget('target', 0, -900, [0, 0, 0, 0]);
            addRock('rock', 40, -500);
            step(5);
            const uuid = fire(await launcher([0, 0, 0, 0], seeker), 'target');
            const track = targetTrack(uuid, 'rock', 300);
            expect(track.some(p =>
                p.rockDistance < ASTEROID_DECOY_CAPTURE_RANGE))
                .withContext('it does pass within range').toBeTrue();
            expect(track.every(p => p.target === 'target')).toBeTrue();
            world.entities.delete(uuid);
        }
    });

    it('replays rock captures and jammed 0x0002 retargets identically after a rollback', async () => {
        // V 100 against J 50: about half jammed (those go for the nearest
        // rock in the field), the rest captured on the way if they pass a
        // rock within range.
        // Both rocks ahead of the launch (the missiles head -y), rock a the
        // nearer; the target beyond rock a and to its right, so unjammed
        // missiles fly past it.
        addTarget('target', 300, -900, [50, 0, 0, 0]);
        addRock('rock a', 100, -500);
        addRock('rock b', -150, -700);
        step(5);
        const entry = await launcher([100, 0, 0, 0],
            { decoyedByAsteroids: true });

        const beforeLaunch = snapshotWorld(world);
        const launch = () => {
            const ids: string[] = [];
            for (let i = 0; i < 24; i++) {
                ids.push(fire(entry, 'target'));
            }
            const hashes: string[] = [];
            const targets: Array<Array<string | undefined>> = [];
            for (let i = 0; i < 120; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
                targets.push(ids.map(id => targetOf(id)));
            }
            return { ids, hashes, targets };
        };

        const first = launch();
        const finalTargets = first.targets[first.targets.length - 1];
        // Not vacuous: some went to a rock at once (jammed), some later
        // (captured), and the rocks both drew missiles or one did.
        expect(first.targets[0]).toContain('rock a');
        expect(first.targets[0]).toContain('target');
        expect(finalTargets.filter(t => t === 'target').length)
            .toBeLessThan(first.targets[0].filter(t => t === 'target').length);

        restoreWorld(world, beforeLaunch, deriveEntityComponents);
        const second = launch();
        expect(second.ids).toEqual(first.ids);
        expect(second.targets).toEqual(first.targets);
        expect(second.hashes).toEqual(first.hashes);

        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
    /** Fires `count` missiles in one tick and steps once; returns each
     * uuid with its decision. */
    function decidedSalvo(entry: Awaited<ReturnType<typeof launcher>>,
        count: number, target: string) {
        const ids: string[] = [];
        for (let i = 0; i < count; i++) {
            ids.push(fire(entry, target));
        }
        step(1);
        return ids.map(id => [id, world.entities.get(id)!
            .components.get(JamDecisionComponent)?.steer] as const);
    }

    it('flies a missile confused by interference in circles until it expires', async () => {
        // The original's wave-5 cell: JamVuln 0, a jam-free target,
        // Interference 100. About 68% are confused.
        world.resources.set(SystemInterferenceResource, { interference: 100 });
        addTarget('target', 400, 0, [0, 0, 0, 0]);
        step(5);
        const harrier = await gameData.data.Weapon.get(HARRIER) as
            ProjectileWeaponData;
        const salvo = decidedSalvo(await launcher([0, 0, 0, 0],
            { confusedByInterference: true }), 16, 'target');
        const confused = salvo.filter(([, steer]) =>
            steer === 'circleClockwise' || steer === 'circleCounterclockwise');
        expect(confused.length).toBeGreaterThan(4);
        expect(salvo.some(([, steer]) => steer === 'track')).toBeTrue();

        // All the confused missiles fly together; follow each every tick.
        const delta = world.resources.get(TimeResource)!.delta_s;
        const turn = harrier.physics.turnRate * delta;
        const diameter = 2 * harrier.shotSpeed / harrier.physics.turnRate;
        const flights = confused.map(([uuid, steer]) => ({
            uuid,
            sign: steer === 'circleClockwise' ? 1 : -1,
            previous: world.entities.get(uuid)!
                .components.get(MovementStateComponent)!.rotation,
            ticks: 0, turns: [] as number[], xs: [] as number[],
            ys: [] as number[],
        }));
        for (let tick = 0; tick < 2000
            && flights.some(f => world.entities.has(f.uuid)); tick++) {
            world.step();
            for (const flight of flights) {
                const movement = world.entities.get(flight.uuid)
                    ?.components.get(MovementStateComponent);
                if (!movement) {
                    continue;
                }
                flight.ticks++;
                flight.turns.push(
                    flight.previous.distanceTo(movement.rotation).angle);
                flight.previous = movement.rotation;
                flight.xs.push(movement.position.x);
                flight.ys.push(movement.position.y);
            }
        }
        for (const flight of flights) {
            // Full turn rate, one direction, every tick of its life.
            expect(flight.turns.every(turned =>
                Math.abs(turned - flight.sign * turn) < 1e-9))
                .withContext(`${flight.uuid} turns ${flight.sign}`).toBeTrue();
            // It lived its full life and never left its loop: a circle of
            // diameter 2 v / w (about 270 px for the Harrier), never the
            // 400 px out to the target.
            expect(flight.ticks).toBeGreaterThanOrEqual(
                Math.floor(harrier.shotDuration / 1000 / delta) - 1);
            expect(Math.max(...flight.xs) - Math.min(...flight.xs))
                .toBeLessThan(diameter + 10);
            expect(Math.max(...flight.ys) - Math.min(...flight.ys))
                .toBeLessThan(diameter + 10);
        }
    });

    it('confuses no missile at Interference 0, and none without the 0x0008 flag', async () => {
        addTarget('target', 400, 0, [0, 0, 0, 0]);
        step(5);
        const flagged = await launcher([0, 0, 0, 0],
            { confusedByInterference: true });
        expect(decidedSalvo(flagged, 24, 'target')
            .every(([, steer]) => steer === 'track')).toBeTrue();
        world.resources.set(SystemInterferenceResource, { interference: 100 });
        expect(decidedSalvo(await launcher([0, 0, 0, 0]), 24, 'target')
            .every(([, steer]) => steer === 'track')).toBeTrue();
    });

    it('replays interference decisions and the circling identically after a rollback', async () => {
        world.resources.set(SystemInterferenceResource, { interference: 100 });
        addTarget('target', 400, 0, [50, 0, 0, 0]);
        step(5);
        const entry = await launcher([100, 0, 0, 0],
            { confusedByInterference: true });
        const beforeLaunch = snapshotWorld(world);
        const run = () => {
            const salvo = decidedSalvo(entry, 24, 'target');
            const hashes: string[] = [];
            for (let i = 0; i < 120; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return { salvo, hashes };
        };
        const first = run();
        const steers = first.salvo.map(([, steer]) => steer);
        // Not vacuous: all three outcomes in one salvo.
        expect(steers.some(s => s?.startsWith('circle'))).toBeTrue();
        expect(steers).toContain('flyStraight');
        expect(steers).toContain('track');

        restoreWorld(world, beforeLaunch, deriveEntityComponents);
        const second = run();
        expect(second.salvo).toEqual(first.salvo);
        expect(second.hashes).toEqual(first.hashes);

        // Mid-flight restore keeps the decision (no re-roll).
        restoreWorld(world, beforeLaunch, deriveEntityComponents);
        decidedSalvo(entry, 24, 'target');
        step(30);
        const midFlight = snapshotWorld(world);
        const original: string[] = [];
        for (let i = 0; i < 60; i++) {
            world.step();
            original.push(hashWorld(world).hash);
        }
        restoreWorld(world, midFlight, deriveEntityComponents);
        expect(first.salvo.map(([id]) => world.entities.get(id)
            ?.components.get(JamDecisionComponent)?.steer)).toEqual(steers);
        const resimulated: string[] = [];
        for (let i = 0; i < 60; i++) {
            world.step();
            resimulated.push(hashWorld(world).hash);
        }
        expect(resimulated).toEqual(original);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
