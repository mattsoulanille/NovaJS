import * as t from 'io-ts';
import { Emit, EmitFunction, GetEntity, GetWorld, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";
import { CommunicatorResource } from "nova_ecs/plugins/multiplayer_plugin";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { ControlAction, ControlState } from "../core/index.js";
import { ControlEvent } from "../core/index.js";
import { PlayerShipSelector } from "./player_ship_plugin.js";

/**
 * Which peer steers this ship. Synced to every peer, so each peer can
 * apply every peer's control inputs to the right ship — the heart of
 * per-peer input application.
 */
export const ControlledByComponent =
    new Component<{ peerId: string }>('ControlledBy');
export const ControlledByType = t.type({ peerId: t.string });

/**
 * A controlled ship's held-control state. Per-ship (not a global
 * resource): every peer's ship has its own. Not synced — it develops
 * identically on every peer from the same input records.
 */
export const ShipControlStateComponent =
    new Component<ControlState>('ShipControlState');

/**
 * A controlled ship's analog steering state (virtual joystick /
 * autopilot). `heading` is an absolute direction in the Vector.angle
 * convention; `throttle` is forward acceleration in [0, 1] (negative
 * values brake inertialess ships). Null fields leave the digital
 * controls in charge. Like ShipControlStateComponent, it develops
 * identically on every peer from the same input records.
 */
export interface AnalogControlState {
    heading: number | null;
    throttle: number | null;
}
export const AnalogControlComponent =
    new Component<AnalogControlState>('AnalogControl');

/**
 * Emitted targeted at a ship when a peer's control events were just
 * applied to it. Edge-triggered systems (landing, target cycling,
 * weapon selection, jumping) listen for this instead of polling.
 */
export const ShipControlEvent = new EcsEvent<undefined>('ShipControlEvent');

/**
 * Finds the ship a peer controls. With no peerId (local play before a
 * connection exists), falls back to the PlayerShipSelector ship.
 */
export function findControlledEntity(world: World, peerId: string | undefined) {
    for (const [uuid, entity] of world.entities) {
        if (peerId !== undefined) {
            if (entity.components.get(ControlledByComponent)?.peerId === peerId) {
                return { uuid, entity };
            }
        } else if (entity.components.has(PlayerShipSelector)) {
            return { uuid, entity };
        }
    }
    return undefined;
}

/**
 * Applies a peer's analog steering input to the ship it controls.
 * Sanitizes at the boundary: non-finite numbers (a hostile or buggy
 * peer) become null and throttle is clamped, so every peer stores the
 * same well-formed state in the deterministic world.
 */
export function applyAnalogControl(world: World, peerId: string | undefined,
    control: AnalogControlState) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const heading = typeof control.heading === 'number'
        && Number.isFinite(control.heading) ? control.heading : null;
    const throttle = typeof control.throttle === 'number'
        && Number.isFinite(control.throttle)
        ? Math.max(-1, Math.min(1, control.throttle)) : null;
    found.entity.components.set(AnalogControlComponent, { heading, throttle });
    // ControlShipSystem (which consumes analog state) requires the
    // digital control-state component; a ship steered purely by
    // analog input would otherwise never match the system's query.
    if (!found.entity.components.has(ShipControlStateComponent)) {
        found.entity.components.set(ShipControlStateComponent, new Map());
    }
}

/**
 * A controlled ship's control bookkeeping for the tick being applied
 * (#377). It exists only while a tick's inputs are being applied: the
 * tick's first control input creates it, and HoldControlReleasesSystem
 * deletes it when the step starts draining the event queue, so it is
 * never in a snapshot, a state hash or a wire baseline.
 *
 * - `pressed`: the actions this tick has pressed ('start' or 'repeat').
 * - `held`: the events waiting for the end of the step, in authored
 *   order.
 */
export interface ShipControlTick {
    pressed: Set<ControlAction>;
    held: ControlEvent[];
}
export const ShipControlTickComponent =
    new Component<ShipControlTick>('ShipControlTick');

/**
 * Emitted (targeted at the ship) with a tick's first control input,
 * right after that tick's ShipControlEvent. Both are queued before the
 * step, which `world.step()` queues behind them, so this one's handler
 * (HoldControlReleasesSystem) runs after the edge handlers and BEFORE
 * the step's systems, and what it emits in turn runs AFTER them.
 */
export const ControlTickEvent = new EcsEvent<undefined>('ControlTickEvent');

/**
 * The control events a tick held back for one ship, applied after that
 * tick's step systems (see applyControlEvents). Targeted at the ship.
 */
export const HeldControlEvent =
    new EcsEvent<ControlEvent[]>('HeldControlEvent');

/**
 * Decays the edges a ship's control state already shows ('start' and
 * 'repeat' become plain held: they have been seen), sets `events`, and
 * emits the ShipControlEvent the edge handlers listen for.
 */
