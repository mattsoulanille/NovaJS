import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { restockEscortEntity, RestockGameData } from '../../spaceport/escort_restock.js';
import { CollisionEvent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { ControlledByComponent, EscortCommandComponent } from '../player/index.js';
import {
    makeShip, OutfitsStateComponent, ShipComponent, SourceComponent,
    WeaponsStateComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { BayFighterComponent } from './bay_plugin.js';

/**
 * ============================================================================
 * Docking and landing refill to the ship VARIANT's own loadout (real data)
 * ============================================================================
 *
 * Matthew (2026-11-27): "Docking an escort with ammo (including fighters)
 * should replenish the ammo", and "full" means the shïp resource's own
 * stock loadout, the amounts it spawns with, not the most its magazines
 * could hold: "a Fed Viper should come back with 6 IR missiles, not 200".
 * Landing with the player refills to the same amounts.
 *
 * The stock bay craft that carry IR missiles (oütf nova:135, Max 200):
 *   - the Fed Anaconda (shïp nova:145, 6 IR missiles), from the Fed
 *     Carrier's (nova:143) Anaconda Bay (wëap nova:150);
 *   - the Pirate Viper (shïp nova:333, 10 IR missiles), from the Pirate
 *     Carrier's (nova:285) Pirate Viper Bay (wëap nova:190).
 * (The Viper Bay's own Fed Viper, nova:144, carries no missiles.)
 */
const IR_MISSILE = 'nova:135';

const CRAFT = [
    { name: 'Fed Anaconda', carrier: 'nova:143', bay: 'nova:150',
        ship: 'nova:145', stock: 6 },
    { name: 'Pirate Viper', carrier: 'nova:285', bay: 'nova:190',
        ship: 'nova:333', stock: 10 },
] as const;

function park(entity: Entity, x: number, y: number) {
    entity.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(x, y),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });
}

async function step(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function missiles(entity: Entity): number | undefined {
    return entity.components.get(OutfitsStateComponent)?.get(IR_MISSILE)
        ?.count;
}

/** The player's carrier fires `bay` once; returns the craft it launched. */
async function launch(world: World, carrier: Entity, bay: string) {
    const before = new Set(world.entities.keys());
    const weapon = carrier.components.get(WeaponsStateComponent)!.get(bay)!;
    weapon.firing = true;
    let found: [string, Entity] | undefined;
    // Long enough for the bay's own reload between the two launches.
    for (let i = 0; i < 400 && !found; i++) {
        await step(world, 1);
        found = [...world.entities].find(([uuid, entity]) =>
            !before.has(uuid)
            && entity.components.get(BayFighterComponent)?.bayWeaponId === bay
            && entity.components.get(SourceComponent) === 'player');
    }
    weapon.firing = false;
    expect(found).withContext('a craft launched').toBeDefined();
    // Wait for its outfits to derive from its ShipData.
    for (let i = 0; i < 10 && missiles(found![1]) === undefined; i++) {
        await step(world, 1);
    }
    return found!;
}

describe('docking refills a bay craft to its variant\'s stock (real data)',
    () => {
        for (const craft of CRAFT) {
            for (const spent of [0, 1, 200]) {
                it(`${craft.name}: docked with ${spent} IR missiles, `
                    + `relaunches with its ${craft.stock}`, async () => {
                    const gameData = await getIntegrationGameData();
                    const world = await makeSystem('nova:226', gameData,
                        undefined, { npcs: false });
                    const carrier = makeShip(
                        await gameData.data.Ship.get(craft.carrier));
                    carrier.components.set(ControlledByComponent,
                        { peerId: 'p' });
                    await completeEntity(world, carrier);
                    park(carrier, 0, 0);
                    world.entities.set('player', carrier);
                    await step(world, 2);

                    const [uuid, fighter] = await launch(world, carrier,
                        craft.bay);
                    expect(fighter.components.get(ShipComponent)?.id)
                        .toBe(craft.ship);
                    expect(missiles(fighter)).toBe(craft.stock);

                    // It fires (or, at 200, somehow carries more than its
                    // stock) and comes home.
                    fighter.components.get(OutfitsStateComponent)!
                        .get(IR_MISSILE)!.count = spent;
                    fighter.components.set(EscortCommandComponent,
                        { command: 'returnToBay' });
                    await step(world, 2);
                    world.emit(CollisionEvent,
                        { other: 'player', initiator: true }, [uuid]);
                    await step(world, 1);
                    expect(world.entities.has(uuid)).toBeFalse();

                    const [, relaunched] = await launch(world, carrier,
                        craft.bay);
                    expect(missiles(relaunched)).toBe(craft.stock);
                }, 60_000);
            }
        }
    });

describe('landing refills a hired escort to its variant\'s stock (real data)',
    () => {
        for (const craft of CRAFT) {
            for (const spent of [0, 1, 200]) {
                it(`${craft.name}: landed with ${spent} IR missiles, lifts `
                    + `off with its ${craft.stock}`, async () => {
                    const gameData = await getIntegrationGameData();
                    const lookups: RestockGameData = {
                        getOutfit: id => gameData.data.Outfit.get(id),
                        getWeapon: id => gameData.data.Weapon.get(id),
                        getShip: id => gameData.data.Ship.get(id),
                    };
                    const shipData = await gameData.data.Ship.get(craft.ship);
                    const escort = new Entity('escort');
                    escort.components.set(ShipComponent, { id: craft.ship });
                    escort.components.set(OutfitsStateComponent, new Map(
                        Object.entries(shipData.outfits).map(([id, count]) =>
                            [id, { count: id === IR_MISSILE ? spent : count }])));
                    await restockEscortEntity(escort, lookups);
                    expect(missiles(escort)).toBe(craft.stock);
                }, 60_000);
            }
        }
    });
