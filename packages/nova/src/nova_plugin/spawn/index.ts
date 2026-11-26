/**
 * spawn: entities entering a system.
 *
 * Entity staging (entity_data_loader: loading a ship's, planet's or
 * asteroid's game data before it is inserted), NPC traffic spawning from
 * sÿst dude tables and flëets, pers (named persons), and a system's
 * reinforcement fleet (sÿst ReinfFleet), and a stellar's defence fleet
 * (spöb DefenseDude, launched by a demand for tribute).
 */
export * from './entity_data_loader.js';
export * from './pers_plugin.js';
export * from './npc_spawn_plugin.js';
export * from './spawn_bits.js';
export * from './reinforcements.js';
export * from './defense_fleet_system.js';

import { Domain, domainPlugin } from '../core/index.js';
import { PersPlugin } from './pers_plugin.js';
import { NpcSpawnPlugin } from './npc_spawn_plugin.js';
import { ReinforcementsPlugin } from './reinforcements.js';
import { DefenseFleetPlugin } from './defense_fleet_system.js';

export const SpawnDomain: Domain = {
    name: 'spawn',
    dependsOn: ['combat', 'core', 'ncb', 'npc', 'player', 'reputation',
        'ship', 'travel'],
    plugins: [PersPlugin, NpcSpawnPlugin, ReinforcementsPlugin,
        DefenseFleetPlugin],
};
export const SpawnDomainPlugin = domainPlugin(SpawnDomain);
