import { GetEntity, GetWorld } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import {
    DisplayAssetDataResource, SimulationGameDataResource, SystemIdResource,
} from '../nova_plugin/core/index.js';
import { emptySetStringRequests } from '../spaceport/set_string_requests.js';
import { presentSetStringRequests } from './set_string_display.js';
import type { StellarSetString } from '../nova_plugin/encounters/index.js';
import {
    PendingStellarSetString, PendingStellarSetStringsComponent,
    PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { buildStellarSetString } from '../spaceport/ship_mission_accept.js';

/**
 * A stellar's OnDominate / OnRelease on its way to the simulation bridge
 * (game_session.ts -> bridge.stellarSetString): the `stellarSetString`
 * input record (encounters/tribute.ts StellarSetStringType).
 */
export const StellarSetStringEvent = new EcsEvent<{
    record: StellarSetString,
}>('StellarSetStringEvent');

/**
 * How long a sent entry may stay owed before it is sent again (ms, wall
 * clock: this is display bookkeeping, never simulation state). A record
 * normally clears its entry within a round trip; one lost with a closed
 * bridge (the pilot jumped or landed under it) is sent again from the
 * next world the pilot is in. A duplicate is harmless: the apply pays
 * each entry once (player/dominated.ts takeStellarSetString).
 */
export const STELLAR_SET_STRING_RESEND_MS = 3000;

/** The owed entry (by `seq`) this display world last sent, and when. */
export interface StellarSetStringSent {
    seq?: number;
    at: number;
    /** The last entry whose Qxxx / Pxxx were shown / played. */
    presentedSeq?: number;
}
export const StellarSetStringSentResource =
    new Resource<StellarSetStringSent>('StellarSetStringSent');

/**
 * Pays the OnDominate / OnRelease the simulation owes the local pilot
 * (player/dominated.ts PendingStellarSetStringsComponent, queued the tick a
 * demand was given in to, a defence fleet fell or a stellar was released):
 * the OLDEST owed entry is resolved against a detached copy of the
 * pilot's mirror (spaceport/ship_mission_accept.ts buildStellarSetString)
 * and sent as a `stellarSetString` record. One at a time, so each string
 * runs against the state the previous one left, as the original runs them
 * in order.
 *
 * Player-local: PlayerShipSelector is this client's own ship, so only the
 * owner sends. A string that cannot be resolved (its stellar's data fails
 * to load) is still paid, empty, so the debt cannot wedge the queue.
 */
export const StellarSetStringSystem = new System({
    name: 'StellarSetStringSystem',
    args: [StellarSetStringSentResource, SimulationGameDataResource,
        PlayerShipSelector, PendingStellarSetStringsComponent, GetEntity,
        GetWorld] as const,
    step(sent, gameData, _player, owed, entity, world) {
        const entry: PendingStellarSetString | undefined = owed.pending[0];
        if (!entry) {
            return;
        }
        const now = performance.now();
        if (sent.seq === entry.seq
            && now - sent.at < STELLAR_SET_STRING_RESEND_MS) {
            return;
        }
        sent.seq = entry.seq;
        sent.at = now;
        const systemId = world.resources.get(SystemIdResource);
        void (async () => {
            let effects = {};
            const requests = emptySetStringRequests();
            try {
                const planet = await gameData.data.Planet.get(entry.planetId);
                effects = await buildStellarSetString(entity, planet,
                    entry.kind, gameData, MissionUniverse.shared(gameData), {
                        systemId, requests,
                        displayAssets:
                            world.resources.get(DisplayAssetDataResource),
                    });
            } catch (e) {
                console.warn(`The ${entry.kind === 'dominate'
                    ? 'OnDominate' : 'OnRelease'} of ${entry.planetId} `
                    + 'could not be resolved; paying it empty:', e);
            }
            world.emit(StellarSetStringEvent, {
                record: { seq: entry.seq, planetId: entry.planetId,
                    ...effects },
            });
            // Its `Qxxx` / `Pxxx` (no stock OnDominate has one), once per
            // entry however often it is resent.
            if (sent.presentedSeq !== entry.seq) {
                sent.presentedSeq = entry.seq;
                await presentSetStringRequests(world, requests, entity);
            }
        })();
    },
});

export const StellarSetStringPlugin: Plugin = {
    name: 'StellarSetStringPlugin',
    build(world) {
        world.resources.set(StellarSetStringSentResource, { at: 0 });
        world.addSystem(StellarSetStringSystem);
    },
    remove(world) {
        world.removeSystem(StellarSetStringSystem);
        world.resources.delete(StellarSetStringSentResource);
    },
};
