import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getPluginGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { TargetComponent } from '../ship/target_component.js';

// Ships. The Wren Skiff has no shïp-level blind spots; the Bastion Hulk
// is rear-blind (shïp Flags 0x4000), as the stock Fed Destroyer/Carrier
// and Aurora Cruiser families are.
const SKIFF = SYNTHETIC.ships.skiff;
const REAR_BLIND_HULL = SYNTHETIC.ships.hulk;

// Weapons, and the wëap Flags they carry.
const SENTRY_TURRET = SYNTHETIC.weapons.turret;        // turret, no blind spots
const FLANK_TURRET = SYNTHETIC.weapons.flankTurret;    // turret, rear blind (0x4000)
const NARROW_TURRET = SYNTHETIC.weapons.narrowTurret;  // turret, sides+rear (0x6000)
const ARC_TURRET = SYNTHETIC.weapons.arcTurret;        // beamTurret, rear blind
const BOW_CHASER = SYNTHETIC.weapons.bowChaser;        // frontQuadrant, no blind spots
const STUB_GUN = SYNTHETIC.weapons.stubGun;            // FIXED gun that sets 0x6000
// extra-outfits, from Matthew's report. Stays on the plug-in data: it is
// the one reported 0x5000 (front+rear) turret, a combination nothing in
// the scenario carries.
const FLAK_CANNON = 'extra-outfits:352';  // turret, front+rear (0x5000)

/**
 * Where the target sits relative to a shooter facing "up" (Nova
 * rotation 0 = -y). 200 units out in each case, well inside every
 * weapon's reach (the shortest is the Arc Turret's 240) and far enough
 * that the turret exit points cannot change which quadrant the bearing
 * lands in.
 */
const BEARINGS = {
    ahead: new Position(1000, 800),
    abeam: new Position(1200, 1000),
    astern: new Position(1000, 1200),
} as const;
type Bearing = keyof typeof BEARINGS;

