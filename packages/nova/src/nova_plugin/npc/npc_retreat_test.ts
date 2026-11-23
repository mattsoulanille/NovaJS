import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    DamagedEvent, makeShip, ShieldComponent, ShipDataComponent,
    SourceComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import {
    addDamageLoad, damageLoadNow, HEAVY_FIRE_LOAD, HEAVY_FIRE_LOAD_CAP,
    HEAVY_FIRE_RATE_PER_S, HEAVY_FIRE_RESUME_S, RETREAT_JUMP_MS,
    RETREAT_STANDOFF_MAX, RETREAT_STANDOFF_MIN, underHeavyFire,
    warshipRetreat,
} from './npc_retreat.js';

/**
 * gövt Flags 0x0010 against the reference (docs/reference_experiments.md,
 * "A-series wave 4: AI 1 departure, gövt 0x0010 retreat").
 */

describe('the 0x0010 damage load (leaky bucket)', () => {
    it('drains at HEAVY_FIRE_RATE_PER_S and never goes negative', () => {
        const npc: NpcState = { aiType: 3 };
        addDamageLoad(npc, 0.2, 1000);
        expect(damageLoadNow(npc, 1000)).toBeCloseTo(0.2);
        expect(damageLoadNow(npc, 2000))
            .toBeCloseTo(0.2 - HEAVY_FIRE_RATE_PER_S);
        expect(damageLoadNow(npc, 1000 + 60_000)).toBe(0);
    });

    it('one weak gun (3% shots, about 4.5%/s) never counts as heavy fire',
        () => {
            const npc: NpcState = { aiType: 3 };
            let heavy = false;
            // 1.5 shots/s of 3% for a minute.
            for (let t = 0; t < 60_000; t += 667) {
                addDamageLoad(npc, 0.03, t);
                heavy ||= underHeavyFire(npc, t);
            }
            expect(heavy).toBeFalse();
        });

    it('four guns (about 12%/s) trip it within a few seconds', () => {
        const npc: NpcState = { aiType: 3 };
        let trippedAt: number | undefined;
        for (let t = 0; t < 10_000 && trippedAt === undefined; t += 250) {
            addDamageLoad(npc, 0.03, t);
            if (underHeavyFire(npc, t)) {
                trippedAt = t;
            }
        }
        expect(trippedAt).toBeDefined();
        expect(trippedAt!).toBeLessThanOrEqual(4000);
    });

    it('is capped, so it clears within HEAVY_FIRE_RESUME_S of the fire '
        + 'stopping, however long the barrage', () => {
            const npc: NpcState = { aiType: 3 };
            for (let t = 0; t <= 80_000; t += 250) {
                addDamageLoad(npc, 0.03, t);
            }
            expect(damageLoadNow(npc, 80_000)).toBe(HEAVY_FIRE_LOAD_CAP);
            expect(underHeavyFire(npc,
                80_000 + HEAVY_FIRE_RESUME_S * 1000 - 100)).toBeTrue();
            expect(underHeavyFire(npc,
                80_000 + HEAVY_FIRE_RESUME_S * 1000 + 1)).toBeFalse();
        });
});

describe('warshipRetreat (the 0x0010 decision)', () => {
    const weak = { current: 20, max: 100 };
    const healthy = { current: 30, max: 100 };
    function heavy(now: number): NpcState {
        const npc: NpcState = { aiType: 3, mode: 'attack' };
        addDamageLoad(npc, HEAVY_FIRE_LOAD * 2, now);
        return npc;
    }

    it('fights on below 25% when not losing (favorable odds, light fire)',
        () => {
            const npc: NpcState = { aiType: 3 };
            expect(warshipRetreat(npc, weak, 0, true, true)).toBeUndefined();
            expect(npc.retreatSince).toBeUndefined();
        });

    it('does nothing at or above 25% shield, even under heavy fire', () => {
        const npc = heavy(0);
        expect(warshipRetreat(npc, healthy, 0, true, false)).toBeUndefined();
    });

    it('stands off when under heavy fire, or when its odds are bad', () => {
        expect(warshipRetreat(heavy(0), weak, 0, true, true))
            .toBe('standoff');
        expect(warshipRetreat({ aiType: 3 }, weak, 0, true, false))
            .toBe('standoff');
    });

    it('jumps once it has been losing for RETREAT_JUMP_MS, and stays '
        + 'committed', () => {
            const npc = heavy(0);
            expect(warshipRetreat(npc, weak, 0, true, false)).toBe('standoff');
            expect(warshipRetreat(npc, weak, RETREAT_JUMP_MS - 1, true, false))
                .toBe('standoff');
            expect(warshipRetreat(npc, weak, RETREAT_JUMP_MS, true, false))
                .toBe('jump');
            npc.mode = 'flee';
            // Even with the odds turned favorable and the fire gone.
            expect(warshipRetreat(npc, weak, RETREAT_JUMP_MS + 60_000, true,
                true)).toBe('jump');
        });

    it('forgets the retreat (and the drained load) when it stops losing',
        () => {
            const npc = heavy(0);
            warshipRetreat(npc, weak, 0, true, true);
            expect(npc.retreatSince).toBe(0);
            expect(warshipRetreat(npc, weak, 60_000, true, true))
                .toBeUndefined();
            expect(npc.retreatSince).toBeUndefined();
            expect(npc.damageLoad).toBeUndefined();
            expect(npc.damageLoadAt).toBeUndefined();
        });

    it('runs at once from heavy fire it cannot fight back against', () => {
        expect(warshipRetreat(heavy(0), weak, 0, false, false)).toBe('jump');
    });

    it('a ship held in the system never commits to a jump: it keeps '
        + 'standing off, and fights on once it stops losing', () => {
            const npc = heavy(0);
            expect(warshipRetreat(npc, weak, RETREAT_JUMP_MS * 3, true, false,
                false)).toBe('standoff');
            npc.mode = 'flee';
            expect(warshipRetreat(npc, weak, RETREAT_JUMP_MS * 3, true, true,
                false)).toBeUndefined();
            expect(warshipRetreat(heavy(0), weak, 0, false, false, false))
                .toBeUndefined();
        });
});

