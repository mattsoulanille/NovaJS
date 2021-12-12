import { EcsEvent } from "nova_ecs/events";
import { ControlAction } from "./controls";


export type ControlState = Map<ControlAction, false | 'start' | 'repeat' | true>;
export const ControlStateEvent = new EcsEvent<ControlState>('ControlState');

