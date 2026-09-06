import { isLeft } from "fp-ts/lib/Either.js";
import { Entity } from "nova_ecs/entity";
import { EncodedEntity, Serializer } from "nova_ecs/plugins/serializer_plugin";
import { ControlEvent } from "../nova_plugin/core/controls_plugin.js";
import { EscortAction } from "../nova_plugin/escorts/escort_action.js";
import { HailAction } from "../nova_plugin/encounters/hail_plugin.js";
import { AcceptedMission } from "../nova_plugin/missions/mission_accept.js";
import { AnalogControlState } from "../nova_plugin/player/ship_control.js";
import { SimulationBridgeHostApi } from "./simulation_bridge_api.js";
import { SimulationFrame } from "./simulation_frame.js";

/** Decodes a wire entity, throwing a described error on failure. */
export function decodeEntityOrThrow(serializer: Serializer, entity: EncodedEntity): Entity {
    const decoded = serializer.decode(entity);
    if (isLeft(decoded)) {
        throw new Error(`Failed to decode entity: ${serializer.describeDecodeFailure(entity, decoded.left)}`);
    }
    return decoded.right;
}

/**
 * In-process client: the same-thread stand-in for the worker
 * transports. Everything crossing to the host is structuredClone'd so
 * callers see the postMessage boundary a real worker would impose
 * (no shared references, no functions, no class instances).
 */
export class SimulationBridgeClient {
    constructor(
        private host: SimulationBridgeHostApi,
        private serializer: Serializer,
    ) { }

    snapshot(): SimulationFrame {
        return structuredClone(this.host.snapshot());
    }

    step(count = 1) {
        this.host.step(count);
    }

    controlEvents(events: ControlEvent[]) {
        this.host.controlEvents(structuredClone(events));
    }

    analogControl(control: AnalogControlState) {
        this.host.analogControl(structuredClone(control));
    }

    setTarget(target: string | null) {
        this.host.setTarget(target);
    }

    setPlanetTarget(target: string | null) {
        this.host.setPlanetTarget(target);
    }

    hail(action: HailAction) {
        this.host.hail(structuredClone(action));
    }

    escortAction(action: EscortAction) {
        return this.host.escortAction(structuredClone(action));
    }

    acceptMission(accepted: AcceptedMission) {
        return this.host.acceptMission(structuredClone(accepted));
    }

    addEntity(uuid: string, entity: Entity) {
        return this.host.addEntity(uuid, structuredClone(this.serializer.encode(entity)));
    }

    removeEntity(uuid: string) {
        this.host.removeEntity(uuid);
    }

    setPlayerJumpRoute(route: string[]) {
        this.host.setPlayerJumpRoute(structuredClone(route));
    }

    rewind(ticks: number) {
        return this.host.rewind(ticks);
    }

    resync() {
        return this.host.resync();
    }

    status() {
        return this.host.status();
    }

    entityHashes() {
        return this.host.entityHashes();
    }

    spawnNpc(shipId: string) {
        return this.host.spawnNpc(shipId);
    }

    getSerializer() {
        return this.serializer;
    }

    decodeEntity(entity: EncodedEntity) {
        return decodeEntityOrThrow(this.serializer, entity);
    }
}