describe('turret blind spots', () => {
    type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

    function pin(ship: Entity, position: Position) {
        ship.components.set(MovementStateComponent, {
            position,
            velocity: new Vector(0, 0),
            // Facing -y. Every bearing below is read against this.
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(world: World, gameData: GameData, shipId: string,
        uuid: string, position: Position) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        pin(ship, position);
        world.entities.set(uuid, ship);
        return ship;
    }

    /**
     * A shooter of the given class at (1000, 1000) facing -y, locked on
     * a Wren Skiff placed on the given bearing. Thessaly Reach has no
     * asteroids, and npcs are off, so nothing else is in the world.
     */
    async function setUp(bearing: Bearing, shipId = SKIFF) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        const shooter = await addShip(world, gameData, shipId, 'shooter',
            new Position(1000, 1000));
        await addShip(world, gameData, SKIFF, 'victim', BEARINGS[bearing]);
        shooter.components.set(TargetComponent, { target: 'victim' });

        // Let the providers attach hitboxes, weapon state and the rest.
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        pin(shooter, new Position(1000, 1000));
        pin(world.entities.get('victim')!, BEARINGS[bearing]);
        return { gameData, world, shooter };
    }

    /**
     * Whether `weaponId` produces a shot from the shooter this tick.
     * Fired with inaccuracy off so the geometry is exact and the result
     * is a pure function of the bearing.
     */
    async function firesAt(bearing: Bearing, weaponId: string,
        shipId = SKIFF): Promise<boolean> {
        const { world } = await setUp(bearing, shipId);
        const weapon = await world.resources.get(WeaponEntries)!.get(weaponId);
        expect(weapon).withContext(`weapon ${weaponId} loaded`).toBeDefined();
        return weapon!.fireFromEntity('shooter', false) !== undefined;
    }

    describe('wëap-level flags', () => {
        // Matthew's report: "Blindspots ... don't work for regular
        // turrets". The Narrow Turret is blind to the sides AND the
        // rear, so it is the weapon that shows it most sharply — it may
        // only shoot at what is in front of the ship, even though a
        // turret can physically point anywhere.
        it('silences the Narrow Turret except dead ahead', async () => {
            expect(await firesAt('ahead', NARROW_TURRET)).toBeTrue();
            expect(await firesAt('abeam', NARROW_TURRET)).toBeFalse();
            expect(await firesAt('astern', NARROW_TURRET)).toBeFalse();
        });

        it('lets the rear-blind Flank Turret cover the sides',
            async () => {
                expect(await firesAt('ahead', FLANK_TURRET)).toBeTrue();
                expect(await firesAt('abeam', FLANK_TURRET)).toBeTrue();
                expect(await firesAt('astern', FLANK_TURRET)).toBeFalse();
            });

        it('applies to beam turrets too (rear-blind Arc Turret)', async () => {
            expect(await firesAt('ahead', ARC_TURRET)).toBeTrue();
            expect(await firesAt('abeam', ARC_TURRET)).toBeTrue();
            expect(await firesAt('astern', ARC_TURRET)).toBeFalse();
        });

        // The control: a turret with no flags tracks all the way round,
        // which is what every turret did before blind spots existed.
        it('leaves an unflagged turret free to fire in any direction',
            async () => {
                for (const bearing of ['ahead', 'abeam', 'astern'] as Bearing[]) {
                    expect(await firesAt(bearing, SENTRY_TURRET))
                        .withContext(bearing).toBeTrue();
                }
            });

        // The Stub Gun is an 'unguided' FIXED gun that nonetheless sets
        // 0x2000|0x4000 (as the stock Light Blaster does). The Bible's
        // flags are about turrets, so a fixed mount ignores them — it
        // shoots straight out of the nose whatever the target is doing.
        it('ignores the flags on a fixed gun', async () => {
            for (const bearing of ['ahead', 'abeam', 'astern'] as Bearing[]) {
                expect(await firesAt(bearing, STUB_GUN))
                    .withContext(bearing).toBeTrue();
            }
        });
    });

    describe('shïp-level flags', () => {
        // shïp Flags 0x4000 on the Bastion Hulk: EVERY turret it mounts
        // is rear-blind, including one whose own wëap sets nothing.
        it('makes a rear-blind ship\'s unflagged turret rear-blind',
            async () => {
                expect(await firesAt('ahead', SENTRY_TURRET,
                    REAR_BLIND_HULL)).toBeTrue();
                expect(await firesAt('abeam', SENTRY_TURRET,
                    REAR_BLIND_HULL)).toBeTrue();
                expect(await firesAt('astern', SENTRY_TURRET,
                    REAR_BLIND_HULL)).toBeFalse();
            });

        it('unions with the weapon\'s own set rather than replacing it',
            async () => {
                // Ship rear-blind, weapon sides+rear-blind: only the
                // front survives, exactly as for the Wren Skiff carrying
                // the same weapon.
                expect(await firesAt('ahead', NARROW_TURRET,
                    REAR_BLIND_HULL)).toBeTrue();
                expect(await firesAt('abeam', NARROW_TURRET,
                    REAR_BLIND_HULL)).toBeFalse();
                expect(await firesAt('astern', NARROW_TURRET,
                    REAR_BLIND_HULL)).toBeFalse();
            });

        it('does not reach a fixed gun on the same rear-blind ship',
            async () => {
                expect(await firesAt('astern', STUB_GUN, REAR_BLIND_HULL))
                    .toBeTrue();
            });
    });

    describe('front-quadrant turrets', () => {
        // Why the bug looked partial: a front-quadrant turret already
        // refuses to track outside its ±45° cone, so the stock
        // front-quadrant weapons Matthew named LOOKED like they honoured
        // blind spots. They carry no blind-spot flags at all — the
        // quadrant restriction was doing the work. The Bow Chaser is the
        // scenario's weapon of that shape.
        it('aims the Bow Chaser at a target only in its front quadrant',
            async () => {
                const gameData = await getSyntheticGameData();
                const weapon = await gameData.data.Weapon.get(BOW_CHASER);
                expect(weapon.guidance).toEqual('frontQuadrant');
                expect(weapon.turretBlindSpots)
                    .toEqual({ front: false, sides: false, rear: false });
            });
    });

    describe('the reload clock', () => {
        // A refused turret must not eat its own cooldown: WeaponsSystem
        // only stamps `lastFired` when fireFromEntity hands back a shot,
        // so the turret is ready the instant the target crosses into a
        // live sector. Firing twice in a row at a blind bearing and then
        // once at a live one proves nothing was consumed in between.
        it('does not restart when a blind-spot shot is refused', async () => {
            const { world } = await setUp('astern');
            const weapon =
                await world.resources.get(WeaponEntries)!.get(FLANK_TURRET);
            expect(weapon!.fireFromEntity('shooter', false)).toBeUndefined();
            expect(weapon!.fireFromEntity('shooter', false)).toBeUndefined();

            // Same tick, target moved forward: the turret opens up.
            pin(world.entities.get('victim')!, BEARINGS.ahead);
            expect(weapon!.fireFromEntity('shooter', false)).toBeDefined();
        });
    });

    describe('extra-outfits Flak Cannon', () => {
        it('is a turret blind to the front AND the rear, so it only '
            + 'covers the sides', async () => {
                const gameData = await getPluginGameData('extra-outfits');
                if (!gameData) {
                    pending('Extra Outfits plug-in not installed');
                    return;
                }
                const flak = await gameData.data.Weapon.get(FLAK_CANNON);
                expect(flak.name).toEqual('Flak Cannon');
                expect(flak.type).toEqual('ProjectileWeaponData');
                expect((flak as { guidance?: string }).guidance)
                    .toEqual('turret');
                // wëap Flags 0xd082: 0x1000 | 0x4000 set, 0x2000 clear.
                expect(flak.turretBlindSpots)
                    .toEqual({ front: true, sides: false, rear: true });
            });
    });

    // Stays on the REAL Nova data: this whole describe exists to pin the
    // stock resources the blind-spot rules were reported against, so the
    // stock ids live here now that the rules above run on the scenario.
    describe('stock data the rules are pinned against', () => {
        const LIGHT_BLASTER_TURRET = 'nova:130';
        const FUSION_PULSE_TURRET = 'nova:144';
        const FUSION_PULSE_BATTERY = 'nova:162';
        const FUSION_PULSE_CANNON = 'nova:143';
        const HAIL_CHAINGUN = 'nova:155';
        const LIGHT_BLASTER = 'nova:128';
        const SHUTTLE = 'nova:128';
        const FED_DESTROYER = 'nova:141';

        it('reads the wëap flags off the weapons in the report', async () => {
            const gameData = await getIntegrationGameData();
            const expected: Array<[string, string, unknown]> = [
                [FUSION_PULSE_BATTERY, 'Fusion Pulse Battery',
                    { front: false, sides: true, rear: true }],
                [FUSION_PULSE_TURRET, 'Fusion Pulse Turret',
                    { front: false, sides: false, rear: true }],
                [FUSION_PULSE_CANNON, 'Fusion Pulse Cannon',
                    { front: false, sides: false, rear: false }],
                [HAIL_CHAINGUN, 'Hail Chaingun',
                    { front: false, sides: false, rear: false }],
                [LIGHT_BLASTER_TURRET, 'Light Blaster Turret',
                    { front: false, sides: false, rear: false }],
                [LIGHT_BLASTER, 'Light Blaster',
                    { front: false, sides: true, rear: true }],
            ];
            for (const [id, name, blindSpots] of expected) {
                const weapon = await gameData.data.Weapon.get(id);
                expect(weapon.name).withContext(id).toEqual(name);
                expect(weapon.turretBlindSpots).withContext(id)
                    .toEqual(blindSpots as never);
            }
        });

        it('reads the shïp flags off the Fed Destroyer and the Shuttle',
            async () => {
                const gameData = await getIntegrationGameData();
                expect((await gameData.data.Ship.get(FED_DESTROYER))
                    .turretBlindSpots)
                    .toEqual({ front: false, sides: false, rear: true });
                expect((await gameData.data.Ship.get(SHUTTLE))
                    .turretBlindSpots)
                    .toEqual({ front: false, sides: false, rear: false });
            });

        // No stock ship is blind to its front, and no stock ship carries
        // a front blind spot that could silence a front-quadrant turret
        // outright. This is what makes it safe to run one blind-spot
        // rule over quadrant turrets as well as full ones.
        it('has no ship with a front blind spot', async () => {
            const gameData = await getIntegrationGameData();
            const frontBlind: string[] = [];
            for (const id of (await gameData.ids).Ship) {
                if ((await gameData.data.Ship.get(id)).turretBlindSpots.front) {
                    frontBlind.push(id);
                }
            }
            expect(frontBlind).toEqual([]);
        });
    });
});
