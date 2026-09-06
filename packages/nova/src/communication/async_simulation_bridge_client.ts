import { Entity } from "nova_ecs/entity";
import { EncodedEntity, Serializer } from "nova_ecs/plugins/serializer_plugin";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { EscortAction } from "../nova_plugin/escort_action.js";
import { HailAction } from "../nova_plugin/hail_plugin.js";
import { AcceptedMission } from "../nova_plugin/mission_accept.js";
import { AnalogControlState } from "../nova_plugin/ship_control.js";
import { AsyncSimulationBridgeHostApi } from "./simulation_bridge_api.js";
import { decodeEntityOrThrow } from "./simulation_bridge_client.js";
import { SimulationFrame } from "./simulation_frame.js";

/**
 * Thrown (as a rejection) by every in-flight or later call on an
 * AsyncSimulationBridgeClient once it has been closed. Callers that
 * race a system transition (the frame pump) catch this and bail out.
 */
export class SimulationBridgeClosedError extends Error {
    constructor() {
        super('Simulation bridge closed');
        this.name = 'SimulationBridgeClosedError';
    }
}

/**
 * Client for a host on the far side of a worker boundary (the comlink
 * transports in simulation_bridge_browser_worker.ts and
 * simulation_bridge_worker_threads.ts): every call is a message round
 * trip, and close() settles whatever is in flight.
 */
export class AsyncSimulationBridgeClient {
    /**
     * Rejects when close() runs. Every host call races against it:
     * closing a bridge whose worker is terminated mid-call would
     * otherwise leave the caller's promise unsettled FOREVER (a
     * message posted to a terminated worker gets no reply), which
     * wedged the browser's frame pump and froze every transit that
     * raced it (the hypergate black screen / jump white screen hang).
     */
    private closedRejection: Promise<never>;
    private rejectClosed!: (error: Error) => void;
    private closed = false;

    constructor(
        private host: AsyncSimulationBridgeHostApi,
        private serializer: Serializer,
        private closeImpl?: () => void | Promise<void>,
    ) {
        this.closedRejection = new Promise<never>((_, reject) => {
            this.rejectClosed = reject;
        });
        // If close() runs with no call in flight, the bare rejection
        // must not surface as an unhandled rejection.
        this.closedRejection.catch(() => { });
    }

    /**
     * Races a worker call against bridge closure so it always settles.
     */
    private guard<T>(call: () => Promise<T>): Promise<T> {
        if (this.closed) {
            return Promise.reject(new SimulationBridgeClosedError());
        }
        return Promise.race([call(), this.closedRejection]);
    }

    async snapshot(): Promise<SimulationFrame> {
        return await this.guard(() => this.host.snapshot());
    }

    async step(count = 1) {
        await this.guard(() => this.host.step(count));
    }

    async controlEvents(events: ControlEvent[]) {
        await this.guard(() => this.host.controlEvents(events));
    }

    async analogControl(control: AnalogControlState) {
        await this.guard(() => this.host.analogControl(control));
    }

    async setTarget(target: string | null) {
        await this.guard(() => this.host.setTarget(target));
    }

    async setPlanetTarget(target: string | null) {
        await this.guard(() => this.host.setPlanetTarget(target));
    }

    async hail(action: HailAction) {
        await this.guard(() => this.host.hail(action));
    }

    async escortAction(action: EscortAction) {
        await this.guard(() => this.host.escortAction(action));
    }

    async acceptMission(accepted: AcceptedMission) {
        await this.guard(() => this.host.acceptMission(accepted));
    }

    async addEntity(uuid: string, entity: Entity) {
        await this.guard(() =>
            this.host.addEntity(uuid, this.serializer.encode(entity)));
    }

    async removeEntity(uuid: string) {
        await this.guard(() => this.host.removeEntity(uuid));
    }

    async setPlayerJumpRoute(route: string[]) {
        await this.guard(() => this.host.setPlayerJumpRoute(route));
    }

    async spawnNpc(shipId: string) {
        await this.guard(() => this.host.spawnNpc(shipId));
    }

    async rewind(ticks: number) {
        return this.guard(() => this.host.rewind(ticks));
    }

    async resync() {
        return this.guard(() => this.host.resync());
    }

    async status() {
        return this.guard(() => this.host.status());
    }

    async entityHashes() {
        return this.guard(() => this.host.entityHashes());
    }

    getSerializer() {
        return this.serializer;
    }

    decodeEntity(entity: EncodedEntity) {
        return decodeEntityOrThrow(this.serializer, entity);
    }

    async close() {
        // Settle every in-flight (and future) call BEFORE terminating
        // the worker: terminate() silences the worker, so any call
        // still awaiting a reply would never settle.
        this.closed = true;
        this.rejectClosed(new SimulationBridgeClosedError());
        await this.closeImpl?.();
    }
}
