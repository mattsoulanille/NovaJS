/**
 * pilot: the player across worlds.
 *
 * Saved games (pilot files), carrying the player's entities into a fresh
 * system world, and the debug cheats that poke at player state. Named
 * `session` when the sub-plugins wave carved it out; renamed by ruling
 * #252 once that wave had merged (a move, nothing else).
 */
export * from './debug_cheat_plugin.js';
export * from './save_game.js';
export * from './save_migrations.js';
export * from './transition_prep.js';

import { Domain, domainPlugin } from '../core/index.js';
import { DebugCheatPlugin } from './debug_cheat_plugin.js';

export const PilotDomain: Domain = {
    name: 'pilot',
    dependsOn: ['combat', 'core', 'escorts', 'ncb', 'npc', 'player', 'reputation', 'ship', 'travel'],
    plugins: [DebugCheatPlugin],
};
export const PilotDomainPlugin = domainPlugin(PilotDomain);
