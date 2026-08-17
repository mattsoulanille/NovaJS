import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import SAT from 'sat';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { AggressionComponent } from './aggression.js';
import { CollisionVulnerabilityComponent } from './collision_interaction.js';
import { CompositeHull, HitboxHullComponent } from './collisions_plugin.js';
import { DamagedEvent, DeathEvent, ExplodingComponent } from './death_plugin.js';
import { DisabledComponent, isBelowDisableThreshold } from './disabled_component.js';
import { completeEntity } from './entity_data_loader.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { CombatRatingComponent, DamageAttributionComponent, LegalRecordsComponent } from './reputation_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { ShipDataComponent } from './ship_plugin.js';
import { Stat } from './stat.js';
import {
    MAX_SECONDARY_EXPLOSIONS, MIN_SECONDARY_EXPLOSIONS,
    nonLethalArmor, nonLethalArmorFloor, secondaryExplosionsDue,
    secondaryExplosionTotal, SHIP_EXPLOSION_DAMAGE_PER_TON,
    SHIP_EXPLOSION_KNOCKBACK_PER_TON, SHIP_EXPLOSION_MAX_RADIUS,
    SHIP_EXPLOSION_MIN_RADIUS, shipExplosionDamage, shipExplosionRadius,
} from './ship_explosion.js';

/** Stock ships whose real numbers these specs lean on. */
const LEVIATHAN = 'nova:131';   // 10000 tons, DeathDelay 250 frames
const SHUTTLE = 'nova:128';     // 15 tons, DeathDelay 25 frames
const VIPER = 'nova:167';       // 10 tons, DeathDelay 10 frames
const FED_CARRIER = 'nova:219'; // 2000 tons, DeathDelay 150 frames

/** Enough to zero any stock ship's shields and armor in one hit. */
const LETHAL = {
    shield: 1e9, armor: 1e9, ionization: 0, ionizationColor: 0,
    knockback: 0, passThroughShield: 1,
} as never;

describe('ship explosion scaling', () => {
    it('scales the blast radius with mass, floored and capped', () => {
        // The Bible (shïp Mass): "the blast radius and impact strength
        // when the ship explodes is proportional to its mass".
        expect(shipExplosionRadius(2000)).toEqual(40);
        expect(shipExplosionRadius(4000)).toEqual(80);
        // A Leviathan (10000 tons) reaches the cap.
        expect(shipExplosionRadius(10000)).toEqual(SHIP_EXPLOSION_MAX_RADIUS);
        expect(shipExplosionRadius(1e9)).toEqual(SHIP_EXPLOSION_MAX_RADIUS);
        // Light hulls get the floor rather than a mathematical point.
        expect(shipExplosionRadius(15)).toEqual(SHIP_EXPLOSION_MIN_RADIUS);
        expect(shipExplosionRadius(0)).toEqual(SHIP_EXPLOSION_MIN_RADIUS);
        expect(shipExplosionRadius(NaN)).toEqual(SHIP_EXPLOSION_MIN_RADIUS);
    });

    it('scales damage and knockback linearly with mass', () => {
        const leviathan = shipExplosionDamage(10000);
        expect(leviathan.armor)
            .toBeCloseTo(10000 * SHIP_EXPLOSION_DAMAGE_PER_TON, 9);
        expect(leviathan.shield).toEqual(leviathan.armor);
        expect(leviathan.knockback)
            .toBeCloseTo(10000 * SHIP_EXPLOSION_KNOCKBACK_PER_TON, 9);
        // Ten times the mass, ten times the damage.
        expect(shipExplosionDamage(1000).armor)
            .toBeCloseTo(leviathan.armor / 10, 9);
        // An explosion is a shock wave, not a shield-piercer, and it
        // ionizes nothing.
        expect(leviathan.passThroughShield).toEqual(0);
        expect(leviathan.ionization).toEqual(0);
        // A degenerate mass is harmless rather than NaN (which would
        // desync the sim).
        expect(shipExplosionDamage(NaN).armor).toEqual(0);
    });
});

