/**
 * spawn: entities entering a system.
 *
 * Entity staging (entity_data_loader: loading a ship's, planet's or
 * asteroid's game data before it is inserted), NPC traffic spawning from
 * sÿst dude tables and flëets, and pers (named persons).
 */
export * from './entity_data_loader.js';
export * from './pers_plugin.js';
export * from './npc_spawn_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { PersPlugin } from './pers_plugin.js';
import { NpcSpawnPlugin } from './npc_spawn_plugin.js';

export const SpawnDomain: Domain = {
    name: 'spawn',
    dependsOn: ['combat', 'core', 'ncb', 'npc', 'player', 'ship', 'travel'],
    plugins: [PersPlugin, NpcSpawnPlugin],
};
export const SpawnDomainPlugin = domainPlugin(SpawnDomain);
