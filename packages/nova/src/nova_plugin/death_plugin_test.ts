import 'jasmine';
import { EmitNow } from 'nova_ecs/arg_types';
import { Entity } from 'nova_ecs/entity';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import {
    armorFullyRestored, DamagedEvent, DeathEvent, ExplodingComponent,
    ZeroArmorEvent,
} from './death_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { DamageAttributionComponent } from './reputation_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { Stat } from './stat.js';

const SHIP = 'ship under test';

/** Enough to zero any stock ship's shields and armor in one hit. */
const LETHAL = {
    shield: 1e9, armor: 1e9, ionization: 0, ionizationColor: 0,
    knockback: 0, passThroughShield: true,
} as never;

describe('armorFullyRestored', () => {
    const stat = (current: number, max: number) =>
        new Stat({ current, recharge: 0, max });

    it('recognizes the respawn refill', () => {
        expect(armorFullyRestored(stat(0, 100))).toBeFalse();
        expect(armorFullyRestored(stat(100, 100))).toBeTrue();
    });

    it('does NOT mistake a hulk\'s tick of armor recharge for life',
        () => {
            // 70 of the 288 stock ships recharge armor, and ArmorRecharge
            // runs after the weapons that zero them, so a hulk sits a hair
            // above zero for its whole death sequence. Calling that alive
            // would make every one of those ships immortal.
            expect(armorFullyRestored(stat(0.01, 100))).toBeFalse();
            expect(armorFullyRestored(stat(99.9, 100))).toBeFalse();
        });

    it('takes an armorless or degenerate entity at face value', () => {
        expect(armorFullyRestored(undefined)).toBeFalse();
        expect(armorFullyRestored(stat(0, 0))).toBeFalse();
    });
});

/**
 * Matthew's playtest bug: "I managed to get into a state where my ship
 * was constantly playing the exploding animation while flying around. It
 * was after I died and respawned and probably died again immediately."
 *
 * A hit that lands on the hulk in the very tick its explosion finishes
 * queues a ZeroArmorEvent *behind* the DeathEvent that ends the death
 * sequence, so the event is handled after PlayerDeathSystem has already
 * refilled the armor. Acting on it restarted the death sequence on a
 * living, full-armor ship. These specs pin both event orderings.
 */
