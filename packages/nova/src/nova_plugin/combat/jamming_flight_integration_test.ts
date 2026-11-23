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
import { JamDecisionComponent, JammingComponent } from './jamming_plugin.js';

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
});
