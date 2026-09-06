import { World } from 'nova_ecs/world';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { Entity } from 'nova_ecs/entity';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    DisplayAssetDataResource,
    SimulationGameDataResource,
} from '../nova_plugin/core/game_data_resource.js';
import {
    DEFAULT_MISSILE_GUIDANCE,
    MissileGuidanceResource,
} from '../nova_plugin/combat/guidance.js';
import { IdFactory, IdFactoryResource } from '../nova_plugin/core/id_factory.js';
import { AsyncSystemResource } from 'nova_ecs/async_system';
import { SystemIdResource } from '../nova_plugin/core/system_id_resource.js';
import { SystemPlugin } from '../nova_plugin/system_plugin.js';

/**
 * Runs a freshly-bought ship entity through a throwaway "outfit builder"
 * world so its outfits' providers populate the entity's components before
 * the spaceport adopts it as the docked input.
 *
 * The world mirrors the resource set make_system.ts primes before
 * addPlugin(SystemPlugin): every resource a SystemPlugin system REQUIRES
 * must be present or addSystem throws during addPlugin — and since this
 * runs inside the shipyard's post-purchase handler, that throw kills the
 * handler (the spaceport never adopts the new ship and the controls stay
 * unbound; shipped bug — MissileGuidance was added to make_system in
 * 2026-07 without being mirrored here, breaking every ship purchase).
 * When adding a required resource to make_system.ts, add it here too;
 * ship_build_world_test.ts pins that this function keeps working.
 *
 * Determinism note: this scratch world only computes ship stats and is
 * discarded, so the fixed Random seed is fine.
 */
export async function runShipBuildWorld(ship: Entity,
    simulationData: SimulationGameDataInterface,
    displayAssets: DisplayAssetDataInterface): Promise<void> {
    const shipBuildWorld = new World('outfit builder');
    shipBuildWorld.resources.set(SimulationGameDataResource, simulationData);
    shipBuildWorld.resources.set(DisplayAssetDataResource, displayAssets);
    shipBuildWorld.resources.set(SystemIdResource, 'nova:128');
    shipBuildWorld.resources.set(RandomResource, new Random(0));
    shipBuildWorld.resources.set(IdFactoryResource, new IdFactory());
    shipBuildWorld.resources.set(MissileGuidanceResource,
        { mode: DEFAULT_MISSILE_GUIDANCE });
    await shipBuildWorld.addPlugin(SystemPlugin);
    shipBuildWorld.entities.set('ship', ship);
    shipBuildWorld.step();
    await shipBuildWorld.resources.get(AsyncSystemResource)?.done;
    shipBuildWorld.step();
    shipBuildWorld.entities.delete('ship');
}
