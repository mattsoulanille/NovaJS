import { ControlAction, Controls, getActions } from '../nova_plugin/core/index.js';

/**
 * Resolves keyboard events to control actions, releasing on a key-up
 * exactly what that key's press pressed.
 *
 * Bindings resolve through the modifiers held at the moment of the event
 * (getActions), so a combo's release could resolve to a different action
 * than its press did: press Alt+C (returnToBay), let go of Alt, then of C,
 * and the key-up resolves to plain C (formation) — the release that
 * reaches the simulation is formation's, and returnToBay stays held
 * there. Releasing by key as well as by binding means nothing a key
 * pressed outlives the key.
 */
export class KeyActions {
    /** event.code -> the actions its press (and repeats) resolved to. */
    private readonly pressed = new Map<string, ControlAction[]>();

    resolve(controls: Controls, event: KeyboardEvent): ControlAction[] {
        const actions = getActions(controls, event);
        const held = this.pressed.get(event.code) ?? [];
        if (event.type === 'keyup') {
            this.pressed.delete(event.code);
            return [...actions, ...held.filter(a => !actions.includes(a))];
        }
        this.pressed.set(event.code,
            [...held, ...actions.filter(a => !held.includes(a))]);
        return actions;
    }
}
