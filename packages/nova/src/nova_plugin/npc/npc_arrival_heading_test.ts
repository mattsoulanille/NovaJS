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

/**
 * A trader flying in to a planet (steerArrive) holds a steady heading.
 *
 * Matthew's playtest (2026-11-23, Heraan, "Why so much wiggling?"): a long
 * freighter pottering past the parked player swung its nose back and forth
 * by up to 90° every second or two. Two causes, both in steerArrive's
 * cruise:
 *  - At its speed cap the cruise's velocity error (top speed at the goal
 *    minus velocity) is all cross-track floating-point residue; the ship
 *    pointed along it, 90° off its course, and the residue's sign flipped
 *    as it flew. Slow hulls (Leviathan, Pegasus: top speed under the 50
 *    px/s arrival speed) did this the whole way in.
 *  - Inside the slow radius, a hull faster than the arrival speed braked to
 *    it, then the cruise asked for top speed again, carrying it back over
 *    the arrival speed into the brake: a 180° flip each way, over and over.
 */

const GOVT = 'test:traders';
const DESTINATION = 'destination';

/** Stock Pegasus (shïp nova:193): 49.5 px/s, 15.3 px/s^2, 60°/s. */
const PEGASUS = { speed: 49.5, acceleration: 15.3, turnRate: Math.PI / 3 };
/** Stock Enterprise (shïp nova:209): 90 px/s, 45 px/s^2, 120°/s. */
const ENTERPRISE = { speed: 90, acceleration: 45, turnRate: 2 * Math.PI / 3 };

async function arrivalWorld(physics: typeof PEGASUS) {
    const gameData = new MockGameData();
    const base = getDefaultShipData();
    const hull: ShipData = {
        ...base, id: 'test:freighter',
        physics: { ...base.physics, ...physics },
    };
    gameData.data.Ship.map.set(hull.id, hull);
    gameData.data.Govt.map.set(GOVT, { ...getDefaultGovtData(), id: GOVT });
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    // The planet stand-in: steerArrive only reads its position.
    const destination = new Entity();
    destination.components.set(MovementStateComponent, {
        position: new Position(0, 0), velocity: new Vector(0, 0),
        rotation: new Angle(0), accelerating: 0, turning: 0,
        turnBack: false,
    });
    world.entities.set(DESTINATION, destination);
    const ship = makeShip(hull);
    ship.components.set(GovtComponent, { id: GOVT });
    // Travelling with no re-plan or departure due inside the spec.
    ship.components.set(NpcComponent, {
        aiType: 1, mode: 'travel', destination: DESTINATION,
        nextDecision: 1e9, departAt: 1e9,
    });
    await completeEntity(world, ship);
    // At rest 760 px out, facing the goal give or take a degree and a
    // half (the playtest's trader set off from a dwell, not on a ruler
    // line; the first burn leaves it a little sideways velocity).
    const start = new Position(700, -300);
    Object.assign(ship.components.get(MovementStateComponent)!, {
        position: start, velocity: new Vector(0, 0),
        rotation: new Position(0, 0).subtract(start).angle.add(-0.025),
        accelerating: 0, turning: 0, turnBack: false, turnTo: null,
    });
    world.entities.set('trader', ship);
    world.step();
    return world;
}

function trader(world: World) {
    const entity = world.entities.get('trader')!;
    return {
        npc: entity.components.get(NpcComponent)!,
        movement: entity.components.get(MovementStateComponent)!,
    };
}

/** Steps until the trader arrives (or 60 s pass); returns how many times
 * it reversed its direction of turn and how far its nose swept in all. */
function flyIn(world: World) {
    let reversals = 0;
    let swept = 0;
    let lastTurning = 0;
    let rotation = Angle.fromAngleLike(trader(world).movement.rotation);
    let ticks = 0;
    while (trader(world).npc.mode === 'travel' && ticks < 60 * 60) {
        world.step();
        ticks++;
        const { movement } = trader(world);
        if (movement.turning !== 0 && lastTurning !== 0
            && movement.turning !== lastTurning) {
            reversals++;
        }
        if (movement.turning !== 0) {
            lastTurning = movement.turning;
        }
        swept += Math.abs(rotation.distanceTo(movement.rotation).angle);
        rotation = Angle.fromAngleLike(movement.rotation);
    }
    return {
        arrived: trader(world).npc.mode === 'dwell',
        seconds: ticks / 60, reversals, sweptDeg: swept * 180 / Math.PI,
    };
}

describe('A trader flying in to a planet holds its heading', () => {
    it('a slow freighter at its speed cap does not swing its nose',
        async () => {
            // Before the fix: 7 reversals, 717° of swing on the way in.
            const run = flyIn(await arrivalWorld(PEGASUS));
            expect(run.arrived).toBeTrue();
            expect(run.reversals).toBe(0);
            // It brakes once at the end (a flip toward retrograde); no
            // more swinging than that.
            expect(run.sweptDeg).toBeLessThan(200);
            expect(run.seconds).toBeLessThan(17);
        });

    it('a hull faster than the arrival speed brakes once, not back and '
        + 'forth across it', async () => {
            // Before the fix: 2 reversals, 493°.
            const run = flyIn(await arrivalWorld(ENTERPRISE));
            expect(run.arrived).toBeTrue();
            expect(run.reversals).toBe(0);
            expect(run.sweptDeg).toBeLessThan(200);
            expect(run.seconds).toBeLessThan(11);
        });

    it('replays identically from a snapshot mid-approach', async () => {
        const world = await arrivalWorld(ENTERPRISE);
        // Into the slow radius, where the approach-speed cap and the
        // on-course hold both apply.
        for (let i = 0; i < 60 * 6; i++) {
            world.step();
        }
        expect(trader(world).npc.mode).toBe('travel');
        const atBreak = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            const headings: number[] = [];
            for (let i = 0; i < 60 * 6; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
                headings.push(trader(world).movement.rotation.angle);
            }
            return { hashes, headings, mode: trader(world).npc.mode };
        };
        const first = record();
        expect(first.mode).toBe('dwell');
        restoreWorld(world, atBreak, deriveEntityComponents);
        const second = record();
        expect(second.headings).toEqual(first.headings);
        expect(second.hashes).toEqual(first.hashes);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