const RETREATER = 'test:retreater';
const PLAIN = 'test:plain';
const HULL = 'test:tank';
/** The AI Tank Disc's shape: 1000 shield, armor that never runs out, no
 * recharge (so the shield level is what the spec sets). */
const TANK_SHIELD = 1000;
/** One Kit Escort Gun hit, 3% of the tank's shield. */
const SHOT_DAMAGE = 30;

const NO_DAMAGE: WeaponDamage = {
    shield: 0, armor: 0, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/**
 * The reference tank fight: a 0x0010 (or plain) AI 3 warship at 20%
 * shield, 600 px from a stationary attacker that hits it on a fixed
 * schedule through the real DamagedEvent path.
 */
async function tankFight(govtId: string) {
    const gameData = new MockGameData();
    const hull = getDefaultShipData();
    gameData.data.Ship.map.set(HULL, {
        ...hull, id: HULL, strength: 1000,
        physics: {
            ...hull.physics, shield: TANK_SHIELD, shieldRecharge: 0,
            armor: 30000, armorRecharge: 0,
        },
    });
    const flagged = getDefaultGovtData();
    gameData.data.Govt.map.set(RETREATER, {
        ...flagged, id: RETREATER, maxOdds: 1000,
        flags: { ...flagged.flags, warshipsRetreatAt25: true },
    });
    gameData.data.Govt.map.set(PLAIN, {
        ...getDefaultGovtData(), id: PLAIN, maxOdds: 1000,
    });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, x: number,
        configure: (entity: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(HULL)!);
        const movement = ship.components.get(MovementStateComponent)!;
        ship.components.set(MovementStateComponent, {
            ...movement, position: new Position(x, 0),
        });
        configure(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    // The attacker: a plain hull with no brain, so it sits still and its
    // "fire" is the schedule below. Weak, so the odds stay favorable.
    const attacker = await addShip('attacker', 0);
    attacker.components.set(ShipDataComponent, {
        ...attacker.components.get(ShipDataComponent)!, strength: 1,
    });
    await addShip('tank', 600, ship => {
        ship.components.set(GovtComponent, { id: govtId });
        ship.components.set(NpcComponent, { aiType: 3 });
    });
    const shot = new Entity('shot').addComponent(SourceComponent, 'attacker');
    world.entities.set('shot', shot);
    world.step();
    const shield = world.entities.get('tank')!.components
        .get(ShieldComponent)!;
    shield.current = 0.2 * shield.max;
    return world;
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

function npcOf(world: World) {
    return world.entities.get('tank')?.components.get(NpcComponent);
}

function distance(world: World) {
    const tank = world.entities.get('tank')!.components
        .get(MovementStateComponent)!;
    const attacker = world.entities.get('attacker')!.components
        .get(MovementStateComponent)!;
    return tank.position.subtract(attacker.position).length;
}

/**
 * Runs `ms` of sim time, landing a SHOT_DAMAGE hit every `intervalMs`
 * (none when undefined) and calling `observe` after each step.
 */
function fight(world: World, ms: number, intervalMs: number | undefined,
    observe: () => void = () => { }) {
    const until = now(world) + ms;
    let nextShot = now(world);
    while (now(world) < until && world.entities.has('tank')) {
        if (intervalMs !== undefined && now(world) >= nextShot) {
            world.emit(DamagedEvent, {
                damage: { ...NO_DAMAGE, shield: SHOT_DAMAGE, armor: SHOT_DAMAGE },
                damager: 'shot',
            }, ['tank']);
            nextShot += intervalMs;
        }
        world.step();
        observe();
    }
}

/** One Kit Escort Gun: about 4.5%/s of the tank's shield. */
const ONE_GUN_MS = 667;
/** Four guns: about 12%/s. */
const FOUR_GUNS_MS = 250;

describe('gövt 0x0010 retreat in a live fight', () => {
    it('one weak attacker: fights on with shields down (5 of 6 runs)',
        async () => {
            const world = await tankFight(RETREATER);
            let closest = Infinity;
            let fled = false;
            fight(world, 30_000, ONE_GUN_MS, () => {
                closest = Math.min(closest, distance(world));
                fled ||= npcOf(world)?.mode === 'flee';
            });
            expect(fled).toBeFalse();
            expect(npcOf(world)!.mode).toBe('attack');
            expect(npcOf(world)!.retreatSince).toBeUndefined();
            // Making close passes, not keeping its distance.
            expect(closest).toBeLessThan(RETREAT_STANDOFF_MIN - 100);
            expect(world.entities.get('tank')!.components.get(JumpComponent))
                .toBeUndefined();
        });

    it('heavy damage: stands off, still attacking, then comes straight back '
        + 'when the firing stops', async () => {
            const world = await tankFight(RETREATER);
            // Under four guns for 12 s (inside RETREAT_JUMP_MS).
            const distances: number[] = [];
            fight(world, 12_000, FOUR_GUNS_MS,
                () => distances.push(distance(world)));
            const npc = npcOf(world)!;
            expect(npc.mode).toBe('attack');
            expect(npc.retreatSince).toBeDefined();
            // Over the last 6 s it held the band (with some slop for
            // settling), never closing in for a pass.
            const late = distances.slice(-360);
            expect(Math.min(...late)).toBeGreaterThan(RETREAT_STANDOFF_MIN - 60);
            expect(Math.max(...late)).toBeLessThan(RETREAT_STANDOFF_MAX + 120);

            // Trigger released: back to attacking within about 4 s...
            let resumedAt: number | undefined;
            const stopped = now(world);
            let closest = Infinity;
            fight(world, 12_000, undefined, () => {
                if (resumedAt === undefined
                    && npcOf(world)!.retreatSince === undefined) {
                    resumedAt = now(world) - stopped;
                }
                closest = Math.min(closest, distance(world));
            });
            expect(resumedAt).toBeDefined();
            expect(resumedAt!).toBeLessThanOrEqual(
                HEAVY_FIRE_RESUME_S * 1000 + 1100);
            // ...and to close passes, shields still down.
            expect(npcOf(world)!.mode).toBe('attack');
            expect(closest).toBeLessThan(RETREAT_STANDOFF_MIN - 100);
        });

    it('heavy damage that persists: jumps out about 16 s in (never lands)',
        async () => {
            const world = await tankFight(RETREATER);
            const start = now(world);
            let fleeAt: number | undefined;
            let jumping = false;
            fight(world, 40_000, FOUR_GUNS_MS, () => {
                const npc = npcOf(world);
                if (fleeAt === undefined && npc?.mode === 'flee') {
                    fleeAt = now(world) - start;
                }
                jumping ||= world.entities.get('tank')?.components
                    .has(JumpComponent) ?? false;
            });
            expect(fleeAt).toBeDefined();
            // Losing from the first think (within a few seconds of the
            // barrage starting), then RETREAT_JUMP_MS.
            expect(fleeAt!).toBeGreaterThanOrEqual(RETREAT_JUMP_MS);
            expect(fleeAt!).toBeLessThan(RETREAT_JUMP_MS + 5000);
            // Gone through the hyperspace sequence.
            expect(jumping).toBeTrue();
            expect(world.entities.has('tank')).toBeFalse();
        });

    it('without the flag: fights on under the same heavy fire', async () => {
        const world = await tankFight(PLAIN);
        let closest = Infinity;
        fight(world, 30_000, FOUR_GUNS_MS, () => {
            closest = Math.min(closest, distance(world));
        });
        const npc = npcOf(world)!;
        expect(npc.mode).toBe('attack');
        expect(npc.retreatSince).toBeUndefined();
        // And it carries no damage-load state at all.
        expect(npc.damageLoad).toBeUndefined();
        expect(closest).toBeLessThan(RETREAT_STANDOFF_MIN - 100);
    });
});
