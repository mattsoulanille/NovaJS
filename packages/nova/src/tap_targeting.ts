import { Entity } from 'nova_ecs/entity';
import { wrapNearestDelta } from 'nova_ecs/datatypes/position';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { Space } from './display/space_resource.js';
import {
    clientToWorld, DisplayScaleResource,
} from './display/screen_size_plugin.js';
import { PlanetComponent } from './nova_plugin/planet_plugin.js';
import { ControlledByComponent } from './nova_plugin/ship_control.js';
import { ShipComponent } from './nova_plugin/ship_plugin.js';

/**
 * Tap (or click — this works with a mouse too) on the game view:
 * - on a ship: target it,
 * - on a planet: autopilot to it and land.
 *
 * Purely a picker: it translates screen taps into "target uuid X" /
 * "navigate to uuid Y" and leaves the acting to the caller.
 */

export interface TapHandlers {
    getWorld(): World | undefined;
    getMyPeerId(): string | undefined;
    targetShip(uuid: string): void;
    navigateToPlanet(uuid: string): void;
    /**
     * Whether a tap at these client coordinates landed on UI rather than
     * on space — an open menu/dialog, a button, the status bar. Such a tap
     * must not fall through to target a ship or land on a planet drawn
     * underneath.
     */
    isBlocked?(clientX: number, clientY: number): boolean;
}

/** How close (world units ≈ px) a tap must be to count as a hit. */
export const SHIP_PICK_RADIUS = 45;
export const PLANET_PICK_RADIUS = 70;
/** Longer presses / larger drags are not taps. */
const TAP_MS = 400;
const TAP_SLOP_PX = 12;

/**
 * The nearest selectable ship and/or planet to a world-space point, using the
 * same radii and own-ship exclusion as tap targeting. Shared with the in-flight
 * cursor plugin so the cursor animates over exactly what a tap would select.
 */
export function pickNearest(entities: Iterable<[string, Entity]>,
    myPeerId: string | undefined, worldX: number, worldY: number) {
    let bestShip: { uuid: string, distance: number } | undefined;
    let bestPlanet: { uuid: string, distance: number } | undefined;
    for (const [uuid, entity] of entities) {
        const movement = entity.components.get(MovementStateComponent);
        if (!movement) {
            continue;
        }
        const isShip = entity.components.has(ShipComponent);
        const isPlanet = entity.components.has(PlanetComponent);
        if (!isShip && !isPlanet) {
            continue;
        }
        if (isShip && entity.components.get(ControlledByComponent)?.peerId
            === myPeerId && myPeerId !== undefined) {
            continue; // Don't target your own ship.
        }
        // Hit-test against the toroidal-nearest copy of the entity so a click
        // on an object drawn across the loop-boundary seam still selects it.
        const distance = Math.hypot(
            wrapNearestDelta(movement.position.x - worldX),
            wrapNearestDelta(movement.position.y - worldY));
        if (isShip && distance <= SHIP_PICK_RADIUS
            && (!bestShip || distance < bestShip.distance)) {
            bestShip = { uuid, distance };
        }
        if (isPlanet && distance <= PLANET_PICK_RADIUS
            && (!bestPlanet || distance < bestPlanet.distance)) {
            bestPlanet = { uuid, distance };
        }
    }
    return { bestShip, bestPlanet };
}

export function installTapTargeting(view: HTMLElement,
    handlers: TapHandlers): void {
    let start: {
        pointerId: number, x: number, y: number, time: number,
    } | undefined;

    view.addEventListener('pointerdown', event => {
        // Track single-pointer presses only; a second finger (pinch,
        // button press) voids the tap.
        start = start ? undefined : {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            time: performance.now(),
        };
    });
    view.addEventListener('pointerup', event => {
        const press = start;
        if (!press || event.pointerId !== press.pointerId) {
            return;
        }
        start = undefined;
        if (performance.now() - press.time > TAP_MS
            || Math.hypot(event.clientX - press.x,
                event.clientY - press.y) > TAP_SLOP_PX) {
            return;
        }
        if (handlers.isBlocked?.(event.clientX, event.clientY)) {
            return;
        }
        const world = handlers.getWorld();
        const space = world?.resources.get(Space);
        if (!world || !space) {
            return;
        }
        // The camera only translates (CenterShipSystem sets position;
        // no zoom or rotation), so screen → world is a subtraction — once
        // the pointer's CSS pixels have been divided by the global scale,
        // which the renderer's resolution carries and the DOM knows
        // nothing about.
        const scale = world.resources.get(DisplayScaleResource)
            ?? { ui: 1, global: 1 };
        const worldX = clientToWorld(event.clientX, scale) - space.position.x;
        const worldY = clientToWorld(event.clientY, scale) - space.position.y;
        const { bestShip, bestPlanet } = pickNearest(
            world.entities, handlers.getMyPeerId(), worldX, worldY);
        if (bestShip) {
            handlers.targetShip(bestShip.uuid);
        } else if (bestPlanet) {
            handlers.navigateToPlanet(bestPlanet.uuid);
        }
    });
    view.addEventListener('pointercancel', () => {
        start = undefined;
    });
}
