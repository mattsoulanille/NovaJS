import { GetWorld, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { AddEvent, EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provide';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { GATE_EMERGENCE_DISTANCE } from '../nova_plugin/travel/gate_transit_plugin.js';
import { Optional } from 'nova_ecs/optional';
import { SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { ActiveRanksComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { PlanetComponent, PlanetDataComponent, PlanetTargetComponent, stellarClearanceFor, StellarBribesComponent } from '../nova_plugin/travel/planet_plugin.js';
import { MissionsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/reputation_plugin.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';
import { AnimationGraphicComponent, AnimationGraphicInsert, ObjectDrawSystem } from './animation_graphic_plugin.js';
import { BoardingUiSystem } from "./boarding_plugin.js";
import { TargetShipBeepSystem } from "./ui_sound_triggers_plugin.js";

/**
 * Hypergate open/close animation (display-only, player-local).
 *
 * The stock hypergate sprite (rlëD 2001, shared by every animated stock gate)
 * has 42 frames: one opening sequence whose final two frames flicker while
 * the gate stands open.
 *
 * Behavior (matching the original game):
 * - IDLE: closed and un-animated (frame 0, frozen) while no ship has the
 *   gate selected as its landing target and no arrival is due.
 * - SELECTED: the opening sequence plays FORWARD; on reaching the last two
 *   frames it ALTERNATES between them (the "working" flicker).
 * - DESELECTED: the sequence plays BACKWARDS from wherever it is, back to
 *   closed. Mid-animation reversals continue from the current frame.
 * - ARRIVAL: the gate also opens when a ship is about to arrive through it.
 *   For the local player the browser announces the destination gate the
 *   moment the room switch starts (GateArrivalAnticipationEvent), giving the
 *   opening a head start of roughly the room join + insertion latency.
 *   Remote ships' arrivals carry no advance information (the sim consumes
 *   the arrival marker within a tick, before any delta reaches this peer),
 *   so their gates open when the ship appears at the emergence point.
 *
 * Selection visibility: PlanetTargetComponent is per-ship, delta-synced
 * simulation state, so every ship's landing target — including other
 * players' — is visible to this display world; "no one selecting it" means
 * exactly that. (In practice only player ships ever set a landing target.)
 *
 * Purely cosmetic and driven by the display world's wall clock; never
 * touches simulation state.
 */

/** How long each animation frame shows. The spöb AnimDelay of every stock
 * gate is 0 (unset; the Bible's unit is 30ths of a second), so the rate is
 * tuned to feel. */
export const GATE_FRAME_MS = 80;
/** How long an announced/observed arrival holds the gate open. Covers the
 * full stock opening (~3.4s) plus a beat of flicker while the arriving ship
 * pulls away. */
export const GATE_ARRIVAL_HOLD_MS = 5000;

export interface GateAnimationState {
    mode: 'closed' | 'opening' | 'flicker' | 'closing';
    frame: number;
    /** Display-clock time (ms) the frame last advanced. */
    lastAdvance: number;
}

/**
 * Advances the gate animation state machine one display tick. Pure and
 * unit-testable: `wantOpen` is the resolved trigger (selection or arrival),
 * `frames` the sprite's frame count, `now` the display clock in ms.
 *
 * closed --open--> opening --(reaches the last two frames)--> flicker;
 * opening/flicker --close--> closing, which steps BACKWARDS from the
 * CURRENT frame (no jumps on mid-animation reversals) down to closed;
 * closing --open--> opening resumes forward from the current frame.
 */
export function stepGateAnimation(state: GateAnimationState, wantOpen: boolean,
    frames: number, now: number) {
    if (frames < 2) {
        return; // A static (single-frame) gate has nothing to animate.
    }
    const advance = now - state.lastAdvance >= GATE_FRAME_MS;
    switch (state.mode) {
        case 'closed':
            state.frame = 0;
            if (wantOpen) {
                state.mode = 'opening';
                state.lastAdvance = now;
            }
            break;
        case 'opening':
            if (!wantOpen) {
                // Reverse from the current frame; no jump.
                state.mode = 'closing';
                break;
            }
            if (advance) {
                state.lastAdvance = now;
                if (state.frame + 1 >= frames - 1) {
                    state.frame = frames - 1;
                    state.mode = 'flicker';
                } else {
                    state.frame++;
                }
            }
            break;
        case 'flicker':
            if (!wantOpen) {
                state.mode = 'closing';
                break;
            }
            if (advance) {
                state.lastAdvance = now;
                // The open gate alternates between the sequence's last two
                // frames.
                state.frame =
                    state.frame === frames - 1 ? frames - 2 : frames - 1;
            }
            break;
        case 'closing':
            if (wantOpen) {
                // Resume opening from the current frame; no jump.
                state.mode = 'opening';
                break;
            }
            if (advance) {
                state.lastAdvance = now;
                if (state.frame <= 1) {
                    state.frame = 0;
                    state.mode = 'closed';
                } else {
                    state.frame--;
                }
            }
            break;
    }
}

export const GateAnimationComponent =
    new Component<GateAnimationState>('GateAnimation');

const GateAnimationProvider = Provide({
    name: 'GateAnimationProvider',
    provided: GateAnimationComponent,
    args: [PlanetDataComponent] as const,
    factory: (): GateAnimationState =>
        ({ mode: 'closed', frame: 0, lastAdvance: 0 }),
    // #156 pin (shared: *): GateAnimationPlugin registers after
    // BoardingDisplayPlugin.
    after: [BoardingUiSystem],
});

/**
 * Announces that a ship (the local player) is about to arrive through the
 * gate whose spöb global id is `spob`. The browser emits this on the
 * destination display world as soon as it exists — before the room join
 * completes and the ship is inserted — so the gate's opening gets whatever
 * head start that latency provides.
 */
export const GateArrivalAnticipationEvent =
    new EcsEvent<{ spob: string }>('GateArrivalAnticipationEvent');

/**
 * spöb global id -> display-clock time (ms) until which that gate holds
 * open for an arrival. A resource (not per-gate state) so an anticipation
 * that lands before the gate entity or its animation state exists is not
 * lost.
 */
export const GateAnticipationResource =
    new Resource<Map<string, number>>('GateAnticipation');

const AnticipateArrivalSystem = new System({
    name: 'AnticipateArrivalSystem',
    events: [GateArrivalAnticipationEvent],
    args: [GateArrivalAnticipationEvent, GateAnticipationResource,
        TimeResource] as const,
    step({ spob }, anticipation, time) {
        anticipation.set(spob, time.time + GATE_ARRIVAL_HOLD_MS);
    },
});

const GateQuery = new Query([PlanetComponent, PlanetDataComponent,
    MovementStateComponent] as const);

/**
 * A ship appearing out of nowhere at a gate's emergence point just arrived
 * through it (remote players' transits give this peer no earlier signal):
 * hold that gate open. The margin over the emergence distance allows for the
 * ship coasting outward before this peer first saw it.
 */
const ShipArrivedAtGateSystem = new System({
    name: 'ShipArrivedAtGateSystem',
    events: [AddEvent],
    args: [ShipComponent, MovementStateComponent, GateAnticipationResource,
        TimeResource, RunQuery] as const,
    step(_ship, movement, anticipation, time, runQuery) {
        for (const [planet, planetData, gateMovement] of runQuery(GateQuery)) {
            if (planetData.gate?.kind !== 'hypergate') {
                continue;
            }
            const distance = movement.position
                .subtract(gateMovement.position).length;
            if (distance < GATE_EMERGENCE_DISTANCE * 2) {
                anticipation.set(planet.id, time.time + GATE_ARRIVAL_HOLD_MS);
            }
        }
    },
    // #156 pin (shared: *): among the AddEvent handlers, after the graphic
    // insert.
    after: [AnimationGraphicInsert],
});

/**
 * A ship's landing selection plus everything the clearance rule reads. A
 * PLAYER (the only kind of ship that carries a legal record) opens a gate
 * only if the gate would actually let it through — the same
 * stellarClearanceFor verdict the landing gate, radar blip and comm dialog
 * quote (ränk 147 unlocks the stock network) — so a pilot without access
 * sees a gate that ignores them. NPC selections open it as before.
 */
const ShipTargetQuery = new Query([PlanetTargetComponent,
    Optional(LegalRecordsComponent), Optional(ShipDataComponent),
    Optional(OutfitsStateComponent), Optional(StellarBribesComponent),
    Optional(ActiveRanksComponent), Optional(MissionsComponent)] as const);

export const GateAnimationSystem = new System({
    name: 'GateAnimationSystem',
    args: [GateAnimationComponent, PlanetComponent, PlanetDataComponent,
        AnimationGraphicComponent, UUID, TimeResource,
        GateAnticipationResource, RunQuery, GetWorld] as const,
    step(state, planet, planetData, graphic, uuid, time, anticipation,
        runQuery, world) {
        // Optional resources: a test world without game data treats every
        // selection as cleared (the pre-clearance rule).
        const gameData = world.resources.get(SimulationGameDataResource);
        const simTime = world.resources.get(SimulationTimeResource);
        if (planetData.gate?.kind !== 'hypergate') {
            return;
        }
        // The frame count comes from the loaded sprite sheet (all frames load
        // regardless of the declared 'normal' range). A single-frame gate
        // (e.g. plug-in gates with static sprites) has nothing to animate.
        const sprites = [...graphic.sprites.values()];
        const frames = Math.min(...sprites.map(s => s.frames));
        if (!Number.isFinite(frames) || frames < 2) {
            return;
        }

        // Open while ANY ship has this gate selected as its landing target
        // (per-ship synced state, so other players' selections count too),
        // or while an arrival through this gate is pending/fresh.
        let wantOpen = false;
        for (const [target, records, shipData, outfits, bribes, ranks,
            missions] of runQuery(ShipTargetQuery)) {
            if (target.target !== uuid) {
                continue;
            }
            // Bribe expiries are sim-clock stamps: judge them against the
            // mirrored sim clock, never this world's wall clock.
            const cleared = !records || !gameData || stellarClearanceFor({
                planetData, gameData, records, shipData, outfits, bribes,
                ranks, missions, planetId: planet.id,
                now: simTime?.time ?? 0,
            }).cleared;
            if (cleared) {
                wantOpen = true;
                break;
            }
        }
        if (!wantOpen) {
            const until = anticipation.get(planet.id);
            if (until !== undefined) {
                if (time.time < until) {
                    wantOpen = true;
                } else {
                    anticipation.delete(planet.id);
                }
            }
        }

        stepGateAnimation(state, wantOpen, frames, time.time);

        // Override the frame ObjectDrawSystem's rotation pass picked (planets
        // have a 1-frame 'normal' set, which pins frame 0 every tick).
        for (const sprite of sprites) {
            sprite.frame = Math.min(frames - 1, state.frame);
        }
    },
    // GateAnimationProvider is a #156 pin (shared: *).
    after: [ObjectDrawSystem, GateAnimationProvider],
    // #156 pin (shared: *): before the UI sound triggers.
    before: [TargetShipBeepSystem],
});

export const GateAnimationPlugin: Plugin = {
    name: 'GateAnimationPlugin',
    build(world) {
        world.addComponent(GateAnimationComponent);
        world.resources.set(GateAnticipationResource, new Map());
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(GateAnimationProvider);
        world.addSystem(AnticipateArrivalSystem);
        world.addSystem(ShipArrivedAtGateSystem);
        world.addSystem(GateAnimationSystem);
    },
    remove(world) {
        world.removeSystem(GateAnimationSystem);
        world.removeSystem(ShipArrivedAtGateSystem);
        world.removeSystem(AnticipateArrivalSystem);
        world.removeSystem(GateAnimationProvider);
        world.resources.delete(GateAnticipationResource);
    }
}
