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
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { BayFighterComponent } from '../escorts/bay_plugin.js';
import { CollisionVulnerabilityComponent } from '../core/collision_interaction.js';
import { DamagedEvent } from '../ship/death_plugin.js';
import {
    completeEntity, loadWeaponsGameData,
} from '../spawn/entity_data_loader.js';
import {
    OwnerComponent, VulnerableToPD, WeaponEntries, WeaponEntry,
} from './fire_weapon_plugin.js';
import { GovtComponent } from '../core/govt_component.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { TargetComponent } from '../ship/target_component.js';

// The battlefield ship: a Shuttle, which the flag happens to mark too,
// but it is only ever the SHOOTER here.
const SHUTTLE = 'nova:128';
// shïp Flags2 0x0008 ("Ship can be fired on by point defense systems"):
const FED_VIPER = 'nova:144';   // set - a fighter, and Viper Bay's payload
const MANTA = 'nova:161';       // clear - and Manta Bay's payload
const FED_CARRIER = 'nova:143'; // clear - a capital ship
// wëap Guidance 9, "Point defense turret": speed 600, shotDuration 400ms,
// so it reaches 240 units.
const QUAD_LIGHT_BLASTER_TURRET = 'nova:133';
const PD_RANGE = 240;
const VIPER_BAY = 'nova:149';  // launches FED_VIPER
const PIRATE_GOVT = 'nova:137'; // xenophobic: hostile to a flagless ship

/**
 * POINT DEFENSE AGAINST FIGHTERS, end to end on the real Nova data.
 *
 * The EVN Bible describes point defense as firing "at incoming guided
 * weapons and nearby ships" (wëap Guidance 9/10, ~:3103), and marks the
 * eligible ships with shïp Flags2 0x0008, "Ship can be fired on by point
 * defense systems" (~:2572). Only the missile half was ever implemented:
 * ship_parse hardcoded `vulnerableTo: ["normal"]` with a TODO, so no
 * ship ever carried the marker a PD turret scans for.
 *
 * These specs pin the whole chain on real data: the flag off the stock
 * resources, the marker and collision tag it becomes on a live entity,
 * the missiles-first choice, and the rule that keeps a turret off its
 * own wing.
 */
