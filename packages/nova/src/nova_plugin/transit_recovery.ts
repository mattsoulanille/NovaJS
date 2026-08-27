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
 * player's ship from the game. The two answers are:
 *
 *  - 'gate': the ship was AT a gate (a hypergate/wormhole transit, or a map
 *    pick made while docked). It goes back to that gate and lifts off from
 *    it, which is precisely the path a player takes when they open a gate
 *    map and close it again — slot bookkeeping, landed escorts and mission
 *    ships all already right.
 *  - 'reenter': the ship was IN FLIGHT (a hyperspace jump). There is no gate
 *    to stand on, so it re-enters the system it left. The entity still
 *    carries the arrival kinematics JumpSequenceSystem stamped on it at
 *    departure — teleported to the rim, coasting inward at top speed, stage
 *    'arriving' — so it drops out of hyperspace at the ORIGIN's rim exactly
 *    as it would have at the destination's. The jump "didn't take".
 *
 * The fuel is not refunded in either case: it was spent at departure, in the
 * simulation, on every peer, and a client-local refund would be a rewrite of
 * synced state that no other peer replays.
 *
 * 'lost' is the honest third answer for the one case with no destination to
 * name — a jump whose origin system id was never captured. Nothing can be
 * done, and saying so beats pretending.
 *
 * These functions are pure over the entity (they only strip the arrival
 * marker, which is a claim about a system the ship never reached) and hand
 * back a plan; browser.ts owns the module state that carries it out.
 */
export type TransitRecovery =
    /** Put the ship back at `planetId` (a gate) and lift it off from there. */
    | { kind: 'gate', planetId: string }
    /** Re-enter system `to` with the ship's existing arrival kinematics. */
    | { kind: 'reenter', to: string }
    /** Nothing can be done; `reason` says why. */
    | { kind: 'lost', reason: string };

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
 * gate it left from.
 */
export function planGateTransitRecovery(entity: Entity,
    fromSpob: string): TransitRecovery {
    clearArrivalClaim(entity);
    return { kind: 'gate', planetId: fromSpob };
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
