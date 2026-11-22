import type { World } from 'nova_ecs/world';
import type { Subject } from 'rxjs';
import { ControlAction, ControlEvent, EcsControlEvent } from '../nova_plugin/core/index.js';

/** Where {@link ControlRouter.route} sends one batch of control events. */
export interface ControlRouteTargets {
    /**
     * Client-local presentation actions (FPS meter, display scale):
     * returns true when it consumed the event, which then goes nowhere
     * else — never into the input log or the simulation.
     */
    consumeLocal(event: ControlEvent): boolean;
    /** The live system's display world, if any. */
    displayWorld: World | undefined;
    /** The UI's control stream (MenuControls, spaceport lists, dialogs). */
    controlsSubject: Subject<ControlEvent>;
    /** The live system's simulation bridge, if any. */
    bridge: { controlEvents(events: ControlEvent[]): Promise<void> } | undefined;
    /** Fire-and-forget wrapper for the bridge call (runtime.sendToBridge). */
    send(call: Promise<void>): void;
}

/**
 * Routes the client's in-space control events: client-local actions are
 * handled first; the rest reach the display world and the UI's control
 * stream unchanged, and the SIMULATION — the bridge, and so the room's
 * input log — without keyboard auto-repeat.
 *
 * Why: no simulation system acts on 'repeat'. Edge-triggered actions
 * (land, cycle target, cloak...) fire on 'start' only, and held actions
 * (accelerate, turn, fire) read the state as truthy from 'start' until
 * the release (nova_plugin/player/ship_control.ts). Yet each repeat of a
 * held key is its own input record, and over a ~100 ms round trip every
 * record is retimed by the relay and rolled back locally — hundreds of
 * rollbacks while a turn key is held. Repeats still matter to the UI
 * (scrolling the outfitter list, ...), which reads controlsSubject.
 *
 * The one thing a repeat did for the sim is kept: a key pressed while a
 * menu owned the keyboard (its press never reached the sim) and still
 * held when the menu closes becomes held in the sim at its next repeat.
 * So the router remembers which actions the CURRENT bridge has been told
 * are down, and forwards a repeat only for an action it has not — once.
 */
export class ControlRouter {
    private readonly held = new Set<ControlAction>();
    private heldFor: ControlRouteTargets['bridge'];

    route(events: readonly ControlEvent[], targets: ControlRouteTargets) {
        const passed: ControlEvent[] = [];
        for (const event of events) {
            if (!targets.consumeLocal(event)) {
                passed.push(event);
            }
        }
        if (passed.length === 0) {
            return;
        }
        targets.displayWorld?.emit(EcsControlEvent, passed);
        for (const event of passed) {
            targets.controlsSubject.next(event);
        }
        const { bridge } = targets;
        if (!bridge) {
            return;
        }
        const simEvents = this.simulationEvents(bridge, passed);
        if (simEvents.length > 0) {
            targets.send(bridge.controlEvents(simEvents));
        }
    }

    /** The events the simulation needs: all but redundant repeats. */
    private simulationEvents(bridge: NonNullable<ControlRouteTargets['bridge']>,
        events: readonly ControlEvent[]): ControlEvent[] {
        if (bridge !== this.heldFor) {
            // A new system's simulation: it has been told nothing yet.
            this.heldFor = bridge;
            this.held.clear();
        }
        const simEvents: ControlEvent[] = [];
        for (const event of events) {
            if (event.state === false) {
                this.held.delete(event.action);
            } else if (this.held.has(event.action)) {
                if (event.state === 'repeat') {
                    continue;
                }
            } else {
                this.held.add(event.action);
            }
            simEvents.push(event);
        }
        return simEvents;
    }
}
