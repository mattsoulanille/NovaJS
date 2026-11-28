import 'jasmine';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultPlanetData, PlanetData } from 'novadatainterface/planet_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { makeShip } from '../ship/index.js';
import { completeEntity, gateArrivalState } from '../spawn/index.js';
import { JumpComponent, JUMP_DISTANCE, PlanetDataComponent } from '../travel/index.js';
import { NpcComponent, NpcState } from './npc_component.js';
import { PlanetEntry, traderDestinations } from './npc_decision.js';
import { FormationComponent } from './npc_formation.js';
import {
    GATE_EMERGENCE_SPEED_FACTOR, gateEmergenceState, gateUse,
    isWorkingHypergate,
} from './npc_hypergate.js';

/**
 * ============================================================================
 * NPC hypergate traffic, against docs/reference_experiments.md "NPC
 * hypergate traffic, wave 60": a gövt Flags2 0x0040 govt's ships come OUT
 * of a working gate and fly straight on out, and the ones already in the
 * system fly INTO it and are gone; a 0x0020 govt's never go near it; a
 * govt with neither flag uses it now and then.
 * ============================================================================
 */

const PREFER = 'test:sigma';
const NEVER = 'test:civvies';
const MAY = 'test:neither';
const SYSTEM = 'test:tichel';
const PORT = 'test:port';
const GATE = 'test:gate';
const DEAD_GATE = 'test:deadgate';
const HULL = 'test:hull';

function govt(id: string, flags: Partial<GovtData['flags2']>): GovtData {
    const base = getDefaultGovtData();
    return { ...base, id, name: id, classes: [13],
        flags2: { ...base.flags2, ...flags } };
}

const govts = [
    govt(PREFER, { prefersHypergates: true }),
    govt(NEVER, { doesntUseHypergates: true }),
    govt(MAY, {}),
];

function stellar(id: string, x: number, y: number,
    gate?: PlanetData['gate'], canLand = true): PlanetData {
    const base = getDefaultPlanetData();
    return {
        ...base, id, name: id, position: [x, y], govt: null, gate,
        flags: { ...base.flags, canLand },
    } as PlanetData;
}

const port = stellar(PORT, 0, 0);
// The stock gates: CustSndID 120, govt 183 / MinStatus 32767 (which locks
// the player out and no NPC: not modelled here, NPCs never read it).
const gate = stellar(GATE, 125, 300,
    { kind: 'hypergate', destinations: ['test:elsewhere'], emergenceAngle: 120 });
// A destroyed gate of the collapsed network: no links, can-land clear.
const deadGate = stellar(DEAD_GATE, -300, 300,
    { kind: 'hypergate', destinations: [], emergenceAngle: 120 }, false);

function hull(): ShipData {
    const base = getDefaultShipData();
    return { ...base, id: HULL, name: HULL,
        physics: { ...base.physics, speed: 200, acceleration: 200,
            turnRate: 3 } };
}

/** A system with a port, a working gate and a destroyed one; traffic of
 * `trafficGovt` when given. */
async function gateWorld(trafficGovt?: string, avgShips = 4) {
    const gameData = new MockGameData();
    for (const g of govts) {
        gameData.data.Govt.map.set(g.id, g);
    }
    for (const planet of [port, gate, deadGate]) {
        gameData.data.Planet.map.set(planet.id, planet);
    }
    gameData.data.Ship.map.set(HULL, hull());
    if (trafficGovt) {
        gameData.data.Dude.map.set('test:dude', {
            ...getDefaultDudeData(), id: 'test:dude', aiType: 1,
            govt: trafficGovt, ships: [{ id: HULL, weight: 100 }],
        });
    }
    gameData.data.System.map.set(SYSTEM, {
        ...getDefaultSystemData(), id: SYSTEM,
        planets: [PORT, GATE, DEAD_GATE],
        ...(trafficGovt ? {
            avgShips, dudes: [{ id: 'test:dude', weight: 100 }],
        } : {}),
    });
    const world = await makeSystem(SYSTEM, gameData, undefined,
        { npcs: trafficGovt !== undefined });

    async function addNpc(uuid: string, npc: NpcState, govtId: string,
        position = new Position(-600, -600)) {
        const ship = makeShip(gameData.data.Ship.map.get(HULL)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position, rotation: new Angle(0),
            turnBack: false, turning: 0, velocity: new Vector(0, 0),
        });
        ship.components.set(GovtComponent, { id: govtId });
        ship.components.set(NpcComponent, npc);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, gameData, addNpc };
}

function now(world: World) {
    return world.resources.get(TimeResource)!.time;
}

function gateUuid(world: World, id: string) {
    for (const [uuid, entity] of world.entities) {
        if (entity.components.get(PlanetDataComponent)?.id === id) {
            return uuid;
        }
    }
    throw new Error(`no ${id}`);
}

