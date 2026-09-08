/**
 * core: the simulation's foundation, with no game rules of its own.
 *
 * Game-data access and staging primitives (SimulationGameDataResource,
 * provideFromCache, the entity factory, the id factory, load retry), the
 * platform and system-id resources, creation time and the return-to-queue
 * marker, animation and collision plumbing, sound events, the control
 * input layer (control actions, ControlsPlugin, the control-state event),
 * and the leaf value modules every other domain reads (Stat, govt and
 * landable flags, display names). Also `Domain`, the descriptor each
 * domain's index exports.
 *
 * Depends on nothing inside nova_plugin.
 */
export * from './provide_from_cache.js';
export * from './collision_interaction.js';
export * from './game_data_resource.js';
export * from './game_data_ref.js';
export * from './collisions_plugin.js';
export * from './projectile_data.js';
export * from './animation_plugin.js';
export * from './controls.js';
export * from './control_state_event.js';
export * from './platform_plugin.js';
export * from './controls_plugin.js';
export * from './create_time.js';
export * from './display_name.js';
export * from './domain.js';
export * from './entity_factory.js';
export * from './govt_component.js';
export * from './id_factory.js';
export * from './landable.js';
export * from './load_retry.js';
export * from './return_to_queue_plugin.js';
export * from './sound_plugin.js';
export * from './stat.js';
export * from './system_id_resource.js';
export * from './systems_resource.js';

import { Domain, domainPlugin } from './domain.js';
import { TimePlugin } from 'nova_ecs/plugins/time_plugin';
import { DeltaPlugin } from 'nova_ecs/plugins/delta_plugin';
import { MovementPlugin } from 'nova_ecs/plugins/movement_plugin';
import { CreateTimePlugin } from './create_time.js';
import { ReturnToQueuePlugin } from './return_to_queue_plugin.js';
import { PlatformPlugin } from './platform_plugin.js';
import { AnimationPlugin } from './animation_plugin.js';
import { ControlsPlugin } from './controls_plugin.js';
import { CollisionsPlugin } from './collisions_plugin.js';
import { SoundEventPlugin } from './sound_plugin.js';

export const CoreDomain: Domain = {
    name: 'core',
    dependsOn: [],
    plugins: [TimePlugin, CreateTimePlugin, ReturnToQueuePlugin, PlatformPlugin, DeltaPlugin, AnimationPlugin, ControlsPlugin, MovementPlugin, CollisionsPlugin, SoundEventPlugin],
};
export const CoreDomainPlugin = domainPlugin(CoreDomain);
