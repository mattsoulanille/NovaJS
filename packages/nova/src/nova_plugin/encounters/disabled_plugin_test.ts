import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { CloakActiveComponent } from '../ship/cloak_plugin.js';
import {
    deriveRepair,
    DisabledComponent,
    DISABLED_DECELERATION,
    isBelowDisableThreshold,
    OUTFIT_REPAIR_DELAY_MAX_MS,
    OUTFIT_REPAIR_DELAY_MIN_MS,
    PLAYER_REPAIR_DELAY_MAX_MS,
    PLAYER_REPAIR_DELAY_MIN_MS,
    RepairComponent,
    repairedArmor,
    REPAIR_MARGIN_FRACTION,
    rollRepairTime,
} from '../ship/disabled_component.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { SourceComponent } from '../combat/fire_weapon_plugin.js';
import { ArmorComponent, FuelComponent, ShieldComponent } from '../ship/health_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import {
    FormationComponent, formationSlotPosition,
} from '../npc/npc_ai_plugin.js';
import { OutfitsState, OutfitsStateComponent } from '../ship/outfit_plugin.js';
import { ControlledByComponent, ShipControlEvent, ShipControlStateComponent } from '../player/ship_control.js';
import { ShipDataComponent, ShipPhysicsComponent } from '../ship/ship_plugin.js';
import { PlayerSoundEvent } from '../core/sound_plugin.js';
import { Stat } from '../core/stat.js';

/** A gameData stub exposing only Outfit.getCached. */
function mockGameData(outfits: { [id: string]: OutfitData | undefined }) {
    return { data: { Outfit: { getCached: (id: string) => outfits[id] } } } as any;
}

describe('disable threshold helpers', () => {
    it('detects the threshold crossing', () => {
        const armor = { current: 331, max: 1000 };
        expect(isBelowDisableThreshold(armor, 0.33)).toBeFalse();
        armor.current = 330;
        expect(isBelowDisableThreshold(armor, 0.33)).toBeTrue();
        // The same armor is fine for a 10%-threshold ship.
        expect(isBelowDisableThreshold(armor, 0.10)).toBeFalse();
        armor.current = 100;
        expect(isBelowDisableThreshold(armor, 0.10)).toBeTrue();
    });

    it('never disables a ship with no armor stat', () => {
        expect(isBelowDisableThreshold({ current: 0, max: 0 }, 0.33))
            .toBeFalse();
    });

    it('repairs to slightly above the threshold, capped at max', () => {
        expect(repairedArmor(1000, 0.33))
            .toBeCloseTo((0.33 + REPAIR_MARGIN_FRACTION) * 1000, 9);
        expect(isBelowDisableThreshold(
            { current: repairedArmor(1000, 0.33), max: 1000 }, 0.33))
            .toBeFalse();
        // A margin that would exceed max armor is capped.
        expect(repairedArmor(10, 0.95)).toEqual(10);
    });

    it('rolls repair times: outfit precedes player, ranges hold', () => {
        // The outfit schedule wins even for a player-controlled ship.
        const outfit = rollRepairTime(1000, true, true, () => 0.5)!;
        expect(outfit).toBeGreaterThanOrEqual(1000 + OUTFIT_REPAIR_DELAY_MIN_MS);
        expect(outfit).toBeLessThan(1000 + OUTFIT_REPAIR_DELAY_MAX_MS);

        const player = rollRepairTime(1000, false, true, () => 0.5)!;
        expect(player).toBeGreaterThanOrEqual(1000 + PLAYER_REPAIR_DELAY_MIN_MS);
        expect(player).toBeLessThan(1000 + PLAYER_REPAIR_DELAY_MAX_MS);
        // The inherent droid is slower than the purchasable outfit.
        expect(player).toBeGreaterThan(outfit);

        // No outfit, not a player: no self-repair.
        expect(rollRepairTime(1000, false, false, () => 0.5)).toBeNull();

        // Deterministic: the same draw gives the same time.
        expect(rollRepairTime(1000, true, false, () => 0.25))
            .toEqual(rollRepairTime(1000, true, false, () => 0.25));
    });
});

