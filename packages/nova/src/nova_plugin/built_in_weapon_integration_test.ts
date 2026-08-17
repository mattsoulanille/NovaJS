import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { getPluginGameData } from '../communication/simulation_test_fixture.js';
import { completeEntity } from './entity_data_loader.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { ShootAllWeaponsComponent } from './npc_plugin.js';
import { TargetComponent } from './target_component.js';
import { WeaponsStateComponent } from './weapons_state.js';

/**
 * A ship's stock armament is a list of wëap ids — "the next twelve fields
 * tell Nova which stock weapons to put on your ship" (EVN Bible ~:2382) —
 * and an oütf exists only so a weapon can be BOUGHT at an outfitter.
 * NovaJS derives a ship's weapons from its outfits, so a weapon no oütf
 * provides used to be dropped during ship parsing and the ship flew
 * unarmed.
 *
 * The Planet Rico plug-in is where Matthew hit this: its Swarmer
 * (shïp 416) is a launched fighter carrying wëap 236 "Swarmer Discharge",
 * a weapon the plug-in never made purchasable. There is an oütf for the
 * Swarmer BAY and for the Swarmer's ammunition, but none granting the
 * discharge itself — so the swarmers flew and never fired. Nothing in
 * stock Nova Files hits this path, which is why it survived so long.
 */
describe('a built-in weapon that no oütf provides', () => {
    const PLUGIN = 'Planet Rico';
    const SWARMER = `${PLUGIN}:416`;
    const DISCHARGE = `${PLUGIN}:236`;
    /** Ver'ashan: asteroid-free, so nothing but the ships is in flight. */
    const SYSTEM = 'nova:226';

    async function ricoData() {
        return getPluginGameData(PLUGIN);
    }

    it('is mounted on the ship that comes with it', async () => {
        const gameData = await ricoData();
        if (!gameData) {
            pending('Planet Rico plug-in not installed');
            return;
        }
        const ship = await gameData.data.Ship.get(SWARMER);
        const granting = await Promise.all(
            Object.keys(ship.outfits).map(id => gameData.data.Outfit.get(id)));
        const mounts = granting.filter(o => DISCHARGE in o.weapons);
        expect(mounts.length)
            .withContext(`${SWARMER} mounts ${DISCHARGE}`).toBe(1);
        expect(mounts[0].builtIn)
            .withContext('through an implicit built-in outfit').toBeTrue();
        // Part of the hull: it costs nothing, weighs nothing, and the
        // player is never offered it.
        expect(mounts[0].price).toBe(0);
        expect(mounts[0].physics.freeMass).toBe(0);
        expect(mounts[0].cantSell).toBeTrue();
        expect((await gameData.ids).Outfit)
            .withContext('and is not in the outfit catalogue')
            .not.toContain(mounts[0].id);
    }, 120_000);

    it('reaches the ship\'s weapons state', async () => {
        const gameData = await ricoData();
        if (!gameData) {
            pending('Planet Rico plug-in not installed');
            return;
        }
        const world = await makeSystem(SYSTEM, gameData, undefined,
            { npcs: false });
        const swarmer = await addSwarmer(world, gameData, 'swarmer', 0, 0);
        expect([...swarmer.components.get(WeaponsStateComponent)?.keys() ?? []])
            .toContain(DISCHARGE);
        expect(swarmer.components.get(WeaponsStateComponent)?.get(DISCHARGE)
            ?.count).toBe(1);
    }, 120_000);

    it('actually fires', async () => {
        const gameData = await ricoData();
        if (!gameData) {
            pending('Planet Rico plug-in not installed');
            return;
        }
        const world = await makeSystem(SYSTEM, gameData, undefined,
            { npcs: false });
        const swarmer = await addSwarmer(world, gameData, 'swarmer', 0, 0);
        await addSwarmer(world, gameData, 'victim', 0, 400);

        // Let the providers attach before anything shoots.
        for (let i = 0; i < 20; i++) {
            world.step();
        }
        const before = new Set(world.entities.keys());

        swarmer.components.set(TargetComponent, { target: 'victim' });
        swarmer.components.set(ShootAllWeaponsComponent, undefined);
        for (let i = 0; i < 60; i++) {
            world.step();
        }

        const spawned = [...world.entities.keys()]
            .filter(uuid => !before.has(uuid));
        expect(spawned.length)
            .withContext('the Swarmer spawned at least one shot')
            .toBeGreaterThan(0);
    }, 120_000);

    async function addSwarmer(world: World,
        gameData: NonNullable<Awaited<ReturnType<typeof ricoData>>>,
        uuid: string, x: number, y: number): Promise<Entity> {
        const ship = makeShip(await gameData.data.Ship.get(SWARMER));
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(world, ship);
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        world.entities.set(uuid, ship);
        return ship;
    }
});
