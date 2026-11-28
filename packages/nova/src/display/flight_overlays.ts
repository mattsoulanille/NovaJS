import { Resource } from 'nova_ecs/resource';
import { World } from 'nova_ecs/world';
import { DockedShipResource } from './docked_ship.js';

/**
 * ============================================================================
 * The in-flight overlays, and the one path a docking closes them through
 * ============================================================================
 *
 * The full map (`m`), the minimap (`h`), mission info (`i`), player info
 * (`p`, with its Jettison confirmation), the hail channel (`y`), a ship's
 * mission offer and a mission ship's done text are all drawn over SPACE
 * and bound on the one process-wide focus stack (MenuControls). The
 * original closes in-flight dialogs on landing; here the game goes on
 * under them, and the autopilot (autopilot.ts) keeps tapping `land`
 * with the map open. A landing does not rebuild the display world
 * (a jump does, and each plugin's remove() dismisses its own), so before
 * this an overlay open at touchdown simply stayed open UNDER the
 * spaceport: still bound below it, still "visible" to its opener, which
 * then refused to open it again — `m` on the planet did nothing
 * (Matthew, 2026-11-27) — and back on top, holding the keyboard, the
 * moment the spaceport let go at lift-off.
 *
 * So every in-flight overlay registers how to close itself here, and
 * docking (a spaceport landing, OpenSpaceportSystem; a hypergate dock,
 * OpenGateMapSystem) closes them all through {@link closeFlightOverlays}
 * before its own screen takes the keyboard. Each close leaves its
 * overlay reusable — unlike the teardown dismissals, which are final —
 * and also cancels an open still on its way up (a show() that has not
 * bound yet must not bind over the spaceport once its awaits resolve).
 *
 * Client-local: nothing here touches the simulation. What a close
 * settles with is the overlay's own business (the map commits its route
 * as Done does; an offer is withdrawn, neither accepted nor refused).
 */
export class FlightOverlays {
    private readonly closers = new Map<string, () => void>();

    /** Registers (or replaces) how the overlay `name` closes. */
    register(name: string, close: () => void): void {
        this.closers.set(name, close);
    }

    unregister(name: string): void {
        this.closers.delete(name);
    }

    /** The registered overlays' names, for specs. */
    get names(): string[] {
        return [...this.closers.keys()];
    }

    /**
     * Closes every registered overlay, open or opening. One that throws
     * is logged and does not stop the rest: a landing must not leave
     * any of them bound because another failed.
     */
    closeAll(): void {
        for (const [name, close] of this.closers) {
            try {
                close();
            } catch (e) {
                console.warn(`Closing the ${name} at docking failed:`, e);
            }
        }
    }
}

export const FlightOverlaysResource =
    new Resource<FlightOverlays>('FlightOverlays');

/** The world's registry, made on first use (plugin build order is moot). */
export function flightOverlays(world: World): FlightOverlays {
    let overlays = world.resources.get(FlightOverlaysResource);
    if (!overlays) {
        overlays = new FlightOverlays();
        world.resources.set(FlightOverlaysResource, overlays);
    }
    return overlays;
}

/**
 * Whether the player is landed at a spaceport of `world`: an in-flight
 * overlay whose opener was still loading at the landing must not open
 * now (OfferPopup.withdrawnWhen).
 */
export function landedIn(world: World): boolean {
    return world.resources.get(DockedShipResource)?.current !== undefined;
}

/** Closes every in-flight overlay of `world` (see the module doc). */
export function closeFlightOverlays(world: World): void {
    world.resources.get(FlightOverlaysResource)?.closeAll();
}
