import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import {
    getDefaultBayWeaponData, getDefaultProjectileWeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { makeShip, WeaponsStateComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent } from './npc_component.js';

/**
 * Bible AIType 2, "fights back when attacked, but runs away when his
 * attacker is out of range", against the reference
 * (docs/reference_experiments.md, "A wave 7: does an AI 2 trader run when
 * its attacker is out of range?"): the trader fought the player for 20 s;
 * once the player flew off past its guns' reach it ran directly away and
 * left the system about 20 s later.
 */

const GOVT = 'test:neutral';
const TRADER_HULL = 'test:trader';
const UNARMED_HULL = 'test:unarmed';
const CARRIER_HULL = 'test:carrier';
const ATTACKER_HULL = 'test:attacker';
const GUN = 'test:gun';
const BAY = 'test:bay';
const GUN_OUTFIT = 'test:gun-outfit';
const BAY_OUTFIT = 'test:bay-outfit';
/** The gun's reach: 500 px/s for 1 s, plus its 1 px proximity fuse. */
const GUN_SPEED = 500;
const GUN_REACH = GUN_SPEED + 1;

async function braveTraderWorld(hull = TRADER_HULL, attackerX = 300) {
    const gameData = new MockGameData();
    const gun = getDefaultProjectileWeaponData();
    gameData.data.Weapon.map.set(GUN, {
        ...gun, id: GUN, shotDuration: 1000, proxRadius: 1,
        physics: { ...gun.physics, speed: GUN_SPEED },
    });
    gameData.data.Weapon.map.set(BAY, { ...getDefaultBayWeaponData(), id: BAY });
    gameData.data.Outfit.map.set(GUN_OUTFIT, {
        ...getDefaultOutfitData(), id: GUN_OUTFIT, weapons: { [GUN]: 2 },
    });
    gameData.data.Outfit.map.set(BAY_OUTFIT, {
        ...getDefaultOutfitData(), id: BAY_OUTFIT, weapons: { [BAY]: 1 },
    });
    const base = getDefaultShipData();
    const hullOf = (id: string, over: Partial<ShipData>): ShipData => ({
        ...base, id, ...over,
    });
    gameData.data.Ship.map.set(TRADER_HULL, hullOf(TRADER_HULL, {
        strength: 100, outfits: { [GUN_OUTFIT]: 1 },
    }));
    gameData.data.Ship.map.set(UNARMED_HULL, hullOf(UNARMED_HULL, {
        strength: 100, outfits: {},
    }));
    gameData.data.Ship.map.set(CARRIER_HULL, hullOf(CARRIER_HULL, {
        strength: 100, outfits: { [BAY_OUTFIT]: 1 },
    }));
    // A weak, unkillable target with no brain: it sits where the spec
    // puts it, so "the player flies off" is a move.
    gameData.data.Ship.map.set(ATTACKER_HULL, hullOf(ATTACKER_HULL, {
        strength: 1, outfits: {},
        physics: {
            ...base.physics, shield: 1e7, armor: 1e7,
        },
    }));
    gameData.data.Govt.map.set(GOVT, {
        ...getDefaultGovtData(), id: GOVT, maxOdds: 1000,
    });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, hullId: string, x: number,
        configure: (ship: ReturnType<typeof makeShip>) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(hullId)!);
        ship.components.set(MovementStateComponent, {
            position: new Position(x, 0),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        configure(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
    }
    await addShip('attacker', ATTACKER_HULL, attackerX);
    // Provoked by the attacker (the reference's one tickle).
    await addShip('trader', hull, 0, ship => {
        ship.components.set(GovtComponent, { id: GOVT });
        ship.components.set(NpcComponent, {
            aiType: 2, aggressor: 'attacker',
        });
    });
    world.step();
    return world;
}

function npcOf(world: World) {
    return world.entities.get('trader')?.components.get(NpcComponent);
}

function positionOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components
        .get(MovementStateComponent)!.position;
}

function distance(world: World) {
    return positionOf(world, 'trader')
        .subtract(positionOf(world, 'attacker')).length;
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

/** The attacker "flies off" (or comes back): put it at (`x`, 0), at
 * rest. */
function moveAttacker(world: World, x: number) {
    const attacker = world.entities.get('attacker')!;
    const movement = attacker.components.get(MovementStateComponent)!;
    attacker.components.set(MovementStateComponent, {
        ...movement, position: new Position(x, 0),
        velocity: new Vector(0, 0),
    });
}

function run(world: World, ms: number, observe: () => void = () => { }) {
    const until = now(world) + ms;
    while (now(world) < until && world.entities.has('trader')) {
        world.step();
        observe();
    }
}

describe('AI 2 brave trader: runs when its attacker is out of range', () => {
    it('carries its guns\' reach in synced weapon state', async () => {
        const world = await braveTraderWorld();
        const weapons = world.entities.get('trader')!.components
            .get(WeaponsStateComponent)!;
        expect(weapons.get(GUN)!.reach).toBeCloseTo(GUN_REACH, 6);
    });

    it('fights an attacker in reach, then runs straight away once it is '
        + 'beyond the longest reach, and leaves by a jump', async () => {
            const world = await braveTraderWorld();
            run(world, 5000);
            expect(npcOf(world)!.mode).toBe('attack');
            expect(npcOf(world)!.reachedAggressor).toBe('attacker');

            // The player breaks off: far past the gun's reach, on the -x
            // side, so running away means +x.
            const traderX = positionOf(world, 'trader').x;
            moveAttacker(world, traderX - 1800);
            const breakAt = now(world);
            let fleeAt: number | undefined;
            let jumping = false;
            let lastDistance = distance(world);
            let receding = true;
            run(world, 60_000, () => {
                if (fleeAt === undefined && npcOf(world)?.mode === 'flee') {
                    fleeAt = now(world) - breakAt;
                }
                const trader = world.entities.get('trader');
                if (!trader) {
                    return;
                }
                jumping ||= trader.components.has(JumpComponent);
                const d = distance(world);
                if (fleeAt !== undefined && !jumping
                    && now(world) - breakAt > fleeAt + 3000
                    && d < lastDistance - 1) {
                    receding = false;
                }
                lastDistance = d;
            });
            // Decided on its next think (about a second).
            expect(fleeAt).toBeDefined();
            expect(fleeAt!).toBeLessThanOrEqual(1100);
            // Once turned around, it only ever gets farther away.
            expect(receding).toBeTrue();
            expect(jumping).toBeTrue();
            expect(world.entities.has('trader')).toBeFalse();        });

    it('closes in to fight an attacker that provoked it from beyond its '
        + 'reach (waves 2 and 4)', async () => {
            const world = await braveTraderWorld(TRADER_HULL, 1500);
            let fled = false;
            let closest = Infinity;
            run(world, 15_000, () => {
                fled ||= npcOf(world)?.mode === 'flee';
                closest = Math.min(closest, distance(world));
            });
            expect(fled).toBeFalse();
            expect(npcOf(world)!.mode).toBe('attack');
            expect(closest).toBeLessThan(GUN_REACH);
        });

    it('turns back to fight an attacker that comes back into reach',
        async () => {
            const world = await braveTraderWorld();
            run(world, 5000);
            moveAttacker(world, positionOf(world, 'trader').x - 1800);
            run(world, 1500);
            expect(npcOf(world)!.mode).toBe('flee');
            const trader = positionOf(world, 'trader');
            moveAttacker(world, trader.x + 200);
            run(world, 1500);
            expect(npcOf(world)!.mode).toBe('attack');
        });

    it('an unarmed or bay-only trader has no reach, so never runs for it',
        async () => {
            for (const hull of [UNARMED_HULL, CARRIER_HULL]) {
                const world = await braveTraderWorld(hull);
                run(world, 3000);
                moveAttacker(world, positionOf(world, 'trader').x - 1800);
                let fled = false;
                run(world, 5000, () => {
                    fled ||= npcOf(world)?.mode === 'flee';
                });
                expect(fled).withContext(hull).toBeFalse();
                expect(npcOf(world)!.mode).withContext(hull).toBe('attack');
            }
        });

    it('forgets the reach record with the aggressor', async () => {
        const world = await braveTraderWorld();
        run(world, 3000);
        expect(npcOf(world)!.reachedAggressor).toBe('attacker');
        world.entities.delete('attacker');
        run(world, 1500);
        expect(npcOf(world)!.reachedAggressor).toBeUndefined();
        expect(npcOf(world)!.mode).not.toBe('flee');
    });

    it('replays identically after a rollback', async () => {
        const world = await braveTraderWorld();
        run(world, 4000);
        moveAttacker(world, positionOf(world, 'trader').x - 1800);
        // Snapshot between events: a hit queued for the next step is not
        // captured (and the rollback layer never snapshots there either).
        while (world.queuedEventCount > 0) {
            world.step();
        }
        const atBreak = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            const modes: Array<string | undefined> = [];
            run(world, 10_000, () => {
                hashes.push(hashWorld(world).hash);
                modes.push(npcOf(world)?.mode);
            });
            return { hashes, modes };
        };
        const first = record();
        expect(first.modes).toContain('flee');
        restoreWorld(world, atBreak, deriveEntityComponents);
        const second = record();
        expect(second.modes).toEqual(first.modes);
        expect(second.hashes).toEqual(first.hashes);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
