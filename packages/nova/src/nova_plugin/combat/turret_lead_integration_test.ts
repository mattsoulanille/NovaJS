import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { firstOrderLead, firstOrderWithFallback } from './guidance.js';
import { makeShip, TargetComponent } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import {
    aimsTurretsAccurately, ControlledByComponent, TurretAim,
    TurretAimComponent,
} from '../player/index.js';
import { applySimulationInputs } from '../../communication/simulation_input.js';

/**
 * Reference "A turret's lead, and a lead into a blind sector (the T
 * leftover), wave 50", finding 1: a projectile turret (wëap Guidance 4)
 * aims at the FIRST-ORDER lead, angle(d + dv x |d| / shotSpeed), not at
 * the exact intercept. The quadrant guns (Guidance 7 / 8) were not
 * flown and keep the intercept.
 */
describe('a projectile turret\'s lead (reference T, wave 50)', () => {
    type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;
    const SHOOTER_AT = new Position(1000, 1000);
    // 500 px off the shooter's nose, so it is in every gun's arc.
    const TARGET_AT = new Position(1000, 500);
    // Coasting across the line at 220 px/s, as Kit Fast Blind Ring did.
    const SHOOTER_VELOCITY = new Vector(220, 0);

    function pin(ship: Entity, position: Position, velocity: Vector) {
        ship.components.set(MovementStateComponent, {
            position, velocity, rotation: new Angle(0), accelerating: 0,
            turning: 0, turnBack: false,
        });
    }

    async function addShip(world: World, gameData: GameData, uuid: string) {
        const ship = makeShip(await gameData.data.Ship.get(
            SYNTHETIC.ships.skiff));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    /**
     * The shot `weaponId` fires (inaccuracy off), and its exit point.
     * `player`: the shooter is peer 'p''s ship, with `aim` as its
     * TurretAim (undefined: none); `npcAim` puts a stray TurretAim on an
     * uncontrolled shooter.
     */
    async function shot(weaponId: string, options: {
        player?: boolean, aim?: TurretAim, npcAim?: TurretAim,
        flipTo?: boolean,
    } = {}) {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        const shooter = await addShip(world, gameData, 'shooter');
        const victim = await addShip(world, gameData, 'victim');
        shooter.components.set(TargetComponent, { target: 'victim' });
        if (options.player) {
            shooter.components.set(ControlledByComponent, { peerId: 'p' });
            if (options.aim) {
                shooter.components.set(TurretAimComponent, options.aim);
            }
        } else if (options.npcAim) {
            shooter.components.set(TurretAimComponent, options.npcAim);
        }
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        if (options.flipTo !== undefined) {
            // The pref changed in flight: peer 'p''s input record.
            applySimulationInputs(world,
                [{ kind: 'setTurretAim', accurate: options.flipTo }], 'p');
            // Someone else's flip never reaches this ship.
            applySimulationInputs(world,
                [{ kind: 'setTurretAim', accurate: !options.flipTo }], 'q');
            expect(shooter.components.get(TurretAimComponent))
                .toEqual({ accurate: options.flipTo });
        }
        pin(shooter, SHOOTER_AT, SHOOTER_VELOCITY);
        pin(victim, TARGET_AT, new Vector(0, 0));
        await loadWeaponsGameData(world, [weaponId]);
        const weapon = world.resources.get(WeaponEntries)!
            .getCached(weaponId)!;
        const spawned = weapon.fireFromEntity('shooter', false);
        expect(spawned).withContext(weaponId).toBeDefined();
        const movement = spawned!.components.get(MovementStateComponent)!;
        return {
            aim: movement.rotation.angle,
            exit: movement.position,
            shotSpeed: weapon.data.shotSpeed,
        };
    }

    it('aims a Guidance-4 turret at the first-order lead, not the '
        + 'intercept', async () => {
            const { aim, exit, shotSpeed } =
                await shot(SYNTHETIC.weapons.turret);
            const lead = firstOrderLead(exit, SHOOTER_VELOCITY, TARGET_AT,
                new Vector(0, 0), shotSpeed);
            const intercept = firstOrderWithFallback(exit,
                SHOOTER_VELOCITY, TARGET_AT, new Vector(0, 0), shotSpeed);
            expect(aim).toBeCloseTo(lead.angle, 9);
            // The two really differ here, so the check above means
            // something.
            expect(Math.abs(lead.angle - intercept.angle))
                .toBeGreaterThan(1e-3);
            // Led back against the shooter's own motion (+x).
            expect(aim).toBeLessThan(0);
        });

    it('keeps the exact intercept for a front-quadrant gun (Guidance 7, '
        + 'not measured)', async () => {
            const { aim, exit, shotSpeed } =
                await shot(SYNTHETIC.weapons.bowChaser);
            const intercept = firstOrderWithFallback(exit,
                SHOOTER_VELOCITY, TARGET_AT, new Vector(0, 0), shotSpeed);
            expect(aim).toBeCloseTo(intercept.angle, 9);
        });

    describe('a player\'s own ship (Matthew\'s ruling: the Enhancements '
        + 'toggle "Accurate turret aim")', () => {
        async function aims(options: Parameters<typeof shot>[1]) {
            const { aim, exit, shotSpeed } =
                await shot(SYNTHETIC.weapons.turret, options);
            const still = new Vector(0, 0);
            const lead = firstOrderLead(exit, SHOOTER_VELOCITY, TARGET_AT,
                still, shotSpeed).angle;
            const intercept = firstOrderWithFallback(exit, SHOOTER_VELOCITY,
                TARGET_AT, still, shotSpeed).angle;
            expect(Math.abs(lead - intercept)).toBeGreaterThan(1e-3);
            if (Math.abs(aim - intercept) < 1e-9) {
                return 'intercept';
            }
            if (Math.abs(aim - lead) < 1e-9) {
                return 'first order';
            }
            return `neither (${aim})`;
        }

        it('aims at the exact intercept with the toggle on', async () => {
            expect(await aims({ player: true, aim: { accurate: true } }))
                .toBe('intercept');
        });

        it('aims at the original\'s first-order lead with it off',
            async () => {
                expect(await aims({ player: true, aim: { accurate: false } }))
                    .toBe('first order');
            });

        it('takes the default (on) when the ship carries no choice',
            async () => {
                expect(await aims({ player: true })).toBe('intercept');
            });

        it('follows the setTurretAim input record in flight, the sender\'s '
            + 'own ship only', async () => {
                expect(await aims({
                    player: true, aim: { accurate: true }, flipTo: false,
                })).toBe('first order');
                expect(await aims({
                    player: true, aim: { accurate: false }, flipTo: true,
                })).toBe('intercept');
            });

        it('leaves an NPC on first order whatever it carries', async () => {
            expect(await aims({ npcAim: { accurate: true } }))
                .toBe('first order');
            expect(await aims({})).toBe('first order');
        });
    });

    it('aimsTurretsAccurately: only a player-controlled ship, as its '
        + 'TurretAim says (default on)', () => {
        const ship = new Entity('s');
        expect(aimsTurretsAccurately(ship)).toBeFalse();
        ship.components.set(TurretAimComponent, { accurate: true });
        expect(aimsTurretsAccurately(ship)).toBeFalse();
        ship.components.set(ControlledByComponent, { peerId: 'p' });
        expect(aimsTurretsAccurately(ship)).toBeTrue();
        ship.components.set(TurretAimComponent, { accurate: false });
        expect(aimsTurretsAccurately(ship)).toBeFalse();
        ship.components.delete(TurretAimComponent);
        expect(aimsTurretsAccurately(ship)).toBeTrue();
    });
});
