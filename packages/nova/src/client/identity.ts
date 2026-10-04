/**
 * ============================================================================
 * The client's held fleet follows the CURRENT connection (#354)
 * ============================================================================
 *
 * The server assigns a peer uuid per socket, so a reconnect (a network
 * drop, a server restart with a tab in the game) changes
 * `communicator.uuid` mid-game. What lives in the simulation is the
 * worker's business: the bridge host re-enters the room and re-stamps the
 * fleet it holds there (simulation_bridge_host.ts reenter). What the CLIENT
 * holds out of the simulation is re-stamped here, at once, so nothing it
 * puts back later carries the old id: the docked hull (and the entity about
 * to lift off), the carried player of a transit in progress, and the escort
 * rosters (landed, jumping, lost). Every insertion path also stamps the
 * current id as it inserts (fleet_insertion.ts, landed_escorts.ts), so this
 * is the held state agreeing with what it will become, not the only line of
 * defence.
 */
import type { Entity } from 'nova_ecs/entity';
import { Observable, pairwise, Subscription } from 'rxjs';
import { restampEntity } from '../communication/peer_identity.js';
import type { ClientState } from './client_state.js';
import { dockedShip, launchingEntity } from './client_state.js';
import type { FleetLedger } from './fleet_ledger.js';

/** Every entity the client holds out of the simulation that it owns. */
export function heldFleetEntities(state: ClientState, fleet: FleetLedger):
    Entity[] {
    const held = new Set<Entity>();
    const docked = dockedShip(state)?.entity;
    if (docked) {
        held.add(docked);
    }
    const launching = launchingEntity(state);
    if (launching) {
        held.add(launching);
    }
    if (state.kind === 'transit') {
        held.add(state.transit.entity);
    }
    for (const roster of fleet.rosters) {
        for (const row of roster) {
            held.add(row.entity);
        }
    }
    return [...held];
}

/**
 * Re-stamps everything the client holds from `from` (a uuid this client
 * held before) to `to`. Returns how many entities changed.
 */
export function restampHeldFleet(state: ClientState, fleet: FleetLedger,
    from: string, to: string): number {
    let changed = 0;
    for (const entity of heldFleetEntities(state, fleet)) {
        if (restampEntity(entity, id => id === from, to)) {
            changed++;
        }
    }
    return changed;
}

/**
 * Re-stamps the held fleet on every identity change for as long as the
 * returned subscription lives (a game session).
 */
export function followIdentity(identity: Observable<string | undefined>,
    state: () => ClientState, fleet: FleetLedger): Subscription {
    return identity.pipe(pairwise()).subscribe(([from, to]) => {
        if (from === undefined || to === undefined || from === to) {
            return;
        }
        const changed = restampHeldFleet(state(), fleet, from, to);
        console.info(`Reconnected under a new peer id; re-stamped ${changed} `
            + 'held entit' + (changed === 1 ? 'y' : 'ies') + '.');
    });
}
