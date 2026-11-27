import { GetEntity, GetWorld } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import {
    SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import {
    MissionSetString, owedMissionSetString,
} from '../nova_plugin/missions/index.js';
import {
    MissionsComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildMissionSetString } from '../spaceport/ship_mission_accept.js';

/**
 * A mission's OnShipDone or in-flight OnFailure on its way to the
 * simulation bridge (game_session.ts -> bridge.missionSetString): the
 * `missionSetString` input record (missions/mission_set_string_record.ts).
 */
export const MissionSetStringEvent = new EcsEvent<{
    record: MissionSetString,
}>('MissionSetStringEvent');

/**
 * How long a sent string may stay owed before it is sent again (ms, wall
 * clock: display bookkeeping, never simulation state). A record normally
 * pays its debt within a round trip; one lost with a closed bridge is
 * sent again, and a duplicate is harmless (the apply pays a debt once).
 * The same rule as STELLAR_SET_STRING_RESEND_MS.
 */
export const MISSION_SET_STRING_RESEND_MS = 3000;

/** The owed string (by kind and mission) this display world last sent,
 * and when. */
export interface MissionSetStringSent {
    key?: string;
    at: number;
}
export const MissionSetStringSentResource =
    new Resource<MissionSetStringSent>('MissionSetStringSent');

/**
 * Runs the local pilot's mïsn OnShipDone the moment its special ships'
 * goal completes, and its OnFailure the moment the simulation fails it,
 * IN FLIGHT (MEASURED, reference "OnShipDone and an in-flight OnFailure,
 * read by a person's hail (the SD / SF leftover), wave 48"; see
 * missions/mission_set_string_record.ts): the next owed string
 * (owedMissionSetString: OnShipDones first, then failures, each by
 * mission id) is resolved against a detached copy of the pilot's mirror
 * (spaceport/ship_mission_accept.ts buildMissionSetString) and sent as a
 * `missionSetString` record. One at a time, so each string runs against
 * the state the previous one left, as the date advance runs them.
 *
 * Player-local: PlayerShipSelector is this client's own ship, so only the
 * owner sends. The date advance stays the fallback for a string that
 * never went out (the pilot jumped or landed first).
 */
export const MissionSetStringSystem = new System({
    name: 'MissionSetStringSystem',
    args: [MissionSetStringSentResource, SimulationGameDataResource,
        PlayerShipSelector, MissionsComponent, GetEntity, GetWorld] as const,
    step(sent, gameData, _player, missions, entity, world) {
        const owed = owedMissionSetString(missions);
        if (!owed) {
            sent.key = undefined;
            return;
        }
        const key = `${owed.kind} ${owed.missionId}`;
        const now = performance.now();
        if (sent.key === key && now - sent.at < MISSION_SET_STRING_RESEND_MS) {
            return;
        }
        sent.key = key;
        sent.at = now;
        const systemId = world.resources.get(SystemIdResource);
        void buildMissionSetString(entity, owed, gameData,
            MissionUniverse.shared(gameData), { systemId })
            .then(record => {
                if (record) {
                    world.emit(MissionSetStringEvent, { record });
                }
            }).catch(e => {
                console.warn(`The ${owed.kind === 'shipDone'
                    ? 'OnShipDone' : 'OnFailure'} of ${owed.missionId} `
                    + 'could not be resolved:', e);
            });
    },
});

export const MissionSetStringPlugin: Plugin = {
    name: 'MissionSetStringPlugin',
    build(world) {
        world.resources.set(MissionSetStringSentResource, { at: 0 });
        world.addSystem(MissionSetStringSystem);
    },
    remove(world) {
        world.removeSystem(MissionSetStringSystem);
        world.resources.delete(MissionSetStringSentResource);
    },
};
