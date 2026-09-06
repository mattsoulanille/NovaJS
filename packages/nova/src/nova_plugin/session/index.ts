/**
 * session: the player across worlds.
 *
 * Saved games (pilot files), carrying the player's entities into a fresh
 * system world, and the debug cheats that poke at player state.
 */
export * from './debug_cheat_plugin.js';
export * from './save_game.js';
export * from './transition_prep.js';

import { Domain, domainPlugin } from '../core/index.js';
import { DebugCheatPlugin } from './debug_cheat_plugin.js';

export const SessionDomain: Domain = {
    name: 'session',
    dependsOn: ['combat', 'core', 'escorts', 'ncb', 'npc', 'player', 'reputation', 'ship', 'travel'],
    plugins: [DebugCheatPlugin],
};
export const SessionDomainPlugin = domainPlugin(SessionDomain);
