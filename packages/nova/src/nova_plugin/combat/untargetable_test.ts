import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { completeEntity } from '../spawn/index.js';
import { GovtComponent } from '../core/index.js';
import { makeShip, TargetComponent } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from '../npc/index.js';
import { applyControlEvents, ControlledByComponent } from '../player/index.js';
import { applySetTarget } from './target_plugin.js';

/**
 * shïp Flags2 0x0004 "Can't be targeted" (reference "shïp Flags2 0x0004
 * 'can't be targeted' (A13), wave 41"): an enemy AI 3 never fired at such
 * a ship where its plain twin was shot at once, and the player's Tab
 * skipped it.
 */
const PEER = 'test peer';
const PIRATES = 'test:pirates';
const PLAIN = 'test:plain';
const GHOST = 'test:ghost';
const TRADERS = 'test:traders';

async function makeWorld(preyShip: string, withPlayer: boolean) {
    const gameData = new MockGameData();
    // Strength > 0: a zero-strength ship never fights (oddsFavorable).
    gameData.data.Ship.map.set(PLAIN, {
        ...getDefaultShipData(), id: PLAIN, strength: 10,
    });
    gameData.data.Ship.map.set(GHOST, {
        ...getDefaultShipData(), id: GHOST, strength: 10, untargetable: true,
    });
    const pirates = {
        ...getDefaultGovtData(), id: PIRATES, classes: [5], enemies: [1],
        maxOdds: 100,
    };
    pirates.flags.xenophobic = true;
    gameData.data.Govt.map.set(PIRATES, pirates);
    gameData.data.Govt.map.set(TRADERS, {
        ...getDefaultGovtData(), id: TRADERS, classes: [1], maxOdds: 100,
    });
    await gameData.data.Govt.get(PIRATES);
    await gameData.data.Govt.get(TRADERS);
    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, shipId: string, x: number,
        extra: (ship: ReturnType<typeof makeShip>) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0, position: new Position(x, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        });
        extra(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    if (withPlayer) {
        await addShip('player', PLAIN, 0, ship => ship.components.set(
            ControlledByComponent, { peerId: PEER }));
    }
    // A hostile (xenophobic) warship that thinks.
    await addShip('hunter', PLAIN, 300, ship => {
        ship.components.set(GovtComponent, { id: PIRATES });
        ship.components.set(NpcComponent, { aiType: 3, nextDecision: 0 });
    });
    await addShip('prey', preyShip, 150, ship => ship.components.set(
        GovtComponent, { id: TRADERS }));
    world.step();
    return world;
}

function press(world: World, action: string) {
    applyControlEvents(world, PEER, [{ action: action as never, state: 'start' }]);
    world.step();
    applyControlEvents(world, PEER, [{ action: action as never, state: false }]);
    world.step();
}

function targetOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(TargetComponent)?.target;
}

describe('shïp Flags2 0x0004 "can\'t be targeted" (A13 wave 41)', () => {
    it('the player\'s Tab skips it (its plain twin is in the cycle)',
        async () => {
            for (const [prey, expected] of [[PLAIN, true], [GHOST, false]] as const) {
                const world = await makeWorld(prey, true);
                const seen = new Set<string | undefined>();
                for (let i = 0; i < 6; i++) {
                    press(world, 'nextTarget');
                    seen.add(targetOf(world, 'player'));
                }
                expect(seen.has('prey')).withContext(prey).toBe(expected);
                expect(seen.has('hunter')).toBeTrue();
            }
        });

    it('`r` and a click leave it out too (GUESS)', async () => {
        const world = await makeWorld(GHOST, true);
        world.entities.get('hunter')!.components.delete(GovtComponent);
        world.entities.get('prey')!.components.set(GovtComponent, { id: PIRATES });
        press(world, 'nearestTarget');
        expect(targetOf(world, 'player')).not.toBe('prey');
        applySetTarget(world, PEER, 'prey');
        expect(targetOf(world, 'player')).not.toBe('prey');
    });

    it('an enemy AI 3 never picks it as a target', async () => {
        const plain = await makeWorld(PLAIN, false);
        const ghost = await makeWorld(GHOST, false);
        for (let i = 0; i < 120; i++) {
            plain.step();
            ghost.step();
        }
        expect(targetOf(plain, 'hunter')).toBe('prey');
        expect(targetOf(ghost, 'hunter')).toBeUndefined();
    });
});
