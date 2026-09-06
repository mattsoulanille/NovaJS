import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
import { ControlEvent } from "../nova_plugin/controls_plugin.js";
import { EscortAction } from "../nova_plugin/escort_action.js";
import { HailAction } from "../nova_plugin/hail_plugin.js";
import { AcceptedMission } from "../nova_plugin/mission_accept.js";
import { AnalogControlState } from "../nova_plugin/ship_control.js";
import { SimulationFrame } from "./simulation_frame.js";

/**
 * The bridge host's surface as seen across the display/simulation
 * boundary: SimulationBridgeHost implements the synchronous form;
 * the worker transports expose the promise-returning form.
 */

export interface SimulationBridgeHostApi {
    controlEvents(events: ControlEvent[]): void;
    analogControl(control: AnalogControlState): void;
    setTarget(target: string | null): void;
    setPlanetTarget(target: string | null): void;
    hail(action: HailAction): void;
    escortAction(action: EscortAction): void | Promise<void>;
    acceptMission(accepted: AcceptedMission): void | Promise<void>;
    step(count?: number): void;
    snapshot(): SimulationFrame;
    addEntity(uuid: string, entity: EncodedEntity): void | Promise<void>;
    removeEntity(uuid: string): void;
    setPlayerJumpRoute(route: string[]): void;
    spawnNpc(shipId: string): void | Promise<void>;
    /** Debug/netcode: roll back `ticks` and resimulate. */
    rewind(ticks: number): boolean;
    /** Desync recovery: rebuild from genesis plus the room's input log. */
    resync(): Promise<boolean>;
    /** Diagnostics: sim tick, desyncs seen, last join result. */
    status(): SimulationStatus;
    /** Diagnostics: per-entity world hashes (peer-local excluded),
     * for diffing against another world's view. */
    entityHashes(): { tick: number, entities: [string, string][] };
}

export interface SimulationStatus {
    tick: number;
    desyncCount: number;
    /** Result of the most recent joinRoom, if one ran. */
    joined?: boolean;
    /** Recent worker-side log lines, newest last (worker entry only). */
    logs?: string[];
}

export interface AsyncSimulationBridgeHostApi {
    controlEvents(events: ControlEvent[]): Promise<void>;
    analogControl(control: AnalogControlState): Promise<void>;
    setTarget(target: string | null): Promise<void>;
    setPlanetTarget(target: string | null): Promise<void>;
    hail(action: HailAction): Promise<void>;
    escortAction(action: EscortAction): Promise<void>;
    acceptMission(accepted: AcceptedMission): Promise<void>;
    step(count?: number): Promise<void>;
    snapshot(): Promise<SimulationFrame>;
    addEntity(uuid: string, entity: EncodedEntity): Promise<void>;
    removeEntity(uuid: string): Promise<void>;
    setPlayerJumpRoute(route: string[]): Promise<void>;
    spawnNpc(shipId: string): Promise<void>;
    rewind(ticks: number): Promise<boolean>;
    resync(): Promise<boolean>;
    status(): Promise<SimulationStatus>;
    entityHashes(): Promise<{ tick: number, entities: [string, string][] }>;
}
