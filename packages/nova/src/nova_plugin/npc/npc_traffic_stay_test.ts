import 'jasmine';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import {
    getDefaultShipAIFlags, getDefaultShipData, ShipData,
} from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { DisabledComponent, makeShip, ShipDataComponent } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import { isShuttle } from './npc_shuttle.js';

/**
 * ============================================================================
 * Who of ordinary traffic stays, against docs/reference_experiments.md
 * "Stock Sol, wave 16: traffic for 26 minutes, no plug-in: the system
 * freezes with six ships, two of them shuttles". In the original's stock
 * Sol (avgShips 6) the AI 1 traders and an AI 3 destroyer left within the
 * first minutes, and then the same six ships (two shuttles, three AI 4 Fed
 * interceptors and a miner) sat there for 21 minutes with nothing arriving
 * or leaving: the slots ended up with whatever does not leave.
 * ============================================================================
 */

const GOVT = 'test:fed';
const SYSTEM = 'test:sol';
const EARTH = 'test:earth';
const MARS = 'test:mars';
const HULL = 'test:hull';
const SHUTTLE_HULL = 'test:shuttle';

function hull(id: string, shuttle: boolean): ShipData {
    const base = getDefaultShipData();
    return {
        ...base, id, name: id,
        aiFlags: {
            ...getDefaultShipAIFlags(),
            scoopsAsteroidDebris: shuttle,
            shuttlesBetweenStellars: shuttle,
        },
    };
}

function stellar(id: string, x: number, y: number): PlanetData {
    return {
        ...getDefaultPlanetData(), id, name: id, position: [x, y], govt: GOVT,
    };
}

/**
 * A two-port system of one govt. With `traffic`, its AvgShips and an even
 * mix of four düdes, as in stock Sol: AI 4 interceptors, AI 3 warships,
 * AI 1 traders and AI 1 shuttles.
 */
async function trafficWorld(traffic?: number) {
    const gameData = new MockGameData();
    gameData.data.Govt.map.set(GOVT,
        { ...getDefaultGovtData(), id: GOVT, classes: [1] });
    for (const planet of [stellar(EARTH, 0, 0), stellar(MARS, 600, 300)]) {
        gameData.data.Planet.map.set(planet.id, planet);
    }
    gameData.data.Ship.map.set(HULL, hull(HULL, false));
    gameData.data.Ship.map.set(SHUTTLE_HULL, hull(SHUTTLE_HULL, true));
    const dudes = [
        ['test:interceptors', 4, HULL],
        ['test:warships', 3, HULL],
        ['test:traders', 1, HULL],
        ['test:shuttles', 1, SHUTTLE_HULL],
    ] as const;
    for (const [id, aiType, ship] of dudes) {
        gameData.data.Dude.map.set(id, {
            ...getDefaultDudeData(), id, aiType, govt: GOVT,
            ships: [{ id: ship, weight: 100 }],
        });
    }
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM, govt: GOVT,
        planets: [EARTH, MARS],
        ...(traffic !== undefined ? {
            avgShips: traffic,
            dudes: dudes.map(([id]) => ({ id, weight: 25 })),
        } : {}),
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: traffic !== undefined });

    async function addNpc(uuid: string, npc: NpcState) {
        const ship = makeShip(gameData.data.Ship.map.get(HULL)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(300, -300),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        ship.components.set(GovtComponent, { id: GOVT });
        ship.components.set(NpcComponent, npc);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, addNpc };
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

/** Steps `world` for `seconds`; whether each ship decided to leave. */
function departures(world: World, uuids: string[], seconds: number) {
    const left = new Map(uuids.map(uuid => [uuid, false]));
    const end = now(world) + seconds * 1000;
    while (now(world) < end) {
        world.step();
        for (const uuid of uuids) {
            const ship = world.entities.get(uuid);
            left.set(uuid, left.get(uuid)! || !ship
                || ship.components.get(NpcComponent)?.mode === 'depart'
                || ship.components.has(JumpComponent));
        }
    }
    return left;
}

describe('Ordinary traffic that stays (reference "Stock Sol, wave 16")', () => {
    it('an AI 4 interceptor never leaves on its departure roll; an AI 3 '
        + 'warship still does', async () => {
            const { world, addNpc } = await trafficWorld();
            await addNpc('interceptor', { aiType: 4, departAt: 0 });
            await addNpc('warship', { aiType: 3, departAt: 0 });
            const left = departures(world, ['interceptor', 'warship'], 60);
            expect(left.get('interceptor')).toBeFalse();
            expect(world.entities.get('interceptor')!.components
                .get(NpcComponent)!.mode).toBe('patrol');
            expect(left.get('warship')).toBeTrue();
        }, 60_000);

    it('an AI 4 with no business here (`passingThrough`: a released '
        + 'mission ship, a përs sent on its way) still leaves on its '
        + 'clock', async () => {
            const { world, addNpc } = await trafficWorld();
            await addNpc('interceptor',
                { aiType: 4, departAt: 0, passingThrough: true });
            const left = departures(world, ['interceptor'], 30);
            expect(left.get('interceptor')).toBeTrue();
        }, 60_000);

    it('a stock-Sol-like mix freezes: the slots end up with interceptors '
        + 'and shuttles, and nothing arrives or leaves', async () => {
            const { world } = await trafficWorld(6);
            const census = () => {
                const stayers: string[] = [];
                let others = 0;
                for (const [uuid, entity] of world.entities) {
                    const npc = entity.components.get(NpcComponent);
                    if (!npc || entity.components.has(DisabledComponent)) {
                        continue;
                    }
                    const ship = entity.components.get(ShipDataComponent);
                    if (npc.aiType === 4 || (ship && isShuttle(ship))) {
                        stayers.push(uuid);
                    } else {
                        others++;
                    }
                }
                return { stayers: stayers.sort().join(), others };
            };
            const start = now(world);
            const frozenFrom = 15 * 60_000;
            let atFreeze: ReturnType<typeof census> | undefined;
            let changed: ReturnType<typeof census> | undefined;
            while (now(world) - start < 20 * 60_000) {
                world.step();
                if (now(world) - start >= frozenFrom) {
                    const current = census();
                    atFreeze ??= current;
                    if (current.stayers !== atFreeze.stayers
                        || current.others !== atFreeze.others) {
                        changed = current;
                        break;
                    }
                }
            }
            expect(changed).withContext('the system changed').toBeUndefined();
            expect(atFreeze!.others).toBe(0);
            expect(atFreeze!.stayers.split(',').length)
                .toBeGreaterThanOrEqual(5);
        }, 300_000);
});
