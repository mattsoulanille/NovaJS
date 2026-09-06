/**
 * escorts: ships that answer to the player.
 *
 * Player escorts (ownership, payroll, following through jumps and
 * gates), escort commands and their propagation, escort actions from the
 * landed UI, the escort cap, and carrier bays (launching and recovering
 * fighters, which are escorts of their carrier).
 */
export * from './bay_plugin.js';
export * from './escort_command_plugin.js';
export * from './escort_action.js';
export * from './escort_cap.js';
export * from './player_escort_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { BayPlugin } from './bay_plugin.js';
import { EscortCommandPlugin } from './escort_command_plugin.js';
import { PlayerEscortPlugin } from './player_escort_plugin.js';

export const EscortsDomain: Domain = {
    name: 'escorts',
    dependsOn: ['combat', 'core', 'ncb', 'npc', 'player', 'reputation', 'ship', 'travel'],
    plugins: [BayPlugin, EscortCommandPlugin, PlayerEscortPlugin],
};
export const EscortsDomainPlugin = domainPlugin(EscortsDomain);
