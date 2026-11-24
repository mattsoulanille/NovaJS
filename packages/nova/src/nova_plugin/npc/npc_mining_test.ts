import 'jasmine';
import { AsteroidData, getDefaultAsteroidData } from 'novadatainterface/asteroid_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import {
    getDefaultShipAIFlags, getDefaultShipData, ShipAIFlags, ShipData,
} from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { getDefaultProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import {
    AsteroidComponent, DebrisComponent, loadAsteroidGameData, makeAsteroid,
} from '../combat/index.js';
import {
    deriveEntityComponents, GovtComponent, SimulationGameDataResource,
} from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { CargoComponent, makeShip, WeaponsStateComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import { chooseMiningJob, isMinerHull, miningReach } from './npc_mining.js';

/**
 * ============================================================================
 * NPC mining against the reference: docs/reference_experiments.md "N1:
 * does the Asteroid Miner mine?", wave 13. A copy of the stock Asteroid
 * Miner (shïp 379: AI 1, Flags3 0x0003, the Asteroid Scoop and the
 * asteroid-miner Mining Blaster, wëap 181: unguided, 300 px/s for 0.4 s)
 * closed on a rock, shot it apart, flew over the debris, and later jumped
 * out like other traffic.
 * ============================================================================
 */

const GOVT = 'test:miners';
const SYSTEM = 'test:system';
const PORT = 'test:port';
const PORT_2 = 'test:port-2';
const MINER_HULL = 'test:miner';
const SHOOTER_HULL = 'test:shooter';
const TRADER_HULL = 'test:trader';
const GUN = 'test:mining-blaster';
const GUN_OUTFIT = 'test:mining-blaster-outfit';
const SCOOP = 'test:scoop';
const ROCK = 'test:rock';
const ROCK_STRENGTH = 100;

const ROCK_DATA: AsteroidData = {
    ...getDefaultAsteroidData(),
    id: ROCK, name: 'Test Rock', strength: ROCK_STRENGTH,
    yieldType: 'cargo:4', yieldQuantity: 4,
    debrisAnimation: getDefaultAsteroidData().animation,
    fragments: [], fragmentCount: 0, mass: 100,
};

function hull(id: string, flags: Partial<ShipAIFlags>,
    outfits: Record<string, number>, over: Partial<ShipData> = {}): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, name: id, outfits,
        physics: { ...base.physics, freeCargo: 100 },
        aiFlags: { ...getDefaultShipAIFlags(), ...flags },
        ...over,
    };
}