describe('deriveRepair', () => {
    it('finds a repair-system outfit', () => {
        const outfits: OutfitsState = new Map([['r', { count: 1 }]]);
        expect(deriveRepair(outfits, mockGameData({
            r: { ...getDefaultOutfitData(), id: 'r', repairSystem: true },
        }))).toEqual({ hasRepairSystem: true });
    });

    it('ignores zero-count outfits and reports absence', () => {
        const outfits: OutfitsState = new Map([['r', { count: 0 }]]);
        expect(deriveRepair(outfits, mockGameData({
            r: { ...getDefaultOutfitData(), id: 'r', repairSystem: true },
        }))).toEqual({ hasRepairSystem: false });
    });

    it('returns undefined until the outfit data is cached', () => {
        const outfits: OutfitsState = new Map([['missing', { count: 1 }]]);
        expect(deriveRepair(outfits, mockGameData({}))).toBeUndefined();
    });
});

// Real Nova data: the shïp Flags 0x0010 bit splits the fleet into
// 33%-threshold civilians and 10%-threshold warships. Pin one of each
// (plus the ships other specs lean on).
describe('disable thresholds against real Nova data', () => {
    it('pins stock ships to their thresholds', async () => {
        const gameData = await getIntegrationGameData();
        // Shuttle: no flag, disables at 33%.
        expect((await gameData.data.Ship.get('nova:128'))!.disableArmorFraction)
            .toEqual(0.33);
        // Fed Carrier: also a 33% ship.
        expect((await gameData.data.Ship.get('nova:143'))!.disableArmorFraction)
            .toEqual(0.33);
        // Fed Destroyer: Flags 0x0010, disables at 10%.
        expect((await gameData.data.Ship.get('nova:141'))!.disableArmorFraction)
            .toEqual(0.10);
        // Raven: 10% too.
        expect((await gameData.data.Ship.get('nova:164'))!.disableArmorFraction)
            .toEqual(0.10);
    }, 120_000);
});

/**
 * World-level behavior against the real simulation stack. Worlds build
 * with the 'worker' platform (control systems included) in an
 * asteroid-free system with NPC traffic off — a controlled battlefield.
 */
