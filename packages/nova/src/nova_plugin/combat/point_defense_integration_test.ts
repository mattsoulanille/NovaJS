import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { UUID } from 'nova_ecs/arg_types';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { BayFighterComponent } from '../escorts/bay_plugin.js';
import { CollisionVulnerabilityComponent } from '../core/collision_interaction.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import {
    OwnerComponent, VulnerableToPD, WeaponEntries, WeaponEntry,
} from './fire_weapon_plugin.js';
import { GovtComponent } from '../core/govt_component.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { TargetComponent } from '../ship/target_component.js';

// The battlefield ship: a Wren Skiff, which the flag happens to mark too,
// but it is only ever the SHOOTER here.
const SKIFF = SYNTHETIC.ships.skiff;
// shïp Flags2 0x0008 ("Ship can be fired on by point defense systems"):
const PD_FIGHTER = SYNTHETIC.ships.skiff;   // set - and the Skiff Bay's payload
const TOUGH_FIGHTER = SYNTHETIC.ships.ghost; // clear - and the Ghost Bay's payload
const CAPITAL_SHIP = SYNTHETIC.ships.warden; // clear - a capital ship
/**
 * wëap Guidance 9, "Point defense turret". Its reach is
 * shotSpeed x shotDuration, exactly as ProjectileWeapon computes
 * pointDefenseRangeSquared. The Flak Point Defense's wëap Speed of 1400
 * parses to 1400 x WEAP_SPEED_FACTOR (3/10) = 420 px/s, and its Count of
 * 15 frames is 15 / 30 fps = 500 ms, so it reaches 420 x 0.5 = 210
 * units. (The stock spec derived 240 the same way, from a parsed
 * 600 px/s over 400 ms.)
 */
const FLAK_POINT_DEFENSE = SYNTHETIC.weapons.pointDefense;
const PD_RANGE = (1400 * 3 / 10) * (15 / 30);
const SKIFF_BAY = SYNTHETIC.weapons.skiffBay;  // launches PD_FIGHTER
// (TOUGH_FIGHTER is the Ghost Bay's payload; the specs below place one
// directly rather than launching it, as the stock spec did with the Manta.)
// Xenophobic: hostile to a flagless ship.
const RAIDER_GOVT = SYNTHETIC.govts.raiders;

/**
 * POINT DEFENSE AGAINST FIGHTERS, end to end on parsed game data.
 *
 * The EVN Bible describes point defense as firing "at incoming guided
 * weapons and nearby ships" (wëap Guidance 9/10, ~:3103), and marks the
 * eligible ships with shïp Flags2 0x0008, "Ship can be fired on by point
 * defense systems" (~:2572). Only the missile half was ever implemented:
 * ship_parse hardcoded `vulnerableTo: ["normal"]` with a TODO, so no
 * ship ever carried the marker a PD turret scans for.
 *
 * These specs pin the whole chain: the flag off the parsed resources, the
 * marker and collision tag it becomes on a live entity, the
 * missiles-first choice, and the rule that keeps a turret off its own
 * wing.
 */
