import { isLeft } from "fp-ts/lib/Either.js";
import { UnknownComponent } from "nova_ecs/component";
import { Entity } from "nova_ecs/entity";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { World } from "nova_ecs/world";
import { SimulationTimeResource } from "../display/simulation_time.js";
import { EntityDelta, SimulationFrame } from "./simulation_bridge.js";
import { emitSimulationBridgeEvent } from "./simulation_bridge_events.js";

/**
 * Applies the simulation bridge's delta frames to the display world.
 * Extracted from browser.ts so the frame-application ordering — in
 * particular, that a frame's events are emitted BEFORE its removals
 * are applied — is testable without the whole browser entry point.
 */

/**
 * Which components each display entity currently holds because a frame
 * synced them, so a full resync (frame.added) can delete the ones the
 * new snapshot no longer carries without touching display-only
 * components. Module-level, like the display sync itself: cleared when
 * a new bridge's delta stream starts (see browser.ts).
 */
export const syncedComponents = new Map<string, Set<UnknownComponent>>();
/** Entities/components already warned about, so decode failures log once. */
export const warnedUnsyncableEntities = new Set<string>();

function syncEntityToDisplay(uuid: string, encodedEntity: unknown, serializer: Serializer, displayWorld: World) {
    const decoded = serializer.decode(encodedEntity);
    if (isLeft(decoded)) {
        if (!warnedUnsyncableEntities.has(uuid)) {
            warnedUnsyncableEntities.add(uuid);
            console.warn(
                `Skipping entity ${uuid} because serializer decode failed: `
                + serializer.describeDecodeFailure(encodedEntity, decoded.left)
            );
        }
        return;
    }
    const syncedEntity = decoded.right;

    let displayEntity = displayWorld.entities.get(uuid);
    if (!displayEntity) {
        displayEntity = new Entity(syncedEntity.name);
        displayWorld.entities.set(uuid, displayEntity);
    } else if (displayEntity.name !== syncedEntity.name) {
        displayEntity.name = syncedEntity.name;
    }

    const previousComponents = syncedComponents.get(uuid) ?? new Set<UnknownComponent>();
    const nextComponents = new Set<UnknownComponent>(syncedEntity.components.keys());

    for (const [component, data] of syncedEntity.components) {
        displayEntity.components.set(component, data);
    }

    for (const component of previousComponents) {
        if (!nextComponents.has(component)) {
            displayEntity.components.delete(component);
        }
    }

    syncedComponents.set(uuid, nextComponents);
}

function applyEntityDelta(uuid: string, delta: EntityDelta, serializer: Serializer, displayWorld: World) {
    const displayEntity = displayWorld.entities.get(uuid);
    if (!displayEntity) {
        if (!warnedUnsyncableEntities.has(uuid)) {
            warnedUnsyncableEntities.add(uuid);
            console.warn(`Received a delta for entity ${uuid}, which is not in the display world`);
        }
        return;
    }

    if (delta.name !== undefined) {
        displayEntity.name = delta.name;
    }

    const synced = syncedComponents.get(uuid) ?? new Set<UnknownComponent>();
    syncedComponents.set(uuid, synced);
    for (const [componentName, encoded] of delta.changed) {
        const decoded = serializer.decodeComponent(componentName, encoded);
        if (!decoded) {
            continue;
        }
        if (isLeft(decoded)) {
            const warnKey = `${uuid} ${componentName}`;
            if (!warnedUnsyncableEntities.has(warnKey)) {
                warnedUnsyncableEntities.add(warnKey);
                console.warn(`Skipping component ${componentName} of entity ${uuid} because decode failed`);
            }
            continue;
        }
        const [component, data] = decoded.right;
        displayEntity.components.set(component, data);
        synced.add(component);
    }
    for (const componentName of delta.removed) {
        const component = serializer.componentsByName.get(componentName);
        if (!component) {
            continue;
        }
        displayEntity.components.delete(component);
        synced.delete(component);
    }
}

export function applySimulationFrame(frame: SimulationFrame,
    serializer: Serializer, displayWorld: World,
    { emitEvents = false }: { emitEvents?: boolean } = {}) {
    for (const [uuid, entity] of frame.added) {
        syncEntityToDisplay(uuid, entity, serializer, displayWorld);
    }
    for (const [uuid, delta] of frame.changed) {
        applyEntityDelta(uuid, delta, serializer, displayWorld);
    }
    // The frame's events are emitted BEFORE its removals are applied:
    // the simulation emitted them during the tick, while the entities
    // they target still existed, so an event subscriber that looks its
    // target up in the display world must still find it. Removing
    // first silently dropped every event that targeted an entity
    // removed in the same frame — the NPC-death footgun that
    // ShipDeletedFinalExplosionSystem (display/explosion_plugin.ts)
    // works around. That DeleteEvent path stays, belt and braces:
    // event-listening display SYSTEMS (as opposed to subscribers)
    // resolve their target uuids later, at the display world's next
    // flush, by which point the entity is gone either way. Note the
    // host never puts a changed-delta and a removal for the same uuid
    // in one frame (snapshot() diffs the final state), so applying
    // removals after events reorders nothing else.
    //
    // Callers that do not forward events (the jump-arrival initial
    // frame in browser.ts) leave emitEvents off, exactly as before.
    if (emitEvents) {
        for (const event of frame.events) {
            emitSimulationBridgeEvent(event, serializer, displayWorld);
        }
    }
    for (const uuid of frame.removed) {
        syncedComponents.delete(uuid);
        displayWorld.entities.delete(uuid);
    }

    // The simulation's time (frame.time) is NOT copied into the display
    // world's TimeResource: the simulation runs on fixed, 0-based
    // logical time, while the display world keeps wall-clock time for
    // smooth rendering. It is mirrored under a separate resource for
    // display systems that compare against sim-clock timestamps on
    // components (e.g. debris expiry).
    if (frame.time) {
        displayWorld.resources.set(SimulationTimeResource, frame.time);
    }
}
