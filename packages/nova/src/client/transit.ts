/**
 * ============================================================================
 * Leaving a system: jumps, gates, wormholes, and putting the ship back
 * ============================================================================
 *
 * The simulation deletes a departing ship BEFORE the client hears about
 * it (JumpFromSystem on FinishJumpEvent, GateDepartureSystem on
 * GateTransitEvent, the pump's gate dock), so from the moment one of
 * these handlers runs the player entity exists only as the object the
 * event carried. Everything here is about carrying that object to the
 * right system — through {@link jumpTo} — and, when that fails, putting
 * it SOMEWHERE (nova_plugin/travel/transit_recovery.ts holds the choice: back at
 * the gate while the origin world is up, back INTO the origin once it is
 * not, and 'lost' only when there is nothing to name).
 *
 * Every follow-through is a tracked transition of the session
 * (client/session_transitions.ts), recovery included: an exit-to-title
 * during the (possibly long) date advance waits for this to bail rather
 * than letting the jumpTo start into a torn-down session, and a
 * SessionEndedError means "do not recover — there is no world to recover
 * into, and the save that stands is the last one written".
 */
import type { Entity } from 'nova_ecs/entity';
import { daysPerJump } from '../nova_plugin/player/index.js';
import {
    GateArrivalComponent, planGateTransitRecovery, planHyperspaceJumpRecovery,
} from '../nova_plugin/travel/index.js';
import { ShipComponent, ShipPhysicsComponent } from '../nova_plugin/ship/index.js';
import { advanceEntityDate } from '../spaceport/mission_session.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    activeSystemId, requestGateLaunch, returnToGate, strand, TransitPlan,
} from './client_state.js';
import type { ClientRuntime } from './runtime.js';
import { isSessionEnded } from './session_transitions.js';
import { isSystemLive, jumpTo, WorldWiring } from './system_entry.js';

/** The ship a departure event carried. */
export interface DepartingShip {
    entity: Entity;
    uuid: string;
}

/**
 * The player's hyperspace jump has finished (FinishJumpEvent for the
 * local player's ship). Advances the calendar by the jump's days, then
 * follows the ship to its destination; a failed follow-through re-enters
 * the origin.
 */
export function followHyperspaceJump(runtime: ClientRuntime,
    data: DepartingShip & { to: string }, wire: WorldWiring): void {
    // The system being LEFT, captured before the transition clears it. A
    // failed jumpTo has nowhere else to put the ship back.
    const origin = activeSystemId(runtime.state.state);
    // The WHOLE follow-through is a tracked transition (issue #30), date
    // advance included: an exit-to-title during the (possibly long)
    // advance waits for this to bail rather than letting the jumpTo below
    // start into a torn-down session.
    void runtime.transitions.run(async () => {
        await advanceDateForJump(runtime, data.entity);
        // A rejection here used to be unobserved: the ship (already
        // deleted sim-side) was simply gone. Recover it into the system it
        // left, the way a failed gate transit recovers to its gate.
        try {
            await jumpTo(runtime, {
                kind: 'hyper', from: origin, to: data.to, uuid: data.uuid,
                entity: data.entity,
            }, wire);
        } catch (e) {
            if (isSessionEnded(e)) {
                // Exit-to-title took the session: there is no world to
                // recover the ship into, and nothing was lost — the save
                // that stands is the last one written.
                return;
            }
            console.warn('Hyperspace jump failed:', e);
            await abortHyperspaceJump(runtime, data, origin,
                'Hyperspace jump failed.', wire);
        }
    }).catch(e => {
        if (!isSessionEnded(e)) {
            console.error('Jump follow-through failed:', e);
        }
    });
}

/**
 * A jump takes days (by ship mass, adjusted by any "hyperspace speed
 * mod" outfits); advance the player's calendar while the entity is
 * between simulations. The date rides to peers with the re-added entity.
 * The derived ShipPhysicsComponent already sums the outfit mods; fall
 * back to the raw ship data if it isn't populated yet.
 */