describe('ship disabling in a live world', () => {
    const SHIP = 'ship under test';

    async function shipWorld(shipId: string, {
        controlled = false,
        extraOutfits = {} as { [id: string]: number },
    } = {}) {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        const shipData = (await gameData.data.Ship.get(shipId))!;
        const ship = makeShip(shipData);
        if (controlled) {
            ship.components.set(ControlledByComponent, { peerId: 'a' });
        }
        if (Object.keys(extraOutfits).length > 0) {
            // Seed the outfits state before completion so the derivers
            // (weapons, cloak, repair) all see the extra outfits and
            // the loader stages their data.
            const outfits: OutfitsState = new Map(Object.entries({
                ...shipData.outfits, ...extraOutfits,
            }).map(([id, count]) => [id, { count }]));
            ship.components.set(OutfitsStateComponent, outfits);
        }
        await completeEntity(world, ship);
        world.entities.set(SHIP, ship);
        world.step();
        return { world, ship, gameData };
    }

    function armorOf(ship: Entity): Stat {
        return ship.components.get(ArmorComponent)!;
    }

    function damageToFraction(ship: Entity, fraction: number) {
        const armor = armorOf(ship);
        armor.current = fraction * armor.max;
        const shield = ship.components.get(ShieldComponent);
        if (shield) {
            shield.current = 0;
        }
    }

    function holdControls(world: World, ship: Entity,
        held: { [action: string]: true | 'start' }) {
        ship.components.set(ShipControlStateComponent,
            new Map(Object.entries(held)) as any);
        world.emit(ShipControlEvent, undefined, [SHIP]);
    }

    it('keeps a full-armor hulk disabled, and un-disables it only when '
        + 'the component is deleted (boarding repair)', async () => {
        const { world, ship } = await shipWorld('nova:128');
        // A spawn-disabled derelict: full armor + shields, hulk flag
        // (Matthew's playtest observation: the original's derelicts read
        // "disabled" yet take a whole hull's worth of shots to destroy).
        ship.components.set(DisabledComponent,
            { repairAt: null, hulk: true });
        world.step();
        world.step();
        // Armor is far above the threshold, but the hulk stays disabled.
        expect(armorOf(ship).current).toBe(armorOf(ship).max);
        expect(ship.components.get(DisabledComponent)).toBeDefined();
        // Boarding repair deletes the component; the ship comes back and
        // stays back (armor was never below the threshold).
        ship.components.delete(DisabledComponent);
        world.step();
        expect(ship.components.get(DisabledComponent)).toBeUndefined();
    });

    it('enters at 33% for a Shuttle and NOT at 33% for a Fed Destroyer',
        async () => {
            {
                const { world, ship } = await shipWorld('nova:128');
                damageToFraction(ship, 0.34);
                world.step();
                expect(ship.components.has(DisabledComponent)).toBeFalse();
                damageToFraction(ship, 0.33);
                world.step();
                expect(ship.components.has(DisabledComponent)).toBeTrue();
            }
            {
                // The destroyer keeps fighting at 33% and disables at 10%.
                const { world, ship } = await shipWorld('nova:141');
                damageToFraction(ship, 0.33);
                world.step();
                expect(ship.components.has(DisabledComponent)).toBeFalse();
                damageToFraction(ship, 0.10);
                world.step();
                expect(ship.components.has(DisabledComponent)).toBeTrue();
            }
        }, 120_000);

    it('spends no afterburner fuel while disabled', async () => {
        // The stock Shuttle has no afterburner; fit the stock Afterburner
        // outfit (nova:197, 37 fuel/s) through the real provider path.
        const { world, ship } = await shipWorld('nova:128', {
            extraOutfits: { 'nova:197': 1 },
        });
        expect(ship.components.get(ShipPhysicsComponent)!.afterburner)
            .toBeGreaterThan(0);
        const fuel = ship.components.get(FuelComponent)!;
        fuel.current = fuel.max;

        // Enabled: holding afterburner drains fuel (the control reaches
        // EffectiveMovementPhysicsSystem).
        holdControls(world, ship, { afterburner: true });
        world.step();
        const afterEnabledBurn = fuel.current;
        expect(afterEnabledBurn).toBeLessThan(fuel.max);

        // Disabled: DisabledMovementSystem erased the thrust afterwards
        // but the fuel was still being spent up front (shipped bug).
        damageToFraction(ship, 0.2);
        world.step();
        expect(ship.components.has(DisabledComponent)).toBeTrue();
        const beforeDisabledBurn = fuel.current;
        for (let i = 0; i < 30; i++) {
            holdControls(world, ship, { afterburner: true });
            world.step();
        }
        expect(fuel.current).toEqual(beforeDisabledBurn);
    }, 120_000);

    it('suspends thrust and turning, and the ship slows to rest',
        async () => {
            const { world, ship } = await shipWorld('nova:128');
            const movement = ship.components.get(MovementStateComponent)!;
            movement.velocity = new Vector(100, 0);
            damageToFraction(ship, 0.2);
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeTrue();

            holdControls(world, ship, { accelerate: true, turnRight: true });
            const speedBefore = movement.velocity.length;
            world.step();
            // The control system's writes were erased.
            expect(movement.accelerating).toEqual(0);
            expect(movement.turning).toEqual(0);
            expect(movement.velocity.length).toBeLessThan(speedBefore);

            // DISABLED_DECELERATION px/s^2: 100 px/s reaches zero within
            // 100/DISABLED_DECELERATION seconds (plus slack for the
            // partial first tick).
            const steps = Math.ceil(
                (100 / DISABLED_DECELERATION) * 60) + 10;
            for (let i = 0; i < steps; i++) {
                holdControls(world, ship, { accelerate: true });
                world.step();
            }
            expect(movement.velocity.length).toEqual(0);
            expect(ship.components.has(DisabledComponent)).toBeTrue();
        }, 120_000);

    it('suspends weapon fire while disabled', async () => {
        const projectilesFrom = (world: World) => [...world.entities]
            .filter(([, entity]) =>
                entity.components.get(SourceComponent) === SHIP).length;

        // Control case: a healthy shuttle firing its primary spawns
        // projectiles once past the initial reload window. (Controlled:
        // the trigger->firing translation only runs for controlled
        // ships, which carry ActiveSecondaryWeapon.)
        {
            const { world, ship } = await shipWorld('nova:128',
                { controlled: true });
            for (let i = 0; i < 300; i++) {
                holdControls(world, ship, { firePrimary: true });
                world.step();
            }
            expect(projectilesFrom(world)).toBeGreaterThan(0);
        }
        // Disabled: the same trigger-holding spawns nothing.
        {
            const { world, ship } = await shipWorld('nova:128',
                { controlled: true });
            damageToFraction(ship, 0.2);
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeTrue();
            for (let i = 0; i < 300; i++) {
                holdControls(world, ship, { firePrimary: true });
                world.step();
            }
            expect(projectilesFrom(world)).toEqual(0);
        }
    }, 120_000);

    it('suspends shield/armor/fuel recharge but still clamps', async () => {
        const { world, ship } = await shipWorld('nova:128');
        const armor = armorOf(ship);
        const shield = ship.components.get(ShieldComponent)!;
        const fuel = ship.components.get(FuelComponent)!;
        expect(shield.recharge).toBeGreaterThan(0);

        damageToFraction(ship, 0.2);
        fuel.current = 10;
        world.step();
        expect(ship.components.has(DisabledComponent)).toBeTrue();

        const armorBefore = armor.current;
        const shieldBefore = shield.current;
        const fuelBefore = fuel.current;
        for (let i = 0; i < 60; i++) {
            world.step();
        }
        expect(armor.current).toEqual(armorBefore);
        expect(shield.current).toEqual(shieldBefore);
        expect(fuel.current).toEqual(fuelBefore);

        // Damage overshoot is still clamped to the stat floor even
        // though the recharge step is suspended.
        shield.current = shield.min - 500;
        world.step();
        expect(shield.current).toEqual(shield.min);
    }, 120_000);

    it('decloaks once on disable and blocks re-cloaking', async () => {
        // nova:269 is the stock Polaris cloaking device.
        const { world, ship } = await shipWorld('nova:128',
            { extraOutfits: { 'nova:269': 1 } });

        let cloakOffSounds = 0;
        world.addSystem(new System({
            name: 'CountCloakOffSounds',
            events: [PlayerSoundEvent],
            args: [PlayerSoundEvent, UUID] as const,
            step(sound) {
                if (sound.id === 'nova:380') {
                    cloakOffSounds++;
                }
            },
        }));

        holdControls(world, ship, { cloak: 'start' });
        world.step();
        expect(ship.components.get(CloakActiveComponent)?.active).toBeTrue();

        damageToFraction(ship, 0.2);
        world.step();
        expect(ship.components.has(DisabledComponent)).toBeTrue();
        expect(ship.components.get(CloakActiveComponent)?.active).toBeFalse();
        expect(cloakOffSounds).toEqual(1);

        // Steps while disabled do not re-emit the decloak.
        for (let i = 0; i < 30; i++) {
            world.step();
        }
        expect(cloakOffSounds).toEqual(1);

        // The cloak toggle is offline while disabled.
        holdControls(world, ship, { cloak: 'start' });
        world.step();
        expect(ship.components.get(CloakActiveComponent)?.active).toBeFalse();
    }, 120_000);

    it('repairs on the outfit schedule to above the threshold and resumes',
        async () => {
            // nova:437: the stock ModType 49 repair-system outfit.
            const { world, ship } = await shipWorld('nova:128',
                { extraOutfits: { 'nova:437': 1 } });
            expect(ship.components.get(RepairComponent))
                .toEqual({ hasRepairSystem: true });

            damageToFraction(ship, 0.2);
            world.step();
            const disabled = ship.components.get(DisabledComponent)!;
            expect(disabled.repairAt).not.toBeNull();

            // Step to just past the rolled repair time.
            const steps = Math.ceil(disabled.repairAt! / (1000 / 60)) + 5;
            for (let i = 0; i < steps; i++) {
                world.step();
            }
            expect(ship.components.has(DisabledComponent)).toBeFalse();
            const armor = armorOf(ship);
            const shipData = ship.components.get(ShipDataComponent)!;
            expect(armor.current).toBeCloseTo(
                repairedArmor(armor.max, shipData.disableArmorFraction), 6);

            // Systems resume: the shield recharges again.
            const shield = ship.components.get(ShieldComponent)!;
            const before = shield.current;
            for (let i = 0; i < 60; i++) {
                world.step();
            }
            expect(shield.current).toBeGreaterThan(before);
        }, 120_000);

    it('rolls the same repair delay for the same seed', async () => {
        const roll = async () => {
            const { world, ship } = await shipWorld('nova:128',
                { extraOutfits: { 'nova:437': 1 } });
            damageToFraction(ship, 0.2);
            world.step();
            return ship.components.get(DisabledComponent)!.repairAt;
        };
        const a = await roll();
        const b = await roll();
        expect(a).not.toBeNull();
        expect(a).toEqual(b);
    }, 120_000);

    it('gives player-controlled ships the inherent repair droid',
        async () => {
            const { world, ship } = await shipWorld('nova:128',
                { controlled: true });
            expect(ship.components.get(RepairComponent))
                .toEqual({ hasRepairSystem: false });
            damageToFraction(ship, 0.2);
            world.step();
            const disabled = ship.components.get(DisabledComponent)!;
            expect(disabled.repairAt).not.toBeNull();
            // The inherent droid uses the slower player schedule.
            expect(disabled.repairAt!).toBeGreaterThanOrEqual(
                PLAYER_REPAIR_DELAY_MIN_MS);
        }, 120_000);

    it('leaves NPCs with no repair outfit stranded', async () => {
        const { world, ship } = await shipWorld('nova:128');
        damageToFraction(ship, 0.2);
        world.step();
        expect(ship.components.get(DisabledComponent)!.repairAt).toBeNull();
        for (let i = 0; i < 120; i++) {
            world.step();
        }
        expect(ship.components.has(DisabledComponent)).toBeTrue();
    }, 120_000);

    it('re-enables when outside repair lifts armor above the threshold',
        async () => {
            const { world, ship } = await shipWorld('nova:128');
            damageToFraction(ship, 0.2);
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeTrue();
            armorOf(ship).current = armorOf(ship).max;
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeFalse();
        }, 120_000);

    it('self-destruct kills the ship through the zero-armor death path',
        async () => {
            const { world, ship } = await shipWorld('nova:128',
                { controlled: true });
            holdControls(world, ship, { selfDestruct: 'start' });
            world.step();
            expect(armorOf(ship).current).toEqual(0);
            // The normal death path: the ship explodes for its
            // deathDelay, then (being player-controlled) respawns with
            // full stats — so after enough steps it is alive, at full
            // armor, and not disabled.
            for (let i = 0; i < 300; i++) {
                world.step();
            }
            expect(world.entities.has(SHIP)).toBeTrue();
            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.has(DisabledComponent)).toBeFalse();
        }, 120_000);

    it('disable-only weapons floor armor above zero; a normal weapon ' +
        'finishes the job', async () => {
            const { DamagedEvent, DISABLE_ONLY_ARMOR_FLOOR, ExplodingComponent } =
                await import('../ship/death_plugin.js');
            const ionBarrage = {
                shield: 100_000, armor: 100_000, ionization: 0,
                ionizationColor: 0xffffff, passThroughShield: 0,
                knockback: 0, disableOnly: true,
            };
            const lightBlaster = {
                shield: 0, armor: 5, ionization: 0,
                ionizationColor: 0xffffff, passThroughShield: 1,
                knockback: 0,
            };
            // Both threshold flavors: 33% Shuttle and 10% Fed Destroyer.
            for (const shipId of ['nova:128', 'nova:141']) {
                const { world, ship } = await shipWorld(shipId);
                world.emit(DamagedEvent,
                    { damage: ionBarrage, damager: 'nobody' }, [SHIP]);
                world.step();
                const armor = armorOf(ship);
                // Far below the disable threshold, but never zero.
                expect(armor.current).toEqual(DISABLE_ONLY_ARMOR_FLOOR);
                expect(ship.components.has(DisabledComponent)).toBeTrue();
                expect(ship.components.has(ExplodingComponent)).toBeFalse();
                // More ion fire changes nothing.
                world.emit(DamagedEvent,
                    { damage: ionBarrage, damager: 'nobody' }, [SHIP]);
                world.step();
                expect(armor.current).toEqual(DISABLE_ONLY_ARMOR_FLOOR);
                expect(ship.components.has(ExplodingComponent)).toBeFalse();
                // One tap from a lethal weapon destroys it.
                world.emit(DamagedEvent,
                    { damage: lightBlaster, damager: 'nobody' }, [SHIP]);
                world.step();
                expect(armor.current).toEqual(0);
                expect(ship.components.has(ExplodingComponent)).toBeTrue();
            }
        }, 120_000);

    it('pins the stock disable-only weapons (real data)', async () => {
        const gameData = await getIntegrationGameData();
        const damageOf = async (id: string) => {
            const weapon = await gameData.data.Weapon.get(id);
            if (!weapon || !('damage' in weapon)) {
                throw new Error(`No damage on weapon ${id}`);
            }
            return weapon.damage;
        };
        // Ion Cannon (the Manticore's Ionic Particle Cannons fire it).
        expect((await damageOf('nova:142')).disableOnly).toBeTrue();
        // A normal blaster turret is lethal.
        expect((await damageOf('nova:131')).disableOnly).toBeFalse();
        // The Manticore stocks 8 Ionic Particle Cannons.
        const manticore = (await gameData.data.Ship.get('nova:146'))!;
        expect(manticore.outfits['nova:148']).toEqual(8);
    }, 120_000);

    it('NPC warships drop disabled ships as attack targets', async () => {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        const { makeNpcShip } = await import('../spawn/npc_spawn_plugin.js');
        const { NpcComponent } = await import('../npc/npc_ai_plugin.js');
        const { TargetComponent } = await import('../ship/target_component.js');
        const { Position } = await import('nova_ecs/datatypes/position');
        const { Angle } = await import('nova_ecs/datatypes/angle');

        // A Federation destroyer warship and a nearby Auroran-governed
        // ship (the Federation's govt enemies include the Aurorans).
        const destroyerData = (await gameData.data.Ship.get('nova:141'))!;
        const warship = makeNpcShip(destroyerData, 3, 'nova:128',
            new Position(0, 0), new Angle(0), new Vector(0, 0));
        await completeEntity(world, warship);
        world.entities.set('warship', warship);

        const preyData = (await gameData.data.Ship.get('nova:128'))!;
        const prey = makeNpcShip(preyData, 1, 'nova:129',
            new Position(400, 0), new Angle(0), new Vector(0, 0));
        await completeEntity(world, prey);
        world.entities.set('prey', prey);

        // Let the decision system run (1s think interval, faster with
        // govt SkillMult). Only as far as the first think: the moment
        // the warship's first GUIDED missile locks on, the lock itself
        // provokes the wimpy prey into fleeing (guided-missile
        // provocation), so a long dogfight now ends with the prey
        // destroyed rather than intact — this spec is about the
        // disabled-target drop, so keep the shooting window short.
        for (let i = 0; i < 70; i++) {
            world.step();
        }
        expect(warship.components.get(TargetComponent)?.target)
            .toEqual('prey');
        expect(warship.components.get(NpcComponent)?.mode).toEqual('attack');

        // Disable the prey: the warship drops it at its next think.
        const preyArmor = prey.components.get(ArmorComponent)!;
        preyArmor.current = 0.05 * preyArmor.max;
        const preyShield = prey.components.get(ShieldComponent);
        if (preyShield) {
            preyShield.current = 0;
        }
        // Clear the sky of in-flight ordnance: at 5% armor a single
        // already-launched missile would destroy the prey and turn
        // this into a death test instead of a disable test.
        const { ProjectileDataComponent } =
            await import('../core/projectile_data.js');
        for (const [uuid, entity] of [...world.entities]) {
            if (entity.components.has(ProjectileDataComponent)) {
                world.entities.delete(uuid);
            }
        }
        for (let i = 0; i < 180; i++) {
            world.step();
        }
        expect(prey.components.has(DisabledComponent)).toBeTrue();
        expect(warship.components.get(TargetComponent)?.target)
            .not.toEqual('prey');
        expect(warship.components.get(NpcComponent)?.mode)
            .not.toEqual('attack');
    }, 120_000);

    it('a DISABLED escort drifts instead of holding its formation slot',
        async () => {
            // The playtest bug: formation keeping's RCS regime writes
            // movement.velocity DIRECTLY, so DisabledMovementSystem running
            // afterwards could not undo it and a hulk kept station.
            const { world, ship: leader } = await shipWorld('nova:128');
            const gameData = await getIntegrationGameData();
            const shipData = await gameData.data.Ship.get('nova:128');
            const follower = makeShip(shipData);
            await completeEntity(world, follower);
            world.entities.set('follower', follower);

            const leaderMovement =
                leader.components.get(MovementStateComponent)!;
            leaderMovement.position = new Position(0, 0);
            leaderMovement.velocity = new Vector(0, 0);
            leaderMovement.rotation = new Angle(0);

            follower.components.set(FormationComponent,
                { leader: SHIP, slot: 0, rcs: true });
            // 20px off station with the leader at rest: a small enough
            // correction that station-keeping uses the RCS nudge (the only
            // regime that survives the disabled sweep).
            const slot = formationSlotPosition(new Position(0, 0),
                new Angle(0), 0, 1);
            const start = new Position(slot.x + 20, slot.y);
            const followerMovement =
                follower.components.get(MovementStateComponent)!;
            followerMovement.position = start;
            followerMovement.velocity = new Vector(0, 0);
            // A hulk: disabled with full armor, so it stays disabled.
            follower.components.set(DisabledComponent,
                { repairAt: null, hulk: true });

            for (let i = 0; i < 60; i++) {
                world.step();
            }

            expect(follower.components.has(DisabledComponent)).toBeTrue();
            // Dead in space: not a single pixel of station-keeping.
            expect(followerMovement.velocity.length).toBe(0);
            expect(followerMovement.position.x).toBe(start.x);
            expect(followerMovement.position.y).toBe(start.y);
        }, 120_000);

    it('an ABLE escort in the same spot does close on its slot',
        async () => {
            // The control for the test above: without the disable, station
            // keeping pulls the escort in, so the assertion there is really
            // about the disabled gate and not about a dead formation.
            const { world, ship: leader } = await shipWorld('nova:128');
            const gameData = await getIntegrationGameData();
            const shipData = await gameData.data.Ship.get('nova:128');
            const follower = makeShip(shipData);
            await completeEntity(world, follower);
            world.entities.set('follower', follower);

            const leaderMovement =
                leader.components.get(MovementStateComponent)!;
            leaderMovement.position = new Position(0, 0);
            leaderMovement.velocity = new Vector(0, 0);
            leaderMovement.rotation = new Angle(0);

            follower.components.set(FormationComponent,
                { leader: SHIP, slot: 0, rcs: true });
            const slot = formationSlotPosition(new Position(0, 0),
                new Angle(0), 0, 1);
            const followerMovement =
                follower.components.get(MovementStateComponent)!;
            followerMovement.position = new Position(slot.x + 20, slot.y);
            followerMovement.velocity = new Vector(0, 0);

            for (let i = 0; i < 60; i++) {
                world.step();
            }

            expect(followerMovement.position.subtract(slot).length)
                .toBeLessThan(20);
        }, 120_000);

    it('self-destruct works while disabled (the escape hatch)',
        async () => {
            const { world, ship } = await shipWorld('nova:128',
                { controlled: true });
            damageToFraction(ship, 0.2);
            world.step();
            expect(ship.components.has(DisabledComponent)).toBeTrue();
            holdControls(world, ship, { selfDestruct: 'start' });
            world.step();
            expect(armorOf(ship).current).toEqual(0);
            for (let i = 0; i < 300; i++) {
                world.step();
            }
            // Respawned at full armor; the disable cleared with it.
            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.has(DisabledComponent)).toBeFalse();
        }, 120_000);
});
