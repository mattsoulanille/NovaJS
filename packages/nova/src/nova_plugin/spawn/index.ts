/**
 * spawn: entities entering a system.
 *
 * Entity staging (entity_data_loader: loading a ship's, planet's or
 * asteroid's game data before it is inserted), NPC traffic spawning from
 * sÿst dude tables and flëets, pers (named persons), and a system's
 * reinforcement fleet (sÿst ReinfFleet).
 */
export * from './entity_data_loader.js';
export * from './pers_plugin.js';
export * from './npc_spawn_plugin.js';
export * from './spawn_bits.js';
export * from './reinforcements.js';

import { Domain, domainPlugin } from '../core/index.js';
import { PersPlugin } from './pers_plugin.js';
import { NpcSpawnPlugin } from './npc_spawn_plugin.js';
import { ReinforcementsPlugin } from './reinforcements.js';

export const SpawnDomain: Domain = {
    name: 'spawn',
    dependsOn: ['combat', 'core', 'ncb', 'npc', 'player', 'reputation',
        'ship', 'travel'],
    plugins: [PersPlugin, NpcSpawnPlugin, ReinforcementsPlugin],
};
export const SpawnDomainPlugin = domainPlugin(SpawnDomain);
