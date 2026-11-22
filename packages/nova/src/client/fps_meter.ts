import type { ControlEvent } from '../nova_plugin/core/index.js';

/** Minimal DOM surface of stats.js's overlay element, for node-level specs. */
export interface FpsMeterElement {
    style: { display: string };
}

/**
 * Client-local visibility controller for the stats.js FPS overlay (#371 R4).
 *
 * The original game has no always-on FPS counter (and the 80x48 overlay at
 * (0, 0) covers the top-left x2 badge), so the meter starts hidden and is
 * toggled via the rebindable `toggleFpsMeter` control action (default
 * Option+F / Alt+F). Visibility is session-local and never persists across
 * reloads; consumed events never reach the simulation.
 */
export class FpsMeterToggle {
    private shown = false;

    constructor(private readonly dom: FpsMeterElement) {
        this.dom.style.display = 'none';
    }

    get visible(): boolean {
        return this.shown;
    }

    /**
     * Handles a control event. Returns true whenever the action is
     * `toggleFpsMeter` (including keyup and key-repeat) so the caller drops
     * it before it can reach menus or the simulation; toggles visibility on
     * `'start'` edges only.
     */
    handleControlEvent(event: ControlEvent): boolean {
        if (event.action !== 'toggleFpsMeter') {
            return false;
        }
        if (event.state === 'start') {
            this.shown = !this.shown;
            this.dom.style.display = this.shown ? '' : 'none';
        }
        return true;
    }
}
