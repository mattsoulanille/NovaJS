import { isLeft } from 'fp-ts/lib/Either.js';
import * as t from 'io-ts';
import {
    Emit, EmitFunction, Entities, GetEntity, UUID,
} from 'nova_ecs/arg_types';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import {
    MovementState, MovementStateComponent, MovementSystem,
} from 'nova_ecs/plugins/movement_plugin';
import {
    EncodedEntity, Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../communication/simulation_bridge_events.js';
import { deImmerify } from '../util/deimmerify.js';
import {
    BayFighterComponent, CollectableEscortComponent, ReturnComponent,
} from './bay_plugin.js';
import { clearPlunderRecord } from './boarding_component.js';
import { EscortCommandComponent } from './escort_command.js';
import { FiringGroupComponent } from './firing_group.js';
import { flockParent, MAX_FLOCK_DEPTH } from './flock.js';
import { DisabledComponent } from './disabled_component.js';
import { GateDepartureSystem } from './gate_transit_plugin.js';
import { FuelComponent } from './health_plugin.js';
import {
    beginFollowJump, InitiateJumpEvent, JumpComponent, JumpFromSystem,
    JumpSequenceSystem, TransitKind,
} from './jump_plugin.js';
import { MissionShipComponent } from './mission_ship_component.js';
import {
    formationsIn, FormationComponent, FormationSystem, nextFormationSlot,
    RCS_ACCEL_FRACTION,
} from './npc_ai_plugin.js';
import { LandEvent, PlanetDataComponent } from './planet_plugin.js';
import {
    carriedEscortFields, EscortLanding, EscortLandingComponent,
    EscortPayrollComponent, escortProvenance, PlayerEscort,
    PlayerEscortComponent,
} from './player_escort.js';
import { ControlledByComponent } from './ship_control.js';
import { ShipComponent, ShipPhysicsComponent } from './ship_plugin.js';

/**
 * ============================================================================
 * Player escorts follow the player's lifecycle
 * ============================================================================
 *
 * Escorts (hired escorts, captured hulks, and fighters launched from the
 * player's bays) used to be strictly in-system, in-flight entities: the
 * player landing removed their leader from the simulation and orphaned
 * them, and jumping left them behind entirely. This module makes them
 * follow the player instead:
 *
 *  - OWNERSHIP is durable. MarkPlayerEscortsSystem stamps
 *    PlayerEscortComponent on every ship whose escort chain tops out at a
 *    player-controlled ship, and nothing here ever clears it because the
 *    player went missing. FormationSystem's leader-gone rule is
 *    deliberately UNCHANGED (see the note on EscortReattachSystem): the
 *    formation link is allowed to lapse while the player is away and is
 *    rebuilt on return, so genuinely-released NPC followers keep behaving
 *    exactly as before.
 *
 *  - LANDING. The player's LandEvent orders their escorts to the same
 *    stellar (EscortLandOrderSystem). Each escort flies there
 *    (EscortLandingSystem) and, inside a relaxed landing window, is
 *    removed from the simulation and handed to the owning client as a
 *    fully serialized entity via EscortLandedEvent — the same split
 *    landing itself uses (deterministic despawn in the sim; the per-player
 *    roster lives client-side, see spaceport/landed_escorts.ts). Other
 *    peers simply watch the escorts land.
 *
 *  - DEPARTURE. The client respawns the roster alongside the relaunched
 *    player (browser.ts). Escorts that never made it to the planet are
 *    re-attached by EscortReattachSystem the moment the player's entity is
 *    back in the world, so ownership survives a landing even when an
 *    escort was still mid-approach.
 *
 *  - JUMPING. Escorts WARP OUT, visibly, on their own hyperspace jump
 *    sequences. The moment the player's jump begins, every escort that
 *    will follow starts a JumpComponent sequence of its own onto the
 *    player's jump heading (EscortFollowJumpBeginSystem); each is
 *    serialized out of the origin system and handed to the client at its
 *    own warp-out (EscortDepartJumpSystem), or — if it is still turning
 *    when the player goes — swept on the spot by the departure fallback
 *    (EscortFollowJumpSystem), which is what guarantees a slow ship is
 *    never left behind. The client inserts them at formation stations
 *    around the player's arrival point in the destination system.
 *
 *    Their jumps are FREE (no fuel deduction): an escort must always be
 *    able to follow. Two hulls stay behind, still owned, recovered only if
 *    the player comes back: one with no energy capacity at all (shïp
 *    "energy" 0, i.e. FuelComponent.max === 0) has no hyperdrive, and one
 *    that is DISABLED cannot run the hyperdrive it has. Both live in
 *    {@link escortFollows}.
 *
 *    A jump that is CANCELLED takes the whole flock's sequences with it.
 *    A ship disabled at any stage of a jump stops dead and loses it
 *    (JumpDisableCancelSystem), and a follower's sequence is only valid
 *    while its leader is jumping (JumpSequenceSystem), so a player shot
 *    down mid-spinup drops their escorts back into formation on the same
 *    tick. Escorts that had already warped out ride the client's carried
 *    roster and are put back beside the player who never left, by the
 *    standing flush that exists for multi-jump chains
 *    (flushCarriedJumpEscorts / carriedBatchSettled, spaceport/
 *    landed_escorts.ts): the never-drop machinery covers the cancel case
 *    with nothing added.
 *
 *  - GATE TRANSIT. EscortFollowGateSystem does the same for a hypergate or
 *    wormhole, on the player's LandEvent at the gate. A gate carries
 *    ANYTHING (EVN Bible p. 61: the gate moves the ship, the ship's own
 *    hyperdrive is not involved), so the zero-energy exclusion above does
 *    NOT apply here — that exclusion is a rule about hyperspace jumps only.
 *    See {@link escortFollows}, which is the single place both rules live.
 *
 *    Gate-swept escorts ride the LANDED roster (EscortLandedEvent) rather
 *    than the jump roster, because at sweep time there is no destination
 *    system to name: a hypergate's destination is still unpicked (the map
 *    has not even opened) and a wormhole's is a spöb the client resolves to
 *    a system afterwards. EscortJumpEvent's `to` could only be a lie.
 *    Using the landed roster also means all three of its consumers already
 *    exist and need no new pipeline: `jumpTo` carries it to the destination,
 *    the gate lift-off path puts it back when the map is closed without a
 *    pick (spaceport-liftoff parity, for free), and flushLandedEscorts is a
 *    standing safety net that re-inserts the batch beside the player if the
 *    transit never actually happens.
 *
 * COMMAND RESET. Escorts used to reset to the 'formation' command purely
 * by accident (they were rebuilt from scratch at every boundary). Now
 * that they persist, the reset is explicit at both boundaries: the client
 * stamps 'formation' on every escort it inserts (jump arrival and
 * liftoff), and EscortReattachSystem stamps it on every escort it
 * re-attaches.
 *
 * THE CONVERGENCE INVARIANT. An escort always ends up in the same system as
 * its player. At rest, every PlayerEscortComponent-marked escort of the
 * local player is either in the player's system, in a client roster
 * destined for it, or — only for the two hyperspace-jump exclusions above,
 * no hyperdrive and disabled — deliberately left behind. `escortsAccountedFor`
 * (spaceport/landed_escorts.ts) is that invariant as a predicate, exercised
 * by the tests and exposed live as `window.novaEscortAudit()`.
 *
 * DOCUMENTED SEAMS (deliberate v1 limits):
 *  - No warp-IN animation. Escorts warp out for real now, but they still
 *    arrive by appearing at their formation station rather than flying in
 *    from the edge: the client re-inserts them positioned on the player,
 *    and the arrival kinematics a jumping ship normally sets for itself
 *    would only be overwritten. Their outbound sequence is dropped at the
 *    sweep for exactly that reason (sweepJumpingEscort).
 *  - GATES keep the instant carry. A hypergate or wormhole sweeps the
 *    whole flock on the player's LandEvent with no sequence at all
 *    (EscortFollowGateSystem), which is right in kind — the gate does the
 *    moving and no hyperdrive spins up — and is anyway forced: at sweep
 *    time there is no destination, so there is no heading to turn onto.
 *    Escorts leave with the player at the gate instead of each flying down
 *    to it, which is why gates need no landing orders.
 *  - A "multi-jump" outfit chain (ModType 32) no longer out-runs the carry,
 *    but it does so by HOLDING the batch out of the world for the length of
 *    the chain (browser.ts): escorts are absent from the intermediate
 *    systems the chain passes through and appear at the final destination.
 *    See multiJumpChainContinues / multiJumpChainSettled. The warp-out
 *    sequences therefore only ever run in the system a chain STARTS from:
 *    at every later hop the escorts are in the client's hands and not in
 *    the world, so EscortFollowJumpBeginSystem finds nobody to start and
 *    nothing double-triggers.
 *  - Escorts ARE saved, as whole serialized entities, and come back
 *    through this same carried-batch path on the first system entry after
 *    a load (save_game.ts, browser.ts). What a save cannot bring back is
 *    an escort left behind in ANOTHER system by a jump exclusion above: it
 *    is in no system the client holds state for.
 */

// --- Tuning constants ---

/**
 * The landing window for an AI-steered escort, deliberately looser than
 * the player's (planet_plugin's LAND_DISTANCE_SQUARED = 10_000 / 100px
 * and LAND_SPEED_SQUARED = 3_000 / ~55px per second). The player nudges
 * their ship into a 100px bullseye by hand; an escort arrives under a
 * proportional-approach controller whose final convergence is bounded by
 * its RCS budget, so a heavy, low-acceleration hulk can hover just
 * outside the strict window for a long time. 300px / 100px per second
 * lands every stock hull promptly and is still visually "at the planet".
 */
export const ESCORT_LAND_DISTANCE_SQUARED = 90_000;
export const ESCORT_LAND_SPEED_SQUARED = 10_000;

/**
 * Approach gain (1/s) for the landing controller: the escort aims for a
 * speed of gain * remaining distance, capped at its top speed. This is
 * the standard "arrival" profile — it decelerates automatically as the
 * stellar gets closer instead of overshooting and orbiting.
 */
export const ESCORT_APPROACH_GAIN = 1.2;

/**
 * Correction magnitude (px/s) below which the landing controller switches
 * from turn-and-burn to a direct RCS-style velocity nudge, exactly like
 * formation station-keeping (steerFormation): the last few px/s of an
 * approach cannot be bled off with the main engine without the ship
 * spinning in place.
 */
export const ESCORT_APPROACH_RCS_SPEED = 60;

/**
 * The fields of an existing ownership marker that a RE-STAMP must carry
 * over — `detached`, `provenance` and the queued deals. Shared with the
 * carried-roster re-insertion; see {@link carriedEscortFields}.
 */
const carriedFields = carriedEscortFields;

/**
 * The player ship at the top of `uuid`'s escort chain, plus the escort's
 * immediate leader. Walks the same chain isInFlock does (formation leader
 * -> bay owner -> firing group) and stops at the first ancestor that is a
 * player-controlled ship. Returns undefined when the chain reaches no
 * such ship — including the important case where the player's entity is
 * simply not in the world right now (landed or jumping), which is why
 * callers must treat undefined as "no new information" rather than "not
 * owned".
 *
 * ---------------------------------------------------------------------------
 * THE MISSION-SHIP BOUNDARY: A BAY FIGHTER BELONGS TO ITS CARRIER
 * ---------------------------------------------------------------------------
 *
 * The walk STOPS at any ancestor wearing a MissionShipComponent, and
 * reports no owner. A ship whose chain passes through a mission ship on
 * its way to the player is not the player's escort — it is the MISSION
 * SHIP'S OWN WING, and it belongs to the mission exactly as its carrier
 * does.
 *
 * WHY IT IS NEEDED (Matthew's playtest, 2026-08: "I gain more escorts
 * every time I change systems", still growing after the one-batch-per-
 * system fix, 2a565960). mïsn 792's ShipBehav 1 special ship is düde
 * nova:241 — always shïp nova:302, an Aurora Carrier with eight fighter
 * bays — and mïsn 792 spawns TWO of them (ShipCount 1 plus one AuxShip)
 * in whatever system the player is in. ShipBehav 1 puts each one in
 * FORMATION on the player, sharing the player's firing group, so a
 * fighter it launches in a fight has the chain
 *
 *     fighter --Owner/Formation--> carrier --Formation--> player
 *
 * and the walk topped out at the PLAYER. The mission-ship exclusions in
 * MarkPlayerEscortsSystem and sweepableEscorts did not catch the
 * fighters, because the FIGHTERS are not mission ships: they were stamped
 * PlayerEscort{player, parent: carrier}, swept through the jump, and
 * re-parented straight onto the player by insertCarriedEscorts (their
 * carrier is not in the batch, so prepareCarriedEscorts falls back to the
 * player). They could then never return to a bay, they persisted into the
 * save's `escorts` array, and every new system's fresh pair of carriers
 * launched a fresh wing: measured 0 -> 10 -> 18 across two systems.
 *
 * WHY IT IS THE RIGHT RULE, not just a patch. The two exclusions already
 * in this module say a mission ship is not the player's: it is not swept,
 * not paid, not manageable, and it despawns and respawns with the mission.
 * Ownership is TRANSITIVE (see flock.ts), so a wing that belongs to a ship
 * that is not the player's cannot itself be the player's. The consequences
 * follow from that one sentence: such fighters are never marked, so they
 * are never swept through a jump or a gate, never on the payroll, never in
 * fleet cargo or escort hail management; and when the mission carrier
 * despawns they orphan like any NPC carrier's wing and depart the system
 * under OrphanedBayFighterSystem (bay_plugin.ts), which exempts only
 * PlayerEscort-marked fighters — precisely the mark they no longer carry.
 *
 * SCOPE: THIS IS THE ESCORT-MARKING INTERPRETATION OF THE CHAIN, and only
 * that. flock.ts's flockParent and isInFlock are DELIBERATELY unchanged:
 * combat, point defense, friendly fire, IFF and the target cycle must all
 * keep reading a mission carrier's wing as part of the player's flock (it
 * flies with the player and shares its firing group, so shooting it would
 * be as wrong as shooting a hired escort's fighter). Only the question
 * "is this ship MINE, to carry and to pay for?" is answered differently
 * here. Both callers of this function are that question:
 * MarkPlayerEscortsSystem and sweepableEscorts.
 *
 * A CAPTURED mission ship is unaffected, for the same reason the sweep's
 * own exclusion is: capturing strips MissionShipComponent
 * (boarding_plugin), so a prize's wing tops out at the player like any
 * other escort's.
 */
export function playerEscortLink(uuid: string,
    getEntity: (uuid: string) => Entity | undefined):
    PlayerEscort | undefined {
    const self = getEntity(uuid);
    if (!self) {
        return undefined;
    }
    const parent = flockParent(self);
    if (parent === undefined || parent === uuid) {
        return undefined;
    }
    const visited = new Set<string>([uuid]);
    let current = parent;
    for (let depth = 0; depth < MAX_FLOCK_DEPTH; depth++) {
        if (visited.has(current)) {
            return undefined; // Leader cycle: nobody's escort.
        }
        visited.add(current);
        const entity = getEntity(current);
        if (!entity) {
            return undefined; // The chain ends at a ship that isn't here.
        }
        if (entity.components.has(MissionShipComponent)) {
            // The mission-ship boundary (see the doc comment above): this
            // candidate is the mission ship's own wing, not the player's.
            // Checked BEFORE the player test, so nothing beyond a mission
            // ship can be reached however the chain continues.
            return undefined;
        }
        if (entity.components.has(ControlledByComponent)) {
            return { player: current, parent };
        }
        const next = flockParent(entity);
        if (next === undefined) {
            return undefined;
        }
        current = next;
    }
    return undefined;
}

/**
 * The two ways a player leaves a system taking their flock with them
 * (jump_plugin's TransitKind). They differ in exactly one rule, so they
 * share one predicate.
 */
export type EscortTransition = TransitKind;

/**
 * Whether `escort` follows its player through a `kind` transition —
 * Matthew's ruling, in one place, so the jump sweep and the gate sweep
 * cannot drift apart.
 *
 * A hyperspace JUMP needs a hyperdrive of the escort's own: a hull with no
 * energy capacity at all (shïp "energy" 0, i.e. FuelComponent.max === 0)
 * has none and is left behind, still owned. A GATE carries anything (EVN
 * Bible p. 61) — the gate does the moving, so there is nothing for the
 * escort to lack, and the exclusion deliberately does not apply.
 */
export function escortFollows(kind: EscortTransition, escort: Entity):
    boolean {
    if (kind === 'gate') {
        return true;
    }
    // A DISABLED ship cannot run its hyperdrive — the same rule that stops
    // a disabled player pressing jump (PlayerJumpControl), a disabled NPC
    // departing (departByJump), and any ship's jump mid-sequence
    // (JumpDisableCancelSystem). So it neither starts a follow sequence nor
    // gets swept up at its player's departure: it stops dead where it was
    // hit and is left behind, still owned, exactly like the zero-energy
    // hull below. One predicate, so the two sweep sites and the sequence
    // start cannot disagree about it.
    if (escort.components.has(DisabledComponent)) {
        return false;
    }
    // The exclusion has to be POSITIVELY established: only a hull we can
    // see has no energy capacity is left behind. FuelComponent is supplied
    // by a per-tick provider (ShipFuelProvider), not by the insertion
    // deriver, so an escort inserted on the same tick as the jump can be
    // momentarily without one — and "we have not looked yet" is not the
    // same thing as "it has no hyperdrive". Convergence wins the tie.
    const fuel = escort.components.get(FuelComponent);
    return fuel === undefined || fuel.max > 0;
}

/**
 * The uuids of `player`'s escorts that follow them through a `kind`
 * transition, in uuid order.
 *
 * Ownership is read from the durable marker OR, failing that, from the
 * live escort chain. The fallback closes a tick race in the sweep's
 * precondition: MarkPlayerEscortsSystem is what stamps the marker, and it
 * declares no ordering against the departure events, so a ship that joined
 * the flock on this very tick — a fighter just launched from a bay, a hulk
 * just captured — may not carry the marker yet and would be silently left
 * behind. Both sweeps run while the player is still in the world (they are
 * ordered before the system that removes it), so the chain always resolves
 * here. The same two exclusions MarkPlayerEscortsSystem applies are
 * repeated: player ships are not their own escorts, and mission ships have
 * their own respawn-with-the-player flow — the latter ahead of the marker
 * check, so no marker can defeat it (see the note in the loop).
 *
 * Sorted for the same reason EscortReattachSystem sorts: the sweep order
 * becomes the client roster's order, which becomes the order
 * prepareCarriedEscorts hands out formation slots in. Entity-map iteration
 * order is not stable across peers (a world rebuilt from a wire baseline
 * can iterate differently), and the resulting slots are hashed simulation
 * state once the insertion records land, so the batch's order has to be
 * fixed here rather than left to the map.
 *
 * Collected before anything is deleted: mutating the map mid-iteration is
 * what the two-pass shape in the callers avoids.
 */
export interface EscortSweepEntities {
    [Symbol.iterator](): Iterator<[string, Entity]>;
    get(uuid: string): Entity | undefined;
}

export function sweepableEscorts(entities: EscortSweepEntities,
    player: string, kind: EscortTransition): string[] {
    const following: string[] = [];
    for (const [escortUuid, escort] of entities) {
        // A MISSION SHIP IS NEVER SWEPT, whatever markers it happens to be
        // wearing. The exclusion is checked BEFORE the ownership marker, not
        // inside the "not marked yet" branch below, so that it matches
        // MarkPlayerEscortsSystem's — which is unconditional — exactly.
        // Otherwise a special ship that acquired a marker by any route at all
        // would ride the jump AND be respawned at the far end by
        // buildMissionShipSpawns, and the mission's batch would grow by its
        // ShipCount at every hop (Matthew: "I gain more escorts every time I
        // change systems"). mïsn ShipBehav 1 ships make that a live risk: they
        // fly in FORMATION on the player sharing their firing group, so the
        // escort chain genuinely does top out at the player.
        //
        // A CAPTURED mission ship is not affected: capturing one strips the
        // MissionShipComponent (boarding_plugin.ts), which is what turns a
        // prize into an ordinary escort, so it is swept here like any other.
        //
        // A mission ship's own BAY FIGHTERS are excluded too, one level
        // down: they are not mission ships, so this check does not see
        // them, but playerEscortLink stops at their carrier and reports no
        // owner, so they never acquire the marker the branch below tests
        // and never back-fill one here. See THE MISSION-SHIP BOUNDARY on
        // playerEscortLink.
        if (escort.components.has(MissionShipComponent)) {
            continue;
        }
        if (escort.components.get(PlayerEscortComponent)?.player !== player) {
            if (!escort.components.has(ShipComponent)
                || escort.components.has(ControlledByComponent)) {
                continue;
            }
            const link = playerEscortLink(escortUuid,
                other => entities.get(other));
            if (link?.player !== player) {
                continue;
            }
            // Back-fill the marker MarkPlayerEscortsSystem would have
            // written a tick later. Writing the same value it would have
            // written keeps this deterministic and idempotent, and it means
            // the entity we are about to serialize carries its own
            // `parent`, so prepareCarriedEscorts can put a just-launched
            // fighter back on its carrier instead of flattening it onto the
            // player. Any provenance already recorded is carried over for
            // the same reason MarkPlayerEscortsSystem carries it.
            escort.components.set(PlayerEscortComponent, {
                ...link,
                ...carriedFields(
                    escort.components.get(PlayerEscortComponent)),
            });
        }
        if (!escortFollows(kind, escort)) {
            continue;
        }
        following.push(escortUuid);
    }
    return following.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Steers a ship to come to rest at `target` (a stellar's position).
 * Proportional arrival profile plus the same two-regime hysteresis-free
 * split formation keeping uses: turn-and-burn while the velocity
 * correction is large, a budgeted RCS nudge once it is small. Pure, so
 * convergence is unit-testable.
 */
export function steerToStellar(movement: MovementState, target: Position,
    acceleration: number, maxVelocity: number, delta_s: number): void {
    // Position subtraction yields the shortest toroidal delta.
    const error = target.subtract(movement.position);
    const distance = error.length;
    const desiredSpeed = Math.min(maxVelocity,
        distance * ESCORT_APPROACH_GAIN);
    const desired = distance > 1e-9
        ? error.normalize(desiredSpeed) : new Vector(0, 0);
    const correction = desired.subtract(
        Vector.fromVectorLike(movement.velocity));
    const magnitude = correction.length;
    const budget = acceleration * RCS_ACCEL_FRACTION * delta_s;
    if (magnitude < Math.max(budget, ESCORT_APPROACH_RCS_SPEED)) {
        const nudge = magnitude <= budget
            ? correction : correction.normalize(budget);
        movement.velocity = Vector.fromVectorLike(movement.velocity)
            .add(nudge);
        movement.accelerating = 0;
        movement.turnBack = false;
        movement.turnTo = distance > 1e-9 ? error.angle : null;
        return;
    }
    const heading = correction.angle;
    movement.turnTo = heading;
    movement.turnBack = false;
    movement.accelerating =
        Math.abs(movement.rotation.distanceTo(heading).angle) < 0.7 ? 1 : 0;
}

// --- Events that hand a serialized escort to the owning client ---

export interface EscortJump {
    entity: Entity,
    uuid: string,
    /** Destination system id. */
    to: string,
    /** The player ship whose jump this escort is following. */
    player: string,
}
export const EscortJumpEvent = new EcsEvent<EscortJump>('EscortJumpEvent');

export interface EscortLanded {
    entity: Entity,
    uuid: string,
    /** The player ship this escort belongs to. */
    player: string,
    /** Entity uuid of the stellar it landed on. */
    planet: string,
}
export const EscortLandedEvent =
    new EcsEvent<EscortLanded>('EscortLandedEvent');

/**
 * Codec for an event that carries a whole serialized entity plus some
 * plain fields — the FinishJumpEvent pattern (jump_plugin), shared by the
 * two escort carry events. Carrying the ENTITY (rather than a ship id) is
 * what preserves damage, outfits, cargo, and bay-fighter identity
 * (OwnerComponent / SourceComponent / any future BayFighterComponent)
 * across the round trip: anything the serializer knows about survives
 * without this module having to know it exists.
 */
function escortCarryEventType<Rest extends object>(
    name: string, restType: t.Type<Rest, Rest>, serializer: Serializer,
): t.Type<Rest & { entity: Entity }, Rest & { entity: EncodedEntity }> {
    const EncodedCarry = t.intersection([restType,
        t.type({ entity: EncodedEntity })]);
    return new t.Type<Rest & { entity: Entity },
        Rest & { entity: EncodedEntity }>(
        name,
        (_u): _u is Rest & { entity: Entity } => true,
        (input, context) => {
            const encoded = EncodedCarry.validate(input, context);
            if (isLeft(encoded)) {
                return encoded;
            }
            const { entity, rest } = splitCarry(encoded.right);
            const decoded = serializer.decode(entity);
            if (isLeft(decoded)) {
                return t.failure(entity, context,
                    serializer.describeDecodeFailure(entity, decoded.left));
            }
            return t.success({ ...rest, entity: decoded.right });
        },
        carry => {
            const { entity, rest } = splitCarry(carry);
            return {
                ...restType.encode(rest),
                entity: serializer.encode(entity),
            };
        },
    );
}

/**
 * Separates a carried entity from the plain fields it travels with (the
 * fields keep their order; the entity is re-attached last by the caller).
 */
function splitCarry<Rest extends object, E>(
    carry: Rest & { entity: E }): { entity: E, rest: Rest } {
    const { entity, ...rest } = carry;
    // cast: a rest destructure of a generic intersection is typed
    // Omit<Rest & { entity: E }, 'entity'>, which TypeScript cannot relate
    // back to Rest; at runtime it holds exactly Rest's own fields.
    return { entity, rest: rest as unknown as Rest };
}

const EscortJumpRest = t.type({
    uuid: t.string,
    to: t.string,
    player: t.string,
});
const EscortLandedRest = t.type({
    uuid: t.string,
    player: t.string,
    planet: t.string,
});

registerSimulationBridgeEvent({ event: EscortJumpEvent });
registerSimulationBridgeEvent({ event: EscortLandedEvent });

// --- Systems ---

/**
 * Stamps the durable ownership marker on every ship whose escort chain
 * tops out at a player-controlled ship. Runs over ships (not just
 * followers) because the chain edge can be any of formation / bay owner /
 * firing group, and re-stamps whenever the live chain says something
 * different — but stays SILENT when the chain reaches nobody, which is
 * how ownership survives the player being out of the world.
 *
 * Excluded:
 *  - player ships themselves (ControlledByComponent),
 *  - mission ships (MissionShipComponent), which already have their own
 *    respawn-with-the-player flow (mission_ship_spawn) and would be
 *    double-spawned if this module carried them too,
 *  - anything whose chain PASSES THROUGH a mission ship — a mission
 *    carrier's bay fighters. That exclusion is not written here: it is
 *    inside playerEscortLink, which stops the walk at a mission ship (see
 *    THE MISSION-SHIP BOUNDARY there), so the marking sweep and the
 *    departure sweeps cannot disagree about it.
 *
 * Deterministic: per entity the answer is a pure function of the synced
 * chain components, with no accumulation over entity-map iteration order.
 */
export const MarkPlayerEscortsSystem = new System({
    name: 'MarkPlayerEscorts',
    args: [UUID, GetEntity, ShipComponent, Entities] as const,
    step(uuid, entity, _ship, entities) {
        if (entity.components.has(ControlledByComponent)
            || entity.components.has(MissionShipComponent)) {
            return;
        }
        const link = playerEscortLink(uuid, other => entities.get(other));
        if (!link) {
            return;
        }
        const existing = entity.components.get(PlayerEscortComponent);
        if (existing?.player === link.player
            && existing.parent === link.parent) {
            return;
        }
        // Preserve the pending-return flag so this system's ordering
        // against EscortReattachSystem cannot matter, and the PROVENANCE
        // (hired / captured), which is a fact about how the escort was
        // acquired and must survive every re-parenting of the live chain —
        // a captured prize does not become a hire because its formation
        // leader changed.
        entity.components.set(PlayerEscortComponent,
            { ...link, ...carriedFields(existing) });
    },
});

/**
 * The escorts of `player` that draw a WAGE, as their ship-class ids, sorted.
 *
 * The payroll is the owned flock minus the ships that are not somebody
 * else's ship:
 *
 *  - BAY FIGHTERS (BayFighterComponent) are the player's own outfit flying.
 *    There is nobody to pay, and a wing that launches and docks a dozen
 *    times in a fight must not make the daily expense flicker.
 *  - Anything with no ShipComponent has no hull to price.
 *
 *  - CAPTURED HULLS (player_escort.ts's `provenance`). Matthew's spec is
 *    explicit — "hired escorts have a daily fee ... captured escorts have no
 *    daily salary" — and the original's own comm box agrees: a hired escort's
 *    readout carries a "Pay: N credits per day" line
 *    (hail/hail_escort.png) and a captured one's carries none
 *    (hail/hail_captured_escort.png), where it shows a "Sell Price" instead.
 *    A prize is property, not an employee. This is also why the readout and
 *    the payroll cannot be allowed to differ: they would be quoting and
 *    charging different things for the same ship.
 *
 * An escort with NO recorded provenance — every escort in a save written
 * before the field existed — reads as 'hired' and so stays on the payroll,
 * which is where it has always been.
 *
 * Sorted so the value is a pure function of the world's contents: entity-map
 * iteration order is not stable across peers, and this result is written into
 * a serializer-registered component that is hashed for desync detection.
 */
export function escortsOnPayroll(
    entities: Iterable<[string, Entity]>, player: string): string[] {
    const ships: string[] = [];
    for (const [, escort] of entities) {
        if (escort.components.get(PlayerEscortComponent)?.player !== player) {
            continue;
        }
        // MISSION SHIPS ARE NOT EMPLOYEES. A mïsn ShipBehav 1 special ship
        // flies in formation on the player like a hire, but nobody engaged
        // it and nobody pays it; it belongs to the mission, and it goes when
        // the mission does. Checked here rather than trusted to the marker's
        // absence, for the same reason the sweep checks it: the two must
        // agree about what is the player's, or the player is billed for a
        // ship they cannot dismiss, sell, or keep.
        if (escort.components.has(MissionShipComponent)) {
            continue;
        }
        if (escort.components.has(BayFighterComponent)) {
            continue;
        }
        if (escortProvenance(escort) === 'captured') {
            continue;
        }
        const shipId = escort.components.get(ShipComponent)?.id;
        if (shipId !== undefined) {
            ships.push(shipId);
        }
    }
    return ships.sort();
}

/**
 * Mirrors the player's wage-drawing flock onto the player's own entity
 * (EscortPayrollComponent), so the daily debit at a date advance — which
 * runs on the player entity while it is OUT of the world — has something to
 * charge against. See the component's own doc for why it must be a mirror.
 *
 * Runs AFTER MarkPlayerEscortsSystem so an escort that joined the flock this
 * very tick (a hulk just captured, an escort just re-attached) is already
 * marked and is on the payroll from the first step it exists.
 *
 * Writes only on a real change: the component is serializer-registered, so
 * an unconditional `set` every step would put a fresh array into every
 * rollback snapshot and wire baseline for a value that almost never moves.
 */
export const EscortPayrollSystem = new System({
    name: 'EscortPayroll',
    args: [UUID, GetEntity, ControlledByComponent, Entities] as const,
    step(uuid, entity, _controlledBy, entities) {
        const ships = escortsOnPayroll(entities, uuid);
        const previous = entity.components.get(EscortPayrollComponent);
        if (previous && previous.length === ships.length
            && previous.every((id, i) => id === ships[i])) {
            return;
        }
        if (!previous && ships.length === 0) {
            // A player who never had an escort never gets the component.
            return;
        }
        entity.components.set(EscortPayrollComponent, ships);
    },
    after: [MarkPlayerEscortsSystem],
});

/**
 * The player landed: their escorts head for the same stellar.
 *
 * Runs on the landing ship (LandEvent is targeted at it) on every peer,
 * so every peer stamps the same orders. Gates (hypergates and wormholes)
 * are skipped, and still are: an escort has no reason to fly down to a
 * gate, because EscortFollowGateSystem takes the whole flock through it
 * with the player on this very event. The two systems split the same
 * LandEvent on `gate` and never both act.
 */
export const EscortLandOrderSystem = new System({
    name: 'EscortLandOrder',
    events: [LandEvent],
    args: [UUID, LandEvent, Entities] as const,
    step(playerUuid, land, entities) {
        const planet = entities.get(land.uuid);
        if (!planet || planet.components.get(PlanetDataComponent)?.gate) {
            return;
        }
        for (const [, escort] of entities) {
            if (escort.components.get(PlayerEscortComponent)?.player
                !== playerUuid) {
                continue;
            }
            escort.components.set(EscortLandingComponent,
                { planet: land.uuid });
            // A fighter that was flying home to its bay lands on the
            // planet instead — its carrier is leaving the system, so
            // there is no bay to reach.
            escort.components.delete(ReturnComponent);
            escort.components.delete(CollectableEscortComponent);
        }
    },
});

/**
 * Tracks whether an escort's player is in the world, and re-attaches the
 * escort the moment it comes back: restores the formation link, resets the
 * command to 'formation', and re-stamps the player's firing group.
 *
 * This is the deliberate alternative to suppressing FormationSystem's
 * leader-gone deletion. Letting the formation link lapse while the player
 * is away keeps NPC behavior identical (a follower whose leader really
 * died still reverts to its own AI, and nothing freezes waiting for a
 * leader that will never return), while PlayerEscortComponent carries the
 * ownership that must not be lost. Rebuilding the link here covers, with
 * one rule:
 *  - an escort that was still flying toward the planet when the player
 *    lifted off (its landing order is dropped and it falls straight back
 *    into formation — the case Matthew's spec calls out),
 *  - an escort that never got a landing order at all,
 *  - an escort that held its formation link the whole time because it was
 *    under a non-formation command (its command still gets reset),
 *  - an escort orphaned by any other momentary player absence.
 *
 * A fighter under the 'returnToBay' command is left alone: it is already
 * flying home and must not be yanked back into formation.
 *
 * Runs ONCE per tick over the whole escort set (on the singleton entity)
 * rather than per escort, and walks it in uuid order. Slot allocation is
 * the reason: nextFormationSlot takes a max over the LIVE entity map, and
 * this system writes FormationComponent as it goes, so two escorts
 * re-attaching on the same tick — the ordinary case when a player lands
 * with a wing and lifts off again — would be handed slots in entity-map
 * iteration order. That is not a deterministic order across peers (a
 * world rebuilt from a wire baseline can iterate differently), and slot
 * numbers are hashed simulation state that drives station geometry, so
 * per-entity allocation would desync. A fixed uuid sort makes the batch's
 * assignment identical everywhere.
 */
const PlayerEscortsQuery = new Query(
    [UUID, GetEntity, PlayerEscortComponent] as const);

export const EscortReattachSystem = new System({
    name: 'EscortReattach',
    args: [PlayerEscortsQuery, Entities, SingletonComponent] as const,
    step(escorts, entities) {
        const inUuidOrder = [...escorts].sort(
            ([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        for (const [uuid, entity, owned] of inUuidOrder) {
            if (!entities.has(owned.player)) {
                // Landed, jumped, or otherwise out of the world. Ownership
                // waits; note the absence so the return is a real
                // boundary. Written once, not every tick: an idempotent
                // re-write would churn the component (and its hash) for
                // the whole landing.
                if (!owned.detached) {
                    owned.detached = true;
                }
                continue;
            }
            if (!owned.detached) {
                continue; // Steady state: no per-tick writes at all.
            }
            if (entity.components.get(EscortCommandComponent)?.command
                === 'returnToBay') {
                // Flying home to a bay: leave it be, but stop treating the
                // player's return as pending. Any landing order is dropped
                // all the same — the player is back, so nothing should
                // still be flying down to a planet.
                entity.components.delete(EscortLandingComponent);
                owned.detached = false;
                continue;
            }
            // Prefer the escort's own carrier (a fighter launched from an
            // escort's bays), falling back to the player.
            const leaderUuid = owned.parent !== undefined
                && owned.parent !== uuid && entities.has(owned.parent)
                ? owned.parent : owned.player;
            if (leaderUuid === uuid) {
                owned.detached = false;
                continue;
            }
            const formation = entity.components.get(FormationComponent);
            entity.components.set(FormationComponent, {
                leader: leaderUuid,
                slot: formation?.leader === leaderUuid ? formation.slot
                    : nextFormationSlot(formationsIn(entities), leaderUuid),
            });
            // Explicit command reset at a lifecycle boundary (see the
            // module comment): a re-attached escort always starts from
            // formation.
            entity.components.set(EscortCommandComponent,
                { command: 'formation' });
            entity.components.set(FiringGroupComponent,
                { group: owned.player });
            entity.components.delete(EscortLandingComponent);
            owned.detached = false;
        }
    },
    before: [FormationSystem],
});

/**
 * Hands `escort` to the owning client: strips the state that must not ride
 * to the destination, removes it from the simulation, and emits its carry
 * event. The single exit both jump sweeps use, so the early warp-out and
 * the departure fallback cannot drift apart.
 *
 * The JumpComponent goes because the entity is about to be re-inserted in
 * ANOTHER world. Its stage machine there would resume a sequence whose
 * leader, heading, and destination all belong to the system just left —
 * an escort would arrive and immediately start warping out again.
 */
function sweepJumpingEscort(escort: Entity, escortUuid: string,
    to: string, playerUuid: string,
    entities: { delete(uuid: string): unknown },
    emit: EmitFunction): void {
    // A landing order does not survive the jump: the stellar it named is
    // in the system being left behind.
    escort.components.delete(EscortLandingComponent);
    escort.components.delete(JumpComponent);
    // A jump ends this escort's plunder life segment: whatever a pirate
    // stripped from it in the system being left behind is forgotten, and
    // it arrives plunderable once again (Matthew's ruling — see
    // clearPlunderRecord).
    clearPlunderRecord(escort);
    entities.delete(escortUuid);
    deImmerify(escort);
    emit(EscortJumpEvent,
        { entity: escort, uuid: escortUuid, to, player: playerUuid },
        [escortUuid]);
}

/**
 * The player's jump has begun: every escort that will follow starts its
 * OWN jump sequence, so the flock is seen to stop, swing onto the jump
 * heading, spin up, and warp out — instead of blinking out of existence
 * the instant the player does.
 *
 * POLLED, not edge-triggered on the player's entry into the sequence. The
 * condition it enforces is a standing one ("while my player is jumping,
 * every follower of mine is jumping too"), and polling makes it true of
 * escorts that were not eligible at the start: a fighter launched from a
 * bay mid-spinup, a hulk captured mid-spinup, an escort inserted on a
 * later tick. It is idempotent — an escort that already has a sequence is
 * left alone — and it cannot fight the cancel rule, because a player whose
 * jump was cancelled no longer has a JumpComponent for this to read.
 *
 * The heading and destination come from the player's own JumpComponent
 * (see beginFollowJump), so nothing here can refuse for want of game data.
 * A follower's sequence is otherwise ordinary: it is stopped dead and
 * cancelled if the escort is disabled, and cancelled if the player's jump
 * is (JumpSequenceSystem's leader check).
 *
 * Runs on every peer, like every other escort lifecycle system: the
 * sequences are shared simulation state, and only their terminal — the
 * carry event's roster — is the owning client's business.
 */
export const EscortFollowJumpBeginSystem = new System({
    name: 'EscortFollowJumpBegin',
    args: [JumpComponent, ControlledByComponent, UUID, Entities] as const,
    step(playerJump, _controlledBy, playerUuid, entities) {
        if (playerJump.vanish || playerJump.follows !== undefined) {
            // Not a jump anyone can follow: a vanishing ship's departure
            // arrives nowhere to be followed to (its `to` is the sentinel,
            // not a system), and a follower leads nobody.
            return;
        }
        for (const escortUuid of sweepableEscorts(entities, playerUuid,
            'jump')) {
            const escort = entities.get(escortUuid);
            if (!escort || escort.components.has(JumpComponent)) {
                continue; // Already under way.
            }
            const physics = escort.components.get(ShipPhysicsComponent);
            if (!physics) {
                continue; // Not fully built yet; try again next tick.
            }
            // A stale landing order would fight the sequence for the
            // steering (EscortLandingSystem owns a landing escort's
            // controls), and the stellar it names is in the system being
            // left. The sweep drops it too; dropping it here means it is
            // never held alongside a jump.
            escort.components.delete(EscortLandingComponent);
            beginFollowJump(escort, playerUuid, playerJump, physics);
        }
    },
    // The sequences it starts are advanced by the stage machine, so it has
    // to write them before the machine runs. That also puts it before
    // JumpSequenceSystem's leader check, which is what makes a sequence
    // started on a tick whose leader is cancelled harmless: it is undone on
    // that same tick.
    before: [JumpSequenceSystem],
});

/**
 * An escort's OWN departure burn has finished: it warps out ahead of its
 * player and is handed to the owning client right there.
 *
 * This is the ordinary case — an escort that is quicker onto its heading
 * than its player leaves first, which is exactly what the sequences were
 * added to show. The carry event names the destination, which a follower
 * knows because it copied it from the player's jump when the sequence
 * began.
 *
 * THE EVENT IS THE PLAYER'S OWN. A follower emits the same
 * InitiateJumpEvent every departing ship emits, and the split is by
 * component, not by event: this system requires a JumpComponent with
 * `follows`, EscortFollowJumpSystem requires ControlledByComponent, and
 * JumpFromSystem skips anything with `follows`. Reusing the one event is
 * what reduces the ordering guarantee below to a toposort edge.
 *
 * ORDERING. `before: [JumpFromSystem]` — the same discipline
 * EscortFollowJumpSystem uses, and for the same reason. FinishJumpEvent is
 * what the client follows out of the origin system, and it is emitted only
 * by JumpFromSystem; every escort carry is therefore recorded in the
 * frame's event list ahead of it, whether the escort left on an earlier
 * tick, on an earlier event of the same tick, or (the coincidence case) on
 * the player's very own InitiateJumpEvent via the fallback sweep below.
 * The client can never tear the origin system down holding an escort it
 * has not been given.
 */
export const EscortDepartJumpSystem = new System({
    name: 'EscortDepartJump',
    events: [InitiateJumpEvent],
    args: [JumpComponent, GetEntity, UUID, InitiateJumpEvent, Entities,
        Emit] as const,
    step(jump, escort, escortUuid, { to }, entities, emit) {
        if (jump.follows === undefined) {
            return; // A ship jumping on its own account.
        }
        sweepJumpingEscort(escort, escortUuid, to, jump.follows, entities,
            emit);
    },
    before: [JumpFromSystem],
});

/**
 * The player is departing into hyperspace: any escort still with them
 * leaves too, on the spot.
 *
 * THIS IS THE FALLBACK, and the guarantee that no escort is ever left
 * behind by slow turning. Escorts normally warp out on their own sequences
 * (EscortDepartJumpSystem); one that is still stopping, aligning, spinning
 * up, or burning when its player goes is swept here instead, exactly as
 * every escort was before the sequences existed. It got its visible stop
 * and turn — what it loses is the last part of an animation whose whole
 * point was to leave with the player, who has now left.
 *
 * A heavy freighter behind a nimble player is the ordinary case, not a
 * corner: the alternative to sweeping it would be stranding it, and
 * convergence wins that tie every time (see THE CONVERGENCE INVARIANT).
 *
 * Each follower is serialized out of this system and handed to the owning
 * client, which inserts it into the destination system beside the player
 * (browser.ts). Ordered BEFORE JumpFromSystem so the escort carry events
 * precede the player's FinishJumpEvent in the frame's event list — the
 * client collects the escorts synchronously and consumes them inside the
 * (asynchronous) jump handler, so they are always in hand before
 * teardownActiveSystem drops the old system's entities.
 *
 * Escorts jump for FREE: no fuel is deducted, because an escort must
 * always be able to follow. A ship with zero energy capacity
 * (FuelComponent.max === 0, i.e. shïp "energy" 0) has no hyperdrive at
 * all and is left behind — still marked owned, so it is recovered if the
 * player ever returns to this system. So is one that is DISABLED, which
 * cannot run a hyperdrive it still has ({@link escortFollows}).
 */
export const EscortFollowJumpSystem = new System({
    name: 'EscortFollowJump',
    events: [InitiateJumpEvent],
    args: [UUID, InitiateJumpEvent, ControlledByComponent, Entities,
        Emit] as const,
    step(playerUuid, { to }, _controlledBy, entities, emit) {
        const following =
            sweepableEscorts(entities, playerUuid, 'jump');
        for (const escortUuid of following) {
            const escort = entities.get(escortUuid);
            if (!escort) {
                continue;
            }
            sweepJumpingEscort(escort, escortUuid, to, playerUuid, entities,
                emit);
        }
    },
    before: [JumpFromSystem],
});

/**
 * The player is entering a hypergate or a wormhole: their escorts go
 * through it with them.
 *
 * Fires on the player's LandEvent at the gate — the one moment both gate
 * flows share. A wormhole transits from that same event (GateDepartureSystem
 * removes the ship and emits GateTransitEvent); a hypergate docks the ship
 * a frame later and opens the map. Sweeping at the LandEvent therefore puts
 * the whole flock in the client's hands BEFORE either flow can start
 * tearing the origin system down, with no new client -> sim command path and
 * no waiting on a destination that, for a hypergate, the player has not
 * picked yet.
 *
 * Ordered BEFORE GateDepartureSystem for the same reason
 * EscortFollowJumpSystem is ordered before JumpFromSystem: the escorts'
 * carry events must precede the player's own departure event in the frame's
 * event list, so the client has collected them before it follows the
 * transit.
 *
 * Escorts ride the LANDED roster (see the module comment): a gate sweep has
 * no destination system to name, and the landed roster's consumers already
 * cover every outcome — the transit, the map-closed lift-off, and the
 * transit that never happens.
 *
 * No fuel rule: a gate carries anything, so a zero-energy hull that would
 * be left behind by a hyperspace jump follows through a gate
 * ({@link escortFollows}).
 *
 * Runs on every peer (LandEvent is replicated and targeted at the landing
 * ship), so the despawn is shared simulation state; only the owning client
 * keeps the roster, exactly as with a landing or a jump.
 */
export const EscortFollowGateSystem = new System({
    name: 'EscortFollowGate',
    events: [LandEvent],
    args: [UUID, LandEvent, ControlledByComponent, Entities, Emit] as const,
    step(playerUuid, land, _controlledBy, entities, emit) {
        if (!entities.get(land.uuid)?.components
            .get(PlanetDataComponent)?.gate) {
            return; // An ordinary stellar: EscortLandOrderSystem's job.
        }
        const following =
            sweepableEscorts(entities, playerUuid, 'gate');
        for (const escortUuid of following) {
            const escort = entities.get(escortUuid);
            if (!escort) {
                continue;
            }
            // A landing order does not survive the transit: the stellar it
            // named is in the system being left behind.
            escort.components.delete(EscortLandingComponent);
            // The transit ends this escort's plunder life segment, like
            // the jump sweep and the landing below (clearPlunderRecord).
            clearPlunderRecord(escort);
            entities.delete(escortUuid);
            deImmerify(escort);
            emit(EscortLandedEvent, {
                entity: escort, uuid: escortUuid, player: playerUuid,
                planet: land.uuid,
            }, [escortUuid]);
        }
    },
    before: [GateDepartureSystem],
});

/**
 * Flies a landing escort to its stellar and, inside the relaxed landing
 * window, removes it from the simulation and hands the whole serialized
 * entity to the owning client (EscortLandedEvent). The despawn is
 * simulation state (every peer does it); the roster the event feeds is
 * per-player client state.
 *
 * Ordered AFTER EscortReattachSystem, which closes a stranding race: the
 * player's relaunch arrives as an input record applied before the tick's
 * systems run, so in that tick the re-attach clears the landing order
 * BEFORE this system could despawn an escort that happened to be sitting
 * inside the landing window — an escort whose capture would arrive after
 * the client had already consumed and re-inserted its roster.
 */
export const EscortLandingSystem = new System({
    name: 'EscortLanding',
    args: [EscortLandingComponent, PlayerEscortComponent,
        MovementStateComponent, ShipPhysicsComponent, TimeResource,
        Entities, GetEntity, UUID, Emit] as const,
    step(landing, owned, movement, physics, time, entities, entity, uuid,
        emit) {
        const planetPosition = entities.get(landing.planet)?.components
            .get(MovementStateComponent)?.position;
        if (!planetPosition) {
            // The stellar is gone (system rebuilt under us): stand down
            // and let the re-attach / normal AI take over again.
            entity.components.delete(EscortLandingComponent);
            return;
        }
        const target = Position.fromVectorLike(planetPosition);
        const distanceSquared =
            target.subtract(movement.position).lengthSquared;
        if (distanceSquared <= ESCORT_LAND_DISTANCE_SQUARED
            && movement.velocity.lengthSquared <= ESCORT_LAND_SPEED_SQUARED) {
            // Landed. The order is dropped before the entity is captured
            // so the escort comes back out of the roster clean.
            entity.components.delete(EscortLandingComponent);
            // Landing-and-departing ends this escort's plunder life
            // segment (Matthew's ruling — see clearPlunderRecord).
            clearPlunderRecord(entity);
            entities.delete(uuid);
            deImmerify(entity);
            emit(EscortLandedEvent, {
                entity, uuid, player: owned.player, planet: landing.planet,
            }, [uuid]);
            return;
        }
        steerToStellar(movement, target, physics.acceleration, physics.speed,
            time.delta_s);
    },
    after: [TimeSystem, EscortReattachSystem],
    before: [MovementSystem],
});

export const PlayerEscortPlugin: Plugin = {
    name: 'PlayerEscortPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        // Both components are real simulation state AND must ride the
        // serialized entity across a landing or a jump, so they are
        // serializer-registered (which also puts them in desync hashes,
        // rollback snapshots via the default codec policy, and wire
        // baselines).
        serializer?.addComponent(PlayerEscortComponent, PlayerEscort);
        serializer?.addComponent(EscortLandingComponent, EscortLanding);
        // The payroll mirror rides the PLAYER's entity out of the world at
        // a landing or a jump, which is exactly when it gets charged.
        serializer?.addComponent(EscortPayrollComponent, t.array(t.string));
        if (serializer) {
            serializer.addEvent(EscortJumpEvent, escortCarryEventType(
                'EscortJumpEventType', EscortJumpRest, serializer));
            serializer.addEvent(EscortLandedEvent, escortCarryEventType(
                'EscortLandedEventType', EscortLandedRest, serializer));
        }
        world.addSystem(MarkPlayerEscortsSystem);
        world.addSystem(EscortPayrollSystem);
        world.addSystem(EscortLandOrderSystem);
        world.addSystem(EscortLandingSystem);
        world.addSystem(EscortFollowJumpBeginSystem);
        world.addSystem(EscortDepartJumpSystem);
        world.addSystem(EscortFollowJumpSystem);
        world.addSystem(EscortFollowGateSystem);
        world.addSystem(EscortReattachSystem);
    },
};