describe('point defense against fighters', () => {
    type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

    describe('shïp Flags2 0x0008 parsing', () => {
        it('marks the Wren Skiff, a bay fighter, vulnerable to point defense',
            async () => {
                const gameData = await getSyntheticGameData();
                const skiff = await gameData.data.Ship.get(PD_FIGHTER);
                expect(skiff.vulnerableTo).toContain('pointDefense');
                // Still hit by ordinary weapons, of course.
                expect(skiff.vulnerableTo).toContain('normal');
            }, 120_000);

        it('leaves the Heron Warden, a capital ship, invulnerable to it',
            async () => {
                const gameData = await getSyntheticGameData();
                const warden = await gameData.data.Ship.get(CAPITAL_SHIP);
                expect(warden.vulnerableTo).not.toContain('pointDefense');
                expect(warden.vulnerableTo).toEqual(['normal']);
            }, 120_000);

        it('is per ship class, not per size: the Shrike Ghost bay fighter '
            + 'is clear', async () => {
                // A useful reminder that this is DATA. The Ghost is a bay
                // fighter (the Ghost Bay's payload) whose class does not
                // set the flag, so point defense leaves it alone.
                const gameData = await getSyntheticGameData();
                const ghost = await gameData.data.Ship.get(TOUGH_FIGHTER);
                expect(ghost.vulnerableTo).not.toContain('pointDefense');
            }, 120_000);
    });

    // --- battlefield helpers -------------------------------------------

    function pin(entity: Entity, x: number, y: number) {
        entity.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    /** Thessaly Reach is asteroid-free, so nothing strays in. */
    async function makeBattlefield() {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        return { gameData, world };
    }

    async function addShip(world: World, gameData: GameData, shipId: string,
        uuid: string, x: number, y: number, govt?: string) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        if (govt) {
            ship.components.set(GovtComponent, { id: govt });
        }
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    function settle(world: World, ticks = 20) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    async function getWeapon(world: World, id: string) {
        const weapon = await world.resources.get(WeaponEntries)!.get(id);
        expect(weapon).withContext(`weapon ${id} loaded`).toBeDefined();
        return weapon!;
    }

    /** Launches one fighter out of `carrierUuid`'s bay and returns it. */
    function launch(world: World, bay: WeaponEntry, carrierUuid: string) {
        const before = new Set([...world.entities].map(([uuid]) => uuid));
        bay.fireFromEntity(carrierUuid, false);
        const launched = [...world.entities].find(([uuid, entity]) =>
            !before.has(uuid) && entity.components.has(BayFighterComponent));
        expect(launched)
            .withContext(`${carrierUuid} launched a fighter`).toBeDefined();
        return launched!;
    }

    /** An incoming guided shot, the prey point defense already had. */
    function addMissile(world: World, uuid: string, x: number, y: number,
        owner: string, target: string) {
        const missile = new Entity()
            .addComponent(MovementStateComponent, {
                position: new Position(x, y),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0,
                turning: 0,
                turnBack: false,
            })
            .addComponent(VulnerableToPD, undefined)
            .addComponent(OwnerComponent, { owner })
            .addComponent(TargetComponent, { target });
        world.entities.set(uuid, missile);
        return missile;
    }

    /** What the shot the PD turret just fired is aimed at. */
    function pdTargetOf(shot: Entity | undefined) {
        return shot?.components.get(TargetComponent)?.target;
    }

    /**
     * The shooter, a raider carrier out of point defense reach, and a
     * raider bay fighter parked 100 units off the shooter's +x side —
     * well inside the turret's 210. The shooter flies no flag, so the
     * xenophobic Verge Raiders make the wing HOSTILE by the one
     * hostility rule (hostility.ts), with no target lock needed.
     */
    async function setUp() {
        const { gameData, world } = await makeBattlefield();
        const shooter = await addShip(world, gameData, SKIFF, 'shooter',
            1000, 1000);
        const enemyCarrier = await addShip(world, gameData, SKIFF,
            'enemyCarrier', 1000 + 4 * PD_RANGE, 1000, RAIDER_GOVT);
        settle(world);
        const skiffBay = await getWeapon(world, SKIFF_BAY);
        const [hostileUuid, hostile] = launch(world, skiffBay, 'enemyCarrier');
        settle(world);
        pin(shooter, 1000, 1000);
        pin(enemyCarrier, 1000 + 4 * PD_RANGE, 1000);
        pin(hostile, 1100, 1000);
        return {
            gameData, world, shooter, enemyCarrier, skiffBay,
            hostileUuid, hostile,
        };
    }

    // --- the marker on a live fighter ----------------------------------

    describe('a launched fighter in the world', () => {
        it('carries the point defense marker and collision tag', async () => {
            const { hostile } = await setUp();
            expect(hostile.components.has(VulnerableToPD))
                .withContext('a Wren Skiff is something PD can aim at')
                .toBeTrue();
            expect(hostile.components.get(CollisionVulnerabilityComponent)
                ?.vulnerableTo.has('pointDefense'))
                .withContext('and something a PD shot can damage')
                .toBeTrue();
        }, 120_000);

        it('leaves a ship whose class lacks the flag unmarked', async () => {
            const { gameData, world } = await setUp();
            const ghost = await addShip(world, gameData, TOUGH_FIGHTER,
                'ghost', 1100, 1000);
            settle(world);
            expect(ghost.components.has(VulnerableToPD))
                .withContext('the Shrike Ghost class does not set Flags2 0x0008')
                .toBeFalse();
            expect(ghost.components.get(CollisionVulnerabilityComponent)
                ?.vulnerableTo.has('pointDefense')).toBeFalse();
        }, 120_000);
    });

    // --- who the turret picks ------------------------------------------

    describe('target choice', () => {
        it('engages a hostile bay fighter in range', async () => {
            const { world, hostileUuid } = await setUp();
            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            const shot = pd.fireFromEntity('shooter', false);
            expect(shot).withContext('the turret fires').toBeDefined();
            expect(pdTargetOf(shot)).toBe(hostileUuid);
        }, 120_000);

        it('never engages our own bay fighter, however close', async () => {
            const { world, hostile } = await setUp();
            // Our own wing, sitting closer than the enemy's and (as a
            // formation escort can transiently be) pointed at us.
            const skiffBay = await getWeapon(world, SKIFF_BAY);
            const [, ours] = launch(world, skiffBay, 'shooter');
            settle(world);
            pin(ours, 1010, 1000);
            pin(hostile, 1000 + 4 * PD_RANGE, 1000); // out of reach
            ours.components.set(TargetComponent, { target: 'shooter' });

            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            expect(pd.fireFromEntity('shooter', false))
                .withContext('nothing hostile in reach, so nothing fires')
                .toBeUndefined();
        }, 120_000);

        it('picks the hostile fighter over our own when both are in range',
            async () => {
                const { world, hostile, hostileUuid } = await setUp();
                const skiffBay = await getWeapon(world, SKIFF_BAY);
                const [, ours] = launch(world, skiffBay, 'shooter');
                settle(world);
                pin(ours, 1010, 1000);        // ours is much closer
                pin(hostile, 1100, 1000);

                const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
                const shot = pd.fireFromEntity('shooter', false);
                expect(pdTargetOf(shot)).toBe(hostileUuid);
            }, 120_000);

        it('ignores a hostile ship whose class is not PD-vulnerable',
            async () => {
                const { gameData, world, hostile } = await setUp();
                pin(hostile, 1000 + 4 * PD_RANGE, 1000); // out of reach
                // A raider Heron Warden parked right on top of us, hostile
                // and locked on: Flags2 0x0008 is clear, so PD may not
                // shoot it (and a PD shot could not hurt it anyway).
                const capital = await addShip(world, gameData, CAPITAL_SHIP,
                    'capital', 1050, 1000, RAIDER_GOVT);
                settle(world);
                pin(capital, 1050, 1000);
                capital.components.set(TargetComponent, { target: 'shooter' });

                const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
                expect(pd.fireFromEntity('shooter', false))
                    .withContext('capital ships are not point defense prey')
                    .toBeUndefined();
            }, 120_000);

        it('prefers an incoming missile to a much closer hostile fighter',
            async () => {
                const { world, hostile } = await setUp();
                pin(hostile, 1010, 1000);   // right on top of us
                addMissile(world, 'missile', 1000 + PD_RANGE - 40, 1000,
                    'enemyCarrier', 'shooter'); // nearly at the edge of reach

                const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
                const shot = pd.fireFromEntity('shooter', false);
                expect(pdTargetOf(shot))
                    .withContext('a torpedo outranks a fighter')
                    .toBe('missile');
            }, 120_000);

        it('takes the fighter once the missile is out of reach', async () => {
            const { world, hostile, hostileUuid } = await setUp();
            pin(hostile, 1010, 1000);
            addMissile(world, 'missile', 1000 + 4 * PD_RANGE, 1000,
                'enemyCarrier', 'shooter');

            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            const shot = pd.fireFromEntity('shooter', false);
            expect(pdTargetOf(shot)).toBe(hostileUuid);
        }, 120_000);
    });

    // --- damage --------------------------------------------------------

    describe('damage', () => {
        function recordDamage(world: World) {
            const damaged: string[] = [];
            world.addSystem(new System({
                name: 'PointDefenseDamageRecorder',
                events: [DamagedEvent],
                args: [DamagedEvent, UUID] as const,
                step(_event, uuid) { damaged.push(uuid); },
            }));
            return damaged;
        }

        it('a point defense shot damages a PD-vulnerable fighter', async () => {
            const { world, hostile, hostileUuid } = await setUp();
            const damaged = recordDamage(world);
            pin(hostile, 1030, 1000);

            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            expect(pd.fireFromEntity('shooter', false)).toBeDefined();
            settle(world, 30);

            expect(damaged).withContext('the fighter takes the burst')
                .toContain(hostileUuid);
        }, 120_000);

        it('and cannot damage a ship whose class lacks the flag', async () => {
            // The Bible's other half: point defense only harms missiles
            // and PD-vulnerable ships. A Shrike Ghost parked in the line
            // of fire is untouched even though the shot passes through it.
            const { gameData, world, hostile } = await setUp();
            const ghost = await addShip(world, gameData, TOUGH_FIGHTER,
                'ghost', 1030, 1000);
            settle(world);
            const damaged = recordDamage(world);
            pin(ghost, 1030, 1000);
            pin(hostile, 1100, 1000);

            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            expect(pd.fireFromEntity('shooter', false)).toBeDefined();
            settle(world, 30);

            expect(damaged).withContext('PD shots pass through it')
                .not.toContain('ghost');
        }, 120_000);
    });

    // --- determinism ----------------------------------------------------

    describe('determinism', () => {
        /**
         * Two worlds holding the same fighters, built in opposite order
         * so their entity maps iterate differently, must choose the same
         * victim. Exact-distance ties break on uuid, not on whoever the
         * query happened to yield first.
         */
        async function tieBreak(order: 'forward' | 'reverse') {
            const { gameData, world } = await makeBattlefield();
            await addShip(world, gameData, SKIFF, 'shooter', 1000, 1000);
            settle(world);
            const uuids = order === 'forward'
                ? ['aaa_fighter', 'zzz_fighter'] : ['zzz_fighter', 'aaa_fighter'];
            for (const uuid of uuids) {
                const fighter = await addShip(world, gameData, PD_FIGHTER, uuid,
                    1100, 1000, RAIDER_GOVT);
                settle(world, 5);
                pin(fighter, 1100, 1000); // identical position: an exact tie
            }
            const shooter = world.entities.get('shooter')!;
            pin(shooter, 1000, 1000);
            for (const uuid of uuids) {
                pin(world.entities.get(uuid)!, 1100, 1000);
            }
            const pd = await getWeapon(world, FLAK_POINT_DEFENSE);
            return pdTargetOf(pd.fireFromEntity('shooter', false));
        }

        it('picks the same fighter whichever order the world was built in',
            async () => {
                const forward = await tieBreak('forward');
                const reverse = await tieBreak('reverse');
                expect(forward).withContext('a fighter was chosen')
                    .toBeDefined();
                expect(reverse).toBe(forward!);
                expect(forward).withContext('ties break toward the smaller uuid')
                    .toBe('aaa_fighter');
            }, 240_000);
    });
});