describe('non-lethal armor clamp', () => {
    it('floors just ABOVE the disable threshold, for both flavors', () => {
        for (const fraction of [0.33, 0.10]) {
            const floor = nonLethalArmorFloor(1000, fraction);
            expect(floor).toBeGreaterThan(fraction * 1000);
            expect(isBelowDisableThreshold(
                { current: floor, max: 1000 }, fraction)).toBeFalse();
        }
    });

    it('never heals a ship already below the floor', () => {
        const floor = nonLethalArmorFloor(1000, 0.33);
        // A hulk at zero armor stays at zero: the clamp is a floor on
        // the damage, not a repair.
        expect(nonLethalArmor(0, 500, floor)).toEqual(0);
        expect(nonLethalArmor(100, 500, floor)).toEqual(100);
        // Above the floor, the damage lands until it reaches it.
        expect(nonLethalArmor(1000, 100, floor)).toEqual(900);
        expect(nonLethalArmor(1000, 5000, floor)).toEqual(floor);
    });

    it('leaves a degenerate hull untouchable', () => {
        expect(nonLethalArmorFloor(0, 0.33)).toEqual(0);
        // A threshold at or above 100% floors at max armor: such a ship
        // cannot be hurt at all without disabling it.
        expect(nonLethalArmorFloor(100, 1)).toEqual(100);
        expect(nonLethalArmor(100, 50, nonLethalArmorFloor(100, 1)))
            .toEqual(100);
    });
});

describe('secondary explosion cadence', () => {
    it('accelerates: every gap is shorter than the one before', () => {
        const total = 20;
        // Sample the schedule finely and record when each explosion is
        // due; the intervals must shrink monotonically.
        const times: number[] = [];
        let seen = 0;
        for (let i = 0; i <= 100000; i++) {
            const progress = i / 100000;
            const due = secondaryExplosionsDue(progress, total);
            while (seen < due) {
                times.push(progress);
                seen++;
            }
        }
        expect(times.length).toEqual(total);
        const gaps = times.slice(1).map((t, i) => t - times[i]);
        for (let i = 1; i < gaps.length; i++) {
            expect(gaps[i]).toBeLessThan(gaps[i - 1]);
        }
        // And it is a real speed-up, not a rounding artifact.
        expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1] * 5);
    });

    it('starts immediately and finishes exactly at the final explosion',
        () => {
            expect(secondaryExplosionsDue(0, 20)).toEqual(0);
            // The first explosion goes off as soon as the sequence does,
            // rather than after the longest gap.
            expect(secondaryExplosionsDue(1e-6, 20)).toEqual(1);
            expect(secondaryExplosionsDue(1, 20)).toEqual(20);
            expect(secondaryExplosionsDue(5, 20)).toEqual(20);
            // Monotone, and never over the total.
            let previous = 0;
            for (let i = 0; i <= 1000; i++) {
                const due = secondaryExplosionsDue(i / 1000, 20);
                expect(due).toBeGreaterThanOrEqual(previous);
                expect(due).toBeLessThanOrEqual(20);
                previous = due;
            }
        });

    it('gives longer breakups more explosions, within bounds', () => {
        // A Viper disintegrates for 10 frames, a Leviathan for 250.
        expect(secondaryExplosionTotal(10 / 30 * 1000))
            .toEqual(MIN_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(250 / 30 * 1000))
            .toBeGreaterThan(MIN_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(1e9))
            .toEqual(MAX_SECONDARY_EXPLOSIONS);
        expect(secondaryExplosionTotal(0)).toEqual(MIN_SECONDARY_EXPLOSIONS);
    });
});