async function advanceDateForJump(runtime: ClientRuntime, entity: Entity):
    Promise<void> {
    const { gameData } = runtime;
    try {
        const derived = entity.components.get(ShipPhysicsComponent);
        let mass = derived?.mass;
        let speedMod = derived?.hyperspaceSpeedMod ?? 0;
        if (mass === undefined) {
            const shipId = entity.components.get(ShipComponent)?.id;
            const physics = shipId
                ? (await gameData.data.Ship.get(shipId)).physics
                : undefined;
            mass = physics?.mass ?? 100;
            speedMod = physics?.hyperspaceSpeedMod ?? 0;
        }
        await advanceEntityDate(entity, daysPerJump(mass, speedMod),
            MissionUniverse.shared(gameData), gameData);
    } catch (e) {
        // THE DATE COST IS FORFEIT, DELIBERATELY, and the jump still
        // happens. advanceEntityDate is a player-local bookkeeping pass
        // (crons, salaries, mission deadlines); its own cron evaluation
        // already swallows failures internally, so reaching here means
        // something outside that — and refusing the jump over it would
        // strand a ship the simulation has already deleted, which is a
        // far worse outcome than a jump that cost no days. Logged so the
        // discrepancy is visible rather than silent.
        console.warn('Failed to advance the date on jump; jumping anyway '
            + 'without the date cost:', e);
    }
}

/**
 * A wormhole (or a hypergate the simulation resolved itself) has carried
 * the local player's ship out of the system (GateTransitEvent). Reuses
 * the jump room-switch; the sim already removed the ship this frame.
 */
export function followGateTransit(runtime: ClientRuntime, data: DepartingShip
    & { fromSpob: string, destinationSpob: string | null },
    wire: WorldWiring): void {
    // The system being LEFT, captured before the transition clears it: a
    // rejection after jumpTo has torn this world down has nowhere else to
    // put the ship back (issue #13).
    const origin = activeSystemId(runtime.state.state);
    // A rejection here would leave the ship and its flock deleted with
    // nothing to put them back (the sim removed them as the transit
    // began), so failures land on the same recovery as an unresolvable
    // destination.
    void runtime.transitions.run(() => gateTransit(runtime, data, origin, wire)
        .catch(async e => {
            if (isSessionEnded(e)) {
                return; // See followHyperspaceJump.
            }
            console.warn('Gate transit failed:', e);
            await abortGateTransit(runtime, data, origin,
                'Gate transit failed.', wire);
        })).catch(e => {
            if (!isSessionEnded(e)) {
                console.error('Gate transit follow-through failed:', e);
            }
        });
}

/**
 * The hypergate map closed (LeaveGateMapEvent). With a destination
 * picked, ride the jump room switch to it; otherwise lift back off from
 * the origin gate (client/docking.ts's gate launch block).
 */
export function leaveGateMap(runtime: ClientRuntime,
    data: { ship: Entity, destinationSpob: string | null },
    wire: WorldWiring): void {
    const { state } = runtime;
    const current = state.state;
    if (current.kind !== 'gateMap') {
        return;
    }
    const { ship, destinationSpob } = data;
    if (!destinationSpob) {
        state.apply(s => requestGateLaunch(s, ship));
        return;
    }
    const docked = current.ship;
    // Same recovery as a wormhole transit: the pump's gate-dock block has
    // already removed this ship from the simulation, so a rejection
    // anywhere below would lose it. `fromSpob` is the gate it is docked
    // at, which is exactly where abortGateTransit puts it back while this
    // world is still up — and `origin` is where it re-enters once jumpTo
    // has torn this world down (issue #13).
    const abortTo = { entity: ship, uuid: docked.uuid, fromSpob: docked.planetId };
    const origin = current.system.systemId;
    // Tracked, recovery included (see followHyperspaceJump).
    void runtime.transitions.run(async () => {
        try {
            const to = await runtime.gateDestinations.systemOf(destinationSpob);
            if (!to) {
                console.warn(`Hypergate destination ${destinationSpob} is `
                    + `not in any system; lifting off instead.`);
                state.apply(s => requestGateLaunch(s, ship));
                return;
            }
            // The arrival marker rides the re-insertion input record to
            // every peer; GateArrivalSystem in the destination world
            // positions the ship flying out of the arrival gate. The
            // emergence angle is null so the DESTINATION gate's own
            // CustSndID (read there) decides the fly-out direction;
            // randomDraw backs it up when that angle says "random".
            //
            // Math.random() HERE IS NOT SIM RANDOMNESS, though it looks
            // like it. The draw is minted once, on this client, and rides
            // to every peer INSIDE the GateArrivalComponent on the
            // player's insertion record (the same owner-driven input path
            // as the rest of the entity). GateArrivalSystem in the
            // destination world reads only the replicated value, so every
            // peer resolves the same exit; the sim's own wormhole choice
            // uses the replicated RandomResource instead
            // (gate_transit_plugin.ts). Display-side event plumbing, not a
            // determinism-rule exception.
            ship.components.set(GateArrivalComponent, {
                destinationSpob,
                emergenceAngle: null,
                randomDraw: Math.random(),
            });
            await jumpTo(runtime, {
                kind: 'gate', from: origin, to, uuid: docked.uuid, entity: ship,
                arrivalSpob: destinationSpob,
            }, wire);
        } catch (e) {
            if (isSessionEnded(e)) {
                return;
            }
            console.warn('Hypergate transit failed:', e);
            await abortGateTransit(runtime, abortTo, origin,
                'Hypergate transit failed.', wire);
        }
    }).catch(e => {
        if (!isSessionEnded(e)) {
            console.error('Hypergate transit recovery failed:', e);
        }
    });
}

