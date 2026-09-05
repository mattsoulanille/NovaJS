import 'jasmine';
import { BeamWeaponData } from 'novadatainterface/weapon_data';
import { RunQuery, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { BeamDataComponent, BeamStateComponent } from './beam_plugin.js';
import { DamagedEvent } from './death_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import {
    OwnerComponent, VulnerableToPD, WeaponConstructors, WeaponEntries,
} from './fire_weapon_plugin.js';
import { zeroOrderGuidance } from './guidance.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { TargetComponent } from './target_component.js';
import { ORIGINAL_FRAME_MS } from './weapon_plugin.js';
import { WeaponsStateComponent } from './weapons_state.js';

const SHIP_ID = 'nova:128';      // Shuttle.
const SOLAR_LANCE = 'nova:164';  // beam, Reload 0, Count 1, Inaccuracy 5.
const PULSE_LASER = 'nova:146';  // beam, Count 15, Decay 100, Falloff 0.

/**
 * Beams against the original's 30 fps clock, on real data (#23, #93,
 * #101). The Solar Lance is the review's measured case: Reload 0 and
 * Count 1, so the original fires it once per frame and each shot deals
 * one frame of its damage — 30 beams and 30 frame-damages per second.
 * Measured at 7f4e013e: 60 beams and 78 frame-damages (2.0x shots, 2.6x
 * damage), from firing per 60 Hz tick and a 1-frame beam straddling a
 * third tick.
 *
 * Battlefield as in beam_turret_stale_target_test: nova:226 (asteroid-
 * free), shooter facing -y with the victim 60 px straight ahead, well
 * inside the Lance's reach and close enough that its 5° error cannot
 * miss a Shuttle.
 */
