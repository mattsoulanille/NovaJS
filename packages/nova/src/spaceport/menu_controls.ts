import { Observable, Subscription } from "rxjs";
import { ControlAction, ControlEvent } from '../nova_plugin/core/index.js';

/**
 * Key handling for one landed-UI surface (a menu or dialog).
 *
 * Bound instances form a global focus stack, and only the most
 * recently bound (topmost) instance receives control events. Menus are
 * modal: a key the focused surface doesn't handle does nothing rather
 * than falling through to the surface underneath, so e.g. 'b' over the
 * starmap can't open the bar behind it, and a quantity dialog
 * suppresses every navigation key of its parent. Global key handlers
 * outside the menu system (e.g. the in-flight starmap toggle) should
 * check `MenuControls.focused` and stand down while any menu is bound.
 */
/** Actions that repeat while their key is held by default: list/grid
 * navigation. Everything else (buy, hire, accept, depart...) fires once
 * per press, so holding a key can't e.g. hire a bar full of escorts. An
 * individual surface may opt extra actions in via `repeatableActions`
 * (the outfitter does this for buy/sell) — scoped to that surface only,
 * so global controls (jump, land, fire) never gain repeat behavior. */
const REPEATABLE = new Set<ControlAction>(['up', 'down', 'left', 'right']);

export class MenuControls {
    private static stack: MenuControls[] = [];

    /** The surface that currently owns the keyboard, if any. */
    static get focused(): MenuControls | undefined {
        return MenuControls.stack[MenuControls.stack.length - 1];
    }

    /**
     * The actions that repeat while their key is held on THIS surface.
     * Seeded with the navigation defaults; a surface may add its own
     * (e.g. the outfitter adds buy/sell) without affecting other menus.
     */
    readonly repeatableActions = new Set<ControlAction>(REPEATABLE);

    private controlsSubscription: Subscription | undefined;
    /** Set by {@link release}: this surface is dead and must never take
     * the keyboard again. */
    private released = false;
    constructor(private controlEvents: Observable<ControlEvent>,
        public controls: { [index in ControlAction]?: () => void } = {}) { }

    bind() {
        this.unbind();
        if (this.released) {
            return;
        }
        MenuControls.stack.push(this);
        this.controlsSubscription =
            this.controlEvents.subscribe(({ action, state }) => {
                if (state === false
                    || (state === 'repeat'
                        && !this.repeatableActions.has(action))) {
                    return;
                }
                if (MenuControls.focused !== this) {
                    return;
                }
                this.controls[action]?.();
            });
    }

    unbind() {
        this.controlsSubscription?.unsubscribe();
        this.controlsSubscription = undefined;
        const index = MenuControls.stack.indexOf(this);
        if (index >= 0) {
            MenuControls.stack.splice(index, 1);
        }
    }

    /**
     * Unbinds for good: the surface that owns these controls is being
     * destroyed with its display world (a jump or gate transit while a
     * dialog is up), and every later bind() is a no-op.
     *
     * The permanence is the point. A dialog's show() is an async chain
     * that binds AFTER an await (the hail dialog renders its frame first;
     * a venue's caller re-binds the spaceport's keys once the venue
     * resolves), so an unbind alone can be undone a microtask later by a
     * continuation that does not know its world died — and a surface
     * left on the focus stack after that keeps the keyboard for the rest
     * of the session: the next system's in-flight 'h'/'i'/'m' handlers
     * all stand down while anything is focused.
     */
    release() {
        this.released = true;
        this.unbind();
    }
}
