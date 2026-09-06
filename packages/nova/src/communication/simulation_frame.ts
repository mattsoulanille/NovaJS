import { EncodedEntity, Serializer } from "nova_ecs/plugins/serializer_plugin";
import { Time } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { EncodedSimulationBridgeEvent } from "./simulation_bridge_events.js";

/**
 * The simulation → display frame: the wire shape the bridge host
 * produces each snapshot and the display applies
 * (apply_simulation_frame.ts), plus the delta encoder that produces it.
 */

export interface EntityDelta {
    /** Present only when the entity's name changed. */
    name?: string;
    /** Components whose encoded form changed since the last snapshot. */
    changed: [string, unknown][];
    /** Names of components removed since the last snapshot. */
    removed: string[];
}

/**
 * How the sim's clock should track the room's. Present only once a
 * tickSync has arrived (i.e. in a live multiplayer room).
 */
export interface SimulationPacing {
    /**
     * Multiply real elapsed time by this before accumulating
     * simulation steps: a smooth slew toward the room's clock.
     */
    rate: number;
    /**
     * Raw drift: how far the sim trails its target tick (negative
     * when ahead). Small values are corrected by `rate`; the pump
     * snaps only when this is beyond slewing (e.g. a hidden tab).
     */
    behindTicks: number;
}

/**
 * A delta frame. Entities absent from `added`, `changed`, and `removed`
 * are unchanged since the previous snapshot from the same host.
 */
export interface SimulationFrame {
    added: [string, EncodedEntity][];
    changed: [string, EntityDelta][];
    removed: string[];
    time?: Time;
    events: EncodedSimulationBridgeEvent[];
    pacing?: SimulationPacing;
}

/** The entity part of a frame: everything but time, events and pacing. */
export type EntityFrame = Pick<SimulationFrame, 'added' | 'changed' | 'removed'>;

interface SentEntityRecord {
    name: string | undefined;
    /** Component name -> JSON of the component's encoded form as last sent. */
    components: Map<string, string>;
}

/**
 * Encodes a world's serializer-registered state as a delta against the
 * state this encoder last sent: entities never sent arrive in full,
 * entities whose encoded components changed arrive as an EntityDelta,
 * and entities that vanished are named in `removed`.
 */
export class DeltaFrameEncoder {
    private lastSent = new Map<string, SentEntityRecord>();

    encode(world: World, serializer: Serializer): EntityFrame {
        const added: [string, EncodedEntity][] = [];
        const changed: [string, EntityDelta][] = [];
        const seen = new Set<string>();

        for (const [uuid, entity] of world.entities) {
            if (uuid === "singleton") {
                continue;
            }
            seen.add(uuid);
            const previous = this.lastSent.get(uuid);

            const encodedComponents: [string, unknown][] = [];
            const record: SentEntityRecord = {
                name: entity.name,
                components: new Map(),
            };
            for (const [component, data] of entity.components) {
                if (!serializer.hasComponent(component)) {
                    continue;
                }
                const encoded = serializer.encodeComponent(component, data);
                encodedComponents.push([component.name, encoded]);
                record.components.set(component.name,
                    JSON.stringify(encoded) ?? 'undefined');
            }

            if (!previous) {
                added.push([uuid, {
                    name: entity.name,
                    components: encodedComponents,
                }]);
            } else {
                const delta: EntityDelta = { changed: [], removed: [] };
                if (previous.name !== entity.name) {
                    delta.name = entity.name;
                }
                for (const [componentName, encoded] of encodedComponents) {
                    if (previous.components.get(componentName)
                        !== record.components.get(componentName)) {
                        delta.changed.push([componentName, encoded]);
                    }
                }
                for (const componentName of previous.components.keys()) {
                    if (!record.components.has(componentName)) {
                        delta.removed.push(componentName);
                    }
                }
                if (delta.name !== undefined || delta.changed.length > 0
                    || delta.removed.length > 0) {
                    changed.push([uuid, delta]);
                }
            }
            this.lastSent.set(uuid, record);
        }

        const removed: string[] = [];
        for (const uuid of this.lastSent.keys()) {
            if (!seen.has(uuid)) {
                removed.push(uuid);
                this.lastSent.delete(uuid);
            }
        }

        return { added, changed, removed };
    }

    /**
     * Forgets all previously sent state so the next frame resends
     * every entity in full.
     */
    reset() {
        this.lastSent.clear();
    }
}