/**
 * Follows a hypergate/wormhole transit to its destination system. The
 * sim already chose the exit spöb (or a random draw for a link-less
 * wormhole) and tagged the ship with a GateArrivalComponent; here we
 * resolve that spöb to its containing system, patch a random wormhole's
 * exit onto the arrival marker, and reuse the jump room-switch to move
 * the player there. GateArrivalSystem in the destination world then
 * teleports the ship to the arrival gate.
 */
async function gateTransit(runtime: ClientRuntime, data: DepartingShip & {
    fromSpob: string, destinationSpob: string | null,
}, origin: string | undefined, wire: WorldWiring): Promise<void> {
    const arrival = data.entity.components.get(GateArrivalComponent);
    let destinationSpob = data.destinationSpob;
    if (!destinationSpob) {
        // Random wormhole: resolve the exit from the full link-less-
        // wormhole list using the sim's replicated random draw.
        destinationSpob = (await runtime.gateDestinations.randomWormholeExit(
            data.fromSpob, arrival?.randomDraw ?? 0)) ?? null;
        if (arrival && destinationSpob) {
            // Record the resolved exit so GateArrivalSystem can position
            // the ship at it in the destination world.
            data.entity.components.set(GateArrivalComponent, {
                ...arrival,
                destinationSpob,
            });
        }
    }
    if (!destinationSpob) {
        await abortGateTransit(runtime, data, origin, `Gate transit from `
            + `${data.fromSpob} had no resolvable destination.`, wire);
        return;
    }
    const to = await runtime.gateDestinations.systemOf(destinationSpob);
    if (!to) {
        await abortGateTransit(runtime, data, origin, `Gate destination spöb `
            + `${destinationSpob} is not in any system.`, wire);
        return;
    }
    await jumpTo(runtime, {
        kind: 'gate', from: origin, to, uuid: data.uuid, entity: data.entity,
        arrivalSpob: destinationSpob,
    }, wire);
}

/**
 * Puts a ship back into the system it just tried to leave through a
 * gate, after the transit turned out to have nowhere to go.
 *
 * WHILE THE ORIGIN WORLD IS STILL UP (a destination that could not be
 * resolved — found before jumpTo ran), recovery reuses the hypergate
 * lift-off machinery rather than re-adding the ship by hand: the
 * `gateMap` state with `launching` set makes the pump's gate lift-off
 * block re-add the ship at the gate, re-insert the landed roster (which
 * is where the swept flock is waiting), and respawn mission ships, with
 * the slot bookkeeping already right. That is exactly the path a player
 * takes when they open a hypergate map and close it without picking.
 *
 * ONCE jumpTo HAS TORN THE ORIGIN DOWN — which is where every realistic
 * rejection happens — that block can never run. So the ship RE-ENTERS
 * the origin system instead, the way a failed hyperspace jump does:
 * jumpTo builds the origin world again and inserts the ship where it was
 * — at the gate — and the retry's own takeEscortsForTransition picks the
 * flock up off the roster jumpTo handed it back to (issue #13).
 */