describe('point defense against fighters (real Nova data)', () => {
    type GameData = Awaited<ReturnType<typeof getIntegrationGameData>>;

    describe('shïp Flags2 0x0008 parsing', () => {
        it('marks the Fed Viper, a bay fighter, vulnerable to point defense',
            async () => {
                const gameData = await getIntegrationGameData();
                const viper = await gameData.data.Ship.get(FED_VIPER);
                expect(viper.vulnerableTo).toContain('pointDefense');
                // Still hit by ordinary weapons, of course.
                expect(viper.vulnerableTo).toContain('normal');
            }, 120_000);

        it('leaves the Fed Carrier, a capital ship, invulnerable to it',
            async () => {
                const gameData = await getIntegrationGameData();
                const carrier = await gameData.data.Ship.get(FED_CARRIER);
                expect(carrier.vulnerableTo).not.toContain('pointDefense');
                expect(carrier.vulnerableTo).toEqual(['normal']);
            }, 120_000);

        it('is per ship class, not per size: the Manta bay fighter is clear',
            async () => {
                // A useful reminder that this is DATA. The Manta is a bay
                // fighter (Manta Bay, nova:154) whose class does not set
                // the flag, so point defense leaves it alone.
                const gameData = await getIntegrationGameData();
                const manta = await gameData.data.Ship.get(MANTA);
                expect(manta.vulnerableTo).not.toContain('pointDefense');
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

    /** nova:226 (Ver'ashan) is asteroid-free, so nothing strays in. */
    async function makeBattlefield() {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, undefined,
            { npcs: false });
        // Neither ship below carries these, so stage them the way the
        // loader stages a ship's own weapons: closure (the Viper Bay's
        // fighter, its hull sprite sheet, both weapons' shot sprites)
        // plus this world's entries. Building the entries straight from
        // WeaponEntries.get skipped the closure, and a launched Viper
        // then grew its hull on whichever tick the sprite sheet's
        // background load landed — one event-loop turn later with a
        // cold shared cache, never during a synchronous settle with a
        // warm one, which is why the damage spec below failed whenever
        // bay_plugin_test had warmed every stock Weapon first (#240).
        await loadWeaponsGameData(world,
            [VIPER_BAY, QUAD_LIGHT_BLASTER_TURRET]);
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

    /** Staged in makeBattlefield, so the cache read is the contract. */
    function getWeapon(world: World, id: string) {
        const weapon = world.resources.get(WeaponEntries)!.getCached(id);
        expect(weapon).withContext(`weapon ${id} staged`).toBeDefined();
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
     * The shooter, a pirate carrier out of point defense reach, and a
     * pirate bay fighter parked 100 units off the shooter's +x side —
     * well inside the turret's 240. The shooter flies no flag, so the
     * xenophobic Pirate government makes the wing HOSTILE by the one
     * hostility rule (hostility.ts), with no target lock needed.
     */
    async function setUp() {
        const { gameData, world } = await makeBattlefield();
        const shooter = await addShip(world, gameData, SHUTTLE, 'shooter',
            1000, 1000);
        const enemyCarrier = await addShip(world, gameData, SHUTTLE,
            'enemyCarrier', 1000 + 4 * PD_RANGE, 1000, PIRATE_GOVT);
        settle(world);
        const viperBay = getWeapon(world, VIPER_BAY);
        const [hostileUuid, hostile] = launch(world, viperBay, 'enemyCarrier');
        settle(world);
        pin(shooter, 1000, 1000);
        pin(enemyCarrier, 1000 + 4 * PD_RANGE, 1000);
        pin(hostile, 1100, 1000);
        return {
            gameData, world, shooter, enemyCarrier, viperBay,
            hostileUuid, hostile,
        };
    }

    // --- the marker on a live fighter ----------------------------------

    describe('a launched fighter in the world', () => {
        it('carries the point defense marker and collision tag', async () => {
            const { hostile } = await setUp();
            expect(hostile.components.has(VulnerableToPD))
                .withContext('a Fed Viper is something PD can aim at')
                .toBeTrue();
            expect(hostile.components.get(CollisionVulnerabilityComponent)
                ?.vulnerableTo.has('pointDefense'))
                .withContext('and something a PD shot can damage')
                .toBeTrue();
        }, 120_000);

        it('leaves a ship whose class lacks the flag unmarked', async () => {
            const { gameData, world } = await setUp();
            const manta = await addShip(world, gameData, MANTA, 'manta',
                1100, 1000);
            settle(world);
            expect(manta.components.has(VulnerableToPD))
                .withContext('the Manta class does not set Flags2 0x0008')
                .toBeFalse();
            expect(manta.components.get(CollisionVulnerabilityComponent)
                ?.vulnerableTo.has('pointDefense')).toBeFalse();
        }, 120_000);
    });

    // --- who the turret picks ------------------------------------------

    describe('target choice', () => {
        it('engages a hostile bay fighter in range', async () => {
            const { world, hostileUuid } = await setUp();
            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
            const shot = pd.fireFromEntity('shooter', false);
            expect(shot).withContext('the turret fires').toBeDefined();
            expect(pdTargetOf(shot)).toBe(hostileUuid);
        }, 120_000);

        it('never engages our own bay fighter, however close', async () => {
            const { world, hostile } = await setUp();
            // Our own wing, sitting closer than the enemy's and (as a
            // formation escort can transiently be) pointed at us.
            const viperBay = getWeapon(world, VIPER_BAY);
            const [, ours] = launch(world, viperBay, 'shooter');
            settle(world);
            pin(ours, 1010, 1000);
            pin(hostile, 1000 + 4 * PD_RANGE, 1000); // out of reach
            ours.components.set(TargetComponent, { target: 'shooter' });

            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
            expect(pd.fireFromEntity('shooter', false))
                .withContext('nothing hostile in reach, so nothing fires')
                .toBeUndefined();
        }, 120_000);

        it('picks the hostile fighter over our own when both are in range',
            async () => {
                const { world, hostile, hostileUuid } = await setUp();
                const viperBay = getWeapon(world, VIPER_BAY);
                const [, ours] = launch(world, viperBay, 'shooter');
                settle(world);
                pin(ours, 1010, 1000);        // ours is much closer
                pin(hostile, 1100, 1000);

                const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
                const shot = pd.fireFromEntity('shooter', false);
                expect(pdTargetOf(shot)).toBe(hostileUuid);
            }, 120_000);

        it('ignores a hostile ship whose class is not PD-vulnerable',
            async () => {
                const { gameData, world, hostile } = await setUp();
                pin(hostile, 1000 + 4 * PD_RANGE, 1000); // out of reach
                // A pirate Fed Carrier parked right on top of us, hostile
                // and locked on: Flags2 0x0008 is clear, so PD may not
                // shoot it (and a PD shot could not hurt it anyway).
                const capital = await addShip(world, gameData, FED_CARRIER,
                    'capital', 1050, 1000, PIRATE_GOVT);
                settle(world);
                pin(capital, 1050, 1000);
                capital.components.set(TargetComponent, { target: 'shooter' });

                const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
                expect(pd.fireFromEntity('shooter', false))
                    .withContext('capital ships are not point defense prey')
                    .toBeUndefined();
            }, 120_000);

        it('prefers an incoming missile to a much closer hostile fighter',
            async () => {
                const { world, hostile } = await setUp();
                pin(hostile, 1010, 1000);   // right on top of us
                addMissile(world, 'missile', 1200, 1000, 'enemyCarrier',
                    'shooter');             // nearly at the edge of reach

                const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
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

            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
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

            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
            expect(pd.fireFromEntity('shooter', false)).toBeDefined();
            settle(world, 30);

            expect(damaged).withContext('the fighter takes the burst')
                .toContain(hostileUuid);
        }, 120_000);

        it('damages it just the same with every stock Weapon already cached '
            + '(#240)', async () => {
                // What bay_plugin_test's sound spec leaves in the shared
                // cache, done here on purpose: with every Weapon a cache
                // hit, nothing between launching the fighter and firing
                // the turret yields to the event loop, so anything the
                // fighter needs that staging did NOT cache (its hull
                // sprite sheet, before makeBattlefield staged the bay)
                // can never arrive during the synchronous settle. The
                // spec above passed only when a cold cache bought that
                // one turn; this one holds whatever ran before it.
                const gameData = await getIntegrationGameData();
                for (const id of (await gameData.ids).Weapon) {
                    await gameData.data.Weapon.get(id);
                }
                const { world, hostile, hostileUuid } = await setUp();
                const damaged = recordDamage(world);
                pin(hostile, 1030, 1000);

                const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
                expect(pd.fireFromEntity('shooter', false)).toBeDefined();
                settle(world, 30);

                expect(damaged).toContain(hostileUuid);
            }, 120_000);

        it('and cannot damage a ship whose class lacks the flag', async () => {
            // The Bible's other half: point defense only harms missiles
            // and PD-vulnerable ships. A Manta parked in the line of fire
            // is untouched even though the shot passes through it.
            const { gameData, world, hostile } = await setUp();
            const manta = await addShip(world, gameData, MANTA, 'manta',
                1030, 1000);
            settle(world);
            const damaged = recordDamage(world);
            pin(manta, 1030, 1000);
            pin(hostile, 1100, 1000);

            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
            expect(pd.fireFromEntity('shooter', false)).toBeDefined();
            settle(world, 30);

            expect(damaged).withContext('PD shots pass through it')
                .not.toContain('manta');
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
            await addShip(world, gameData, SHUTTLE, 'shooter', 1000, 1000);
            settle(world);
            const uuids = order === 'forward'
                ? ['aaa_fighter', 'zzz_fighter'] : ['zzz_fighter', 'aaa_fighter'];
            for (const uuid of uuids) {
                const fighter = await addShip(world, gameData, FED_VIPER, uuid,
                    1100, 1000, PIRATE_GOVT);
                settle(world, 5);
                pin(fighter, 1100, 1000); // identical position: an exact tie
            }
            const shooter = world.entities.get('shooter')!;
            pin(shooter, 1000, 1000);
            for (const uuid of uuids) {
                pin(world.entities.get(uuid)!, 1100, 1000);
            }
            const pd = getWeapon(world, QUAD_LIGHT_BLASTER_TURRET);
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