describe('final explosion area damage (simulation)', () => {
    const EXPLODER = 'exploding ship';
    const VICTIM = 'victim ship';

    /**
     * A world holding one ship that will explode and one victim
     * `distance` pixels away.
     */
    async function battlefield(exploderId: string, distance: number,
        victimId = SHUTTLE, options: { victimIsPlayer?: boolean } = {}) {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });

        const place = async (id: string, uuid: string, x: number) => {
            const shipData = (await gameData.data.Ship.get(id))!;
            const ship = makeShip(shipData);
            await completeEntity(world, ship);
            world.entities.set(uuid, ship);
            ship.components.get(MovementStateComponent)!.position =
                new Position(x, 0);
            return ship;
        };
        const exploder = await place(exploderId, EXPLODER, 0);
        const victim = await place(victimId, VICTIM, distance);
        if (options.victimIsPlayer) {
            victim.components.set(ControlledByComponent, { peerId: 'a' });
            victim.components.set(LegalRecordsComponent, new Map());
            victim.components.set(CombatRatingComponent, { kills: 0 });
        }
        world.step();
        return { world, gameData, exploder, victim };
    }

    const armorOf = (ship: Entity) => ship.components.get(ArmorComponent)!;
    const shieldOf = (ship: Entity) => ship.components.get(ShieldComponent)!;

    /**
     * Ends the exploding ship's death sequence right now. DeathEvent is
     * the tick the final explosion happens on — the same event the
     * display's Explode2 fireball rides — so this reaches the sim's
     * final-explosion tick without waiting out a 250-frame breakup (one
     * spec below does wait it out, end to end). The payload is the
     * sim Time, which no DeathEvent handler reads.
     */
    function explodeNow(world: World) {
        world.emit(DeathEvent,
            { time: 0, delta_s: 0, delta_ms: 0, frame: 0 }, [EXPLODER]);
    }

    it('damages a nearby ship in proportion to the exploder\'s mass',
        async () => {
            const damageTo = async (exploderId: string) => {
                // 10 px apart, inside even the minimum blast radius, so
                // the comparison is about the DAMAGE and not the reach.
                const { world, victim } = await battlefield(exploderId, 10);
                const before = shieldOf(victim).current;
                explodeNow(world);
                world.step();
                return before - shieldOf(victim).current;
            };
            // A Leviathan (10000 t) and a Viper (10 t) at the same range.
            const leviathan = await damageTo(LEVIATHAN);
            const viper = await damageTo(VIPER);
            expect(leviathan).toBeCloseTo(
                10000 * SHIP_EXPLOSION_DAMAGE_PER_TON, 4);
            expect(viper).toBeCloseTo(10 * SHIP_EXPLOSION_DAMAGE_PER_TON, 4);
            expect(leviathan).toBeGreaterThan(viper * 100 - 1);
        }, 120_000);

    it('does not reach past its radius', async () => {
        // A Leviathan's blast is SHIP_EXPLOSION_MAX_RADIUS px; a Shuttle
        // sitting twice that far away is untouched. (Its own hitbox is
        // tens of px wide, so the margin is generous.)
        const { world, victim } = await battlefield(LEVIATHAN,
            SHIP_EXPLOSION_MAX_RADIUS * 4);
        const shield = shieldOf(victim).current;
        const armor = armorOf(victim).current;
        explodeNow(world);
        world.step();
        world.step();
        expect(shieldOf(victim).current).toEqual(shield);
        expect(armorOf(victim).current).toEqual(armor);
    }, 120_000);

    it('never disables or destroys a nearly-dead victim', async () => {
        const { world, victim } = await battlefield(LEVIATHAN, 30);
        const shipData = victim.components.get(ShipDataComponent)!;
        const armor = armorOf(victim);
        // One armor point above the disable threshold, shields gone:
        // the most fragile a living ship gets.
        armor.current = shipData.disableArmorFraction * armor.max + 1;
        shieldOf(victim).current = 0;

        explodeNow(world);
        world.step();

        // The blast hurt it — and stopped above the threshold.
        expect(armor.current).toBeLessThan(
            shipData.disableArmorFraction * armor.max + 1);
        expect(armor.current).toEqual(nonLethalArmorFloor(
            armor.max, shipData.disableArmorFraction));
        expect(isBelowDisableThreshold(armor, shipData.disableArmorFraction))
            .toBeFalse();
        // No disable, no death sequence, and it is still in the world.
        for (let i = 0; i < 10; i++) {
            world.step();
        }
        expect(victim.components.has(DisabledComponent)).toBeFalse();
        expect(victim.components.has(ExplodingComponent)).toBeFalse();
        expect(world.entities.has(VICTIM)).toBeTrue();
    }, 120_000);

    it('cannot finish off a hulk that is already below the threshold',
        async () => {
            const { world, victim } = await battlefield(LEVIATHAN, 30);
            const armor = armorOf(victim);
            // A disabled wreck at a hair of armor, as a real hulk sits.
            armor.current = 0.01;
            shieldOf(victim).current = 0;
            world.step();
            expect(victim.components.has(DisabledComponent)).toBeTrue();

            explodeNow(world);
            world.step();

            // Unhurt (the clamp is a floor on damage, not a repair) and
            // certainly not destroyed.
            expect(armor.current).toEqual(0.01);
            expect(victim.components.has(ExplodingComponent)).toBeFalse();
            expect(world.entities.has(VICTIM)).toBeTrue();
        }, 120_000);

    it('carries no kill credit, no aggression and no legal penalty',
        async () => {
            const { world, victim } = await battlefield(LEVIATHAN, 30,
                SHUTTLE, { victimIsPlayer: true });
            explodeNow(world);
            world.step();

            // It really did land.
            expect(shieldOf(victim).current)
                .toBeLessThan(shieldOf(victim).max);
            // ...and nobody is blamed for it. No damager identity means
            // DamageAttributionSystem records no root (so no kill could
            // ever be credited), AggressionDamageSystem records no
            // aggressor, and no legal record moved.
            expect(victim.components.get(DamageAttributionComponent)?.root)
                .toBeUndefined();
            const aggression = victim.components.get(AggressionComponent);
            expect(aggression === undefined || aggression.size === 0)
                .toBeTrue();
            expect([...victim.components.get(LegalRecordsComponent)!])
                .toEqual([]);
            expect(victim.components.get(CombatRatingComponent))
                .toEqual({ kills: 0 });
        }, 120_000);

    it('sweeps up point-defense-vulnerable ordnance, unclamped',
        async () => {
            // The blast hits both 'normal' (every ship) and
            // 'pointDefense' (guided missiles in flight, plus the ship
            // classes that opt into shïp Flags2 0x0008): a hull coming
            // apart takes the ordnance in the neighbourhood with it. The
            // non-lethal clamp is a SHIP rule, so a missile — which has
            // no shïp data — dies outright.
            const { world } = await battlefield(LEVIATHAN, 1000);
            const missile = new Entity('missile');
            missile.components.set(MovementStateComponent, {
                position: new Position(20, 0), velocity: new Vector(0, 0),
                rotation: new Angle(0), accelerating: 0, turning: 0,
                turnBack: false,
            } as never);
            missile.components.set(CollisionVulnerabilityComponent,
                { vulnerableTo: new Set(['pointDefense']) });
            missile.components.set(HitboxHullComponent, new CompositeHull(
                [new SAT.Circle(new SAT.Vector(0, 0), 5)]));
            missile.components.set(ArmorComponent,
                new Stat({ current: 10, max: 10, recharge: 0 }));
            world.entities.set('missile', missile);
            world.step();

            explodeNow(world);
            world.step();
            // Nothing clamped it above a third of its armor.
            expect(missile.components.get(ArmorComponent)!.current)
                .toEqual(0);
        }, 120_000);

    it('does not damage the exploding ship itself', async () => {
        // A player's ship survives its own death sequence (it respawns),
        // so its own blast must not immediately maul the fresh hull.
        const { world, exploder } = await battlefield(LEVIATHAN, 30);
        const armor = armorOf(exploder);
        armor.current = armor.max;
        explodeNow(world);
        world.step();
        expect(armor.current).toEqual(armor.max);
    }, 120_000);

    it('reaches the blast through a real death sequence, and is '
        + 'deterministic across two identical worlds', async () => {
            // End to end: shoot the ship, let its death sequence run,
            // and the victim takes the blast when it finishes.
            const run = async () => {
                // A Fed Carrier (2000 t) takes a real bite out of a
                // Shuttle's shields on the way out, and its 150-frame
                // breakup is 300 sim steps — short enough to sit through.
                const { world, victim } = await battlefield(FED_CARRIER, 30,
                    SHUTTLE);
                const shieldBefore = shieldOf(victim).current;
                let died = false;
                world.events.get(DeathEvent).subscribe(() => died = true);
                world.emit(DamagedEvent,
                    { damage: LETHAL, damager: 'nobody' }, [EXPLODER]);
                for (let i = 0; i < 600 && !died; i++) {
                    world.step();
                }
                expect(died).toBeTrue();
                // One more step for the blast's collision pass.
                world.step();
                return {
                    shieldLost: shieldBefore - shieldOf(victim).current,
                    armor: armorOf(victim).current,
                };
            };
            const a = await run();
            const b = await run();
            expect(a.shieldLost).toBeGreaterThan(0);
            // Two worlds stepped identically reach identical state.
            expect(a).toEqual(b);
        }, 120_000);
});