function setControlEvents(emit: EmitFunction, uuid: string,
    state: ControlState, events: readonly ControlEvent[]) {
    for (const [action, value] of state) {
        if (value) {
            state.set(action, true);
        }
    }
    for (const { action, state: value } of events) {
        state.set(action, value);
    }
    emit(ShipControlEvent, undefined, [uuid]);
}

/**
 * Applies a peer's control events to the ship it controls.
 *
 * A tick can carry several control inputs from one peer. The relay
 * retimes a lagging sender's late records to its next tick, so a press
 * and its release authored on consecutive ticks can land on the SAME
 * tick (#377), the same way on every world. Applied one after the
 * other, the release undid the press before any system saw it, and the
 * tap was lost: no shot, no missile. The second input also decayed the
 * first one's other edges, and each input ran the edge handlers again.
 * So within one tick:
 *
 * - The tick's first control input decays the previous edges and
 *   emits the tick's one ShipControlEvent. Later inputs add to the same
 *   edge set: the handlers run once, when the step drains the event
 *   queue, and see every press.
 * - Once the tick has pressed an action, any further event for it (its
 *   release, or a second press) is HELD, and so is every event after
 *   it, which keeps the authored order (as takeTickInputs keeps it on
 *   the authoring host). The held events apply after the step's
 *   systems, once the edge handlers and the step (the weapons among
 *   them) have seen the press. A tap that collapsed onto one tick fires
 *   exactly once, and the key is never left down.
 *
 * Only a tap that collapses TWICE onto one tick (press, release, press,
 * release) still loses its second press: the end-of-step application is
 * one more edge set, not another tick.
 *
 * The hand-off is two queued events rather than a step system: a step
 * system that deletes a component (GetEntity) and emits would share
 * state with dozens of step systems and need an order pin against each
 * (system_ambiguity_test). Each of these events has a single handler.
 */
export function applyControlEvents(world: World, peerId: string | undefined,
    events: ControlEvent[]) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const { uuid: targetUuid, entity: targetEntity } = found;

    let state = targetEntity.components.get(ShipControlStateComponent);
    if (!state) {
        state = new Map();
        targetEntity.components.set(ShipControlStateComponent, state);
    }
    let tick = targetEntity.components.get(ShipControlTickComponent);
    if (!tick) {
        tick = { pressed: new Set(), held: [] };
        targetEntity.components.set(ShipControlTickComponent, tick);
        setControlEvents(world.emit.bind(world), targetUuid, state, []);
        world.emit(ControlTickEvent, undefined, [targetUuid]);
    }
    for (const { action, state: value } of events) {
        if (tick.held.length > 0 || tick.pressed.has(action)) {
            tick.held.push({ action, state: value });
            continue;
        }
        state.set(action, value);
        if (value !== false) {
            tick.pressed.add(action);
        }
    }
}

/**
 * Ends a tick's control bookkeeping (ShipControlTickComponent) and
 * sends what it held to ApplyHeldControlEventsSystem. It runs on the
 * pre-step ControlTickEvent, so the event it emits is queued behind the
 * step and applies after every step system has run.
 */
export const HoldControlReleasesSystem = new System({
    name: 'HoldControlReleasesSystem',
    events: [ControlTickEvent],
    args: [ShipControlTickComponent, GetEntity, UUID, Emit] as const,
    step(tick, entity, uuid, emit) {
        entity.components.delete(ShipControlTickComponent);
        if (tick.held.length > 0) {
            emit(HeldControlEvent, tick.held, [uuid]);
        }
    },
});

/** Applies the control events a tick held back (see applyControlEvents). */
export const ApplyHeldControlEventsSystem = new System({
    name: 'ApplyHeldControlEventsSystem',
    events: [HeldControlEvent],
    args: [HeldControlEvent, ShipControlStateComponent, UUID, Emit] as const,
    step(held, state, uuid, emit) {
        setControlEvents(emit, uuid, state, held);
    },
});

/**
 * Marks the local peer's ship with PlayerShipSelector, derived from
 * ControlledBy. Peer-local: not part of the shared deterministic state
 * (see PEER_LOCAL_COMPONENTS).
 */
export const SetControlledShipSystem = new System({
    name: 'SetControlledShipSystem',
    args: [ControlledByComponent, GetEntity, GetWorld] as const,
    step(controlledBy, entity, world) {
        const localPeer = world.resources.get(CommunicatorResource)?.uuid;
        if (!localPeer) {
            return;
        }
        const isLocal = controlledBy.peerId === localPeer;
        if (isLocal && !entity.components.has(PlayerShipSelector)) {
            entity.components.set(PlayerShipSelector, undefined);
        } else if (!isLocal && entity.components.has(PlayerShipSelector)) {
            entity.components.delete(PlayerShipSelector);
        }
    }
});

/**
 * Components that legitimately differ between peers (local UI markers).
 * Excluded when comparing worlds across peers.
 */
export const PEER_LOCAL_COMPONENTS = new Set([PlayerShipSelector.name]);
