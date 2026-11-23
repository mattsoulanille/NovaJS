import 'jasmine';
import { Position } from 'nova_ecs/datatypes/position';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { makeSystem } from '../nova_plugin/make_system.js';
import { ControlledByComponent, PEER_LOCAL_COMPONENTS } from '../nova_plugin/player/index.js';
import { makeShip } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import {
    JumpComponent, JumpRouteComponent, JUMP_DISTANCE,
} from '../nova_plugin/travel/index.js';
import { getSyntheticGameData } from './simulation_test_fixture.js';
import {
    applyInputRecords, InputRecord, loadInputRecordsGameData,
} from './simulation_input.js';

/**
 * ============================================================================
 * An input record is read-only to every world that applies it
 * ============================================================================
 *
 * The desync of nova:282 (2026-11-22, twice): a player arrived on a
 * multi-jump route with the jump key held. Their addEntity record was
 * retimed by the relay, so the client rolled back and applied it a
 * SECOND time — and the second time it inserted a ship whose route had
 * already lost its head, because the first application had inserted the
 * record's own component objects into the world (an io-ts decode hands
 * back its input when nothing needs converting) and beginJump's
 * `route.shift()` then edited the record in place. The client stayed;
 * the server's archive, which applied the record once and intact, jumped
 * the ship out — and, its world aliasing the relay's log the same way,
 * rewrote the logged record too, so every later replay of that log
 * (joiners, resyncs, the desync analyzer) reconstructed a third history.
 *
 * Applying a record must therefore leave it exactly as it was, and a
 * record applied twice (a rollback, the archive and a joiner, a replay)
 * must build the same world both times.
 */

const PEER = 'aliasing peer';
const SHIP_UUID = 'aliasing player ship';

async function makeWorld(): Promise<World> {
    const gameData = await getSyntheticGameData();
    const ids = await gameData.ids;
    // Thessaly Reach, sorted-first and linked.
    const systemId = [...ids.System].sort()[0]!;
    return makeSystem(systemId, gameData, 'node', { npcs: false });
}

/** A player arriving with a route and the jump key held: the first
 * tick it is in the world, it begins the route's next jump. */
async function arrivalRecord(world: World): Promise<InputRecord> {
    const gameData = await getSyntheticGameData();
    const ids = await gameData.ids;
    const systemId = [...ids.System].sort()[0]!;
    const system = await gameData.data.System.get(systemId);
    const destination = [...system.links].sort()[0]!;
    const shipData = await gameData.data.Ship.get([...ids.Ship].sort()[0]!);
    const ship = makeShip(shipData);
    ship.components.set(ControlledByComponent, { peerId: PEER });
    ship.components.set(MultiplayerData, { owner: PEER });
    ship.components.set(JumpRouteComponent, { route: [destination] });
    await completeEntity(world, ship);
    // Outside the no-jump zone, so the held key starts the jump at once.
    ship.components.get(MovementStateComponent)!.position =
        new Position(0, -(JUMP_DISTANCE * 2));
    const entity = world.resources.get(SerializerResource)!.encode(ship);
    return {
        peerId: PEER, tick: 1, seq: 0, inputs: [
            { kind: 'addEntity', uuid: SHIP_UUID, entity },
            { kind: 'control', events: [{ action: 'hyperjump', state: 'start' }] },
        ],
    };
}

async function applyAndStep(world: World, record: InputRecord, steps: number) {
    await loadInputRecordsGameData(world, [record]);
    applyInputRecords(world, [record]);
    for (let i = 0; i < steps; i++) {
        world.step();
    }
}

describe('input records are read-only to the worlds that apply them', () => {
    it('stepping an inserted ship does not edit the record that inserted it',
        async () => {
            const world = await makeWorld();
            const record = await arrivalRecord(world);
            // The encoded entity holds the ship's own class instances
            // (Position, Angle); compare what the record SAYS.
            const said = (r: InputRecord) => JSON.parse(JSON.stringify(r));
            const pristine = said(record);

            await applyAndStep(world, record, 10);
            // The ship did begin its jump: the world's route lost its head.
            const ship = world.entities.get(SHIP_UUID)!;
            expect(ship.components.has(JumpComponent)).toBeTrue();
            expect(ship.components.get(JumpRouteComponent)!.route).toEqual([]);

            // ...and the record that put it there did not.
            expect(said(record)).toEqual(pristine);
        }, 30_000);

    it('one record applied in two worlds builds the same world both times '
        + '(a rollback re-application, the archive and a log replay)',
        async () => {
            const first = await makeWorld();
            const record = await arrivalRecord(first);
            await applyAndStep(first, record, 30);

            // The SAME record object, as a rollback or the relay's log
            // hands it over again.
            const second = await makeWorld();
            await applyAndStep(second, record, 30);

            expect(second.entities.get(SHIP_UUID)!.components
                .has(JumpComponent)).toBeTrue();
            expect(hashWorld(second, PEER_LOCAL_COMPONENTS).hash)
                .toEqual(hashWorld(first, PEER_LOCAL_COMPONENTS).hash);
        }, 30_000);
});
