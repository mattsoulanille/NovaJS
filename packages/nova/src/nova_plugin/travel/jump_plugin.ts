import * as t from 'io-ts';
import { Emit, Entities, GetEntity, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { EcsEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem, MovementState, teleport } from "nova_ecs/plugins/movement_plugin";
import { Optional } from "nova_ecs/optional";
import { EncodedEntity, Serializer, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { TimeResource, TimeSystem } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provide";
import { System } from "nova_ecs/system";
import { isLeft } from "fp-ts/lib/Either.js";
import { registerSimulationBridgeEvent } from "../../communication/simulation_bridge_events.js";
import { deImmerify } from "../../util/deimmerify.js";
import { clearPlunderRecord } from "../ship/index.js";
import { DisabledComponent } from "../ship/index.js";
import { FuelComponent, FUEL_PER_JUMP } from "../ship/index.js";
import { ControlledByComponent, ShipControlStateComponent } from "../player/index.js";
import { ControlShipSystem } from "./ship_controller_plugin.js";
import { ShipPhysics } from "novadatainterface/ship_data";
import { getShipMovementPhysics, ShipPhysicsComponent } from "../ship/index.js";
import { jumpBlocker, jumpRadiusFor } from "./jump_readiness.js";
import { PlayerShipSelector } from "../player/index.js";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";
import { SimulationGameDataResource } from "../core/index.js";
import { PlayerSoundEvent } from "../core/index.js";
import { SystemIdResource } from "../core/index.js";
import { JumpComponent, JumpState, JumpStateType } from "./jump_state.js";

// Hyperspace jump tuning. The EVN Bible documents the *structure* of
// the jump sequence — ships must be outside the no-jump zone ("Jump
// Distance", 1000 pixels, adjusted by "hyperspace dist mod" outfits),
// they come to a stop unless they can "jump without slowing down"
// (shïp Flags2 0x0020 or a "fast jumping" outfit), turn to face the
// destination, and leave at a multiple of the normal hyperspace speed
// (shïp Flags 0x0001/0x0002/0x0004); arriving ships "jump in from
// hyperspace after a short delay". The Bible gives no durations; the
// player's are MEASURED on the original (reference "Jump phases and fuel
// (U8), wave 38": `j` -> arrival 4.8 s from rest, a turn at the hull's
// rate, about 0.4 s still, then about 3.5 s of acceleration, departure and
// arrival on one frame; "Jump phases on a slow hull (U8), wave 39": a
// Turn-10 / Accel-100 hull takes the SAME 4.73 s from rest and 5.5-5.8 s
// from cruise, turning at its own rate almost to the flash and
// accelerating only in the last half second).
//
// THE FIXED CLOCK (the player's jump, and a follower's). The departure
// comes JUMP_CLOCK_MS after the ship is at rest (at once for a ship that
// is already, or that jumps without slowing), whatever its turn rate;
// a moving ship first brakes, at a rate that stops it from its top speed
// in JUMP_BRAKE_MS whatever its acceleration. Inside the clock it turns
// onto the jump heading at its own rate and burns: from
// JUMP_DEPART_DELAY_MS before the departure, or later if the turn runs
// past that, and at the latest JUMP_MIN_BURN_MS before it, turned or not.
// A ship still turning burns as soon as the slot is open and it is within
// JUMP_BURN_ANGLE of the heading, with no hold, finishing the turn under
// thrust (reference "Jump start angle on a slow hull (U8 leftover), wave
// 40"); only a ship that is fully turned early holds JUMP_SPINUP_DELAY_MS. The departure itself does not wait for the
// turn (the arrival heading is the arrival rule's anyway). An NPC's
// departure (`vanish`) keeps its phases: a physical stop, the turn, 1 s
// still and a 2 s burn (NPC_DEPARTURE_*).
/** Radius of the no-jump zone around the system center, in pixels. */
export const JUMP_DISTANCE = 1000;
/** From the ship at rest (or the press, for a ship that need not stop) to
 * its departure. MEASURED: 4.77-4.87 s from the press for the Kit Jump
 * Lancer (wave 38), 4.73 s for the slow hull (wave 39). */
export const JUMP_CLOCK_MS = 4800;
/** How long a ship at its top speed takes to brake to rest when its jump
 * starts, whatever its acceleration (the brake rate scales with the top
 * speed). MEASURED: from cruise the sequence ran about 0.9 s longer than
 * from rest on both hulls (5.73 against 4.80 s; 5.53 / 5.77 against 4.73
 * s), the slow hull's own thrust being far too weak to stop it that fast.
 * GUESS: a forced brake while the ship turns onto the jump heading (the
 * slow hull's turn steps ran through the brake). */
export const JUMP_BRAKE_MS = 900;
/** The least time a ship holds still, facing the destination, before the
 * hyperdrive engages (thrust starting): the ~0.4 s the original's ship
 * sat still (U8 wave 38, u8_a j1: 0.43 s; GUESS that it is a minimum).
 * Only a ship that is fully turned before the burn's slot holds: a slow
 * turner burns within JUMP_BURN_ANGLE with no hold (U8 wave 40). */
export const JUMP_SPINUP_DELAY_MS = 400;
/** How far off the jump heading (radians) a ship still turning may be
 * when its burn starts. MEASURED (U8 wave 40): the Kit Jump Slow Ring
 * (about 29 deg/s) began to move while still 20-45 deg off, with no hold,
 * and was aligned 1-1.5 s before the flash. GUESS: 45 deg, the section's
 * proposal. */
export const JUMP_BURN_ANGLE = Math.PI / 4;
/** The burn's length when the turn leaves room for it: it starts this
 * long before the departure. Acceleration is scaled so the ship reaches
 * its full jump speed exactly at departure. MEASURED: about 3.5 s of
 * acceleration (U8 wave 38: 3.47 s from rest, about 3.6 s from cruise). */
export const JUMP_DEPART_DELAY_MS = 3400;
/** The burn starts at the latest this long before the departure, even
 * for a ship that is still turning (the slow hull accelerated only in the
 * last half second, U8 wave 39; GUESS for the exact figure). */
export const JUMP_MIN_BURN_MS = 500;
/**
 * The pre-wave-38 tuning, kept for an NPC's DEPARTURE (a `vanish` jump,
 * beginDepartureJump): U8 timed only the player's own jumps, so an NPC
 * leaving the system keeps the timings it had (1 s still, 2 s burn).
 * A FOLLOWER (an escort leaving with its player) takes the player's
 * timings, so a flock still warps out together. See jumpStageDelays.
 */
export const NPC_DEPARTURE_SPINUP_DELAY_MS = 1000;
export const NPC_DEPARTURE_DEPART_DELAY_MS = 2000;
/** The spin-up and burn lengths of THIS jump: the measured player
 * minimum hold and nominal burn (the fixed clock, jumpDepartsAt, decides
 * the real ones), or the pre-wave-38 ones for a vanishing NPC
 * departure. */
export function jumpStageDelays(jump: Pick<JumpState, 'vanish'>):
    { spinupMs: number, departMs: number } {
    return jump.vanish
        ? { spinupMs: NPC_DEPARTURE_SPINUP_DELAY_MS,
            departMs: NPC_DEPARTURE_DEPART_DELAY_MS }
        : { spinupMs: JUMP_SPINUP_DELAY_MS, departMs: JUMP_DEPART_DELAY_MS };
}
/**
 * When THIS jump departs (logical ms), from a sequence that has reached
 * its timed stages: the fixed clock's `departAt` for a player's or a
 * follower's jump; a vanishing NPC departure's burn start + its 2 s burn.
 * Undefined before either is known.
 */
export function jumpDepartsAt(jump: Pick<JumpState,
    'vanish' | 'departAt' | 'stage' | 'stageStart'>): number | undefined {
    if (jump.vanish) {
        return jump.stage === 'accelerating' && jump.stageStart !== undefined
            ? jump.stageStart + NPC_DEPARTURE_DEPART_DELAY_MS : undefined;
    }
    return jump.departAt;
}
/**
 * How long THIS jump's departure burn lasts, in ms: from the burn's
 * start (stageStart of 'accelerating') to the departure. The nominal
 * burn when either end is unknown. Never below one millisecond, so the
 * burn acceleration (jumpSpeed / burn) stays finite.
 */
export function jumpBurnMs(jump: Pick<JumpState,
    'vanish' | 'departAt' | 'stage' | 'stageStart'>): number {
    const departs = jumpDepartsAt(jump);
    if (departs === undefined || jump.stageStart === undefined) {
        return jumpStageDelays(jump).departMs;
    }
    return Math.max(1, departs - jump.stageStart);
}
/** The "normal" hyperspace jump speed, scaled per ship by the shïp
 * resource's jump speed flags (75% / 125% / 150%). */
export const JUMP_BASE_SPEED = 1500;
/** NPC traffic jumps in this many seconds of flight (at its regular top
 * speed) outside the no-jump radius (npc_spawn_plugin's jumpInState), and
 * NPC_DEPART_RADIUS is measured in it. Not the player's arrival: see
 * PLAYER_JUMP_ARRIVAL_MARGIN_S. */
export const JUMP_ARRIVAL_MARGIN_S = 3;
/** A ship that JUMPS IN (the player) arrives this many seconds of flight
 * at its regular top speed outside its no-jump radius, coasting inward at
 * that speed: the original's ship arrives about 1,350 px out at Speed 800
 * (about 350 px/s), i.e. 1,000 + one second (reference "Jump phases and
 * fuel (U8), wave 38", finding 3; GUESS that it scales with top speed
 * rather than being a fixed 1,350: one hull measured). A held jump key
 * that reaches the simulation only after the ship has coasted inside the
 * zone still chains: see ARRIVAL_JUMP_GRACE_MS. Multi-jump continues on
 * the tick after the arrival. */
export const PLAYER_JUMP_ARRIVAL_MARGIN_S = 1;

/**
 * THE ARRIVAL GRACE: how long (logical ms) after a ship comes out of
 * hyperspace a jump press still starts the route's next hop although the
 * ship has coasted into the no-jump zone since.
 *
 * Why it exists. On the original a held `j` chains a route hop after hop
 * "each jump starting as soon as the previous one arrived" (reference
 * "Multi-jump routes and the `j` key, wave 11"): the key is read on the
 * arrival frame, a whole second of flight outside the zone. Here the
 * arriving ship is live in the room's simulation (and coasting in on the
 * room's clock) before the player can see it: the client builds and
 * draws the new system first, behind the white flash, and only then
 * passes the held key on (client/control_routing.ts — a key let go while
 * the screen was white must not jump again). That first frame alone can
 * take most of the second (measured headless under load: 0.5-0.8 s; the
 * window is half as long in wall time at 2x), and once the ship was
 * inside the zone the held key did nothing at all — "even when holding
 * j, it does not jump right as I enter" (Matthew, 2026-11-26). So for
 * this long after the arrival the no-jump zone does not refuse a jump;
 * every other condition (route, fuel, disabled, a jump under way) still
 * does.
 *
 * GUESS: 3 s. The player sees the arrival a first frame late (S, in
 * room time; twice the wall time at 2x), so the original's one second
 * to press outside the zone becomes this grace minus S: a full second
 * whenever S is under 2 s. Measured headless under heavy load: S + the
 * key's way in = 0.9-1.0 s at 1x and 1.7-2.0 s at 2x, where 2 s of
 * grace still missed half the hops. A press this late after the arrival
 * can start from well inside the zone (a fast hull would be past the
 * centre), which the original never allows; nothing here is measured.
 */
export const ARRIVAL_JUMP_GRACE_MS = 3000;

/**
 * When (logical ms, the destination world's clock) this ship came out of
 * hyperspace: set by JumpSequenceSystem's 'arriving' stage and read for
 * the arrival grace (ARRIVAL_JUMP_GRACE_MS) by PlayerJumpControl and the
 * display's readiness readouts. Dropped when a jump starts and once the
 * grace is over. Synced (serializer-registered), so the display's
 * jump-ready cue and readout quote the same answer as the gate.
 */
export const HyperspaceArrivalComponent =
    new Component<{ at: number }>('HyperspaceArrival');

/**
 * Whether a ship that came out of hyperspace at `arrival.at` is still in
 * its arrival grace at logical time `now` (see ARRIVAL_JUMP_GRACE_MS).
 */
export function inArrivalJumpGrace(arrival: { at: number } | undefined,
    now: number): boolean {
    return arrival !== undefined && now - arrival.at >= 0
        && now - arrival.at <= ARRIVAL_JUMP_GRACE_MS;
}

/** How closely (radians) an inertial ship must face retrograde before
 * it thrusts to kill its velocity. */
const RETROGRADE_THRUST_TOLERANCE = 0.3;
const ALIGNED_TOLERANCE = 1e-9;

// The engine's hyperspace sounds live at fixed snd resource ids in the
// original game data: 128 "Warp up", 129 "Warp up.x2", 130 "Warp out".
// The EVN Bible does not document how the two warp-up variants are
// chosen; the ".x2" name indicates a double-speed variant of the same
// sound, so ships with an above-normal jump speed (the semi-fast/fast
// jumping shïp flags) play it here.
export const WARP_UP_SOUND = 'nova:128';
export const WARP_UP_FAST_SOUND = 'nova:129';
export const WARP_OUT_SOUND = 'nova:130';

/** The warp-up sound this ship uses, exported so the cancel path
 * (disabled_plugin) can clip the same one the sequence started. */
export function warpUpSound(shipPhysics: { jumpSpeedMult: number }) {
    return shipPhysics.jumpSpeedMult > 1
        ? WARP_UP_FAST_SOUND : WARP_UP_SOUND;
}

/**
 * The `to` a VANISHING jump carries (see JumpStateType's `vanish`): a ship
 * that leaves the game world rather than arriving anywhere still has to
 * name a destination, because `to` is a required wire field.
 *
 * The empty string is used because it is not a legal system uuid and it is
 * FALSY, so the display-side guards that were already asking "is there a
 * destination worth loading?" keep answering no without having to learn
 * about the flag. Simulation code decides the terminal on `vanish` alone.
 */
export const VANISH_DESTINATION = '';

export interface InitiateJump {
    to: string /* system uuid */,
}
export const InitiateJumpEvent = new EcsEvent<InitiateJump>('InitiateJumpEvent');

export type JumpRoute = {
    route: string[],
};
export const JumpRouteComponent = new Component<JumpRoute>('JumpRouteComponent');

/**
 * The two ways a ship moves between systems: a hyperspace JUMP of its own,
 * or a hypergate / wormhole GATE transit. The route reconciliation below
 * and the escort sweeps (player_escort_plugin's EscortTransition) branch
 * on the same pair.
 */
export type TransitKind = 'jump' | 'gate';

/**
 * Reconciles the entity's jump route with the system it just ARRIVED in.
 *
 * Two arrival kinds, two rules:
 *
 *  - 'jump' (hyperspace): beginJump already shifted the destination off
 *    the route at jump START, so on arrival route[0] is normally the NEXT
 *    hop of a multi-jump chain (or the route is empty) and the remaining
 *    hops are exactly the player's onward plan. The one repair is a head
 *    naming THIS system: the starmap, opened during the jump sequence and
 *    closed before the ship departs, re-derives the route from the ORIGIN
 *    and writes back the hop the ship was already committed to. Left
 *    there, the next jump would go straight back out and in again
 *    (Matthew's playtest, 2026-08-17: "you jump out of system B and
 *    arrive in system B"). Later hops are kept — only the reached head
 *    goes. The simulation repairs this too, and by the stronger
 *    stacked-duplicate rule (see JumpRouteReconcileSystem); this keeps the
 *    carried entity right from the very first tick it is re-inserted, so
 *    no peer ever sees the stale destination.
 *  - 'gate' (hypergate / wormhole): the transit never touched the route,
 *    so whatever the player had pinned before is now stale relative to
 *    where they are. If this system heads the route, drop it (a route
 *    through here keeps its later hops); otherwise the route led somewhere
 *    the player didn't go and is CLEARED — a stale single hop from the old
 *    system would otherwise draw the starmap's route line straight from
 *    the new system to a non-adjacent target, and the status bar would
 *    read "Hyperspace: <old target>" (Matthew's playtests, 2026-08-15).
 *
 * Pure over the entity; the caller runs it before the entity is encoded
 * into its insertion record, so every peer sees the same route.
 */
export function reconcileRouteOnArrival(entity: Entity, arrivedSystem: string,
    arrival: TransitKind): void {
    const jumpRoute = entity.components.get(JumpRouteComponent);
    if (!jumpRoute || jumpRoute.route.length === 0) {
        return;
    }
    if (arrival === 'jump') {
        while (jumpRoute.route.length > 0
            && jumpRoute.route[0] === arrivedSystem) {
            jumpRoute.route.shift();
        }
        return;
    }
    if (jumpRoute.route[0] !== arrivedSystem) {
        jumpRoute.route.length = 0;
        return;
    }
    while (jumpRoute.route.length > 0 && jumpRoute.route[0] === arrivedSystem) {
        jumpRoute.route.shift();
    }
}
export const JumpRouteProvider = Provide({
    name: 'JumpRouteProvider',
    // Every controlled ship (any peer's), not just the local player:
    // this is shared simulation state.
    args: [ControlledByComponent] as const,
    provided: JumpRouteComponent,
    factory() {
        return { route: [] };
    }
});

// The sequence's state (JumpStateType / JumpComponent, with their field
// notes) lives in jump_state.ts, so planet_plugin can read it without an
// import cycle; re-exported here for everyone else.
export { JumpComponent, JumpStateType } from './jump_state.js';
export type { JumpState } from './jump_state.js';

/**
 * Marker left on a ship that just arrived from a jump and still has
 * "multi-jump" budget (ModType 32), telling MultiJumpContinueSystem to start
 * the route's next jump this tick without a fresh key press. `left` is the
 * remaining auto-jump budget, passed on to the next JumpComponent. Transient
 * sim state: cloned in snapshots (see snapshot_policies) so a rollback across
 * an arrival tick still auto-continues.
 */
export const MultiJumpContinueComponent =
    new Component<{ left: number }>('MultiJumpContinue');

export interface FinishJump {
    entity: Entity,
    uuid: string,
    to: string,
}
export const FinishJumpEvent = new EcsEvent<FinishJump>('FinishJumpEvent');

const EncodedFinishJumpEvent = t.type({
    entity: EncodedEntity,
    uuid: t.string,
    to: t.string,
});

export function FinishJumpEventType(serializer: Serializer) {
    return new t.Type<FinishJump, {
    entity: EncodedEntity,
    uuid: string,
    to: string,
    }>(
        'FinishJumpEventType',
        (_u): _u is FinishJump => true,
        (input, context) => {
            const encoded = EncodedFinishJumpEvent.validate(input, context);
            if (isLeft(encoded)) {
                return encoded;
            }
            const decoded = serializer.decode(encoded.right.entity);
            if (isLeft(decoded)) {
                return t.failure(
                    encoded.right.entity,
                    context,
                    serializer.describeDecodeFailure(encoded.right.entity, decoded.left),
                );
            }
            return t.success({
                entity: decoded.right,
                uuid: encoded.right.uuid,
                to: encoded.right.to,
            });
        },
        (data) => ({
            entity: serializer.encode(data.entity),
            uuid: data.uuid,
            to: data.to,
        }),
    );
}

registerSimulationBridgeEvent({
    event: FinishJumpEvent,
});

/**
 * Exported so EscortFollowJumpSystem (player_escort_plugin) can order
 * itself BEFORE the departing ship is deleted and its FinishJumpEvent
 * emitted: the escorts' carry events must reach the client's frame event
 * list ahead of the jump the client follows.
 */
export const JumpFromSystem = new System({
    name: 'JumpFromSystem',
    events: [InitiateJumpEvent],
    args: [GetEntity, UUID, Entities, InitiateJumpEvent, Emit] as const,
    step(entity, uuid, entities, { to }, emit) {
        // A FOLLOWER's departure is not a system transition. FinishJumpEvent
        // is the event the client follows out of this system (it tears the
        // origin world down and builds the destination one), and only the
        // ship the client is watching may emit it.
        //
        // ALREADY GONE is the guard that matters, not the `follows` marker:
        // a follower is swept by whoever set it (EscortDepartJumpSystem,
        // ordered before this system), and that sweep drops the
        // JumpComponent along with everything else that must not ride to
        // the destination — so by the time this runs the marker it would
        // have been recognised by has been removed with it. Asking whether
        // the entity is still in the world instead is both the honest
        // question ("is there still a ship here to carry?") and immune to
        // that ordering. The marker check stays as the backstop for a
        // follower whose sweep did not happen at all.
        const jump = entity.components.get(JumpComponent);
        if (!entities.has(uuid) || jump?.follows !== undefined) {
            return;
        }
        // VANISH TERMINAL. A vanishing ship never reaches this system on a
        // peer that understands the flag — JumpSequenceSystem deletes it
        // at burn end without emitting InitiateJumpEvent at all. The guard
        // is here for the state that arrives from a peer that does not:
        // the sentinel names no destination world, so the ship leaves the
        // world rather than being serialized and carried to one. Either
        // way the ship is gone from this system at burn end, which is the
        // convergence the sentinel buys.
        if (jump?.vanish || to === VANISH_DESTINATION) {
            entities.delete(uuid);
            return;
        }
        entities.delete(uuid);
        // A JUMP ENDS A PLUNDER LIFE SEGMENT (Matthew's ruling): the ship
        // arrives in the next system plunderable once again. Cleared here,
        // before the entity is serialized, so the record never rides to
        // the destination in the first place — the alternative (clearing
        // on arrival) would have to be repeated in every arrival path.
        clearPlunderRecord(entity);
        deImmerify(entity);
        emit(FinishJumpEvent, { entity, uuid, to }, [uuid]);
    }
});

/**
 * Attaches a JumpComponent for a jump to `destination`, resolving the travel
 * heading from the origin and destination systems' map positions. Shifts the
 * destination off the route. Returns false (and does nothing) if the system
 * data is not yet cached. `autoJumpsLeft` is the remaining multi-jump budget
 * to carry into this jump.
 *
 * Both getCached reads are provably warm (the staging contract for in-sim
 * getCached): `systemId` is this world's own system, and `destination` is
 * always route[0] — the next hop. A route is a Dijkstra path over
 * system.links (starmap.computeShortestPaths), so every consecutive pair is
 * adjacent; route[0] is therefore a *link* of this world's system, and
 * makeSystem stages every linked system's data at genesis (make_system.ts).
 * This holds at every hop of a multi-jump chain: each per-system world is
 * built through makeSystem on every peer (browser worker, server archive,
 * node worker), so the link set is warm before the world steps.
 */
function beginJump(entity: Entity, systemId: string, destination: string,
    jumpRoute: JumpRoute, shipPhysics: ShipPhysics,
    gameData: SimulationGameDataInterface, autoJumpsLeft: number): boolean {
    const origin = gameData.data.System.getCached(systemId);
    const dest = gameData.data.System.getCached(destination);
    if (!origin || !dest) {
        return false;
    }
    const direction = new Vector(
        dest.position[0] - origin.position[0],
        dest.position[1] - origin.position[1]);
    jumpRoute.route.shift();
    // A ship that jumps again leaves its arrival grace behind (a jump a
    // disable cancels does not get it back).
    entity.components.delete(HyperspaceArrivalComponent);
    entity.components.set(JumpComponent, {
        to: destination,
        // Ships with "fast jumping" skip coming to a stop.
        stage: shipPhysics.canJumpWithoutSlowing ? 'aligning' : 'stopping',
        direction: direction.length === 0 ? 0 : direction.angle.angle,
        autoJumpsLeft,
    });
    return true;
}

/**
 * Attaches the jump sequence to a ship that is LEAVING THE GAME WORLD
 * rather than travelling to another system: an NPC departing or fleeing
 * (npc_ai_plugin). It runs exactly the same visible stages a player
 * gets — stop, align, spin up, accelerate — and ends by deleting the
 * ship instead of carrying it anywhere (the `vanish` flag; see
 * JumpStateType).
 *
 * DIRECTION. NPCs have no route, so there is no map-space heading to
 * resolve. They jump straight out along the radius they are already
 * leaving by: the outward direction from the system center to the
 * ship's own position, sampled once when the sequence begins. That is
 * deterministic (a pure function of synced movement state, no PRNG, no
 * game-data lookup), it is where "depart" was already flying them, and
 * it never points back through the system. Degenerate case: a ship
 * exactly at the center has no outward direction, so it keeps its
 * current heading.
 *
 * Deliberately UNGATED on fuel. NPCs don't track jump fuel, and a
 * fleeing ship must always be able to leave — the same free-jump rule
 * escorts get. The caller owns the other preconditions (a disabled ship
 * cannot spin up a hyperdrive; npc_ai_plugin checks that).
 *
 * No PRNG is drawn here or anywhere else on the jump path, so entering
 * the sequence does not shift any NPC's decision rolls.
 */
export function beginDepartureJump(entity: Entity, movement: MovementState,
    shipPhysics: ShipPhysics): void {
    const outward = new Vector(movement.position.x, movement.position.y);
    const direction = outward.lengthSquared > 1e-12
        ? outward.angle
        : Angle.fromAngleLike(movement.rotation);
    entity.components.set(JumpComponent, {
        // This ship's terminal is to vanish, not to arrive. The flag is
        // what selects that terminal; the sentinel `to` is only there
        // because the field is required on the wire (see JumpStateType).
        vanish: true,
        to: VANISH_DESTINATION,
        stage: shipPhysics.canJumpWithoutSlowing ? 'aligning' : 'stopping',
        direction: direction.angle,
    });
}

/**
 * Attaches the jump sequence to a ship that is FOLLOWING another ship's
 * jump — an escort leaving with its player (player_escort_plugin). It runs
 * the same visible stages everyone else gets, and differs only in the
 * three ways {@link JumpStateType}'s `follows` documents: it is swept by
 * its owner rather than departing through JumpFromSystem, it costs no
 * fuel, and it is cancelled if the leader's own jump is.
 *
 * HEADING. The follower takes the LEADER'S travel heading verbatim, rather
 * than resolving its own. The two would be the same number anyway — the
 * heading is the map-space direction from this system to the destination,
 * a property of the pair of systems and not of the ship — so copying it
 * avoids a second game-data lookup that could fail where the leader's
 * succeeded, and it means the flock visibly swings onto one common bearing
 * and leaves as a formation. It also keeps this function pure: no cache
 * read, no route, nothing that can refuse.
 *
 * Deliberately UNGATED on fuel, exactly as beginDepartureJump is, and for
 * the same reason: a follower must always be able to keep up. The caller
 * owns the preconditions that do apply (escortFollows: a hull with a
 * hyperdrive, not already disabled).
 *
 * No PRNG is drawn here, so putting a flock into their sequences shifts no
 * NPC's decision rolls.
 */
export function beginFollowJump(entity: Entity, leader: string,
    leaderJump: JumpState, shipPhysics: ShipPhysics): void {
    entity.components.set(JumpComponent, {
        // The leader's REAL destination, never the vanish sentinel: a
        // follower is swept to a concrete system, and the caller only ever
        // offers a leader whose jump arrives somewhere
        // (EscortFollowJumpBeginSystem refuses a vanishing leader).
        to: leaderJump.to,
        follows: leader,
        stage: shipPhysics.canJumpWithoutSlowing ? 'aligning' : 'stopping',
        direction: leaderJump.direction,
    });
}

/**
 * Starts the jump sequence while a peer holds hyperjump: checks the
 * no-jump zone, resolves the travel heading from the systems' map
 * positions (staged at world genesis in makeSystem, so the cache read
 * is deterministic), and attaches the JumpComponent state machine.
 *
 * Polled every tick rather than edge-triggered so that *holding* the
 * jump key departs at the first instant a jump becomes possible —
 * flying out of the no-jump zone with the key held, or chain-jumping:
 * ships arrive outside the no-jump radius, so a held key starts the
 * route's next jump immediately, and for ARRIVAL_JUMP_GRACE_MS after
 * the arrival the zone does not refuse it even once the ship has coasted
 * inside (the held key reaches a new system only after its first frame
 * has been seen: client/control_routing.ts).
 */
const PlayerJumpControl = new System({
    name: 'PlayerJumpControl',
    args: [ShipControlStateComponent, GetEntity, SystemIdResource,
        JumpRouteComponent, MovementStateComponent, ShipPhysicsComponent,
        FuelComponent, SimulationGameDataResource, TimeResource,
        Optional(DisabledComponent),
        Optional(HyperspaceArrivalComponent)] as const,
    step(controlState, entity, systemId, jumpRoute, movement, shipPhysics,
        fuel, gameData, time, disabled, arrival) {
        const arrivalGrace = inArrivalJumpGrace(arrival, time.time);
        if (arrival && !arrivalGrace) {
            entity.components.delete(HyperspaceArrivalComponent);
        }
        // Truthy while held ('start'/'repeat'/true); false on release.
        if (!controlState.get('hyperjump')) {
            return;
        }
        const destination = jumpRoute.route[0];
        // THE GATE. Every condition lives in the shared readiness predicate
        // (jump_readiness.ts) so the jump-ready beep and the status bar's
        // dim destination cannot drift from what actually refuses a jump:
        // a disabled ship (it cannot even thrust; disabled_component.ts), a
        // jump already in progress, no route, the no-jump zone (EVN Bible:
        // standard radius 1000, adjusted by "hyperspace dist mod" outfits),
        // and fuel (EVN Bible: "100 = 1 jump").
        const blocked = jumpBlocker({
            hasRoute: destination !== undefined,
            distance: movement.position.length,
            jumpRadius: jumpRadiusFor(JUMP_DISTANCE,
                shipPhysics.jumpDistanceMod),
            fuel: fuel.current,
            fuelPerJump: FUEL_PER_JUMP,
            disabled: disabled !== undefined,
            jumping: entity.components.has(JumpComponent),
            arrivalGrace,
        });
        // The destination re-check is redundant with the 'noRoute' blocker;
        // it is what narrows the type for beginJump.
        if (blocked !== undefined || destination === undefined) {
            return;
        }
        // "multi-jump" (ModType 32): a single jump initiation performs up to
        // multiJump EXTRA jumps along the route automatically. Budget the
        // auto-continues to what the remaining route can actually reach (after
        // this jump's own destination is shifted off).
        const autoJumpsLeft = Math.max(0,
            Math.min(shipPhysics.multiJump, jumpRoute.route.length - 1));
        beginJump(entity, systemId, destination, jumpRoute, shipPhysics,
            gameData, autoJumpsLeft);
    },
    // #237 pin (shared: ControlledBy, JumpRouteComponent): JumpPlugin
    // registers this before its route provider. After TimeSystem: it reads
    // the clock for the arrival grace (determinism rule 4).
    after: [TimeSystem],
    before: [JumpRouteProvider],
});

/**
 * Auto-continues a multi-jump (ModType 32) route the tick after a ship arrives
 * from hyperspace: if it left a MultiJumpContinueComponent marker and still
 * has a routed destination and enough fuel, it starts the next jump without a
 * fresh key press (the ship arrives outside the no-jump zone, so no radius
 * check is needed). Runs before PlayerJumpControl so a released key never
 * cancels an in-flight multi-jump chain.
 */
const MultiJumpContinueSystem = new System({
    name: 'MultiJumpContinueSystem',
    args: [MultiJumpContinueComponent, GetEntity, SystemIdResource,
        JumpRouteComponent, ShipPhysicsComponent, FuelComponent,
        SimulationGameDataResource, Optional(DisabledComponent)] as const,
    step(cont, entity, systemId, jumpRoute, shipPhysics, fuel, gameData,
        disabled) {
        // Consume the marker regardless of outcome, so a blocked continuation
        // (no route / no fuel / disabled) simply ends the chain.
        entity.components.delete(MultiJumpContinueComponent);
        if (entity.components.has(JumpComponent)) {
            return;
        }
        // A ship that arrived disabled cannot spin up its hyperdrive, the
        // same reason PlayerJumpControl refuses. Checked here rather than
        // left to the disabled-cancels-jump rule so the chain ends without
        // ever consuming the route hop it could not fly.
        if (disabled) {
            return;
        }
        const destination = jumpRoute.route[0];
        if (!destination || cont.left <= 0) {
            return;
        }
        if (fuel.current < FUEL_PER_JUMP) {
            return;
        }
        beginJump(entity, systemId, destination, jumpRoute, shipPhysics,
            gameData, cont.left - 1);
    },
    before: [PlayerJumpControl],
});

/**
 * Drops route hops the ship cannot fly from the system it is ALREADY IN —
 * this system itself, or anything that is not one of its hyperlinks —
 * before anything can fly one. A hop like that is not a jump: it takes the ship out of a
 * system and puts it straight back into the same one, so the pilot enters it
 * twice along a single route (Matthew's playtest, 2026-08-17).
 *
 * Three ways such a head gets onto a route, none of which the consumer can
 * tell apart — hence one rule here rather than a guard in each:
 *
 *  - the starmap is opened DURING a jump sequence and closed before the ship
 *    departs. It re-derives the route from the ORIGIN (a correct answer to
 *    "where do I still have to go from here") and writes it back, which puts
 *    the hop the ship is already committed to back at the head.
 *  - a jump cancelled at stage 'arriving' gives its destination back to the
 *    route — the ship is IN that destination (also fixed at the source, in
 *    disabled_plugin's JumpDisableCancelSystem).
 *  - the hop is a stacked duplicate of this system: a different id for the
 *    same place — or any other hop that is not a link of this system, which
 *    could never be flown from here (see hopIsUnflyableFromHere).
 *
 * THE FIX BELONGS IN THE SIMULATION, not in the client that wrote the route.
 * A route arrives here from three separate paths (carried on the entity at
 * insertion, a setJumpRoute input from any peer, and the sim's own cancel
 * unshift), every peer simulates every ship, and the jump destination has to
 * derive from server-visible state alone. This reads only the route
 * component, the world's own SystemIdResource and this system's own staged
 * link list, and it is idempotent
 * within a tick, so a rollback that re-executes it reaches the same state.
 *
 * The whole leading run goes, not one hop: a stack can hold several copies
 * of this system, and the route is then resumed at the first hop that is
 * genuinely somewhere else. Later hops are never touched — they are still
 * the pilot's plan.
 */
export const JumpRouteReconcileSystem = new System({
    name: 'JumpRouteReconcileSystem',
    args: [JumpRouteComponent, SystemIdResource, SimulationGameDataResource,
        Optional(JumpComponent)] as const,
    step(jumpRoute, systemId, gameData, jump) {
        // NOT WHILE A JUMP IS IN PROGRESS. The head is then the hop after
        // the one being flown — measured from the DESTINATION, not from
        // here — and a route that comes back through this system is a
        // perfectly good plan (Procyon -> Kerella -> Procyon). The check
        // resumes the moment the sequence ends, which for an arriving ship
        // is the first tick in the new system: JumpSequenceSystem drops the
        // component there, and nothing can start another jump before then
        // (PlayerJumpControl refuses while one is in progress, and the
        // multi-jump marker is only read on the following tick).
        if (jump) {
            return;
        }
        while (jumpRoute.route.length > 0
            && hopIsUnflyableFromHere(jumpRoute.route[0]!, systemId, gameData)) {
            jumpRoute.route.shift();
        }
    },
    // Before both consumers, so neither can begin a jump to a hop this
    // would have dropped — including the auto-continue that runs on the
    // tick after an arrival without any key press.
    before: [MultiJumpContinueSystem, PlayerJumpControl],
});

/**
 * Whether a route hop is one a ship in `systemId` CANNOT FLY from here — it
 * names this very system, or it is not a hyperlink of this system at all.
 *
 * Not just the same id. Nova stacks several copies of one system at the same
 * map position and swaps between them with control bits — Sol is nova:130
 * under `!(b147|b305)` and nova:531 under `(b147|b305)`, and both are linked
 * from Tichel (nova:129) — so a route pinned under one set of bits can name
 * a DIFFERENT id for the very place the player is standing in. Flying it
 * would leave the system and arrive in a system with the same name at the
 * same coordinates: the pilot sees themselves enter one system twice.
 *
 * DETERMINISTIC BY CONSTRUCTION, and this is why the rule is "not a link
 * of here" rather than "same name and position as here": the ONLY system
 * data this reads is the current system's own record, which makeSystem
 * stages on every peer before the world steps (browser worker, server
 * archive, node worker alike). The hop's own record is never read. It
 * cannot be: the browser worker bulk-warms every system from the preload
 * bundle while the server archive stages only this system and its links,
 * so a getCached read of an arbitrary hop is warm on one peer and cold on
 * another — and a stacked duplicate is never a link of its twin (0 of the
 * 330 same-name-and-position pairs in the stock data are), so it is exactly
 * the read that would diverge (review r13 HIGH). A route is a Dijkstra path
 * over system.links (route.ts), so a legitimate next hop is always in this
 * system's link list; anything else at the head is either this system, its
 * twin, or a stale hop from wherever the route was planned, and none of
 * those can be jumped to from here (beginJump would refuse the unstaged
 * ones on the archive anyway — silently, and forever).
 *
 * If this system's own record is somehow not staged the hop is kept: the
 * answer is then the same "no data" every peer sees.
 */
export function hopIsUnflyableFromHere(hop: string, systemId: string,
    gameData: SimulationGameDataInterface): boolean {
    if (hop === systemId) {
        return true;
    }
    const here = gameData.data.System.getCached(systemId);
    return here !== undefined && !here.links.includes(hop);
}

/** Overrides whatever the player's held controls just wrote: control
 * of the ship is taken away for the duration of the jump. */
function overrideControls(movement: MovementState) {
    movement.accelerating = 0;
    movement.turning = 0;
    movement.turnTo = null;
    movement.turnBack = false;
}

/**
 * Advances a jumping ship's state machine each tick. Runs after the
 * control systems (overriding player input) and before the movement
 * system. The physics the stages imply (the raised hyperspace speed
 * cap and burn acceleration) are applied by the afterburner plugin's
 * EffectiveMovementPhysicsSystem — the single per-tick writer of
 * effective movement physics — which orders itself after this system
 * and reads the jump stage.
 *
 * stopping -> aligning -> spinup -> accelerating happen in the origin
 * system; the ship then crosses to the destination system carrying
 * stage 'arriving'.
 *
 * NOT PLAYER-ONLY. Nothing here is gated on the player: NPCs leaving
 * the system run these same stages (beginDepartureJump), which is why a
 * big slow-turning freighter is now seen to stop and swing onto its
 * jump heading instead of popping out of existence mid-turn. The two
 * flows differ only in the terminal — see JumpStateType's `vanish`.
 *
 * SOUNDS are self-only: the warp-up/warp-out PlayerSoundEvents below are
 * targeted at the jumping ship, and the display's PlayerSoundSystem
 * requires PlayerShipSelector, which only ever sits on the local
 * player's own ship. An NPC's jump is therefore silent for everyone,
 * on every peer.
 */
export const JumpSequenceSystem = new System({
    name: 'JumpSequenceSystem',
    args: [JumpComponent, MovementStateComponent, ShipPhysicsComponent,
        Optional(FuelComponent), Optional(JumpRouteComponent), TimeResource,
        GetEntity, UUID, Entities, Emit] as const,
    step(jump, movement, shipPhysics, fuel, jumpRoute, time, entity, uuid,
        entities, emit) {
        if (jump.follows !== undefined
            && !entities.get(jump.follows)?.components.has(JumpComponent)) {
            // THE LEADER IS NO LONGER JUMPING. A follower's sequence only
            // ever existed because the ship it follows was leaving, so it
            // ends the moment that stops being true — the leader's jump was
            // cancelled (it was disabled: see the disabled-cancels-jump
            // rule in disabled_plugin, which runs before this system, so
            // the whole flock stands down on the SAME tick the leader
            // does), or the leader is simply not here any more.
            //
            // The follower is NOT stopped dead: nothing happened to it. It
            // is released back to its own steering with its velocity
            // intact and falls back into formation. A follower that is
            // itself disabled is stopped dead, but by the general rule
            // applied to it individually, not by this.
            //
            // Returning before overrideControls leaves this tick's steering
            // to whatever wrote it, rather than blanking the controls of a
            // ship that is no longer jumping.
            entity.components.delete(JumpComponent);
            return;
        }
        overrideControls(movement);
        const target = new Angle(jump.direction);
        // The fixed clock (the module comment) runs every jump but an NPC's
        // departure.
        const clocked = !jump.vanish;

        switch (jump.stage) {
            case 'stopping': {
                // Come to a complete stop before turning to the
                // destination (skipped for ships that can jump without
                // slowing down).
                if (clocked) {
                    // A forced brake that stops the ship from its top
                    // speed in JUMP_BRAKE_MS, while it turns onto the jump
                    // heading at its own rate.
                    movement.turnTo = target;
                    const top = getShipMovementPhysics(shipPhysics)
                        .maxVelocity;
                    const speed = movement.velocity.length;
                    const brake = top * time.delta_s
                        / (JUMP_BRAKE_MS / 1000);
                    if (!(brake > 0) || speed <= brake) {
                        movement.velocity = new Vector(0, 0);
                        movement.targetSpeed = 0;
                        jump.stage = 'aligning';
                        jump.departAt = time.time + JUMP_CLOCK_MS;
                        break;
                    }
                    movement.velocity =
                        movement.velocity.scale((speed - brake) / speed);
                    movement.targetSpeed = speed - brake;
                    break;
                }
                const speed = movement.velocity.length;
                const stopThreshold =
                    shipPhysics.acceleration * time.delta_s * 2;
                if (speed <= stopThreshold) {
                    movement.velocity = new Vector(0, 0);
                    movement.targetSpeed = 0;
                    jump.stage = 'aligning';
                    break;
                }
                if (shipPhysics.inertialess) {
                    movement.accelerating = -1;
                } else {
                    // Turn retrograde and thrust once roughly aligned.
                    movement.turnBack = true;
                    const reverse = movement.velocity.angle.add(Math.PI);
                    const misalignment =
                        movement.rotation.distanceTo(reverse).angle;
                    if (Math.abs(misalignment) < RETROGRADE_THRUST_TOLERANCE) {
                        movement.accelerating = 1;
                    }
                }
                break;
            }
            case 'aligning': {
                movement.turnTo = target;
                if (clocked && jump.departAt === undefined) {
                    // A ship that jumps without slowing: the clock starts
                    // with the sequence.
                    jump.departAt = time.time + JUMP_CLOCK_MS;
                }
                const misalignment =
                    movement.rotation.distanceTo(target).angle;
                const aligned = Math.abs(misalignment) < ALIGNED_TOLERANCE;
                // A slow turner still short of the heading burns anyway:
                // with no hold once its slot is open and it is within
                // JUMP_BURN_ANGLE (U8 wave 40: 20-45 deg off), and
                // however far off when the latest start comes (U8 wave
                // 39). It keeps turning under thrust.
                const burnDue = clocked && jump.departAt !== undefined
                    && (time.time >= jump.departAt - JUMP_MIN_BURN_MS
                        || (!aligned
                            && Math.abs(misalignment) <= JUMP_BURN_ANGLE
                            && time.time
                                >= jump.departAt - JUMP_DEPART_DELAY_MS));
                if (aligned || burnDue) {
                    if (aligned) {
                        movement.turnTo = null;
                        movement.rotation = target;
                    }
                    jump.stage = burnDue ? 'accelerating' : 'spinup';
                    jump.stageStart = time.time;
                    // The warp-up sound starts the moment the ship is
                    // ready to jump: stopped (for ships that must
                    // stop) and pointing at the destination. Sounds
                    // are display-side; emitting the event does not
                    // touch simulation state. Warp sounds are only
                    // heard by the jumping ship's own pilot: targeted
                    // at the ship, and the display plays them only for
                    // the local player's ship.
                    emit(PlayerSoundEvent, {
                        id: warpUpSound(shipPhysics),
                    }, [uuid]);
                }
                break;
            }
            case 'spinup': {
                // The hyperdrive charges while the ship holds still: at
                // least the spin-up delay, and on the fixed clock until
                // the burn's slot (JUMP_DEPART_DELAY_MS before the
                // departure), but never past its latest start.
                movement.turnTo = target;
                const held = time.time - (jump.stageStart ?? time.time);
                const departAt = clocked ? jump.departAt : undefined;
                const burnNow = departAt === undefined
                    ? held >= jumpStageDelays(jump).spinupMs
                    : time.time >= departAt - JUMP_MIN_BURN_MS
                        || (held >= JUMP_SPINUP_DELAY_MS
                            && time.time >= departAt - JUMP_DEPART_DELAY_MS);
                if (burnNow) {
                    jump.stage = 'accelerating';
                    jump.stageStart = time.time;
                }
                break;
            }
            case 'accelerating': {
                movement.turnTo = target;
                movement.accelerating = 1;
                // The raised speed cap and hyperdrive acceleration are
                // applied by EffectiveMovementPhysicsSystem (the single
                // per-tick writer of effective movement physics), which
                // runs after this system and reads the jump stage.
                const departsAt = jumpDepartsAt(jump)
                    ?? (jump.stageStart ?? time.time)
                        + jumpStageDelays(jump).departMs;
                if (time.time >= departsAt) {
                    const destination = jump.to;
                    if (jump.vanish) {
                        // VANISH TERMINAL (an NPC departure). There is no
                        // destination world to carry this ship to, so it
                        // simply leaves: no InitiateJumpEvent (which would
                        // put it through JumpFromSystem's serialize-and-
                        // carry path, and past EscortFollowJumpSystem), no
                        // FinishJumpEvent, no arrival kinematics. Every
                        // stage up to this point was the shared one.
                        //
                        // Keyed on the FLAG, not on the sentinel `to` and
                        // not on its falsiness: the terminal is a decision
                        // the sequence records explicitly, so that a
                        // destination that somehow arrived empty is a bug
                        // in whoever wrote it rather than a silent
                        // reinterpretation of the ship's fate here.
                        entities.delete(uuid);
                        break;
                    }
                    if (jump.follows !== undefined) {
                        // FOLLOWER TERMINAL (an escort warping out with its
                        // player). The ship leaves this world, but its
                        // owner is what takes it — EscortDepartJumpSystem,
                        // listening on the very same InitiateJumpEvent and
                        // ordered before JumpFromSystem, which skips it.
                        //
                        // No arrival kinematics: a follower is re-inserted
                        // on a formation station beside its leader, so the
                        // teleport would only be overwritten (and would
                        // bump teleportCount, sending a position no peer
                        // needs). No fuel either — following is free.
                        //
                        // The stage still advances to 'arriving' so that a
                        // sweep that never comes degrades quietly: the next
                        // tick's 'arriving' case simply ends the sequence
                        // and leaves the ship in this system, instead of
                        // this case re-firing every tick.
                        jump.stage = 'arriving';
                        jump.stageStart = undefined;
                        jump.departAt = undefined;
                        emit(InitiateJumpEvent, { to: destination }, [uuid]);
                        break;
                    }
                    // Depart. Set the arrival kinematics the destination
                    // system will see: the ship jumps in on the side of
                    // the system facing where it came from, coasting
                    // inward at its regular top speed, far enough
                    // outside the no-jump zone (PLAYER_JUMP_ARRIVAL_MARGIN_S)
                    // that another jump can start before it drifts in.
                    const basePhysics = getShipMovementPhysics(shipPhysics);
                    const jumpRadius = jumpRadiusFor(JUMP_DISTANCE,
                        shipPhysics.jumpDistanceMod);
                    const arrivalDistance = jumpRadius
                        + basePhysics.maxVelocity * PLAYER_JUMP_ARRIVAL_MARGIN_S;
                    const unit = target.getUnitVector();
                    teleport(movement,
                        new Position(-unit.x * arrivalDistance,
                            -unit.y * arrivalDistance),
                        unit.scale(basePhysics.maxVelocity));
                    movement.rotation = target;
                    movement.targetSpeed = basePhysics.maxVelocity;
                    jump.stage = 'arriving';
                    jump.stageStart = undefined;
                    jump.departAt = undefined;
                    // A jump costs FUEL_PER_JUMP (EVN Bible: fuel
                    // "100 = 1 jump"). It is deducted at departure — the
                    // moment the ship actually leaves the system, which
                    // is the arrival frame on the original (reference
                    // "Jump phases and fuel (U8), wave 38", finding 2: a
                    // jump a disable cuts short costs nothing) — and
                    // crosses to the destination with the entity.
                    if (fuel) {
                        fuel.current = Math.max(
                            fuel.min, fuel.current - FUEL_PER_JUMP);
                    }
                    emit(InitiateJumpEvent, { to: destination }, [uuid]);
                }
                break;
            }
            case 'arriving': {
                // The first tick in the destination system. The ship
                // arrives already at its regular top speed, so there is
                // no hyperspace speed to bleed off: clip the warp-up
                // (it must not ring out over the new system), play the
                // warp-out, and hand control straight back — a held
                // jump key can start the route's next jump on the very
                // next tick.
                emit(PlayerSoundEvent,
                    { id: warpUpSound(shipPhysics), stop: true }, [uuid]);
                emit(PlayerSoundEvent, { id: WARP_OUT_SOUND }, [uuid]);
                entity.components.delete(JumpComponent);
                // The arrival grace starts now (ARRIVAL_JUMP_GRACE_MS): the
                // route's next hop may start even after the ship has
                // coasted into the no-jump zone.
                entity.components.set(HyperspaceArrivalComponent,
                    { at: time.time });
                // "multi-jump" (ModType 32): if the ship still has auto-jump
                // budget, leave a marker so MultiJumpContinueSystem starts the
                // route's next jump this tick without the player re-pressing
                // the key. The marker carries the remaining budget across to
                // the fresh JumpComponent.
                if ((jump.autoJumpsLeft ?? 0) > 0) {
                    entity.components.set(MultiJumpContinueComponent,
                        { left: jump.autoJumpsLeft! });
                } else {
                    entity.components.delete(MultiJumpContinueComponent);
                }
                break;
            }
        }
    },
    // Determinism rule 4: this stage machine reads time.time/time.delta_s
    // to advance its timed stages, so it must run after TimeSystem. The
    // after: [ControlShipSystem] edge does NOT imply this (ControlShipSystem
    // is not itself ordered after TimeSystem), so without the explicit edge a
    // restore could toposort JumpSequenceSystem before TimeSystem.
    //
    // After both jump STARTERS (#113): JumpRouteReconcileSystem's
    // correctness argument ("nothing can start another jump before the
    // tick after arrival") holds only because this system — which drops
    // JumpComponent on the arrival tick — runs after PlayerJumpControl
    // and MultiJumpContinueSystem on that tick. Were either sorted after
    // this one, a held jump key (or the multi-jump marker) would begin
    // the route's next hop on the ARRIVAL tick, before the reconcile
    // system has dropped an unflyable head — and beginJump's getCached
    // for a non-link hop is warm on the browser (preload bundle) and cold
    // on the archive: the review-r13 fork the reconcile system exists to
    // prevent. That ordering used to hold only by addSystem insertion
    // order; this edge makes it a constraint. (Declared here rather than
    // as `before` on the starters because they are defined above this
    // const and cannot reference it.)
    after: [TimeSystem, ControlShipSystem, PlayerJumpControl,
        MultiJumpContinueSystem],
    before: [MovementSystem],
});

// For a single system to emit jump events.
export const JumpPlugin: Plugin = {
    name: 'JumpPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(JumpRouteComponent, t.type({
            route: t.array(t.string),
        }));
        serializer?.addComponent(JumpComponent, JumpStateType);
        // The multi-jump continuation marker crosses systems with the entity
        // (it is set in the origin world at departure and read in the
        // destination world), so it must serialize.
        serializer?.addComponent(MultiJumpContinueComponent,
            t.type({ left: t.number }));
        // Synced so the display's readiness readouts see the arrival grace.
        serializer?.addComponent(HyperspaceArrivalComponent,
            t.type({ at: t.number }));
        if (serializer) {
            serializer.addEvent(FinishJumpEvent, FinishJumpEventType(serializer));
        }
        world.addSystem(JumpFromSystem);
        world.addSystem(JumpRouteReconcileSystem);
        world.addSystem(MultiJumpContinueSystem);
        world.addSystem(PlayerJumpControl);
        world.addSystem(JumpSequenceSystem);
        world.addSystem(JumpRouteProvider);
    }
};
