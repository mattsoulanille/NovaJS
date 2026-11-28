import { EncodedEntity } from "nova_ecs/plugins/serializer_plugin";
import { ControlEvent } from "../nova_plugin/core/index.js";
import { EscortAction, FighterRefund } from "../nova_plugin/escorts/index.js";
import {
    CapturedShip, HailAction, StellarSetString,
} from "../nova_plugin/encounters/index.js";
import {
    AbortedMission, AcceptedMission, MissionSetString, NebulaExplored,
    RefusedMission,
} from "../nova_plugin/missions/index.js";
import { AnalogControlState } from "../nova_plugin/player/index.js";
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
    /** The sender's own turret aim (player/turret_aim.ts). */
    setTurretAim(accurate: boolean): void;
    hail(action: HailAction): void;
    escortAction(action: EscortAction): void | Promise<void>;
    /** A lost bay fighter's round back to its carrier (issue #258). */
    refundFighter(refund: FighterRefund): void | Promise<void>;
    acceptMission(accepted: AcceptedMission): void | Promise<void>;
    /** An in-flight refusal whose OnRefuse did something. */
    refuseMission(refused: RefusedMission): void | Promise<void>;
    /** An in-flight abort of one of the player's own missions. */
    abortMission(aborted: AbortedMission): void | Promise<void>;
    /** The capture prompt's "Use As My Ship", renamed and resolved. */
    captureShip(capture: CapturedShip): void | Promise<void>;
    /** A stellar's OnDominate / OnRelease, resolved on the owning client. */
    stellarSetString(record: StellarSetString): void | Promise<void>;
    /** A mission's OnShipDone or in-flight OnFailure, resolved on the
     * owning client. */
    missionSetString(record: MissionSetString): void | Promise<void>;
    /** A nëbu's OnExplore, resolved on the owning client. */
    nebulaExplored(record: NebulaExplored): void | Promise<void>;
    step(count?: number): void;
    /** System entry: step straight to the room clock's pacing target;
     * returns the ticks stepped (SimulationBridgeHost.catchUpToRoomClock). */
    catchUpToRoomClock(): Promise<number>;
    snapshot(): SimulationFrame;
    addEntity(uuid: string, entity: EncodedEntity): void | Promise<void>;
    removeEntity(uuid: string): void;
    setPlayerJumpRoute(route: string[]): void;
    /** Non-simulation control: publish this peer's Caps Lock 2x speed vote (#371). */
    setSpeedVote(wantFast: boolean, inSpace: boolean): void;
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
    /** Performance telemetry (client/perf_telemetry.ts): what stepping
     * and snapshotting cost since the last call, which resets it. */
    perfCounters(): SimulationPerfCounters;
}

/**
 * The worker's own view of what the simulation cost over one telemetry
 * window: everything since the previous perfCounters() call. Wall-clock
 * measurement only, read on the side; nothing here feeds back into the
 * simulation, so it has no bearing on determinism.
 */
export interface SimulationPerfCounters {
    /** Wall ms the window covers (since the previous call, or the
     * host's start). */
    windowMs: number;
    /** step() calls, and the ticks they advanced the live tick by. */
    stepCalls: number;
    ticks: number;
    /** Wall ms spent inside step(): rollback resimulation, input
     * integration and hash publishing included. */
    stepMs: number;
    stepCallMaxMs: number;
    snapshotCalls: number;
    snapshotMs: number;
    snapshotMaxMs: number;
    /** Rollbacks this window, their summed and largest depth (ticks). */
    rollbacks: number;
    rollbackDepthSum: number;
    rollbackMaxDepth: number;
    /** Rollback events logged this window, by name (status()'s
     * rollbackEvents, windowed). */
    events: Record<string, number>;
}

export interface SimulationStatus {
    tick: number;
    desyncCount: number;
    /** Result of the most recent joinRoom, if one ran. */
    joined?: boolean;
    /** A resync ran out of attempts: the host is frozen for good (#333). */
    resyncFailed?: boolean;
    /** Recent worker-side log lines, newest last (worker entry only). */
    logs?: string[];
    /**
     * Set once the room has refused this peer's re-stamped insertions
     * more times than the host retries (#354, simulation_bridge_host.ts
     * handleRefusal): the peer cannot get its fleet back into the room
     * under the identity it has. It ends the session through #333's
     * terminal path, so `resyncFailed` is set with it; this flag says
     * which give-up it was.
     */
    identityRecoveryFailed?: boolean;
    /** How often each rollback event (rollback, retimed, holdForRelay,
     * lateRecord, resync, ...) has been logged since the host started:
     * the desync dumps' rollback log, tallied, for live diagnostics. */
    rollbackEvents?: Record<string, number>;
}

export interface AsyncSimulationBridgeHostApi {
    controlEvents(events: ControlEvent[]): Promise<void>;
    analogControl(control: AnalogControlState): Promise<void>;
    setTarget(target: string | null): Promise<void>;
    setPlanetTarget(target: string | null): Promise<void>;
    setTurretAim(accurate: boolean): Promise<void>;
    hail(action: HailAction): Promise<void>;
    escortAction(action: EscortAction): Promise<void>;
    refundFighter(refund: FighterRefund): Promise<void>;
    acceptMission(accepted: AcceptedMission): Promise<void>;
    refuseMission(refused: RefusedMission): Promise<void>;
    abortMission(aborted: AbortedMission): Promise<void>;
    captureShip(capture: CapturedShip): Promise<void>;
    stellarSetString(record: StellarSetString): Promise<void>;
    missionSetString(record: MissionSetString): Promise<void>;
    nebulaExplored(record: NebulaExplored): Promise<void>;
    /**
     * Steps `count` ticks. A host that times itself (the browser worker)
     * resolves to the wall-clock ms the batch took IN the host, which the
     * frame pump sizes its batches by (a round trip also carries the
     * caller's own message-queue wait).
     */
    step(count?: number): Promise<number | void>;
    catchUpToRoomClock(): Promise<number>;
    snapshot(): Promise<SimulationFrame>;
    addEntity(uuid: string, entity: EncodedEntity): Promise<void>;
    removeEntity(uuid: string): Promise<void>;
    setPlayerJumpRoute(route: string[]): Promise<void>;
    setSpeedVote(wantFast: boolean, inSpace: boolean): Promise<void>;
    spawnNpc(shipId: string): Promise<void>;
    rewind(ticks: number): Promise<boolean>;
    resync(): Promise<boolean>;
    status(): Promise<SimulationStatus>;
    entityHashes(): Promise<{ tick: number, entities: [string, string][] }>;
    perfCounters(): Promise<SimulationPerfCounters>;
}
