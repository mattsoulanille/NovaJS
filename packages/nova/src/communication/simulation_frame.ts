import * as t from 'io-ts';
import { EncodedComponentList, EncodedEntity, Serializer } from "nova_ecs/plugins/serializer_plugin";
import { Time } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { EncodedSimulationBridgeEvent, EncodedSimulationBridgeEventType } from "./simulation_bridge_events.js";
import { RoomSpeed, RoomSpeedType } from "./rollback_protocol.js";
import { WireTick } from "./simulation_input.js";

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
     * simulation steps: the room's clock multiplier (1 or 2) times a
     * smooth slew toward the room's clock.
     */
    rate: number;
    /**
     * Raw drift: how far the sim trails its target tick (negative
     * when ahead). Small values are corrected by `rate`; the pump
     * snaps only when this is beyond slewing (e.g. a hidden tab).
     */
    behindTicks: number;
    /**
     * The room clock's base speed multiplier at the local tick (1 or 2).
     * Optional for older/synthetic frames (defaults to 1).
     */
    speed?: RoomSpeed;
}

/**
 * Room speed vote status reported from the simulation worker to the
 * display for the status bar indicator (#371). Display-only metadata;
 * never part of simulation state.
 */
export interface RoomSpeedStatus {
    /** Active clock speed at the local tick (1 or 2). */
    speed: RoomSpeed;
    /** Scheduled clock speed from `atTick` onward (1 or 2). */
    targetSpeed: RoomSpeed;
    /** Tick boundary of the latest speed transition. */
    atTick: number;
    /** In-space voters currently voting for 2x. */
    fastVotes: number;
    /** Total in-space voters in the room (landed players excluded). */
    totalVoters: number;
    /** This peer's own Caps Lock vote. */
    wantFast: boolean;
    /** Whether this peer is currently in space (eligible to vote). */
    inSpace: boolean;
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
    roomSpeed?: RoomSpeedStatus;
    /**
     * Set on exactly one frame: the first after the host's desync
     * recovery ran out of attempts (#333), or its identity recovery after
     * a reconnect did (#354, the same terminal path). The host is frozen
     * from then on and every later frame is empty; the client saves,
     * freezes the universe and offers a reload (client/resync_failure.ts).
     */
    resyncFailed?: boolean;
}

/** The entity part of a frame: everything but time, events and pacing. */
export type EntityFrame = Pick<SimulationFrame, 'added' | 'changed' | 'removed'>;

/**
 * Codecs for the frame shapes above. The frame crosses the worker
 * bridge by structuredClone today and is never validated; these exist
 * so its wire schema can be derived (wire_schemas.ts) and so a frame
 * arriving as bytes can be gated like every other boundary.
 */
export const TimeType: t.Type<Time> = t.type({
    time: t.number,
    delta_s: t.number,
    delta_ms: t.number,
    frame: t.number,
});

export const EntityDeltaType: t.Type<EntityDelta> = t.intersection([
    t.type({
        changed: EncodedComponentList,
        removed: t.array(t.string),
    }),
    t.partial({ name: t.string }),
]);

export const SimulationPacingType: t.Type<SimulationPacing> = t.intersection([
    t.type({
        rate: t.number,
        behindTicks: t.number,
    }),
    t.partial({
        speed: RoomSpeedType,
    }),
]);

export const RoomSpeedStatusType: t.Type<RoomSpeedStatus> = t.type({
    speed: RoomSpeedType,
    targetSpeed: RoomSpeedType,
    atTick: WireTick,
    fastVotes: WireTick,
    totalVoters: WireTick,
    wantFast: t.boolean,
    inSpace: t.boolean,
});

export const SimulationFrameType: t.Type<SimulationFrame> = t.intersection([
    t.type({
        added: t.array(t.tuple([t.string, EncodedEntity])),
        changed: t.array(t.tuple([t.string, EntityDeltaType])),
        removed: t.array(t.string),
        events: t.array(EncodedSimulationBridgeEventType),
    }),
    t.partial({
        time: TimeType,
        pacing: SimulationPacingType,
        roomSpeed: RoomSpeedStatusType,
        resyncFailed: t.boolean,
    }),
]);

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