function entry(uuid: string, data: PlanetData): PlanetEntry {
    return [uuid, {
        position: new Position(...data.position),
    } as never, undefined, data];
}

describe('NPC hypergate traffic (reference "NPC hypergate traffic, wave 60")',
    () => {
        it('gateUse reads gövt Flags2: 0x0020 never, 0x0040 prefer, neither '
            + '(or no govt) may; 0x0020 wins over 0x0040', () => {
            expect(gateUse(govts[0])).toBe('prefer');
            expect(gateUse(govts[1])).toBe('never');
            expect(gateUse(govts[2])).toBe('may');
            expect(gateUse(undefined)).toBe('may');
            expect(gateUse(govt('both', { prefersHypergates: true,
                doesntUseHypergates: true }))).toBe('never');
        });

        it('a working gate is a linked, landable hypergate; a destroyed one '
            + 'and a wormhole are not', () => {
            expect(isWorkingHypergate(gate)).toBeTrue();
            expect(isWorkingHypergate(deadGate)).toBeFalse();
            expect(isWorkingHypergate(port)).toBeFalse();
            expect(isWorkingHypergate(stellar('w', 0, 0, { kind: 'wormhole',
                destinations: ['x'], emergenceAngle: null }))).toBeFalse();
        });

        it('trader stops: a 0x0020 govt never picks the gate, a 0x0040 govt '
            + 'picks only the gate, neither picks it like a port, and a held '
            + 'ship never does', () => {
            const planets = [entry('p', port), entry('g', gate),
                entry('d', deadGate)];
            const govtOf = (id: string) => govts.find(g => g.id === id);
            const stops = (g: GovtData, held = false) =>
                traderDestinations(planets, g, govtOf, held)
                    .map(([uuid]) => uuid);
            expect(stops(govts[1])).toEqual(['p']);
            expect(stops(govts[0])).toEqual(['g']);
            expect(stops(govts[2])).toEqual(['p', 'g']);
            expect(stops(govts[0], true)).toEqual(['p']);
            expect(stops(govts[2], true)).toEqual(['p']);
            // No working gate here: a 0x0040 govt stops at the ports.
            expect(traderDestinations([entry('p', port), entry('d', deadGate)],
                govts[0], govtOf).map(([uuid]) => uuid)).toEqual(['p']);
        });

        it('gateEmergenceState: at the gate centre, heading the emergence '
            + 'angle (CustSndID 120: down and to the right on screen), at '
            + 'twice top speed; a random angle costs one draw', () => {
            let draws = 0;
            const random = { next: () => { draws++; return 0.25; } };
            const out = gateEmergenceState(new Position(125, 300), 120, 200,
                random);
            expect(draws).toBe(0);
            expect(out.position.x).toBe(125);
            expect(out.position.y).toBe(300);
            expect(out.rotation.angle).toBeCloseTo(120 * Math.PI / 180, 9);
            expect(out.velocity.length)
                .toBeCloseTo(200 * GATE_EMERGENCE_SPEED_FACTOR, 6);
            expect(out.velocity.x).toBeGreaterThan(0);
            expect(out.velocity.y).toBeGreaterThan(0);
            expect(Math.atan2(out.velocity.y, out.velocity.x) * 180 / Math.PI)
                .toBeCloseTo(30, 6);
            const random2 = gateEmergenceState(new Position(0, 0), null, 200,
                random);
            expect(draws).toBe(1);
            expect(random2.rotation.angle).toBeCloseTo(Math.PI / 2, 9);
        });

        it('gateArrivalState: a 0x0040 govt always comes through the working '
            + 'gate, a 0x0020 govt never, neither on a roll', async () => {
            const { world, gameData } = await gateWorld();
            const random = world.resources.get(RandomResource)!;
            const ship = gameData.data.Ship.map.get(HULL)!;
            const arrival = gateArrivalState(world, gameData, PREFER, ship,
                random);
            expect(arrival).toBeDefined();
            expect(arrival!.position.x).toBe(125);
            expect(arrival!.position.y).toBe(300);
            expect(gateArrivalState(world, gameData, NEVER, ship, random))
                .toBeUndefined();
            let through = 0;
            for (let i = 0; i < 200; i++) {
                if (gateArrivalState(world, gameData, MAY, ship, random)) {
                    through++;
                }
            }
            expect(through).toBeGreaterThan(60);
            expect(through).toBeLessThan(140);
        });

        it('a 0x0040 trader already in the system flies INTO the gate and '
            + 'is gone; a 0x0020 trader goes to the port', async () => {
            const { world, addNpc } = await gateWorld();
            await addNpc('sigma', { aiType: 1 }, PREFER);
            await addNpc('civvy', { aiType: 1 }, NEVER);
            const gateId = gateUuid(world, GATE);
            let sawGateMode = false;
            const end = now(world) + 60_000;
            while (now(world) < end && world.entities.has('sigma')) {
                world.step();
                const npc = world.entities.get('sigma')
                    ?.components.get(NpcComponent);
                if (npc?.mode === 'gate') {
                    sawGateMode = true;
                    expect(npc.destination).toBe(gateId);
                }
            }
            expect(sawGateMode).toBeTrue();
            expect(world.entities.has('sigma')).toBeFalse();
            const civvy = world.entities.get('civvy')!
                .components.get(NpcComponent)!;
            expect(civvy.destination).not.toBe(gateId);
        }, 60_000);

        it('a ship that came out of a gate flies on along the emergence '
            + 'angle and jumps out past the no-jump zone', async () => {
            const { world, addNpc } = await gateWorld();
            const out = gateEmergenceState(new Position(125, 300), 120, 200,
                { next: () => 0 });
            const ship = await addNpc('arrival', {
                aiType: 1, mode: 'depart', departHeading: out.rotation.angle,
            }, PREFER, out.position);
            ship.components.get(MovementStateComponent)!.velocity =
                out.velocity;
            ship.components.get(MovementStateComponent)!.rotation =
                out.rotation;
            let jumpedAt: Position | undefined;
            const end = now(world) + 30_000;
            while (now(world) < end && world.entities.has('arrival')) {
                world.step();
                const e = world.entities.get('arrival');
                if (e?.components.has(JumpComponent) && !jumpedAt) {
                    jumpedAt = Position.fromVectorLike(e.components
                        .get(MovementStateComponent)!.position);
                }
            }
            expect(jumpedAt).toBeDefined();
            expect(jumpedAt!.length).toBeGreaterThan(JUMP_DISTANCE);
            // Out along the 120 degree line from the gate, not radially.
            const dx = jumpedAt!.x - 125, dy = jumpedAt!.y - 300;
            expect(Math.abs(Math.atan2(dy, dx) * 180 / Math.PI - 30))
                .toBeLessThan(10);
        }, 60_000);

        it('a 0x0040 warship leaves by the gate as soon as it has nothing to '
            + 'fight; its fleet escort follows it in', async () => {
            const { world, addNpc } = await gateWorld();
            await addNpc('lead', { aiType: 3, departAt: 1e12 }, PREFER);
            const escort = await addNpc('escort', { aiType: 3, departAt: 1e12 },
                PREFER, new Position(-650, -600));
            escort.components.set(FormationComponent, { leader: 'lead', slot: 0 });
            const gateId = gateUuid(world, GATE);
            let escortGate = false;
            const end = now(world) + 90_000;
            while (now(world) < end && (world.entities.has('lead')
                || world.entities.has('escort'))) {
                world.step();
                const npc = world.entities.get('escort')
                    ?.components.get(NpcComponent);
                if (npc?.mode === 'gate' && npc.destination === gateId) {
                    escortGate = true;
                }
            }
            expect(world.entities.has('lead')).toBeFalse();
            expect(world.entities.has('escort')).toBeFalse();
            expect(escortGate).toBeTrue();
        }, 120_000);

        it('traffic of a 0x0040 govt arrives through the gate; of a 0x0020 '
            + 'govt, by jump only, and never enters the gate', async () => {
            for (const [g, viaGate] of [[PREFER, true], [NEVER, false]] as const) {
                const { world } = await gateWorld(g, 3);
                const firstSeen = new Map<string, Position>();
                const gone = new Set<string>();
                const end = now(world) + 240_000;
                while (now(world) < end) {
                    world.step();
                    for (const [uuid, entity] of world.entities) {
                        if (!entity.components.has(NpcComponent)
                            || firstSeen.has(uuid)) {
                            continue;
                        }
                        firstSeen.set(uuid, Position.fromVectorLike(entity
                            .components.get(MovementStateComponent)!.position));
                    }
                    for (const uuid of firstSeen.keys()) {
                        if (!world.entities.has(uuid)) {
                            gone.add(uuid);
                        }
                    }
                }
                // Genesis ships (the first census) are scattered; every
                // later one arrived.
                const arrivals = [...firstSeen.entries()].slice(3);
                expect(arrivals.length).withContext(g).toBeGreaterThan(2);
                for (const [uuid, at] of arrivals) {
                    const atGate = Math.hypot(at.x - 125, at.y - 300) < 1;
                    expect(atGate).withContext(`${g} ${uuid}`).toBe(viaGate);
                }
                expect(gone.size).withContext(g).toBeGreaterThan(0);
            }
        }, 240_000);
    });
