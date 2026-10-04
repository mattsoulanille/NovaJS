import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { EncodedEntity } from 'nova_ecs/plugins/serializer_plugin';
import { ControlledByComponent } from '../nova_plugin/player/index.js';

/**
 * ============================================================================
 * Peer identity: ownership follows the CURRENT connection (#354)
 * ============================================================================
 *
 * The server assigns a peer uuid per SOCKET (communicator_server.ts), and
 * every entity a client owns is stamped with it: `ControlledBy.peerId` on
 * its player ship, `MultiplayerData.owner` on the ship and on everything it
 * inserted (escorts, bay fighters, mission ships, the NPCs it spawned — the
 * ownership rule of the Trust model, rollback_protocol.ts item 5). A
 * reconnect hands the client a NEW uuid mid-game; anything still stamped
 * with the old one is somebody else's as far as the room is concerned, and
 * the relay stamps every record the client sends from then on with the new
 * one. These helpers re-stamp a client's own entities from its stale ids to
 * the current one — on live entities (the client's held fleet) and on
 * encoded ones (a record's insertion).
 */

const CONTROLLED_BY = ControlledByComponent.name;
const MULTIPLAYER_DATA = MultiplayerData.name;

/** The peer ids an entity is stamped with (controller and owner). */
export function entityStamps(entity: Entity): string[] {
    const stamps: string[] = [];
    const controller = entity.components.get(ControlledByComponent)?.peerId;
    if (controller !== undefined) {
        stamps.push(controller);
    }
    const owner = entity.components.get(MultiplayerData)?.owner;
    if (owner !== undefined) {
        stamps.push(owner);
    }
    return stamps;
}

/**
 * Re-stamps a live entity: every stamp `isStale` names becomes `to`.
 * Replaces the component objects rather than mutating them (snapshots may
 * share them). Returns whether anything changed.
 */
export function restampEntity(entity: Entity,
    isStale: (peerId: string) => boolean, to: string): boolean {
    let changed = false;
    const controller = entity.components.get(ControlledByComponent)?.peerId;
    if (controller !== undefined && controller !== to && isStale(controller)) {
        entity.components.set(ControlledByComponent, { peerId: to });
        changed = true;
    }
    const owner = entity.components.get(MultiplayerData)?.owner;
    if (owner !== undefined && owner !== to && isStale(owner)) {
        entity.components.set(MultiplayerData, { owner: to });
        changed = true;
    }
    return changed;
}

/** The peer ids an ENCODED entity is stamped with. */
export function encodedEntityStamps(encoded: EncodedEntity): string[] {
    const stamps: string[] = [];
    for (const [name, data] of encoded.components) {
        const stamp = name === CONTROLLED_BY
            ? (data as { peerId?: unknown } | undefined)?.peerId
            : name === MULTIPLAYER_DATA
                ? (data as { owner?: unknown } | undefined)?.owner
                : undefined;
        if (typeof stamp === 'string') {
            stamps.push(stamp);
        }
    }
    return stamps;
}

/** A component tuple with its data replaced (any trailing fields kept). */
function withData<C extends EncodedEntity['components'][number]>(
    component: C, data: unknown): C {
    const copy = [...component] as unknown as C;
    copy[1] = data;
    return copy;
}

/**
 * Re-stamps an encoded entity (an insertion record's payload): the same
 * rule as {@link restampEntity}, on the [name, data] component list. Returns
 * the SAME object when nothing is stale, a copy otherwise.
 */
export function restampEncodedEntity(encoded: EncodedEntity,
    isStale: (peerId: string) => boolean, to: string): EncodedEntity {
    let changed = false;
    const components = encoded.components.map(component => {
        const [name, data] = component;
        if (name === CONTROLLED_BY) {
            const peerId = (data as { peerId?: unknown } | undefined)?.peerId;
            if (typeof peerId === 'string' && peerId !== to && isStale(peerId)) {
                changed = true;
                return withData(component, { ...(data as object), peerId: to });
            }
        } else if (name === MULTIPLAYER_DATA) {
            const owner = (data as { owner?: unknown } | undefined)?.owner;
            if (typeof owner === 'string' && owner !== to && isStale(owner)) {
                changed = true;
                return withData(component, { ...(data as object), owner: to });
            }
        }
        return component;
    });
    return changed ? { ...encoded, components } : encoded;
}
