import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, getDefaultShipPhysics, ShipData } from 'novadatainterface/ship_data';
import { BayWeaponData, getDefaultBayWeaponData } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Random } from 'nova_ecs/plugins/random_plugin';
import { World } from 'nova_ecs/world';
import {
    applyRoomRules, ENGINE_LIMITS, IdFactory, LimitsRule,
} from '../core/index.js';
import { BayFighterComponent } from '../escorts/index.js';
import {
    makeShip, OutfitsStateComponent, ShipComponent, shipSlotFree,
    WeaponsStateComponent,
} from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { completeEntity } from './entity_data_loader.js';
import { insertNpc, makeNpcShip, spawnFleet } from './npc_spawn_plugin.js';

/**
 * Max Ships In System (ship/ship_cap.ts; EVN Bible Part I: 64): while the
 * system is full, the simulation adds no ship of its own (an NPC, a fleet,
 * a planet's defender, a bay fighter), and a refused bay launch keeps its
 * fighter in the bay.
 */

const CARRIER_ID = 'test:carrier';
const FIGHTER_SHIP_ID = 'test:fighterShip';
const FILLER_ID = 'test:filler';
const BAY_ID = 'test:bay';
const BAY_OUTFIT_ID = 'test:bayOutfit';
const FIGHTER_ID = 'test:fighter';
const CARRIER_UUID = 'carrier';

async function makeTestWorld(rule: LimitsRule) {
    const gameData = new MockGameData();
    const bay: BayWeaponData = {
        ...getDefaultBayWeaponData(),
        id: BAY_ID,
        shipID: FIGHTER_SHIP_ID,
        ammoType: ['weapon', BAY_ID],
        maxAmmo: 10,
        fireGroup: 'secondary',
        reload: 1,
    };
    gameData.data.Weapon.map.set(BAY_ID, bay);
    gameData.data.Outfit.map.set(BAY_OUTFIT_ID, {
        ...getDefaultOutfitData(),
        id: BAY_OUTFIT_ID,
        weapons: { [BAY_ID]: 1 },
    });
    gameData.data.Outfit.map.set(FIGHTER_ID, {
        ...getDefaultOutfitData(),
        id: FIGHTER_ID,
        ammoFor: BAY_ID,
    });
    for (const id of [FIGHTER_SHIP_ID, FILLER_ID]) {
        gameData.data.Ship.map.set(id, { ...getDefaultShipData(), id });
    }
    const carrierData: ShipData = {
        ...getDefaultShipData(),
        id: CARRIER_ID,
        outfits: { [BAY_OUTFIT_ID]: 1, [FIGHTER_ID]: 5 },
        physics: { ...getDefaultShipPhysics() },
    };
    gameData.data.Ship.map.set(CARRIER_ID, carrierData);

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });
    applyRoomRules(world, { limits: rule });
    const carrier = makeShip(carrierData);
    carrier.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(0, 0),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
    await completeEntity(world, carrier);
    world.entities.set(CARRIER_UUID, carrier);
    await stepWorld(world, 2);
    return { world, carrier, gameData };
}

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function ships(world: World) {
    return [...world.entities.values()]
        .filter(entity => entity.components.has(ShipComponent)).length;
}

/** Parks plain hulls far off until the system holds `total` ships. */
async function fillTo(world: World, gameData: MockGameData, total: number) {
    const fillers: string[] = [];
    for (let i = 0; ships(world) < total; i++) {
        const filler = makeShip(gameData.data.Ship.map.get(FILLER_ID)!);
        filler.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(3000 + 40 * i, 3000),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        await completeEntity(world, filler);
        world.entities.set(`filler ${i}`, filler);
        fillers.push(`filler ${i}`);
    }
    return fillers;
}

function fighters(world: World) {
    return [...world.entities.values()]
        .filter(entity => entity.components.has(BayFighterComponent)).length;
}

function bayAmmo(carrier: Entity) {
    return carrier.components.get(OutfitsStateComponent)?.get(FIGHTER_ID)
        ?.count ?? 0;
}

function setFiring(carrier: Entity, firing: boolean) {
    carrier.components.get(WeaponsStateComponent)!.get(BAY_ID)!.firing = firing;
}

describe('the system ship cap', () => {
    for (const rule of ['original', 'novajs'] as const) {
        const cap = ENGINE_LIMITS[rule].ships;
        describe(`under the ${rule} rule (${cap} ships)`, () => {
            it('refuses a bay launch while full and keeps the fighter in '
                + 'the bay; launches once a slot frees', async () => {
                    const { world, carrier, gameData } =
                        await makeTestWorld(rule);
                    const fillers = await fillTo(world, gameData, cap);
                    expect(shipSlotFree(world)).toBeFalse();
                    setFiring(carrier, true);
                    await stepWorld(world, 20);
                    expect(fighters(world)).toBe(0);
                    expect(bayAmmo(carrier)).toBe(5);
                    // One ship leaves: exactly one fighter takes its slot.
                    world.entities.delete(fillers[0]);
                    await stepWorld(world, 20);
                    setFiring(carrier, false);
                    expect(fighters(world)).toBe(1);
                    expect(bayAmmo(carrier)).toBe(4);
                    expect(ships(world)).toBe(cap);
                });

            it('refuses an NPC, and a whole fleet whose lead is refused',
                async () => {
                    const { world, gameData } = await makeTestWorld(rule);
                    await fillTo(world, gameData, cap - 1);
                    const data = gameData.data.Ship.map.get(FILLER_ID)!;
                    const npc = () => makeNpcShip(data, 1, null,
                        new Position(0, 0), new Angle(0), new Vector(0, 0));
                    expect(insertNpc(world, gameData, 'npc a', npc()))
                        .toBeTrue();
                    expect(insertNpc(world, gameData, 'npc b', npc()))
                        .toBeFalse();
                    expect(world.entities.has('npc b')).toBeFalse();
                    const fleet = spawnFleet(world, gameData,
                        new IdFactory('test'), new Random(1), {
                            leadShip: FILLER_ID,
                            escorts: [{ id: FILLER_ID, min: 3, max: 3 }],
                            govt: null,
                        }, data, {
                            position: new Position(0, 0),
                            rotation: new Angle(0),
                            velocity: new Vector(0, 0),
                        });
                    expect(fleet).toEqual([]);
                    expect(ships(world)).toBe(cap);
                });

            it('lets a fleet in up to the cap, escorts and all', async () => {
                const { world, gameData } = await makeTestWorld(rule);
                await fillTo(world, gameData, cap - 2);
                const data = gameData.data.Ship.map.get(FILLER_ID)!;
                const fleet = spawnFleet(world, gameData,
                    new IdFactory('test'), new Random(1), {
                        leadShip: FILLER_ID,
                        escorts: [{ id: FILLER_ID, min: 3, max: 3 }],
                        govt: null,
                    }, data, {
                        position: new Position(0, 0),
                        rotation: new Angle(0),
                        velocity: new Vector(0, 0),
                    });
                // The lead and one escort fit; the other two are refused.
                expect(fleet.length).toBe(2);
                expect(ships(world)).toBe(cap);
            });
        });
    }
});
