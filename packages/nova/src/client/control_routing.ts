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
    /** When the events reach the router (performance.now); specs pass it.
     * Omitted means now. */
    now?: number;
}

/** What {@link ControlRouter.frame} reads once per drawn frame. */
export interface ArrivalFrameTargets {
    /** The live system's simulation bridge, if any. */
    bridge: ControlRouteTargets['bridge'];
    /**
     * True while the player cannot see the system they are arriving in
     * yet: the hyperspace flash still covers the screen
     * (display/jump_fade_plugin.ts jumpFadeCovering).
     */
    arrivalHidden: boolean;
    /** Fire-and-forget wrapper for the bridge call (runtime.sendToBridge). */
    send(call: Promise<void>): void;
    /** This frame's time (performance.now). */
    now: number;
}

/**
 * How long after the first frame that shows an arrival the held-jump
 * decision waits (see {@link ControlRouter}): long enough for the key
 * events held up behind that frame to be dispatched first.
 */
export const ARRIVAL_DECISION_DELAY_MS = 50;
/**
 * A backstop: the held jump is decided this long after a new system's
 * bridge was first seen even if the flash never reports clear.
 */
export const ARRIVAL_GATE_MAX_MS = 5000;

/**
 * Routes the client's in-space control events: client-local actions are
 * handled first; the rest reach the display world and the UI's control
 * stream unchanged, and the SIMULATION — the bridge, and so the room's
 * input log — without keyboard auto-repeat.
 *
 * Why: no simulation system acts on 'repeat'. Edge-triggered actions
 * (land, cycle target, cloak...) fire on 'start' only, and held actions
 * (accelerate, turn, fire) read the state as truthy from 'start' until
 * the release (nova_plugin/player/ship_control.ts); the one place a
 * 'repeat' differs from a 'start' is the first jump press after an
 * arrival (below), and only the re-assert this router sends itself is
 * one there. Yet each repeat of a
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
 *
 * THE HELD-J ROUTE JUMP is decided here, not by the next auto-repeat.
 * Holding `j` chains a route: on the original each hop starts only while
 * `j` is down at the moment the ship can jump, so a tap, or a release
 * during the transit, flies one hop and a held key flies them all
 * (reference "Multi-jump routes and the `j` key, wave 11"). Here the
 * destination's simulation goes live, its arriving ship already out of
 * hyperspace, while the white flash still covers the screen, and the
 * first frame that shows the new system can be a long one (it builds the
 * system's whole picture). So:
 *
 *  - From the moment a new bridge is seen until its arrival is decided,
 *    no jump PRESS reaches it: not an auto-repeat (Matthew, 2026-11-23:
 *    a key let go before the system was visible still jumped again) and
 *    not a fresh press either (a tap on the white screen does not carry
 *    into the next system). Releases go through as always.
 *  - The router follows the jump key itself, from every press and
 *    release whether a bridge is live or not, so the decision does not
 *    wait for an auto-repeat (one more delay) or need one at all (a Mac
 *    stops repeating a held key once another key is pressed after it).
 *  - The decision comes ARRIVAL_DECISION_DELAY_MS after the first frame
 *    that shows the arrival ({@link frame}), never on that frame. Key
 *    events the first frame held up are dispatched behind it, and a
 *    release made while the screen was still white is among them. The
 *    flash used to clear INSIDE that frame, so the repeats queued behind
 *    it found the arrival visible and re-asserted a key the player had
 *    already let go of (Matthew, 2026-11-26: "I'll immediately jump out
 *    to the next system in the path even when not pressing anything").
 *  - If the key is down then, the bridge is told once, as a 'repeat' —
 *    never a 'start': the simulation tells the two apart. By then the
 *    ship has coasted on for that first frame's length, and maybe into
 *    the no-jump zone; the arrival's held-key decision
 *    (nova_plugin/travel/jump_plugin.ts HyperspaceArrivalComponent) lets
 *    the first press after an arrival through if it is a key held through
 *    it, and refuses a fresh one ('start') inside the zone, as the
 *    original refuses any press there (wave 45: no arrival grace).
 */
export class ControlRouter {
    private readonly held = new Set<ControlAction>();
    private heldFor: ControlRouteTargets['bridge'];
    /** The jump key as the keyboard has it, whatever bridge is live. */
    private jumpDown = false;
    /** The current bridge's undecided arrival (see the class comment). */
    private arrival: { since: number, visibleAt?: number } | undefined;

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
        for (const event of passed) {
            if (event.action === 'hyperjump') {
                this.jumpDown = event.state !== false;
            }
        }
        targets.displayWorld?.emit(EcsControlEvent, passed);
        for (const event of passed) {
            targets.controlsSubject.next(event);
        }
        const { bridge } = targets;
        if (!bridge) {
            return;
        }
        this.noteBridge(bridge, targets.now ?? performance.now());
        const simEvents = this.simulationEvents(passed);
        if (simEvents.length > 0) {
            targets.send(bridge.controlEvents(simEvents));
        }
    }

    /**
     * Once per drawn frame (game_session's ticker): notes when the
     * current bridge's arrival first shows and, ARRIVAL_DECISION_DELAY_MS
     * later, tells the bridge the jump key is down if it still is.
     */
    frame(targets: ArrivalFrameTargets) {
        const { bridge, now } = targets;
        if (!bridge) {
            return;
        }
        this.noteBridge(bridge, now);
        const arrival = this.arrival;
        if (!arrival) {
            return;
        }
        if (arrival.visibleAt === undefined) {
            if (!targets.arrivalHidden
                || now - arrival.since >= ARRIVAL_GATE_MAX_MS) {
                arrival.visibleAt = now;
            }
            return;
        }
        if (now - arrival.visibleAt < ARRIVAL_DECISION_DELAY_MS) {
            return;
        }
        this.arrival = undefined;
        if (this.jumpDown && !this.held.has('hyperjump')) {
            this.held.add('hyperjump');
            targets.send(bridge.controlEvents(
                [{ action: 'hyperjump', state: 'repeat' }]));
        }
    }

    /** The window lost focus: the key-ups of keys held now will not
     * come, so the jump key no longer counts as down. */
    releaseKeys() {
        this.jumpDown = false;
    }

    private noteBridge(bridge: NonNullable<ControlRouteTargets['bridge']>,
        now: number) {
        if (bridge !== this.heldFor) {
            // A new system's simulation: it has been told nothing yet.
            this.heldFor = bridge;
            this.held.clear();
            this.arrival = { since: now };
        }
    }

    /** The events the simulation needs: all but redundant repeats, and no
     * jump press while the arrival is undecided. */
    private simulationEvents(events: readonly ControlEvent[]): ControlEvent[] {
        const simEvents: ControlEvent[] = [];
        for (const event of events) {
            if (event.state === false) {
                this.held.delete(event.action);
            } else if (this.arrival && event.action === 'hyperjump') {
                // Undecided arrival: frame() tells the bridge.
                continue;
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
