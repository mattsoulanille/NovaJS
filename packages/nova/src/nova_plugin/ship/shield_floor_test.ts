import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { DamagedEvent } from './death_plugin.js';
import {
    ArmorComponent, SHIELD_FLOOR_FRACTION, ShieldComponent, shieldFloor,
} from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { completeEntity, makeHulk } from '../spawn/index.js';
import { makeSystem } from '../make_system.js';

/**
 * #313 (maintainer ruling: deliberate): a shield collapses to -5% of its
 * max, not to zero, so a knocked-down shield must regenerate that 5%
 * back before it absorbs damage again. One named constant feeds both
 * places a ship's shield Stat is built (ShipShieldProvider and makeHulk).
 */
describe('shield floor', () => {
    const SHIP = 'shield floor ship';

    /** Shield-only damage, then a probe hit: 1 shield, 5 armor. */
    const COLLAPSE = {
        shield: 1e6, armor: 0, ionization: 0, ionizationColor: 0,
        knockback: 0, passThroughShield: 0,
    } as never;
    const PROBE = {
        shield: 1, armor: 5, ionization: 0, ionizationColor: 0,
        knockback: 0, passThroughShield: 0,
    } as never;

    async function shipWorld() {
        const gameData = await getSyntheticGameData();
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            'worker', { npcs: false });
        const shipData = (await gameData.data.Ship.get(SYNTHETIC.ships.skiff))!;
        const ship = makeShip(shipData);
        await completeEntity(world, ship);
        world.entities.set(SHIP, ship);
        world.step();
        return { world, ship };
    }

    const shieldOf = (ship: Entity) => ship.components.get(ShieldComponent)!;
    const armorOf = (ship: Entity) => ship.components.get(ArmorComponent)!;

    it('is 5% of the shield capacity below zero', () => {
        expect(SHIELD_FLOOR_FRACTION).toBe(0.05);
        expect(shieldFloor(400)).toBe(-20);
        expect(shieldFloor(0)).toBe(-0);
    });

    it('is the floor of a ship\'s shield Stat (ShipShieldProvider)',
        async () => {
            const { ship } = await shipWorld();
            const shield = shieldOf(ship);
            expect(shield.max).toBeGreaterThan(0);
            expect(shield.min).toBe(shieldFloor(shield.max));
        }, 60_000);

    it('is the floor of a hulk\'s seeded shield Stat (makeHulk)', () => {
        const entity = new Entity();
        makeHulk(entity, {
            armor: 100, armorRecharge: 0, shield: 400, shieldRecharge: 1,
        });
        expect(entity.components.get(ShieldComponent)!.min)
            .toBe(shieldFloor(400));
    });

    it('a collapsed shield lets hits through to the armor until it has ' +
        'regenerated past the floor', async () => {
            const { world, ship } = await shipWorld();
            const shield = shieldOf(ship);
            const armor = armorOf(ship);
            const floor = shieldFloor(shield.max);
            // Knock the shield down: it bottoms out at the floor (the
            // recharge step clamps the overshoot), not at zero.
            world.emit(DamagedEvent, { damage: COLLAPSE, damager: 'x' }, [SHIP]);
            world.step();
            expect(shield.current).toBeLessThan(0);
            expect(shield.current).toBeGreaterThanOrEqual(floor);
            expect(armor.current).toBe(armor.max);

            // Halfway back from the floor, still below zero: a hit goes
            // through to the armor. (One tick of recharge is far smaller
            // than the margins used here.)
            shield.current = floor / 2;
            world.emit(DamagedEvent, { damage: PROBE, damager: 'x' }, [SHIP]);
            world.step();
            expect(armor.current).toBe(armor.max - 5);

            // Regenerated past the floor (above zero by more than the
            // hit): the shield absorbs it again.
            shield.current = 2;
            world.emit(DamagedEvent, { damage: PROBE, damager: 'x' }, [SHIP]);
            world.step();
            expect(armor.current).toBe(armor.max - 5);
            // 2 - 1, plus one tick of recharge.
            expect(shield.current).toBeCloseTo(1, 1);
        }, 60_000);
});
