import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import {
    getDefaultBeamWeaponData, getDefaultProjectileWeaponData, BeamWeaponData,
    ProjectileWeaponData, SubmunitionType, WeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { restoreWorld, snapshotWorld } from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import {
    completeEntity, loadWeaponsGameData,
} from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { makeShip, WeaponsStateComponent } from '../ship/index.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { makeSystem } from '../make_system.js';
import {
    applyRoomRules, deriveEntityComponents, LimitsRule, ProjectileComponent,
    roomRulesOf,
} from '../core/index.js';
import { BeamDataComponent } from './beam_plugin.js';
import {
    ENGINE_LIMITS, MAX_SHOTS, ShotFamilyBudget, spawnAllowed,
    splitFamilyBudget,
} from '../core/index.js';

/**
 * The engine's population limits (engine_limits.ts), under each `limits`
 * room rule (core/room_rules.ts):
 *  - 'original': the original's tables (reference "The shot cap, wave
 *    58"): at most 128 projectiles alive in a system, on screen or not,
 *    and a full table refuses the NEW shot, whatever fired it; 64 beams.
 *  - 'novajs': a soft cap for submunitions, a hard cap for directly fired
 *    shots, and a spawn budget per directly fired shot's family.
 */

const SHIP_ID = 'test:ship';
const SHIP_UUID = 'ship';
const PARENT = 'test:parent';
const CHILD = 'test:child';
const GUN = 'test:gun';
const REPLICATOR = 'test:replicator';
const VOLLEY = 'test:volley';
const SPLITTER = 'test:splitter';
const LEAF = 'test:leaf';
const BEAM = 'test:beam';
const BEAM_BURST = 'test:beam burst';

const SHOT_LIFE_MS = 100;
const LONG_LIFE_MS = 2000;

const ORIGINAL = ENGINE_LIMITS.original;
const NOVAJS = ENGINE_LIMITS.novajs;

function weapon(id: string, subs: SubmunitionType[] = [],
    life = SHOT_LIFE_MS): ProjectileWeaponData {
    return {
        ...getDefaultProjectileWeaponData(),
        id,
        reload: 1000,
        shotDuration: life,
        guidance: 'unguided',
        exitType: 'center',
        submunitions: subs,
    };
}

function beam(id: string, life = LONG_LIFE_MS): BeamWeaponData {
    return {
        ...getDefaultBeamWeaponData(),
        id,
        reload: 1000,
        shotDuration: life,
        onScreenDuration: life,
        exitType: 'center',
    };
}

function sub(id: string, count: number, limit = -1): SubmunitionType {
    // A negative theta is a starburst (evenly spaced): no PRNG draws.
    return { id, count, theta: -0.03, limit, fireAtNearest: false, subIfExpire: true };
}

async function makeTestWorld(weapons: WeaponData[], rule: LimitsRule) {
    const gameData = new MockGameData();
    for (const data of weapons) {
        gameData.data.Weapon.map.set(data.id, data);
    }
    gameData.data.Outfit.map.set('test:launcher', {
        ...getDefaultOutfitData(),
        id: 'test:launcher',
        weapons: Object.fromEntries(weapons.map(w => [w.id, 1])),
    });
    const shipData: ShipData = {
        ...getDefaultShipData(),
        id: SHIP_ID,
        outfits: { 'test:launcher': 1 },
        physics: { ...getDefaultShipPhysics() },
    };
    gameData.data.Ship.map.set(SHIP_ID, shipData);

    const world = await makeSystem('test:system', gameData);
    applyRoomRules(world, { limits: rule });
    const ship = makeShip(shipData);
    await completeEntity(world, ship);
    ship.components.set(MovementStateComponent, {
        position: new Position(0, 0),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    });
    world.entities.set(SHIP_UUID, ship);
    await stepWorld(world, 2);
    await loadWeaponsGameData(world, weapons.map(data => data.id));
    const entries = world.resources.get(WeaponEntries)!;
    const fire = (id: string) =>
        entries.getCached(id)!.fireFromEntity(SHIP_UUID, false);
    return { world, entries, fire };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

/** Projectiles alive in `world` now. */
function liveShots(world: World) {
    let n = 0;
    for (const entity of world.entities.values()) {
        if (entity.components.has(ProjectileComponent)) {
            n++;
        }
    }
    return n;
}

/** Beams alive in `world` now. */
function liveBeams(world: World) {
    let n = 0;
    for (const entity of world.entities.values()) {
        if (entity.components.has(BeamDataComponent)) {
            n++;
        }
    }
    return n;
}

/** Steps `world` `steps` times, collecting every projectile uuid seen
 * per weapon id and the peak alive. */
async function census(world: World, steps: number) {
    const seen = new Map<string, Set<string>>();
    let peak = 0;
    for (let i = 0; i < steps; i++) {
        await stepWorld(world, 1);
        peak = Math.max(peak, liveShots(world));
        for (const [uuid, entity] of world.entities) {
            const id = entity.components.get(ProjectileComponent)?.id;
            if (id !== undefined) {
                let set = seen.get(id);
                if (!set) {
                    seen.set(id, set = new Set());
                }
                set.add(uuid);
            }
        }
    }
    const count = (id: string) => seen.get(id)?.size ?? 0;
    return { peak, count };
}

describe('engine limits', () => {
    describe('the tables', () => {
        it('give the original the Bible\'s 128 shots and 64 beams, one '
            + 'cap for every spawn and no family budget', () => {
                expect(MAX_SHOTS).toEqual(128);
                expect(ORIGINAL.shots).toEqual(jasmine.objectContaining(
                    { soft: 128, hard: 128 }));
                expect(ORIGINAL.beams).toEqual(jasmine.objectContaining(
                    { soft: 64, hard: 64 }));
                expect(ORIGINAL.familyBudget).toEqual(Infinity);
                // Wave 60: a refused beam costs its reload; the shot cap
                // could not tell (GUESS: it does not).
                expect(ORIGINAL.beams.refusalReloads).toBeTrue();
                expect(ORIGINAL.shots.refusalReloads).toBeFalse();
                // Wave 60: 55 ships besides the player hold bay launches
                // and NPCs; the defenders got past them (GUESS: to 64).
                expect(ORIGINAL.ships).toEqual({ others: 55, total: 64 });
            });

        it('give NovaJS more room, direct fire above the submunitions, '
            + 'and a budget that fits one DVrger missile (109 a shot)',
            () => {
                for (const caps of [NOVAJS.shots, NOVAJS.beams]) {
                    expect(caps.hard).toBeGreaterThan(caps.soft);
                }
                expect(NOVAJS.shots.soft).toBeGreaterThan(MAX_SHOTS);
                expect(NOVAJS.beams.soft).toBeGreaterThan(ORIGINAL.beams.hard);
                expect(NOVAJS.familyBudget).toBeGreaterThanOrEqual(108);
                expect(Number.isFinite(NOVAJS.familyBudget)).toBeTrue();
            });

        it('default to NovaJS in a world no room rule reached', async () => {
            const world = await makeSystem('test:system', new MockGameData());
            expect(roomRulesOf(world.entities).limits).toEqual('novajs');
        });
    });

    describe('pure parts', () => {
        it('let a submunition in under the soft cap and a direct shot '
            + 'under the hard one', () => {
                const caps = { soft: 4, hard: 6, refusalReloads: false };
                expect(spawnAllowed(3, caps, true)).toBeTrue();
                expect(spawnAllowed(4, caps, true)).toBeFalse();
                expect(spawnAllowed(4, caps, false)).toBeTrue();
                expect(spawnAllowed(5, caps, false)).toBeTrue();
                expect(spawnAllowed(6, caps, false)).toBeFalse();
            });

        it('split a family budget evenly, the remainder first', () => {
            expect(splitFamilyBudget(251, 5)).toEqual([51, 50, 50, 50, 50]);
            expect(splitFamilyBudget(3, 5)).toEqual([1, 1, 1, 0, 0]);
            expect(splitFamilyBudget(0, 2)).toEqual([0, 0]);
            expect(splitFamilyBudget(9, 0)).toEqual([]);
            for (const [remaining, n] of [[7, 3], [256, 36], [1, 1]]) {
                const shares = splitFamilyBudget(remaining, n);
                expect(shares.reduce((a, b) => a + b, 0)).toEqual(remaining);
            }
        });
    });

    describe('under the original rule (Max Shots On Screen 128)', () => {
        it('caps a burst that would overflow it', async () => {
            // 200 long-lived children from one parent: the parent still
            // holds its slot while they spawn, so 127 of them fit.
            const { world, fire } = await makeTestWorld([
                weapon(PARENT, [sub(CHILD, 200)]),
                weapon(CHILD, [], LONG_LIFE_MS),
            ], 'original');
            fire(PARENT);
            const { peak, count } = await census(world, 30);
            // The parent is gone by the end of the tick that spawned them.
            expect(peak).toEqual(MAX_SHOTS - 1);
            expect(count(CHILD)).toEqual(MAX_SHOTS - 1);
        });

        it('refuses a new shot while full, and takes it once a slot frees',
            async () => {
                const { world, fire } = await makeTestWorld([
                    weapon(PARENT, [sub(CHILD, 200)]),
                    weapon(CHILD, [], LONG_LIFE_MS),
                    weapon(GUN, [], LONG_LIFE_MS),
                ], 'original');
                fire(PARENT);
                await stepWorld(world, 20);
                expect(liveShots(world)).toEqual(MAX_SHOTS - 1);
                // One slot left: the first gun shot fits, the second does
                // not. A ship's shot has no priority over submunitions.
                expect(fire(GUN)).toBeDefined();
                expect(fire(GUN)).toBeUndefined();
                expect(liveShots(world)).toEqual(MAX_SHOTS);
                // Everything expires (2 s): the table empties and shots fly.
                await stepWorld(world, 150);
                expect(liveShots(world)).toEqual(0);
                expect(fire(GUN)).toBeDefined();
            });

        it('lets a self-replicating weapon fill the whole table (no family '
            + 'budget)', async () => {
                const { world, fire } = await makeTestWorld([
                    weapon(REPLICATOR, [sub(REPLICATOR, 5, 9999)]),
                ], 'original');
                fire(REPLICATOR);
                const { peak } = await census(world, 60);
                // Full (every expiring parent takes the last slot and
                // frees its own after: 127 between steps).
                expect(peak).toEqual(MAX_SHOTS - 1);
            });

        it('caps beams at 64, refusing the new beam', async () => {
            const { world, fire } = await makeTestWorld([beam(BEAM)],
                'original');
            for (let i = 0; i < ORIGINAL.beams.hard; i++) {
                expect(fire(BEAM)).withContext(`beam ${i}`).toBeDefined();
            }
            expect(fire(BEAM)).toBeUndefined();
            expect(liveBeams(world)).toEqual(ORIGINAL.beams.hard);
            // The beams end after 2 s; the next one fires.
            await stepWorld(world, 150);
            expect(liveBeams(world)).toEqual(0);
            expect(fire(BEAM)).toBeDefined();
        });
    });

    describe('under the NovaJS rule', () => {
        it('refuses submunitions at the soft cap but lets ships keep '
            + 'firing up to the hard cap', async () => {
                const perParent = Math.min(200, NOVAJS.familyBudget);
                const parents = Math.ceil(NOVAJS.shots.soft / perParent) + 1;
                const { world, fire } = await makeTestWorld([
                    weapon(PARENT, [sub(CHILD, perParent)]),
                    weapon(CHILD, [], LONG_LIFE_MS),
                    weapon(GUN, [], LONG_LIFE_MS),
                ], 'novajs');
                for (let i = 0; i < parents; i++) {
                    expect(fire(PARENT)).toBeDefined();
                }
                const { peak, count } = await census(world, 20);
                // As under the original's one cap, the expiring parent
                // holds its slot while its children spawn.
                expect(peak).toEqual(NOVAJS.shots.soft - 1);
                expect(count(CHILD)).toEqual(NOVAJS.shots.soft - 1);
                // The soft-capped table still takes a ship's shots, up to
                // the hard cap.
                const room = NOVAJS.shots.hard - liveShots(world);
                for (let i = 0; i < room; i++) {
                    expect(fire(GUN)).withContext(`shot ${i}`).toBeDefined();
                }
                expect(fire(GUN)).toBeUndefined();
                expect(liveShots(world)).toEqual(NOVAJS.shots.hard);
            });

        it('stops a self-replicating weapon (5 copies of itself, SubLimit '
            + '9999) at its family budget', async () => {
                const { world, fire } = await makeTestWorld([
                    weapon(REPLICATOR, [sub(REPLICATOR, 5, 9999)]),
                ], 'novajs');
                const root = fire(REPLICATOR)!;
                expect(root.components.has(ShotFamilyBudget)).toBeFalse();
                const { count } = await census(world, 120);
                // The root and exactly its budget of descendants: every
                // unit of the budget is spent, none twice.
                expect(count(REPLICATOR)).toEqual(1 + NOVAJS.familyBudget);
                expect(liveShots(world)).toEqual(0);
                // A second shot is a new family with a whole new budget.
                fire(REPLICATOR);
                const again = await census(world, 120);
                expect(again.count(REPLICATOR))
                    .toEqual(1 + NOVAJS.familyBudget);
            });

        it('lets a whole DVrger-shaped family appear (1 + 36 + 72)',
            async () => {
                const { world, fire } = await makeTestWorld([
                    weapon(VOLLEY, [sub(SPLITTER, 36)]),
                    weapon(SPLITTER, [sub(LEAF, 2)]),
                    weapon(LEAF, [], LONG_LIFE_MS),
                ], 'novajs');
                fire(VOLLEY);
                const { count } = await census(world, 30);
                expect(count(SPLITTER)).toEqual(36);
                expect(count(LEAF)).toEqual(72);
            });

        it('refuses beam submunitions at the beam soft cap and a ship\'s '
            + 'beams at the hard cap', async () => {
                const { world, fire } = await makeTestWorld([
                    weapon(BEAM_BURST, [sub(BEAM, NOVAJS.beams.soft + 40)]),
                    beam(BEAM),
                ], 'novajs');
                fire(BEAM_BURST);
                await stepWorld(world, 10);
                // The budget is the tighter of the two when it is smaller.
                const subs = Math.min(NOVAJS.beams.soft, NOVAJS.familyBudget);
                expect(liveBeams(world)).toEqual(subs);
                const room = NOVAJS.beams.hard - liveBeams(world);
                for (let i = 0; i < room; i++) {
                    expect(fire(BEAM)).withContext(`beam ${i}`).toBeDefined();
                }
                expect(fire(BEAM)).toBeUndefined();
                expect(liveBeams(world)).toEqual(NOVAJS.beams.hard);
            });
    });

    describe('a refused directly fired shot', () => {
        const HELD = 'test:held beam';
        const RELOAD_MS = 1000;

        /** Fills the beam table with 2 s beams, holds HELD's trigger, and
         * returns how many ms after the table frees HELD's beam appears. */
        async function delayAfterFree(refusalReloads: boolean) {
            const caps = ENGINE_LIMITS.original.beams as {
                refusalReloads: boolean };
            const saved = caps.refusalReloads;
            caps.refusalReloads = refusalReloads;
            try {
                const { world, fire } = await makeTestWorld([beam(BEAM),
                    { ...beam(HELD, 100), reload: RELOAD_MS }], 'original');
                for (let i = 0; i < ORIGINAL.beams.hard; i++) {
                    fire(BEAM);
                }
                const ship = world.entities.get(SHIP_UUID)!;
                ship.components.get(WeaponsStateComponent)!.get(HELD)!
                    .firing = true;
                const held = () => [...world.entities.values()].filter(
                    entity => entity.components.get(BeamDataComponent)?.id
                        === HELD).length;
                let freedAt: number | undefined;
                for (let i = 0; i < 300; i++) {
                    await stepWorld(world, 1);
                    const now = world.resources.get(TimeResource)!.time;
                    const others = liveBeams(world) - held();
                    if (freedAt === undefined && others < ORIGINAL.beams.hard) {
                        freedAt = now;
                    }
                    if (held() > 0) {
                        expect(freedAt).toBeDefined();
                        return now - freedAt!;
                    }
                }
                return Infinity;
            } finally {
                caps.refusalReloads = saved;
            }
        }

        it('fires on the first tick a slot frees when a refusal costs '
            + 'nothing', async () => {
                expect(await delayAfterFree(false)).toBeLessThan(50);
            });

        it('waits out a whole reload after its last refusal when a refusal '
            + 'costs the reload', async () => {
                const delay = await delayAfterFree(true);
                expect(delay).toBeGreaterThan(RELOAD_MS - 100);
                expect(delay).toBeLessThan(RELOAD_MS + 100);
            });
    });

    describe('determinism', () => {
        for (const rule of ['original', 'novajs'] as const) {
            it(`resimulates a flood across refusals identically after a `
                + `rollback (${rule})`, async () => {
                    const { world, fire } = await makeTestWorld([
                        weapon(REPLICATOR, [sub(REPLICATOR, 5, 9999)]),
                        weapon(PARENT, [sub(CHILD, 200)]),
                        weapon(CHILD, [], LONG_LIFE_MS),
                    ], rule);
                    fire(PARENT);
                    fire(REPLICATOR);
                    await stepWorld(world, 4);
                    // Mid-flood, with refusals still to come.
                    const checkpoint = snapshotWorld(world);
                    const run = async () => {
                        const hashes: string[] = [];
                        for (let i = 0; i < 40; i++) {
                            if (i % 10 === 0) {
                                fire(REPLICATOR);
                            }
                            await stepWorld(world, 1);
                            hashes.push(hashWorld(world).hash);
                        }
                        return { hashes, live: liveShots(world) };
                    };
                    const first = await run();
                    restoreWorld(world, checkpoint, deriveEntityComponents);
                    expect(roomRulesOf(world.entities).limits).toEqual(rule);
                    const second = await run();
                    expect(second.hashes).toEqual(first.hashes);
                    expect(second.live).toEqual(first.live);
                    expect(first.live).toBeGreaterThan(0);
                });
        }
    });
});
