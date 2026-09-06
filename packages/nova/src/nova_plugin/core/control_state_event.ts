import { EcsEvent } from "nova_ecs/events";
import { registerSimulationBridgeEvent } from "../../communication/simulation_bridge_events.js";
import { ControlAction } from "./controls.js";


export type ControlState = Map<ControlAction, false | 'start' | 'repeat' | true>;
export const ControlStateEvent = new EcsEvent<ControlState>('ControlState');

registerSimulationBridgeEvent({ event: ControlStateEvent });