async function miningWorld() {
    const gameData = new MockGameData();
    const gun = getDefaultProjectileWeaponData();
    gameData.data.Weapon.map.set(GUN, {
        ...gun, id: GUN, name: 'Mining Blaster', asteroidMiner: true,
        shotDuration: 400, proxRadius: 5, reload: 200,
        damage: { ...gun.damage, armor: 2, shield: 2 },
        physics: { ...gun.physics, speed: 300 },
    });
    gameData.data.Outfit.map.set(GUN_OUTFIT, {
        ...getDefaultOutfitData(), id: GUN_OUTFIT, weapons: { [GUN]: 4 },
    });
    gameData.data.Outfit.map.set(SCOOP, {
        ...getDefaultOutfitData(), id: SCOOP, miningScoop: true,
    });
    const armed = { [GUN_OUTFIT]: 1 };
    gameData.data.Ship.map.set(MINER_HULL, hull(MINER_HULL,
        { destroysAsteroids: true, scoopsAsteroidDebris: true },
        { ...armed, [SCOOP]: 1 }));
    gameData.data.Ship.map.set(SHOOTER_HULL, hull(SHOOTER_HULL,
        { destroysAsteroids: true }, armed));
    gameData.data.Ship.map.set(TRADER_HULL, hull(TRADER_HULL, {},
        { ...armed, [SCOOP]: 1 }));
    gameData.data.Asteroid.map.set(ROCK, ROCK_DATA);
    gameData.data.Govt.map.set(GOVT, { ...getDefaultGovtData(), id: GOVT });
    // Two ports, far from the rocks: where a miner with nothing to mine
    // goes (the trader loop) instead of leaving.
    for (const [id, x] of [[PORT, -1500], [PORT_2, 1500]] as const) {
        gameData.data.Planet.map.set(id, {
            ...getDefaultPlanetData(), id, name: id, position: [x, 2500],
        });
    }
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, planets: [PORT, PORT_2],
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: false });
    const simData = world.resources.get(SimulationGameDataResource)!;
    // The same staging spawnAsteroids does for a field.
    await loadAsteroidGameData(simData, ROCK);

    function addRock(uuid: string, x: number, y: number) {
        world.entities.set(uuid, makeAsteroid(simData, ROCK_DATA,
            world.resources.get(RandomResource)!, new Position(x, y),
            new Vector(0, 0)));
    }

    async function addNpc(uuid: string, hullId: string, x: number, y: number,
        npc: Partial<NpcState> = {}, aiType = 1) {
        const ship = makeShip(gameData.data.Ship.map.get(hullId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, y),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(GovtComponent, { id: GOVT });
        ship.components.set(NpcComponent, {
            aiType, departAt: Number.MAX_SAFE_INTEGER, ...npc,
        });
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, gameData, addRock, addNpc };
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

function count(world: World, component: typeof AsteroidComponent
    | typeof DebrisComponent) {
    let n = 0;
    for (const [, entity] of world.entities) {
        if (entity.components.has(component)) {
            n++;
        }
    }
    return n;
}

/** Steps for `seconds`, collecting the modes `uuid` passes through. */
function runFor(world: World, uuid: string, seconds: number,
    each: () => void = () => { }) {
    const modes = new Set<string | undefined>();
    const end = now(world) + seconds * 1000;
    while (now(world) < end) {
        world.step();
        modes.add(world.entities.get(uuid)?.components.get(NpcComponent)?.mode);
        each();
    }
    return modes;
}

function hold(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(CargoComponent)!
        .get('cargo:4') ?? 0;
}

describe('NPC mining (shïp Flags3 0x0001 / 0x0002)', () => {
    it('is an AI 1/2 hull with Flags3 0x0001; not a warship or interceptor',
        () => {
            const miner = hull(MINER_HULL, { destroysAsteroids: true }, {});
            expect(isMinerHull(1, miner)).toBeTrue();
            expect(isMinerHull(2, miner)).toBeTrue();
            expect(isMinerHull(3, miner)).toBeFalse();
            expect(isMinerHull(4, miner)).toBeFalse();
            expect(isMinerHull(1, hull(TRADER_HULL, {}, {}))).toBeFalse();
        });

    it('closes to the shortest bounded weapon reach (bays have none)', () => {
        expect(miningReach([['gun', { count: 4, reach: 125 }],
            ['turret', { count: 1, reach: 600 }], ['bay', { count: 2 }]]))
            .toBe(125);
        expect(miningReach([['bay', { count: 2 }]])).toBeUndefined();
    });

    it('scoops debris first, keeps its target, then takes the nearest rock',
        () => {
            const rocks = [['b', 100] as const, ['a', 400] as const];
            expect(chooseMiningJob({}, rocks, [['box', 900]], true))
                .toEqual({ mode: 'scoop', target: 'box' });
            expect(chooseMiningJob({}, rocks, [['box', 900]], false))
                .toEqual({ mode: 'mine', target: 'b' });
            expect(chooseMiningJob({ mode: 'mine', mineTarget: 'a' }, rocks,
                [], true)).toEqual({ mode: 'mine', target: 'a' });
            // Out of reach: nothing to do.
            expect(chooseMiningJob({}, [['far', 4000 * 4000]], [], true))
                .toBeUndefined();
        });

    it('closes on a rock, shoots it apart and scoops the debris (N1)',
        async () => {
            const { world, addRock, addNpc } = await miningWorld();
            addRock('rock', 600, 0);
            await addNpc('miner', MINER_HULL, 0, 0);
            const modes = runFor(world, 'miner', 60);
            expect(world.entities.has('rock')).toBeFalse();
            expect(modes.has('mine')).toBeTrue();
            expect(modes.has('scoop')).toBeTrue();
            expect(hold(world, 'miner')).toBeGreaterThan(0);
            expect(count(world, DebrisComponent)).toBe(0);
            // Nothing left to mine: back to the trader loop.
            const npc = world.entities.get('miner')!.components
                .get(NpcComponent)!;
            expect(['travel', 'dwell']).toContain(npc.mode!);
            expect(npc.mineTarget).toBeUndefined();
        });

    it('a Flags3 0x0001 hull without a scoop shoots rocks but never '
        + 'chases the debris', async () => {
            const { world, addRock, addNpc } = await miningWorld();
            addRock('rock', 600, 0);
            await addNpc('shooter', SHOOTER_HULL, 0, 0);
            const modes = runFor(world, 'shooter', 30);
            expect(world.entities.has('rock')).toBeFalse();
            expect(modes.has('mine')).toBeTrue();
            expect(modes.has('scoop')).toBeFalse();
        });

    it('an ordinary trader leaves rocks alone', async () => {
        const { world, addRock, addNpc } = await miningWorld();
        addRock('rock', 300, 0);
        await addNpc('trader', TRADER_HULL, 0, 0);
        const modes = runFor(world, 'trader', 20);
        expect(world.entities.has('rock')).toBeTrue();
        expect(modes.has('mine')).toBeFalse();
    });

    it('an AI 3 hull with Flags3 0x0001 does not mine (not measured)',
        async () => {
            const { world, addRock, addNpc } = await miningWorld();
            addRock('rock', 300, 0);
            await addNpc('warship', SHOOTER_HULL, 0, 0, {}, 3);
            const modes = runFor(world, 'warship', 20);
            expect(world.entities.has('rock')).toBeTrue();
            expect(modes.has('mine')).toBeFalse();
        });

    it('a scooping miner with a full hold stops mining (guess)', async () => {
        const { world, addRock, addNpc } = await miningWorld();
        addRock('rock', 300, 0);
        const miner = await addNpc('miner', MINER_HULL, 0, 0);
        miner.components.set(CargoComponent, new Map([['cargo:1', 100]]));
        const modes = runFor(world, 'miner', 20);
        expect(world.entities.has('rock')).toBeTrue();
        expect(modes.has('mine')).toBeFalse();
    });

    it('jumps out when its time is up, straight from mining', async () => {
        const { world, addRock, addNpc } = await miningWorld();
        addRock('rock', 3000, 0);
        await addNpc('miner', MINER_HULL, 0, 0, { departAt: 3000 });
        let mined = false;
        let departedFromMining = false;
        let firingWhileDeparting = false;
        runFor(world, 'miner', 10, () => {
            const ship = world.entities.get('miner');
            const npc = ship?.components.get(NpcComponent);
            if (npc?.mode === 'mine') {
                mined = true;
            }
            if (npc?.mode === 'depart') {
                departedFromMining ||= mined && npc.mineTarget === undefined;
                for (const [, weapon] of ship!.components
                    .get(WeaponsStateComponent)!) {
                    firingWhileDeparting ||= weapon.firing;
                }
            }
        });
        expect(departedFromMining).toBeTrue();
        expect(firingWhileDeparting).toBeFalse();
    });

    it('replays identically after a rollback', async () => {
        const { world, addRock, addNpc } = await miningWorld();
        addRock('rock', 500, 0);
        addRock('rock2', -500, 200);
        await addNpc('miner', MINER_HULL, 0, 0);
        await addNpc('shooter', SHOOTER_HULL, 100, 100);
        world.step();
        const before = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            for (let i = 0; i < 1800; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
            }
            return { hashes, cargo: hold(world, 'miner') };
        };
        const first = record();
        expect(world.entities.has('rock')).toBeFalse();
        restoreWorld(world, before, deriveEntityComponents);
        expect(world.entities.has('rock')).toBeTrue();
        expect(record()).toEqual(first);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
