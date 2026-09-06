import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { ExplodingComponent } from '../ship/death_plugin.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { GovtComponent } from '../core/govt_component.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { TargetComponent } from '../ship/target_component.js';

/**
 * A ship in its death sequence (ExplodingComponent, for shïp DeathDelay
 * seconds) is untargetable everywhere else in the engine — the player's
 * target keys, selectNearestHostile, DropExplodingTargetSystem, the
 * escort attack arm. The NPC brain's own candidate gather has to agree,
 * or a warship that has just made a kill re-chooses the fireball at
 * every think, has the lock stripped again each tick, and idles on a
 * corpse instead of engaging the next live enemy.
 */

const SHIP = 'test:ship';
const PIRATE_GOVT = 'test:pirates';
const TRADER_GOVT = 'test:traders';

function govt(id: string, overrides: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), id, ...overrides };
}

async function makeWorld() {
    const gameData = new MockGameData();
    // Strength > 0: a zero-strength ship never fights (oddsFavorable).
    gameData.data.Ship.map.set(SHIP, {
        ...getDefaultShipData(), id: SHIP, strength: 10,
    });
    // MaxOdds 100: willing to take a 1-to-1 fight (the default, 0,
    // never engages).
    gameData.data.Govt.map.set(PIRATE_GOVT, govt(PIRATE_GOVT, {
        classes: [5], enemies: [1], maxOdds: 100,
    }));
    gameData.data.Govt.map.set(TRADER_GOVT, govt(TRADER_GOVT, {
        classes: [1], maxOdds: 100,
    }));
    await gameData.data.Govt.get(PIRATE_GOVT);
    await gameData.data.Govt.get(TRADER_GOVT);
    const world = await makeSystem('test:system', gameData);

    async function addShip(uuid: string, x: number, y: number,
        setup: (ship: ReturnType<typeof makeShip>) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(SHIP)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, y),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }
    return { world, addShip };
}

/** Steps through the NPC's first think (decision interval 1 s). */
function think(world: World) {
    for (let i = 0; i < 40; i++) {
        world.step();
    }
}

function npcOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(NpcComponent)!;
}

function targetOf(world: World, uuid: string) {
    return world.entities.get(uuid)!.components.get(TargetComponent)!.target;
}

describe('NPC target selection and exploding ships', () => {
    it('a warship passes over an exploding enemy for the live one behind it',
        async () => {
            const { world, addShip } = await makeWorld();
            await addShip('warship', 0, 0, ship => {
                ship.components.set(GovtComponent, { id: PIRATE_GOVT });
                ship.components.set(NpcComponent, { aiType: 3 });
                ship.components.set(TargetComponent, { target: undefined });
            });
            // The nearer enemy is mid-explosion; the farther one is alive.
            await addShip('fireball', 300, 0, ship => {
                ship.components.set(GovtComponent, { id: TRADER_GOVT });
                ship.components.set(ExplodingComponent, 1e12);
            });
            await addShip('live', 900, 0, ship => {
                ship.components.set(GovtComponent, { id: TRADER_GOVT });
            });
            think(world);
            expect(npcOf(world, 'warship').mode).toBe('attack');
            expect(targetOf(world, 'warship')).toBe('live');
        });

    it('a warship whose only enemy is exploding stops attacking', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('warship', 0, 0, ship => {
            ship.components.set(GovtComponent, { id: PIRATE_GOVT });
            ship.components.set(NpcComponent, { aiType: 3, mode: 'attack' });
            ship.components.set(TargetComponent, { target: 'fireball' });
        });
        await addShip('fireball', 300, 0, ship => {
            ship.components.set(GovtComponent, { id: TRADER_GOVT });
            ship.components.set(ExplodingComponent, 1e12);
        });
        think(world);
        expect(npcOf(world, 'warship').mode).not.toBe('attack');
        expect(targetOf(world, 'warship')).toBeUndefined();
    });

    it('an interceptor ignores an exploding intruder', async () => {
        const { world, addShip } = await makeWorld();
        await addShip('interceptor', 0, 0, ship => {
            ship.components.set(GovtComponent, { id: PIRATE_GOVT });
            ship.components.set(NpcComponent, { aiType: 4 });
            ship.components.set(TargetComponent, { target: undefined });
        });
        await addShip('fireball', 300, 0, ship => {
            ship.components.set(GovtComponent, { id: TRADER_GOVT });
            ship.components.set(ExplodingComponent, 1e12);
        });
        think(world);
        expect(npcOf(world, 'interceptor').mode).not.toBe('attack');
        expect(targetOf(world, 'interceptor')).toBeUndefined();
    });

    it('a brave trader stops fighting back once its aggressor is exploding',
        async () => {
            const { world, addShip } = await makeWorld();
            await addShip('trader', 0, 0, ship => {
                ship.components.set(GovtComponent, { id: TRADER_GOVT });
                ship.components.set(NpcComponent, {
                    aiType: 2, mode: 'attack', aggressor: 'fireball',
                });
                ship.components.set(TargetComponent, { target: 'fireball' });
            });
            await addShip('fireball', 300, 0, ship => {
                ship.components.set(GovtComponent, { id: PIRATE_GOVT });
                ship.components.set(ExplodingComponent, 1e12);
            });
            think(world);
            // Back to business — neither fighting the fireball nor
            // fleeing from it.
            expect(['attack', 'flee']).not.toContain(npcOf(world, 'trader').mode!);
            expect(targetOf(world, 'trader')).toBeUndefined();
        });
});
