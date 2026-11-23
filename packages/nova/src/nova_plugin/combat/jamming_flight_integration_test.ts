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
    ASTEROID_DECOY_CAPTURE_RANGE, DecoyTargetComponent, JamDecisionComponent,
    JammingComponent,
} from './jamming_plugin.js';
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
     * nothing collides with it; a captured missile circles it). */
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

    it('turns an unjammed 0x0002 missile onto a rock it passes within range of, for good', async () => {
        addTarget('target', 800, 0, [0, 0, 0, 0]);
        // Off the launch point by more than the capture range, near the
        // missile's curve toward the target.
        addRock('rock', 400, -150);
        step(5);
        const uuid = fire(await launcher([0, 0, 0, 0],
            { decoyedByAsteroids: true }), 'target');
        const track = targetTrack(uuid, 'rock', 300);
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
        // Stays on the rock, circling it, for the rest of its life.
        expect(track.slice(captured).every(p => p.target === 'rock'))
            .toBeTrue();
        expect(track[track.length - 1].rockDistance).toBeLessThan(300);
    });

    it('lets a plain or 0x0001 missile fly past the same rock onto its target', async () => {
        for (const seeker of [{}, { passOverAsteroids: true }]) {
            addTarget('target', 800, 0, [0, 0, 0, 0]);
            addRock('rock', 400, -150);
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
        addTarget('target', 800, 0, [50, 0, 0, 0]);
        addRock('rock a', 400, -150);
        addRock('rock b', -500, -300);
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
});
