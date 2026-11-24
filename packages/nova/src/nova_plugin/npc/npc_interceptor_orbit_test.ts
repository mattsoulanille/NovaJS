import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { makeShip } from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { NpcComponent } from './npc_component.js';
import { INTERCEPTOR_ORBIT_RADIUS } from './npc_decision.js';

/**
 * An interceptor (AI 4) circles its home planet smoothly.
 *
 * It used to chase orbit waypoints 45° apart on the 400 px circle, each
 * re-aimed (and, for a fast hull, braked for) once it came within 200 px:
 * a stock Firebird or Phoenix swung its nose back and forth about once a
 * second all the way round (headless Heraan, 120 s: Firebird 135 sampled
 * heading reversals, Phoenix 128), and wandered 350-670 px from the
 * planet. npc_steering.ts's steerOrbit flies the circle itself.
 */

const GOVT = 'test:patrol';
const HOME = 'home';

/** Stock Firebird (shïp nova:155): 225 px/s, 144 px/s^2, 240°/s. Fast
 * enough for its acceleration that the 400 px circle at top speed takes
 * most of its thrust sideways: the hard case. */
const FIREBIRD = { speed: 225, acceleration: 144, turnRate: 4 * Math.PI / 3 };
/** Stock Aurora Carrier (shïp nova:302): 51.75 px/s, 32.4, 75°/s. */
const AURORA = {
    speed: 51.75, acceleration: 32.4, turnRate: 75 * Math.PI / 180,
};

async function orbitWorld(physics: typeof FIREBIRD) {
    const gameData = new MockGameData();
    const base = getDefaultShipData();
    const hull: ShipData = {
        ...base, id: 'test:interceptor',
        physics: { ...base.physics, ...physics },
    };
    gameData.data.Ship.map.set(hull.id, hull);
    gameData.data.Govt.map.set(GOVT, { ...getDefaultGovtData(), id: GOVT });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    // The home planet stand-in: the orbit only reads its position.
    const home = new Entity();
    home.components.set(MovementStateComponent, {
        position: new Position(0, 0), velocity: new Vector(0, 0),
        rotation: new Angle(0), accelerating: 0, turning: 0,
        turnBack: false,
    });
    world.entities.set(HOME, home);
    const ship = makeShip(hull);
    ship.components.set(GovtComponent, { id: GOVT });
    ship.components.set(NpcComponent,
        { aiType: 4, destination: HOME, departAt: 1e9 });
    await completeEntity(world, ship);
    // At rest 760 px out, facing away from the planet's side of things.
    Object.assign(ship.components.get(MovementStateComponent)!, {
        position: new Position(700, -300), velocity: new Vector(0, 0),
        rotation: new Angle(-2), accelerating: 0, turning: 0,
        turnBack: false, turnTo: null,
    });
    world.entities.set('interceptor', ship);
    world.step();
    return world;
}

function movementOf(world: World) {
    return world.entities.get('interceptor')!.components
        .get(MovementStateComponent)!;
}

/** Flies `seconds`; from `settle` seconds on, counts the reversals of
 * the direction the nose is swinging (sampled every 0.1 s, as the
 * playtest repro did) and the range of distances from the planet. */
function fly(world: World, seconds: number, settle = 20) {
    let reversals = 0;
    let lastSign = 0;
    let previous = Angle.fromAngleLike(movementOf(world).rotation);
    let nearest = Infinity;
    let farthest = 0;
    for (let tick = 1; tick <= seconds * 60; tick++) {
        world.step();
        const movement = movementOf(world);
        if (tick < settle * 60) {
            previous = Angle.fromAngleLike(movement.rotation);
            continue;
        }
        const distance = movement.position.length;
        nearest = Math.min(nearest, distance);
        farthest = Math.max(farthest, distance);
        if (tick % 6 === 0) {
            const swing = previous.distanceTo(
                Angle.fromAngleLike(movement.rotation)).angle;
            if (Math.abs(swing) >= 0.005) {
                const sign = Math.sign(swing);
                if (lastSign !== 0 && sign !== lastSign) {
                    reversals++;
                }
                lastSign = sign;
            }
            previous = Angle.fromAngleLike(movement.rotation);
        }
    }
    return { reversals, nearest, farthest };
}

describe('An interceptor orbiting its home planet', () => {
    it('a fighter-speed hull holds the 400 px circle without swinging its '
        + 'nose', async () => {
            const world = await orbitWorld(FIREBIRD);
            const run = fly(world, 120);
            expect(run.reversals).toBe(0);
            expect(run.nearest).toBeGreaterThan(INTERCEPTOR_ORBIT_RADIUS - 20);
            expect(run.farthest).toBeLessThan(INTERCEPTOR_ORBIT_RADIUS + 20);
            expect(movementOf(world).velocity.length).toBeCloseTo(225, 0);
        });

    it('so does a slow, heavy one', async () => {
        const run = fly(await orbitWorld(AURORA), 120, 40);
        expect(run.reversals).toBe(0);
        expect(run.nearest).toBeGreaterThan(INTERCEPTOR_ORBIT_RADIUS - 20);
        expect(run.farthest).toBeLessThan(INTERCEPTOR_ORBIT_RADIUS + 20);
    });

    it('goes round the way the old waypoints did (increasing clock angle)',
        async () => {
            const world = await orbitWorld(FIREBIRD);
            fly(world, 20);
            const before = Vector.fromVectorLike(movementOf(world).position)
                .angle;
            for (let i = 0; i < 30; i++) {
                world.step();
            }
            const after = Vector.fromVectorLike(movementOf(world).position)
                .angle;
            expect(before.distanceTo(after).angle).toBeGreaterThan(0);
            expect(world.entities.get('interceptor')!.components
                .get(NpcComponent)!.waypoint).toBeUndefined();
        });

    it('replays identically from a snapshot mid-orbit', async () => {
        const world = await orbitWorld(FIREBIRD);
        for (let i = 0; i < 60 * 5; i++) {
            world.step();
        }
        const atBreak = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            const headings: number[] = [];
            for (let i = 0; i < 60 * 5; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
                headings.push(movementOf(world).rotation.angle);
            }
            return { hashes, headings };
        };
        const first = record();
        restoreWorld(world, atBreak, deriveEntityComponents);
        const second = record();
        expect(second.headings).toEqual(first.headings);
        expect(second.hashes).toEqual(first.hashes);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
