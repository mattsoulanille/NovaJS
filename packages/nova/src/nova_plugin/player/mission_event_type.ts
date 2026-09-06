import * as t from 'io-ts';
import { openEnum } from '../../common/open_enum.js';

/**
 * What a mission event IS — the discriminator of the UI-facing MissionEvent
 * (mission_machinery.ts) and of the PendingMissionNotice a mid-flight event
 * is parked as on the player entity until the next landing
 * (player_state_plugin.ts). One leaf module, so both the working-state
 * shapes and the serialized player-state codec can name it without an
 * import cycle.
 *
 * OPEN on the wire (openEnum): the notice codec was always a plain string,
 * so a save or baseline from a newer build carrying an event type this
 * build does not know still loads; every reader (checkpoint_requests'
 * missionEventLabel, the landing popups) keeps a default arm for it.
 */
export const MissionEventTypeType = openEnum('MissionEventType', [
    'completed', 'failed', 'aborted', 'accepted', 'autoAborted',
    'shipDone', 'cargoLoaded', 'cargoDropped',
] as const);
export type MissionEventType = t.TypeOf<typeof MissionEventTypeType>;
