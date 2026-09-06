import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { GovtComponent } from '../core/govt_component.js';
import { JumpComponent, JUMP_DISTANCE } from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import {
    NpcComponent, NPC_DEPART_RADIUS,
} from './npc_ai_plugin.js';
import { SystemHoldComponent } from './system_hold.js';

/**
 * ============================================================================
 * A HELD SHIP DOES NOT LEAVE THE SYSTEM
 * ============================================================================
 *
 * Matthew's nit: "Ship shouldn't leave before being refueled if it offers
 * a 'refuel me' mission." The stock Refuel Trader (mïsn 141/650/651/652,
 * ShipGoal 5) broadcasts its HailQuote — "I'm out of fuel, can anybody
 * help?" — over the radio, and the player has to fly across the system to
 * answer it. Every ordinary NPC rolls a 1-3 minute departure timer at its
 * first think, so the ship asking for help routinely warped out while the
 * player was still crossing the system, leaving a radio call from nobody.
 *
 * SystemHoldComponent is the fix (see system_hold.ts). The ship under test
 * here is deliberately generic — the hold is a property of the ship, not
 * of the mission — and it is placed OUTSIDE the no-jump radius with its
 * departure timer already expired, so it wants to leave on the very first
 * think and nothing but the hold is stopping it.
 *
 * Both exits out of a system are covered: the ordinary DEPARTURE (an
 * expired departAt) and the FLEE exit, which is not a departure decision
 * at all and which used to delete the ship outright at the rim when it
 * could not jump.
 */

const SHIP = 'test:ship';
const NEUTRAL = 'test:neutral';

async function makeWorld() {
    const gameData = new MockGameData();
    gameData.data.Ship.map.set(SHIP, {
        ...getDefaultShipData(), id: SHIP, strength: 10,
    });
    const govt = getDefaultGovtData();
    govt.id = NEUTRAL;
    gameData.data.Govt.map.set(NEUTRAL, govt);
    await gameData.data.Govt.get(NEUTRAL);
    // npcs: false — an empty system, so nothing else can distract the AI.
    return { gameData, world: await makeSystem('test:system', gameData, undefined, { npcs: false }) };
}

/**
 * One NPC, `distance` from the middle, whose departure timer has already
 * expired — so its very first think decides to leave.
 */
async function addShip(world: World, gameData: MockGameData, uuid: string,
    { held = false, distance = JUMP_DISTANCE + 500, mode = undefined as
        undefined | 'depart' | 'flee' } = {}) {
    const ship = makeShip(gameData.data.Ship.map.get(SHIP)!);
    ship.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(distance, 0),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    ship.components.set(GovtComponent, { id: NEUTRAL });
    // aiType 3 (warship): with nothing to hunt it patrols until departAt,
    // which is already in the past.
    ship.components.set(NpcComponent, { aiType: 3, departAt: 0, ...(mode ? { mode } : {}) });
    if (held) {
        ship.components.set(SystemHoldComponent, { reason: 'shipOffer' });
    }
    await completeEntity(world, ship);
    world.entities.set(uuid, ship);
    return ship;
}

/** Steps the world, reporting whether the ship ever entered a jump
 * sequence and whether it is still in the world at the end. */
function run(world: World, uuid: string, steps: number) {
    let everJumped = false;
    const modes = new Set<string | undefined>();
    for (let i = 0; i < steps; i++) {
        const ship = world.entities.get(uuid);
        if (ship) {
            modes.add(ship.components.get(NpcComponent)?.mode);
            if (ship.components.has(JumpComponent)) {
                everJumped = true;
            }
        }
        world.step();
    }
    return { everJumped, modes, present: world.entities.has(uuid) };
}

describe('a ship held in the system', () => {
    it('CONTROL: an unheld ship with an expired timer jumps out',
        async () => {
            const { world, gameData } = await makeWorld();
            await addShip(world, gameData, 'ship');
            const { everJumped, modes, present } = run(world, 'ship', 600);
            expect(modes).toContain('depart');
            expect(everJumped).toBeTrue();
            expect(present).toBeFalse();
        });

    it('never decides to depart, never jumps, and is never despawned',
        async () => {
            const { world, gameData } = await makeWorld();
            await addShip(world, gameData, 'ship', { held: true });
            const { everJumped, modes, present } = run(world, 'ship', 600);
            // The decision half: it is not even put into 'depart'.
            expect(modes).not.toContain('depart');
            // The exit half: no hyperspace sequence was ever begun.
            expect(everJumped).toBeFalse();
            // And it was not quietly deleted at the rim instead.
            expect(present).toBeTrue();
        });

    it('leaves as soon as the hold is released', async () => {
        // The other half of the ruling: held "until refuelled / the
        // mission is complete or aborted", not held for ever. Releasing
        // is exactly what applyAcceptMission does to a përs whose offer
        // has been taken, and what rescueBoarded does to a rescued hulk.
        const { world, gameData } = await makeWorld();
        const ship = await addShip(world, gameData, 'ship', { held: true });
        expect(run(world, 'ship', 200).present).toBeTrue();

        // Generous: while held it patrolled back inside the no-jump
        // radius, so it has to fly out again before it can warp.
        ship.components.delete(SystemHoldComponent);
        const { everJumped, present } = run(world, 'ship', 4000);
        expect(everJumped).toBeTrue();
        expect(present).toBeFalse();
    });

    it('is not despawned by the flee exit at the depart radius',
        async () => {
            // 'flee' is not a departure DECISION, so the decision system's
            // guard does not cover it: a ship driven off the edge of the
            // playfield used to be deleted outright once it could not
            // jump. A held ship must survive that too.
            const { world, gameData } = await makeWorld();
            await addShip(world, gameData, 'held', {
                held: true, mode: 'flee', distance: NPC_DEPART_RADIUS + 100,
            });
            await addShip(world, gameData, 'free', {
                mode: 'flee', distance: NPC_DEPART_RADIUS + 100,
            });
            for (let i = 0; i < 10; i++) {
                world.step();
            }
            expect(world.entities.has('held')).toBeTrue();
            // CONTROL: the same ship without the hold leaves (by jumping
            // from out there, or by the delete-at-the-rim fallback).
            const free: Entity | undefined = world.entities.get('free');
            expect(!free || free.components.has(JumpComponent)).toBeTrue();
        });
});