describe('beam fire cadence and damage on the original frame clock', () => {
    let damaged: Array<{ uuid: string, damager: string, scale: number }>;

    type GameData = Awaited<ReturnType<typeof getIntegrationGameData>>;

    async function makeBattlefield() {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, undefined,
            { npcs: false });
        damaged = [];
        world.addSystem(new System({
            name: 'BeamCadenceDamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager, scale }, uuid) {
                damaged.push({ uuid, damager, scale: scale ?? 1 });
            },
        }));
        return { gameData, world };
    }

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(world: World, gameData: GameData, uuid: string,
        x: number, y: number) {
        const ship = makeShip(await gameData.data.Ship.get(SHIP_ID));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    async function setUp() {
        const { gameData, world } = await makeBattlefield();
        const shooter = await addShip(world, gameData, 'shooter', 1000, 1000);
        const victim = await addShip(world, gameData, 'victim', 1000, 940);
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        pin(shooter, 1000, 1000);
        pin(victim, 1000, 940);
        return { gameData, world, shooter, victim };
    }

    /** Mounts `id` on the shooter and holds its trigger. */
    async function holdFire(world: World, shooter: Entity, id: string) {
        await world.resources.get(WeaponEntries)!.get(id);
        const state = shooter.components.get(WeaponsStateComponent)!.get(id)!;
        state.count = 1;
        state.fireGroup = 'primary';
        state.firing = true;
    }

    function beamUuids(world: World): string[] {
        const uuids: string[] = [];
        for (const [uuid, entity] of world.entities) {
            if (entity.components.has(BeamDataComponent)) {
                uuids.push(uuid);
            }
        }
        return uuids;
    }

    /** Runs `ticks` steps; returns every beam seen and the ticks each lived. */
    function run(world: World, ticks: number) {
        const beams = new Map<string, number>();
        for (let i = 0; i < ticks; i++) {
            world.step();
            for (const uuid of beamUuids(world)) {
                beams.set(uuid, (beams.get(uuid) ?? 0) + 1);
            }
        }
        return beams;
    }

    function frameDamages(uuid: string) {
        return damaged.filter(d => d.uuid === uuid)
            .reduce((sum, d) => sum + d.scale, 0);
    }

    it('Solar Lance: 30 beams and 30 frames of damage per second (#23)',
        async () => {
            const { world, shooter } = await setUp();
            await holdFire(world, shooter, SOLAR_LANCE);
            damaged = [];

            // 60 ticks = 1 s. The last beam fired may still be alive
            // when we stop, so the damage tally is over the beams that
            // have run their course.
            const beams = run(world, 60);
            expect(beams.size).withContext('beams spawned in 1 s').toEqual(30);
            for (const ticks of beams.values()) {
                expect(ticks).withContext('a 1-frame beam lives 2 ticks')
                    .toBeLessThanOrEqual(2);
            }
            expect(frameDamages('victim'))
                .withContext('frame-equivalents of damage in 1 s')
                .toBeCloseTo(30, 6);
        }, 120_000);

    it('Pulse Laser: on screen 31 frames, damaging for its 15 (#93)',
        async () => {
            const { world, shooter } = await setUp();
            const laser = await world.resources.get(WeaponEntries)!.get(PULSE_LASER);
            damaged = [];
            const beam = laser!.fireFromEntity('shooter', false)!;
            expect(beam).toBeDefined();

            // Count 15 + 16 - CoronaFalloff 0 = 31 frames = 62 ticks
            // alive, then gone.
            const beams = run(world, 70);
            expect(beams.size).toEqual(1);
            expect([...beams.values()][0]).toEqual(62);
            expect(frameDamages('victim')).toBeCloseTo(15, 6);
        }, 120_000);

    describe('inaccuracy is sampled once, as the beam leaves the ship (#101)', () => {
        /** A long-lived Solar Lance, so the ray can be watched over many ticks. */
        async function longLance(world: World, gameData: GameData,
            over: Partial<BeamWeaponData> = {}) {
            const construct = world.resources
                .get(WeaponConstructors)!.get('BeamWeaponData')!;
            const data = await gameData.data.Weapon.get(SOLAR_LANCE) as BeamWeaponData;
            return new construct({
                ...data,
                id: 'test:long_lance',
                shotDuration: 30 * ORIGINAL_FRAME_MS,
                onScreenDuration: 30 * ORIGINAL_FRAME_MS,
                ...over,
            }, world.resources.get(RunQuery)!);
        }

        function rotations(world: World, uuid: string, ticks: number) {
            const seen: number[] = [];
            for (let i = 0; i < ticks; i++) {
                world.step();
                const beam = world.entities.get(uuid);
                if (beam) {
                    seen.push(beam.components.get(MovementStateComponent)!
                        .rotation.angle);
                }
            }
            return seen;
        }

        it('keeps one error for its whole life', async () => {
            const { gameData, world } = await setUp();
            const lance = await longLance(world, gameData);
            const beam = lance.fireFromEntity('shooter', true)!;
            const offset = beam.components.get(BeamStateComponent)!.aimOffset;
            expect(offset).withContext('the sampled error is stored').toBeDefined();
            expect(Math.abs(offset!)).toBeGreaterThan(0);
            expect(Math.abs(offset!)).toBeLessThanOrEqual(5 * Math.PI / 180);

            const seen = rotations(world, beam.uuid, 20);
            expect(seen.length).toEqual(20);
            for (const angle of seen) {
                expect(angle).toBeCloseTo(offset!, 12);
            }
        }, 120_000);

        it('a point defense beam has no error at all', async () => {
            const { gameData, world } = await setUp();
            const pd = await longLance(world, gameData, { guidance: 'pointDefenseBeam' });
            const incoming = new Entity()
                .addComponent(VulnerableToPD, undefined)
                .addComponent(OwnerComponent, { owner: 'victim' })
                .addComponent(TargetComponent, { target: 'shooter' });
            pin(incoming, 1100, 1000);
            world.entities.set('incoming', incoming);

            const beam = pd.fireFromEntity('shooter', true)!;
            expect(beam).toBeDefined();
            expect(beam.components.get(BeamStateComponent)!.aimOffset).toEqual(0);
            const exact = zeroOrderGuidance(
                beam.components.get(MovementStateComponent)!.position,
                new Position(1100, 1000)).angle;
            expect(beam.components.get(MovementStateComponent)!.rotation.angle)
                .toBeCloseTo(exact, 12);
            for (const angle of rotations(world, beam.uuid, 10)) {
                expect(angle).toBeCloseTo(exact, 12);
            }
        }, 120_000);
    });
});