async function abortGateTransit(runtime: ClientRuntime,
    data: DepartingShip & { fromSpob: string }, origin: string | undefined,
    reason: string, wire: WorldWiring): Promise<void> {
    const { state } = runtime;
    const plan = planGateTransitRecovery(data.entity, data.fromSpob, {
        systemId: origin,
        worldAlive: isSystemLive(state.state, origin),
    });
    // The arrival announcement went with the arrival marker the plan just
    // stripped: `arrivalSpob` rode the failed transit's plan, and the
    // re-entry below names none, so no destination gate is primed to
    // open for a ship that is not coming through it.
    switch (plan.kind) {
        case 'gate':
            console.warn(`${reason} Returning the ship to the origin gate.`);
            state.apply(s => returnToGate(s, {
                uuid: data.uuid, entity: data.entity, planetId: plan.planetId,
            }, data.entity));
            return;
        case 'reenter':
            console.warn(`${reason} Returning the ship to ${plan.to}.`);
            await reenter(runtime, {
                kind: 'reenter', from: origin, to: plan.to, uuid: data.uuid,
                entity: data.entity,
            }, wire);
            return;
        case 'lost':
            console.error(`${reason} The player ship cannot be restored: `
                + `${plan.reason}.`);
            markStranded(runtime, plan.reason);
            return;
    }
}

/**
 * THE HYPERSPACE ANALOGUE OF abortGateTransit: a jump whose destination
 * transition failed. There is no gate to lift off from, so recovery is
 * the honest one: re-enter the system the ship left. The entity already
 * carries the arrival kinematics the sequence stamped on it at departure
 * (teleported to the rim, coasting inward at top speed, stage
 * 'arriving'), so it comes back out of hyperspace at the origin's rim
 * exactly as it would have at the destination's — the jump "didn't
 * take". The escort batch is picked up again by the retry's own
 * takeEscortsForTransition, so the flock arrives beside it.
 *
 * The fuel is NOT refunded: it was spent at departure, in the
 * simulation, on every peer, and refunding it here would be a
 * client-local rewrite of synced state.
 */
async function abortHyperspaceJump(runtime: ClientRuntime,
    data: DepartingShip, origin: string | undefined, reason: string,
    wire: WorldWiring): Promise<void> {
    // The plan also strips the arrival marker: the ship never got
    // anywhere, so the origin world must not try to position it at a gate.
    const plan = planHyperspaceJumpRecovery(data.entity, origin);
    if (plan.kind !== 'reenter') {
        const why = plan.kind === 'lost' ? plan.reason : plan.kind;
        console.error(`${reason} The player ship cannot be restored: ${why}.`);
        markStranded(runtime, why);
        return;
    }
    console.warn(`${reason} Returning the ship to ${plan.to}.`);
    await reenter(runtime, {
        kind: 'reenter', from: origin, to: plan.to, uuid: data.uuid,
        entity: data.entity,
    }, wire);
}

/**
 * The re-entry itself. If it ALSO fails there is nothing further to try
 * — a second recursion would only spin — so it is logged, the state
 * records the ship as stranded, and the pump is left to run shipless
 * rather than throwing into a ticker callback.
 */
async function reenter(runtime: ClientRuntime, plan: TransitPlan,
    wire: WorldWiring): Promise<void> {
    try {
        await jumpTo(runtime, plan, wire);
    } catch (e) {
        if (!isSessionEnded(e)) {
            console.error('Failed to return the player ship to its origin '
                + 'system:', e);
            markStranded(runtime, 'the re-entry into the origin failed');
        }
    }
}

/**
 * Records that the ship is in no world. Only from a transit that holds
 * no claim (the failed transition released it); a "lost" verdict reached
 * while a world is still up leaves that world as it is, which is what
 * the pump running shipless always meant.
 */
function markStranded(runtime: ClientRuntime, reason: string): void {
    const current = runtime.state.state;
    if (current.kind === 'transit' && current.claim === undefined) {
        runtime.state.apply(s => strand(s, reason));
    }
}
