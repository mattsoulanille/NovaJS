import { EcsEvent } from "nova_ecs/events";
import { Serializer } from "nova_ecs/plugins/serializer_plugin";
import { World } from "nova_ecs/world";
import { isLeft } from "fp-ts/lib/Either.js";

export interface EncodedSimulationBridgeEvent {
    name: string;
    data: unknown;
    entityUuids?: string[];
    /**
     * The simulation tick during whose step the event was emitted.
     * Absent when the emission happened outside a rollback-driven step
     * (tests emitting directly, emissions between steps). Additive
     * field: the display side ignores it, and bridge frames flow only
     * host -> display — they never cross the room's rollback protocol,
     * so no PROTOCOL_VERSION bump is needed. The host uses it to drop
     * rollback re-emissions of already-forwarded ticks (see
     * SimulationBridgeHost).
     */
    tick?: number;
}

interface SimulationBridgeEventRegistration<Data, Encoded = Data> {
    event: EcsEvent<Data>;
    name: string;
    includeEntityUuids: boolean;
}

type SimulationBridgeEventOptions<Data> = {
    event: EcsEvent<Data>;
    name?: string;
    includeEntityUuids?: boolean;
};

const eventRegistrationsByEvent = new Map<EcsEvent<unknown>, SimulationBridgeEventRegistration<unknown, unknown>>();
const eventRegistrationsByName = new Map<string, SimulationBridgeEventRegistration<unknown, unknown>>();

export function registerSimulationBridgeEvent<Data>({
    event,
    name,
    includeEntityUuids,
}: SimulationBridgeEventOptions<Data>) {
    const eventName = name ?? event.name;
    if (!eventName) {
        throw new Error("Simulation bridge events need a stable name");
    }

    const existingByEvent = eventRegistrationsByEvent.get(event as EcsEvent<unknown>);
    if (existingByEvent) {
        if (existingByEvent.name !== eventName) {
            throw new Error(`Simulation bridge event ${eventName} conflicts with ${existingByEvent.name}`);
        }
        return;
    }
    if (eventRegistrationsByName.has(eventName)) {
        throw new Error(`Simulation bridge event name ${eventName} is already registered`);
    }

    const registration: SimulationBridgeEventRegistration<Data> = {
        event,
        name: eventName,
        includeEntityUuids: includeEntityUuids ?? true,
    };
    eventRegistrationsByEvent.set(event as EcsEvent<unknown>, registration as SimulationBridgeEventRegistration<unknown, unknown>);
    eventRegistrationsByName.set(eventName, registration as SimulationBridgeEventRegistration<unknown, unknown>);
}

export function getRegisteredSimulationBridgeEvents() {
    return [...eventRegistrationsByEvent.values()];
}

function decodeSimulationBridgeEvent(
    event: EncodedSimulationBridgeEvent,
    serializer: Serializer,
): { event: EcsEvent<unknown>, data: unknown, entityUuids?: string[] } {
    const registration = eventRegistrationsByName.get(event.name);
    if (!registration) {
        throw new Error(`Unknown simulation bridge event ${event.name}`);
    }
    const decoded = serializer.decodeEvent(registration.event, event.data);
    if (isLeft(decoded)) {
        throw new Error(
            `Failed to decode simulation bridge event ${event.name}: `
            + serializer.describeEventDecodeFailure(registration.event, event.data, decoded.left)
        );
    }
    return {
        event: registration.event,
        data: decoded.right,
        entityUuids: event.entityUuids,
    };
}

export function emitSimulationBridgeEvent(
    event: EncodedSimulationBridgeEvent,
    serializer: Serializer,
    world: World,
) {
    const decoded = decodeSimulationBridgeEvent(event, serializer);
    world.emit(decoded.event, decoded.data, decoded.entityUuids);
}