describe('player death and respawn', () => {
    async function playerWorld(shipId = 'nova:128') {
        const gameData = await getIntegrationGameData();
        const world = await makeSystem('nova:226', gameData, 'worker',
            { npcs: false });
        const shipData = (await gameData.data.Ship.get(shipId))!;
        const ship = makeShip(shipData);
        // ControlledBy, not PlayerShipSelector: PlayerDeathSystem (the
        // respawn) is gated on the synced component.
        ship.components.set(ControlledByComponent, { peerId: 'a' });
        await completeEntity(world, ship);
        world.entities.set(SHIP, ship);
        world.step();
        return { world, ship, gameData };
    }

    function armorOf(ship: Entity) {
        return ship.components.get(ArmorComponent)!;
    }

    /**
     * Counts every DeathEvent/ZeroArmorEvent *emit*, which is exactly
     * what the simulation bridge forwards to the display world (it
     * subscribes to the emit stream, not to handling).
     */
    function watchEvents(world: World) {
        const log: ('zeroArmor' | 'death')[] = [];
        world.events.get(ZeroArmorEvent).subscribe(
            () => log.push('zeroArmor'));
        world.events.get(DeathEvent).subscribe(() => log.push('death'));
        return log;
    }

    /**
     * A stand-in beam: emitNow(DamagedEvent) from inside a step system,
     * exactly as BeamDamageSystem does. Added last, so the toposort puts
     * it after ExplodingFinishedSystem — the ordering every real damage
     * source has (ProjectileCollisionSystem, BlastCollisionSystem and
     * BeamDamageSystem all sort after it), and the one that queues a
     * ZeroArmorEvent behind the death.
     */
    function addBeam(world: World, firing: () => boolean) {
        world.addSystem(new System({
            name: 'TestBeamAfterExplodingFinished',
            args: [EmitNow, SingletonComponent] as const,
            step(emitNow) {
                if (firing()) {
                    emitNow(DamagedEvent,
                        { damage: LETHAL, damager: 'nobody' }, [SHIP]);
                }
            },
        }));
    }

    /** Steps until `done`, or fails after `limit` steps. */
    function stepUntil(world: World, done: () => boolean, limit = 2000) {
        for (let i = 0; i < limit; i++) {
            world.step();
            if (done()) {
                return i + 1;
            }
        }
        throw new Error(`Condition not reached in ${limit} steps`);
    }

    it('respawns clean when the killing weapon keeps firing through the '
        + 'whole death sequence', async () => {
            const { world, ship } = await playerWorld();
            const log = watchEvents(world);
            let firing = true;
            addBeam(world, () => firing);

            // The hulk is hit every single tick, including the tick its
            // explosion finishes.
            stepUntil(world, () => log.includes('death'));
            firing = false;

            // The trigger is present: that same tick emitted a further
            // ZeroArmorEvent *after* the death, which is the stale one.
            expect(log[log.length - 1]).toEqual('zeroArmor');
            expect(log.filter(e => e === 'zeroArmor').length)
                .toBeGreaterThan(1);

            // ...and it was ignored. Before the fix the ship flew around
            // at full armor with ExplodingComponent re-attached, which
            // made it untargetable and unable to fire, and teleported it
            // back to the origin one deathDelay later.
            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.get(ShieldComponent)!.current)
                .toEqual(ship.components.get(ShieldComponent)!.max);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();

            // And it stays clean: no second sequence starts later.
            for (let i = 0; i < 300; i++) {
                world.step();
            }
            expect(log.filter(e => e === 'death').length).toEqual(1);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();
        }, 120_000);

    it('respawns clean when the damage is queued ahead of the step '
        + 'instead (the other event ordering)', async () => {
            const { world, ship } = await playerWorld();
            const log = watchEvents(world);

            // world.emit queues the damage, so its ZeroArmorEvent is
            // handled *before* the DeathEvent. That ordering used to slip
            // through the window ExplodingFinishedSystem opened by
            // deleting the marker before the death was handled: the
            // sequence restarted, and the DeathEvent then healed the
            // ship without clearing it.
            for (let i = 0; i < 2000; i++) {
                if (!log.includes('death')) {
                    world.emit(DamagedEvent,
                        { damage: LETHAL, damager: 'nobody' }, [SHIP]);
                }
                world.step();
                if (log.includes('death')) {
                    break;
                }
            }
            expect(log).toContain('death');

            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();

            for (let i = 0; i < 300; i++) {
                world.step();
            }
            expect(log.filter(e => e === 'death').length).toEqual(1);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();
        }, 120_000);

    it('survives repeated die/respawn/die cycles without accumulating a '
        + 'stuck death sequence', async () => {
            const { world, ship } = await playerWorld();
            const log = watchEvents(world);
            let firing = true;
            addBeam(world, () => firing);

            // Dies, explodes, respawns — and is instantly shot again,
            // which is Matthew's "died and probably died again
            // immediately", four lives deep.
            for (let life = 1; life <= 4; life++) {
                stepUntil(world, () =>
                    log.filter(e => e === 'death').length >= life);
            }
            // Exactly one death per life: a hit landing during a
            // sequence must not schedule an extra one.
            expect(log.filter(e => e === 'death').length).toEqual(4);

            firing = false;
            for (let i = 0; i < 300; i++) {
                world.step();
            }
            expect(log.filter(e => e === 'death').length).toEqual(4);
            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();
        }, 120_000);

    // The staleness guards must never mistake a hulk for a live ship.
    // 70 of the 288 stock ships have a nonzero armor recharge, and
    // ArmorRecharge (step system #56) runs after the weapons that zero
    // them, so their armor is a hair above zero for the whole death
    // sequence. An "above zero means alive" guard made every one of them
    // immortal.
    for (const [id, name] of [
        ['nova:158', 'Arachnid (armorRecharge 0.6)'],
        ['nova:159', 'Dragon (armorRecharge 0.3)'],
    ] as const) {
        it(`still kills an armor-recharging ship: ${name}`, async () => {
            const { world, ship } = await playerWorld(id);
            const log = watchEvents(world);
            expect(armorOf(ship).recharge).toBeGreaterThan(0);

            world.emit(DamagedEvent,
                { damage: LETHAL, damager: 'nobody' }, [SHIP]);
            world.step();
            // One tick of recharge has already lifted armor off zero...
            expect(armorOf(ship).current).toBeGreaterThan(0);
            // ...and the ship is dying anyway.
            expect(ship.components.has(ExplodingComponent)).toBeTrue();

            stepUntil(world, () => log.includes('death'));
            expect(armorOf(ship).current).toEqual(armorOf(ship).max);
            expect(ship.components.has(ExplodingComponent)).toBeFalse();
        }, 120_000);
    }

    it('starts the respawned life with its kill credit unspent',
        async () => {
            const { world, ship } = await playerWorld();
            const log = watchEvents(world);
            let firing = true;
            addBeam(world, () => firing);

            stepUntil(world, () => log.includes('death'));
            firing = false;
            world.step();

            // DeathEvent clears the attribution so the next life starts
            // fresh. A stale ZeroArmorEvent used to land afterwards and
            // re-stamp killCredited on the new life, silently denying
            // combat rating and the legal penalty to whoever destroyed
            // it next.
            expect(ship.components.get(DamageAttributionComponent)
                ?.killCredited).toBeFalsy();
        }, 120_000);
});
