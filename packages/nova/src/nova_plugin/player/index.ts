/**
 * player: who a peer is and what it carries between systems.
 *
 * Which ship a peer controls (PlayerShipSelector, ControlledBy, the
 * control-state components and the input-apply helpers), the persisted
 * player-state components (GameDate, Credits, Missions, CronStates, the
 * pending mission notices), the mission-state value types the shared sim
 * reads (ShipObjective, MissionShipComponent, MissionEventType), system
 * discovery and its store, the calendar, and the escort-ownership
 * components (PlayerEscort, EscortCommand) that both the NPC AI and the
 * escort systems read.
 *
 * Below `ship` because a ship entity carries its controller.
 */
export * from './calendar.js';
export * from './discovery.js';
export * from './discovery_store.js';
export * from './escort_command.js';
export * from './mission_event_type.js';
export * from './mission_ship_component.js';
export * from './mission_ship_state.js';
export * from './player_escort.js';
export * from './player_ship_plugin.js';
export * from './player_state_plugin.js';
export * from './ship_control.js';

import { Domain, domainPlugin } from '../core/index.js';
import { PlayerStatePlugin } from './player_state_plugin.js';

export const PlayerDomain: Domain = {
    name: 'player',
    dependsOn: ['core'],
    plugins: [PlayerStatePlugin],
};
export const PlayerDomainPlugin = domainPlugin(PlayerDomain);
