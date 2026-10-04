import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { playerEscortLink } from '../nova_plugin/escorts/index.js';
import {
    ControlledByComponent, MissionShipComponent, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';

/**
 * ============================================================================
 * What leaves with a departed peer, and what stays (#354, ruling 2026-10-03)
 * ============================================================================
 *
 * The maintainer's ruling for `removePeer`: the departed peer's PLAYER SHIP
 * and its ESCORTS disappear with it ("On disconnect, they should disappear
 * (escorts and player)", #201); every OTHER ship it owned "should no longer
 * be owned by that player" and stays in the room.
 *
 * A peer can own, i.e. be named by an entity's `ControlledBy.peerId` or
 * `MultiplayerData.owner` (the Trust model's ownership rule,
 * rollback_protocol.ts item 5) — every writer of either marker:
 *
 *   player ship        client/player_start.ts, client/fleet_insertion.ts
 *                      insertPlayerAndFleet (and the shipyard's hull swap,
 *                      spaceport/shipyard_rules.ts, which copies the old
 *                      hull's stamp)                          -> FLEET
 *   hired escort       client/fleet_insertion.ts buildHiredEscort,
 *                      spaceport/landed_escorts.ts (carried batches) -> FLEET
 *   captured escort    nova_plugin/encounters/boarding_plugin.ts
 *                      convertToEscort (the captor's owner)    -> FLEET
 *   bay fighter        nova_plugin/escorts/bay_plugin.ts fire (its
 *                      carrier's owner): of the player's ship or one of its
 *                      escorts -> FLEET; of anything else (a mission
 *                      carrier's wing) -> DISOWNED
 *   mission ship       client/fleet_insertion.ts (system entry) -> DISOWNED
 *                      and STRANDED (below); a ship-offered mission's ships
 *                      (client/game_session.ts AcceptShipMissionEvent)
 *                      carry no owner at all, only the tether -> STRANDED
 *   spawned NPC        simulation_bridge_host.ts spawnNpc (debug)
 *                                                              -> DISOWNED
 *   planets            nova_plugin/make_system.ts ('server', never a peer)
 *
 * FIGHTERS GO WITH THE FLEET. A fighter launched by the player or by one of
 * its escorts is the fleet's own ammunition, not a ship of its own: it
 * wears the fleet's PlayerEscort marker (MarkPlayerEscortsSystem — its
 * chain tops out at the player), the client's ledger accounts for it as
 * the fleet's (client/fleet_ledger.ts lostFighters), a re-entry re-inserts
 * it with its carrier (simulation_bridge_host.ts reenter), and left behind
 * without its carrier it would be an orphan whose round no bay will ever
 * take back. A mission carrier's wing, by the same marking rule (THE
 * MISSION-SHIP BOUNDARY, player_escort_plugin.ts), is the mission's, and
 * stays with its carrier.
 *
 * DISOWNED means `MultiplayerData` is removed: the ship becomes exactly
 * what an ordinary NPC is, an unowned world ship. There is no hand-off to
 * another PLAYER, because in a lockstep simulation nobody "hosts" a ship —
 * every peer and the server's archive simulate every unowned ship
 * identically from the same inputs. Ownership only ever decided who may
 * insert, replace or remove an entity by input record; an unowned ship is
 * one nobody may replace or remove, which is what a world ship is.
 *
 * STRANDED: a mission ship's goal machinery is tethered to its owner's
 * PLAYER SHIP (MissionShipComponent.owner, an entity uuid), and
 * MissionShipCleanupSystem deletes a mission ship whose owner's ship is
 * absent — the despawn that covers the owner jumping away or landing. So
 * that it STAYS when the owner disconnects, it is flagged
 * `ownerDisconnected` (mission_ship_component.ts): the cleanup keeps it
 * while its owner is absent, and the flag clears the moment the owner's
 * ship is back in the world — a reconnecting client re-inserts it under the
 * same entity uuid, so the mission resumes tracking its own ships.
 *
 * A pure function of synced state, decided in full before anything is
 * changed, so every world applies the same departure on the same tick.
 */
export interface PeerDeparture {
    /** The player ships and their escorts and fighters: removed. */
    fleet: string[];
    /** Every other entity the peer owned: its owner is cleared. */
    disowned: string[];
    /** Mission ships tethered to a departed player ship: kept, flagged. */
    stranded: string[];
}

const SINGLETON_UUID = 'singleton';

/** The peer's player ships: what it controls. */
function playerShips(entities: Map<string, Entity>,
    isPeer: (peerId: string) => boolean): Set<string> {
    const players = new Set<string>();
    for (const [uuid, entity] of entities) {
        const controller = entity.components.get(ControlledByComponent)?.peerId;
        if (uuid !== SINGLETON_UUID && controller !== undefined
            && isPeer(controller)) {
            players.add(uuid);
        }
    }
    return players;
}

/**
 * Whether `entity` is part of the fleet of `players` (ships of a peer
 * `isPeer` names): one of them, an escort marked for one of them, an
 * escort marked at all that the peer owns (its player may be between
 * worlds), or a ship the peer owns whose escort chain reaches one of them
 * but which the marking system has not stamped yet (a fighter launched on
 * the previous tick). Mission ships are never escorts.
 */
function inFleet(uuid: string, entity: Entity, players: ReadonlySet<string>,
    isPeer: (peerId: string) => boolean,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    if (players.has(uuid)) {
        return true;
    }
    if (entity.components.has(MissionShipComponent)) {
        return false;
    }
    const marker = entity.components.get(PlayerEscortComponent);
    if (marker && players.has(marker.player)) {
        return true;
    }
    const owner = entity.components.get(MultiplayerData)?.owner;
    if (owner === undefined || !isPeer(owner)) {
        return false;
    }
    if (marker) {
        return true;
    }
    const link = playerEscortLink(uuid, getEntity);
    return link !== undefined && players.has(link.player);
}

/** What a departure of the peers `isPeer` names does to `entities`. */
export function classifyPeerDeparture(entities: Map<string, Entity>,
    isPeer: (peerId: string) => boolean): PeerDeparture {
    const players = playerShips(entities, isPeer);
    const getEntity = (uuid: string) => entities.get(uuid);
    const fleet: string[] = [];
    const disowned: string[] = [];
    const stranded: string[] = [];
    for (const [uuid, entity] of entities) {
        if (uuid === SINGLETON_UUID) {
            continue;
        }
        if (inFleet(uuid, entity, players, isPeer, getEntity)) {
            fleet.push(uuid);
            continue;
        }
        const owner = entity.components.get(MultiplayerData)?.owner;
        if (owner !== undefined && isPeer(owner)) {
            disowned.push(uuid);
        }
        const missionShip = entity.components.get(MissionShipComponent);
        if (missionShip && players.has(missionShip.owner)) {
            stranded.push(uuid);
        }
    }
    return { fleet: fleet.sort(), disowned: disowned.sort(), stranded: stranded.sort() };
}

/**
 * Applies a peer's departure (the `removePeer` input, simulation_input.ts):
 * the fleet removed, the rest disowned, the stranded mission ships flagged.
 * Components are replaced, never mutated in place (snapshots may share
 * them).
 */
export function applyPeerDeparture(entities: Map<string, Entity>,
    isPeer: (peerId: string) => boolean): PeerDeparture {
    const departure = classifyPeerDeparture(entities, isPeer);
    for (const uuid of departure.fleet) {
        entities.delete(uuid);
    }
    for (const uuid of departure.disowned) {
        entities.get(uuid)?.components.delete(MultiplayerData);
    }
    for (const uuid of departure.stranded) {
        const entity = entities.get(uuid);
        const missionShip = entity?.components.get(MissionShipComponent);
        if (entity && missionShip && !missionShip.ownerDisconnected) {
            entity.components.set(MissionShipComponent,
                { ...missionShip, ownerDisconnected: true });
        }
    }
    return departure;
}
