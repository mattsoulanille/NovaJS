/**
 * npc: non-player ships' minds.
 *
 * The NpcComponent and formation state, the legacy follow/shoot/death AI
 * (NpcPlugin), the decision/steering/fire-control/formation/departure/
 * plunder systems behind NpcAiPlugin, the system-hold component that pins
 * a ship in its system, and the assisting-hail component.
 */
export * from './hail_component.js';
export * from './npc_component.js';
export * from './npc_formation.js';
export * from './npc_plunder.js';
export * from './npc_targeting.js';
export * from './system_hold.js';
export * from './npc_decision.js';
export * from './npc_fire_control.js';
export * from './npc_formation_system.js';
export * from './npc_departure.js';
export * from './npc_steering.js';
export * from './npc_plunder_board.js';
export * from './npc_ai_plugin.js';
export * from './npc_plugin.js';

import { Domain, domainPlugin } from '../core/index.js';
import { NpcPlugin } from './npc_plugin.js';
import { NpcAiPlugin } from './npc_ai_plugin.js';

export const NpcDomain: Domain = {
    name: 'npc',
    dependsOn: ['core', 'ncb', 'player', 'reputation', 'ship', 'travel'],
    plugins: [NpcPlugin, NpcAiPlugin],
};
export const NpcDomainPlugin = domainPlugin(NpcDomain);
