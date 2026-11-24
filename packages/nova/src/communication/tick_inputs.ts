import type { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';
import type { SimulationInput } from './simulation_input.js';

/**
 * Splits this peer's queued inputs into the part that goes into the next
 * tick's record and the part that waits for a later tick (LOST_KEY_TAPS).
 *
 * The bridge host queues inputs until its next step, so everything the
 * player did between two steps used to land in ONE record — and a tick
 * can only show each control one way. A key pressed and released between
 * two steps reached the step as a release: the press's 'start' edge was
 * overwritten before any edge handler (land, target cycling, escort
 * orders...) ran. Every 0 ms tap was lost, and on a slow frame so is any
 * tap shorter than the frame.
 *
 * So a tick takes inputs in order until one would undo a press the tick
 * already holds:
 *
 * - Once an action has been pressed ('start' or 'repeat') in this tick,
 *   any further event for it — its release, or a second press — waits
 *   for the next tick, and so does everything queued after it (the
 *   authored order is kept). A tap is thus 'start' on tick N and the
 *   release on N+1: the edge handlers see the press, held-state readers
 *   see the key down for exactly one tick, and nothing is left stuck.
 *   A double tap is two edges on consecutive ticks.
 * - A release followed by a press in one tick is fine: the press wins
 *   and is a fresh edge (the key was down again before a step could see
 *   it up).
 * - Adjacent control inputs merge into ONE control input. (Applying them
 *   one at a time used to decay each earlier 'start' to plain held and
 *   emit a ShipControlEvent per input, so separate presses on one tick
 *   lost all edges but the last. applyControlEvents now keeps one edge
 *   set per tick (#377), which also covers several RECORDS on one tick;
 *   merging still keeps the record to one input.) A control input that
 *   would follow a non-control input after a merged one waits for the
 *   next tick instead, so controls never move across another kind of
 *   input. (A control input with no events would apply nothing but the
 *   tick's decay and its event, so it is dropped.)
 *
 * Pure: the queue and its inputs are not modified (records are read-only
 * once made, and these objects may already be in one).
 */
export function takeTickInputs(pending: readonly SimulationInput[]):
    { now: SimulationInput[], later: SimulationInput[] } {
    const now: SimulationInput[] = [];
    /** The tick's one control input, while it is still the last input. */
    let control: { kind: 'control', events: ControlEvent[] } | undefined;
    let controlClosed = false;
    const pressed = new Set<ControlAction>();
    for (let i = 0; i < pending.length; i++) {
        const input = pending[i]!;
        if (input.kind !== 'control') {
            now.push(input);
            if (control) {
                controlClosed = true;
            }
            continue;
        }
        if (controlClosed) {
            return { now, later: pending.slice(i) };
        }
        for (let j = 0; j < input.events.length; j++) {
            const event = input.events[j]!;
            if (pressed.has(event.action)) {
                // When part of this input already went in, the rest of
                // its events wait as an input of their own.
                return {
                    now,
                    later: [j === 0 ? input
                        : { kind: 'control', events: input.events.slice(j) },
                    ...pending.slice(i + 1)],
                };
            }
            if (!control) {
                control = { kind: 'control', events: [] };
                now.push(control);
            }
            control.events.push(event);
            if (event.state !== false) {
                pressed.add(event.action);
            }
        }
    }
    return { now, later: [] };
}
