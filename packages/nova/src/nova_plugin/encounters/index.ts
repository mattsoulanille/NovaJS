/**
 * encounters: what happens between two ships up close.
 *
 * Hailing (bribes, assistance requests, comm responses), ship disabling
 * and repair, boarding (plunder, capture, escort conversion), and a
 * stellar's tribute (Demand Tribute, its defence fleet, domination).
 *
 * Sits above `escorts` because a capture becomes an escort.
 */
export * from './boarding_plugin.js';
export * from './disabled_plugin.js';
export * from './hail_plugin.js';
export * from './rescue_board.js';
export * from './tribute.js';

import { Domain, domainPlugin } from '../core/index.js';
import { HailPlugin } from './hail_plugin.js';
import { DisabledPlugin } from './disabled_plugin.js';
import { BoardingPlugin } from './boarding_plugin.js';

export const EncountersDomain: Domain = {
    name: 'encounters',
    dependsOn: ['combat', 'core', 'escorts', 'ncb', 'npc', 'player', 'reputation', 'ship', 'spawn', 'travel'],
    plugins: [HailPlugin, DisabledPlugin, BoardingPlugin],
};
export const EncountersDomainPlugin = domainPlugin(EncountersDomain);
