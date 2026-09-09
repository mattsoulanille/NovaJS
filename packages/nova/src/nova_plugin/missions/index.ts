/**
 * missions: the mission machinery.
 *
 * Availability, offer, accept/refuse, cargo, set strings, transitions,
 * landing processing, map marks and pay (the mission_* modules), the
 * special-ship goal systems (MissionShipPlugin) and spawning, mission
 * text, and cröns.
 */
export * from './mission_ids.js';
// In dependency order (ids -> stellar -> context -> machinery -> the
// machinery's users), so the index evaluates each module only after the
// modules it imports — the orientation the whole domain loads in (#266).
export * from './mission_stellar.js';
export * from './mission_context.js';
export * from './mission_machinery.js';
export * from './mission_auto_abort.js';
// Explicit so `freeCargoSpace` (the MissionWorkingState one) does not
// collide with economy's freeCargoSpace(TradeWorkingState) for a module
// importing both domains; every other export keeps its name.
export {
    STANDARD_CARGO_NAMES, cargoName, missionCargoKey, loadMissionCargo,
    unloadMissionCargo, freeCargoSpace as missionFreeCargoSpace,
} from './mission_cargo.js';
export * from './mission_availability.js';
export * from './mission_ship_logic.js';
export * from './mission_offer.js';
export * from './mission_payval.js';
export * from './mission_map_marks.js';
export * from './mission_set_strings.js';
export * from './mission_accept_offer.js';
export * from './mission_transitions.js';
export * from './mission_landing.js';
export * from './cron_logic.js';
export * from './mission_accept.js';
export * from './mission_ship_plugin.js';
export * from './mission_ship_spawn.js';
export * from './mission_text.js';

import { Domain, domainPlugin } from '../core/index.js';
import { MissionShipPlugin } from './mission_ship_plugin.js';

export const MissionsDomain: Domain = {
    name: 'missions',
    dependsOn: ['combat', 'core', 'escorts', 'ncb', 'npc', 'player', 'reputation', 'ship', 'spawn'],
    plugins: [MissionShipPlugin],
};
export const MissionsDomainPlugin = domainPlugin(MissionsDomain);
