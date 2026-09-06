import { Entity } from 'nova_ecs/entity';
import { GateArrivalComponent } from './gate_transit_plugin.js';

/**
 * ============================================================================
 * WHERE A FAILED TRANSIT PUTS THE SHIP BACK
 * ============================================================================
 *
 * Leaving a system is destructive on the client: by the time the display
 * hears about it the SIMULATION HAS ALREADY DELETED the ship. JumpFromSystem
 * removes a hyperspace jumper and hands the entity over on FinishJumpEvent;
 * GateDepartureSystem does the same on GateTransitEvent; the pump's gate-dock
 * block removes a ship that docks at a hypergate. In every case the entity
 * exists only as the object the event (or the docked record) carries, and
 * everything that follows — building the destination world, spawning a
 * worker, joining a room — can reject.
 *
 * So every one of those paths needs an answer to "and if that fails?", and
 * "return without doing anything" is never it: that answer deletes the
 * player's ship from the game. The answers are:
 *
 *  - 'gate': the ship was AT a gate (a hypergate/wormhole transit, or a map
 *    pick made while docked) AND THE ORIGIN WORLD IS STILL UP. It goes back
 *    to that gate and lifts off from it, which is precisely the path a
 *    player takes when they open a gate map and close it again — slot
 *    bookkeeping, landed escorts and mission ships all already right.
 *  - 'reenter': the ship has NO WORLD TO STAND IN. A hyperspace jump was
 *    never at a gate; and a gate transit whose jumpTo failed AFTER tearing
 *    the origin down (which is where every realistic rejection happens: the
 *    destination world build, the worker, the room join — issue #13) has
 *    had the origin's bridge closed, its display stripped from the stage
 *    and its room left. There is nothing for a lift-off block to add the
 *    ship to, so it re-enters the system it left the way a failed jump
 *    does. The entity still carries whatever kinematics it had at
 *    departure (a jumper: teleported to the rim, coasting inward, stage
 *    'arriving'; a gate ship: sitting at the gate), so it comes back at
 *    the origin's rim or at the origin gate respectively. The transit
 *    "didn't take".
 *
 * The fuel is not refunded in either case: it was spent at departure, in the
 * simulation, on every peer, and a client-local refund would be a rewrite of
 * synced state that no other peer replays.
 *
 * 'lost' is the honest third answer for the one case with no destination to
 * name — a transit whose origin system id was never captured, or a gate
 * transit whose origin is gone and unknown. Nothing can be done, and saying
 * so beats pretending: before issue #13, the gate abort armed a lift-off
 * block that could never run (no bridge, forever) and the player got a
 * black screen with no ship and no save.
 *
 * These functions are pure over the entity (they only strip the arrival
 * marker, which is a claim about a system the ship never reached) and hand
 * back a plan; browser.ts owns the module state that carries it out.
 */
export type TransitRecovery =
    /** Put the ship back at `planetId` (a gate) and lift it off from there. */
    | { kind: 'gate', planetId: string }
    /** Re-enter system `to` with the ship's existing kinematics. */
    | { kind: 'reenter', to: string }
    /** Nothing can be done; `reason` says why. */
    | { kind: 'lost', reason: string };

/**
 * Where the ship came from, as the abort site knows it.
 */
export interface TransitOrigin {
    /** The system the ship left, captured before the transition cleared it. */
    systemId: string | undefined;
    /**
     * Whether that system's world is still the live one: its bridge open
     * and its display on the stage. False once enterSystem has torn it
     * down for the destination.
     */
    worldAlive: boolean;
}

/**
 * Strips the claim that this ship arrived anywhere. A GateArrivalComponent
 * names the spöb the destination world would have positioned the ship at;
 * carried into a recovery it would teleport the ship to a gate it never
 * came through (or, at the origin gate, to the one it never left).
 */
function clearArrivalClaim(entity: Entity): void {
    entity.components.delete(GateArrivalComponent);
}

/**
 * A hypergate or wormhole transit that could not be completed: back to the
 * gate it left from while the origin world is still up; back INTO the
 * origin system once it is not.
 */
export function planGateTransitRecovery(entity: Entity,
    fromSpob: string, origin: TransitOrigin): TransitRecovery {
    clearArrivalClaim(entity);
    if (origin.worldAlive) {
        return { kind: 'gate', planetId: fromSpob };
    }
    if (!origin.systemId) {
        return {
            kind: 'lost',
            reason: 'the origin world is gone and its system is unknown',
        };
    }
    return { kind: 'reenter', to: origin.systemId };
}

/**
 * A hyperspace jump that could not be completed: back into the system it
 * left. `origin` is the system the ship departed, captured before the
 * transition cleared it — without one there is nowhere to put the ship.
 */
export function planHyperspaceJumpRecovery(entity: Entity,
    origin: string | undefined): TransitRecovery {
    clearArrivalClaim(entity);
    if (!origin) {
        return {
            kind: 'lost',
            reason: 'the origin system is unknown',
        };
    }
    return { kind: 'reenter', to: origin };
}
