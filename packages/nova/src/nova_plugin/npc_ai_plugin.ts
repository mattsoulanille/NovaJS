import * as t from 'io-ts';
import { Emit, Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { EcsEvent } from 'nova_ecs/events';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { RunQuery } from 'nova_ecs/arg_types';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { registerSimulationBridgeEvent } from '../communication/simulation_bridge_events.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import {
    BoardedComponent, BoardedState, clearPlunderRecord, plunderSpent,
} from './boarding_component.js';
import { CloakActiveComponent, isTargetable } from './cloak_plugin.js';
import { DamagedEvent, ExplodingComponent } from './death_plugin.js';
import { DisabledComponent, DisabledState } from './disabled_component.js';
import { EscortCommandComponent } from './escort_command.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { GovtComponent } from './govt_component.js';
import { BRIBE_MINIMUM } from './hail.js';
import { AssistingComponent } from './hail_component.js';
import { govtDispositionTo, effectiveStrength, oddsFavorable } from './govt_disposition.js';
import { ArmorComponent, ShieldComponent } from './health_plugin.js';
import { beginDepartureJump, JumpComponent, JumpSequenceSystem, JUMP_DISTANCE, JUMP_ARRIVAL_MARGIN_S } from './jump_plugin.js';
import { landable } from './landable.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import { CreditsComponent } from './player_state_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { PlanetData } from 'novadatainterface/planet_data';
import { ShipPhysics } from 'novadatainterface/ship_data';
import { PlanetComponent, PlanetDataComponent } from './planet_plugin.js';
import { EscortLandingComponent } from './player_escort.js';
import { LegalRecordsComponent } from './reputation_plugin.js';
import { ActiveRanksComponent } from './ncb_plugin.js';
import { ranksSuppressAggression } from './rank_logic.js';
import { SourceComponent } from './weapon_components.js';
import { ShipComponent, ShipDataComponent, ShipPhysicsComponent } from './ship_plugin.js';
import { heldInSystem, SystemHoldComponent, SystemHoldType } from './system_hold.js';
import { TargetComponent } from './target_component.js';
import { WeaponsStateComponent } from './weapons_state.js';

/**
 * ============================================================================
 * NPC AI (EVN Bible AITypes 1-4, simplified but distinct)
 * ============================================================================
 *
 * Everything here runs DETERMINISTICALLY IN THE SHARED SIMULATION on
 * every peer: state lives in serializer-registered components, timers
 * use TimeResource, randomness comes only from the seeded
 * RandomResource, and candidate selection breaks ties by uuid. This is
 * the designed endpoint of the AI architecture — the older marker-
 * component AI in npc_plugin.ts (ChooseRandomTarget/Follow/ShootAll)
 * predates rollback multiplayer and survives only as a primitive for
 * dev-spawned test ships and bay fighters in combat; new NPC behavior
 * belongs here.
 *
 * The Bible specifies the STRUCTURE of the four AI types but not their
 * steering geometry, so the numbers below (ranges, dwell times,
 * formation spacing) are judgment calls, kept as named constants for
 * tuning:
 *
 *  1 wimpy trader:  flies planet to planet (arrive -> dwell -> next),
 *                   flees for a jump-out when attacked.
 *  2 brave trader:  same, but fights its attacker back while the govt
 *                   MaxOdds calculation stays favorable, then flees.
 *  3 warship:       hunts govt enemies (disposition via GovtData
 *                   classes/allies/enemies); patrols waypoints when
 *                   there is nothing to hunt; jumps out eventually.
 *  4 interceptor:   orbits a home planet and engages govt enemies that
 *                   come within its engagement bubble. (The Bible's
 *                   cargo-scanning "buzz" and piracy-police reactions
 *                   are not modeled: scanning and boarding don't exist
 *                   in the sim yet.)
 *
 * NPC DEPARTURE runs the real hyperspace jump sequence. A ship that is
 * departing or fleeing enters jump_plugin's JumpComponent state machine
 * (beginDepartureJump) and plays every visible stage a player's ship
 * plays — coming to a stop, turning onto its jump heading, spinning up
 * the hyperdrive, then the departure burn — and only leaves the world
 * at the end of it. Big slow-turning ships are the case that motivated
 * this: they used to pop out of existence mid-turn.
 *
 * The stage machine is REUSED, not duplicated. The only thing that
 * differs from a player's jump is the terminal: an NPC has no route and
 * no destination room to be carried to, so its JumpComponent is marked
 * `vanish` and departure simply deletes it (see JumpStateType). That also
 * keeps NPC jumps clear of the player-only machinery hanging off
 * InitiateJumpEvent — the entity serialize-and-carry in JumpFromSystem,
 * and EscortFollowJumpSystem, which would otherwise be the thing that
 * swept a player's escorts along behind a passing NPC.
 *
 * Deleting at NPC_DEPART_RADIUS survives only as the fallback for a
 * ship that cannot jump at all: see NpcSteeringSystem.
 */

// --- Tuning constants ---

/** Base think interval; divided by the govt's SkillMult/100, so more
 * skilled governments react faster (the natural home for SkillMult
 * until per-ship stat scaling exists). */
export const NPC_DECISION_INTERVAL_MS = 1000;
/** How long a trader loiters at a planet, standing in for landing
 * (real landing would despawn/respawn the ship; not worth it yet). */
export const TRADER_DWELL_MS = 12_000;
/** Traders arrive at a planet within this distance... */
const PLANET_ARRIVE_RADIUS = 90;
/** ...and below this speed (matches AttemptLandingSystem's numbers:
 * dist^2 < 10000, speed^2 < 3000). */
const PLANET_ARRIVE_SPEED = 50;
/** Distance at which an arriving ship starts braking. */
const ARRIVE_SLOW_RADIUS = 400;
/** Warship patrol waypoints are drawn within this box half-size —
 * matching the asteroid field, where gameplay happens. */
const PATROL_HALF_SIZE = 2000;
/** A patrol waypoint counts as reached within this distance. */
const WAYPOINT_RADIUS = 200;
/** Interceptors orbit their home planet at this radius... */
const INTERCEPTOR_ORBIT_RADIUS = 400;
/** ...advancing their orbit waypoint by this angle when they reach it. */
const INTERCEPTOR_ORBIT_STEP = Math.PI / 4;
/** Interceptors engage enemies within this range of themselves or
 * their home planet. */
export const INTERCEPTOR_ENGAGE_RANGE = 1800;
/** Warships hunt enemies anywhere in the inhabited field; beyond this
 * they don't see them (keeps fights near the action). */
export const WARSHIP_ENGAGE_RANGE = 6000;
/** Attackers stop thrusting toward their target inside this range. */
const ATTACK_STANDOFF = 250;
/** NPCs only fire within this range of their target. */
const NPC_FIRE_RANGE = 1200;
/** NPCs stay in the system between these bounds before jumping out. */
export const NPC_DEPART_MIN_MS = 120_000;
export const NPC_DEPART_MAX_MS = 300_000;
/** Fleeing/departing ships are deleted ("jump out") beyond this radius. */
export const NPC_DEPART_RADIUS = JUMP_DISTANCE + 500 * JUMP_ARRIVAL_MARGIN_S;

// JUDGMENT CALL (Matthew wants to tune this): a fleeing ship that is
// far enough out to jump (outside the no-jump radius) jumps away —
// UNLESS its chaser is "right behind it". "Right behind" has no
// original-game definition, so it is defined here as: the chaser is
// within FLEE_JUMP_BLOCK_RANGE px AND inside the cone directly astern
// of the fleeing ship (within FLEE_JUMP_BLOCK_HALF_ANGLE of the
// direction opposite its heading) — close pursuit on its tail. A
// chaser alongside or ahead doesn't stop the jump.
export const FLEE_JUMP_BLOCK_RANGE = 500;
export const FLEE_JUMP_BLOCK_HALF_ANGLE = Math.PI / 3;

/**
 * Whether a pursuer is "right behind" a fleeing ship, blocking its
 * hyperspace escape (see the judgment-call note on the constants).
 */
export function chaserBlocksJump(fleeing: MovementState,
    chaser: MovementState): boolean {
    const toChaser = chaser.position.subtract(fleeing.position);
    if (toChaser.length > FLEE_JUMP_BLOCK_RANGE) {
        return false;
    }
    if (toChaser.lengthSquared < 1e-12) {
        return true;
    }
    const astern = Angle.fromAngleLike(fleeing.rotation).add(Math.PI);
    return Math.abs(astern.distanceTo(toChaser.angle).angle)
        < FLEE_JUMP_BLOCK_HALF_ANGLE;
}

// --- Formation tuning ---

/** Longitudinal spacing between formation rows, px. (Halved from the
 * first-cut 120 after Matthew's playtest: tighter wedge.) */
export const FORMATION_ROW_SPACING = 60;
/** Lateral spacing between adjacent cells of a row, px. (Halved from
 * the first-cut 110.) */
export const FORMATION_LATERAL_SPACING = 55;
/** How far ahead (seconds) followers lead the slot by the leader's
 * velocity, so they fly toward where the slot is going. */
const FORMATION_LOOKAHEAD_S = 0.4;
/** Position error is converted to closing velocity at this rate (1/s):
 * the proportional term of the follower controller. */
const FORMATION_POSITION_GAIN = 1.2;

// --- RCS (reaction control) tuning ---
//
// Ships holding formation get a reaction-control ability: small
// velocity corrections applied directly, WITHOUT rotating the ship,
// so station-keeping doesn't read as constant spin-and-thrust wiggle.
// The ship keeps its heading aligned with the leader's and the main
// engine stays dark (the engine flare is driven by the `accelerating`
// flag — animation_graphic_plugin's glowAlpha — which RCS never sets).
//
// This lives in the AI/steering layer (the formation controller), NOT
// in movement physics: EffectiveMovementPhysicsSystem stays the single
// per-tick writer of MovementPhysics, and RCS is a bounded velocity
// nudge made by steering before MovementSystem integrates — the same
// layer where knockback adjusts velocity. The budget derives from the
// ship's BASE acceleration (ShipPhysics), so afterburners and jump
// drives don't secretly boost thrusterless station-keeping.

/** RCS strength as a fraction of the ship's main-engine acceleration
 * (Matthew's spec: proportional to the ship's acceleration). */
export const RCS_ACCEL_FRACTION = 0.25;
/** Turn-and-burn hands over to RCS when the correction (desired minus
 * actual velocity, px/s) drops below this... */
export const RCS_ENGAGE_SPEED = 60;
/** ...and RCS hands back to turn-and-burn above this. The gap is the
 * hysteresis that stops flip-flopping at the boundary. */
export const RCS_DISENGAGE_SPEED = 120;

// --- NPC plundering of disabled hulks (gövt Flags 0x1000) ---
//
// EVN Bible, gövt Flags (unofficial-corrections edition, the copy at the
// repo root):
//
//   0x1000     Warships will plunder non-mission, trader-type enemies
//              (including the player) before destroying them
//
// (The original Ambrosia text read "non-mission, non-player enemies";
// Appendix V records the correction. Both agree on "warships",
// "non-mission" and "trader-type".)
//
// That sentence is the ONLY NPC-side boarding rule in the whole Bible.
// Everything it does not say is a judgment call, so each one is a named
// constant here and every one of them is listed in the report as wanting
// a ruling:
//
//  - "Warships" -> AIType 3 only. AIType 3 IS "Warship"; AIType 4 is
//    "Interceptor", whose documented job is the opposite one — it "acts
//    as 'piracy police' by attacking any ship that fires on or attempts
//    to board another, non-enemy ship". Putting interceptors on the
//    plundering side would have them police themselves.
//  - "trader-type" -> AIType 1 and 2, which is how the Bible spells the
//    same idea everywhere else: gövt Flags 0x0080 says "Freighters (i.e.
//    AiTypes 1 and 2)" and flët Flags 0x0001 says "Freighters
//    (InherentAI <= 2)".
//  - "(including the player)" IS implemented (Matthew's ruling): a
//    DISABLED player is boarded exactly like a hulk, and the pirates take
//    a cut of the player's cash. See npcPlunderCredits for the amount and
//    why it is pegged above the bribe.
//  - DISABLED FIRST is imposed by this engine, not by the Bible (the
//    flag says only "before destroying them"). Boarding in NovaJS is
//    defined against a disabled hulk (boarding_component.ts), so an NPC
//    plunder run waits for the hulk like the player does — the player
//    included.
//  - From an NPC HULK the boarder takes nothing material: there is
//    nowhere for an NPC's booty to go and no way for anyone to observe
//    it, so the whole point of the run is the DENIAL — the hulk's one
//    plunder is spent and the player is refused. From a PLAYER there is
//    somewhere for it to go, so credits actually move.

/**
 * TUNABLE (Bible-ambiguous). AI types that run a plunder-boarding
 * approach when their government carries gövt Flags 0x1000.
 */
export const NPC_PLUNDER_BOARDER_AI_TYPES: ReadonlySet<number> = new Set([3]);
/**
 * TUNABLE (Bible-ambiguous). AI types that count as the flag's
 * "trader-type" victims.
 */
export const NPC_PLUNDER_VICTIM_AI_TYPES: ReadonlySet<number> = new Set([1, 2]);
/**
 * Whether NPCs plunder ships somebody is FLYING. The corrected Bible text
 * says gövt Flags 0x1000 includes the player, and Matthew's ruling agrees:
 * they do. Kept as a named constant so the predicate reads as a rule
 * rather than an omission, and so the specs can quote it.
 */
export const NPC_PLUNDER_TAKES_FROM_PLAYERS = true;

/**
 * ============================================================================
 * What pirates take off a disabled PLAYER
 * ============================================================================
 *
 * A cut of the player's cash — Matthew's ruling — and it MUST COST MORE
 * THAN BUYING THEM OFF. That relation is the whole design: a hostile ship
 * you can still fly away from will take `bribeAmount` (hail.ts) to leave
 * you alone, so if letting yourself be disabled and boarded were cheaper,
 * the bribe would be strictly dominated and nobody would ever pay one.
 *
 * So both terms of the demand are pegged above the bribe's:
 *
 *  - the FRACTION is above BRIBE_FRACTION_LARGE (0.30), the biggest cut
 *    any bribe takes — the pirate/`largerBribes` one, which is exactly the
 *    kind of government that carries the plunder flag in the first place;
 *  - the FLOOR is DERIVED from BRIBE_MINIMUM rather than written out, so
 *    raising the bribe floor cannot silently leave a cheap plunder behind
 *    it.
 *
 * The one place the two can be EQUAL is a purse too small to satisfy
 * either demand: both are capped at what the player actually has, and
 * nobody can take more than everything. npc_boarding_test pins the
 * relation (>= always, > whenever the bribe is not already taking the
 * whole purse) across a sweep of purses and both bribe flags, so the two
 * functions cannot drift apart.
 *
 * PURE AND DETERMINISTIC: a function of the synced CreditsComponent
 * alone, with no roll, so every peer deducts the same amount on the same
 * tick. (A random cut would also have to agree on the draw count with
 * every other NPC's decision roll.)
 */
export const NPC_PLUNDER_CREDIT_FRACTION = 0.50;
/** The floor, pegged above the bribe's (see NPC_PLUNDER_CREDIT_FRACTION). */
export const NPC_PLUNDER_CREDIT_MINIMUM = 2 * BRIBE_MINIMUM;

/**
 * The credits pirates take off a disabled player: the larger of the
 * fraction and the floor, capped at what the player actually has.
 * Mirrors bribeAmount's shape exactly, one tier up.
 */
export function npcPlunderCredits(playerCredits: number): number {
    const purse = Math.max(0, Math.floor(playerCredits));
    const demand = Math.max(NPC_PLUNDER_CREDIT_MINIMUM,
        Math.floor(purse * NPC_PLUNDER_CREDIT_FRACTION));
    return Math.min(demand, purse);
}
/** TUNABLE. How far away a warship will notice a plunderable hulk. */
export const NPC_PLUNDER_SEEK_RANGE = 4000;
/** TUNABLE. "Pulled alongside", for an NPC (the player's own gate is
 * tighter, and additionally axis-aligned — an NPC is not asked to fly
 * that precisely). */
export const NPC_BOARD_RADIUS = 140;
/** TUNABLE. Relative speed at which an NPC counts as matched to the
 * hulk's drift. */
export const NPC_BOARD_SPEED = 60;

export const NpcMode = t.union([
    t.literal('travel'), t.literal('dwell'), t.literal('flee'),
    t.literal('attack'), t.literal('patrol'), t.literal('depart'),
    /** Flying to a disabled hulk to plunder it (gövt Flags 0x1000). */
    t.literal('board')]);
export type NpcMode = t.TypeOf<typeof NpcMode>;

/**
 * Whether this NPC is a plunderer at all: the "Warships ... of this govt"
 * half of gövt Flags 0x1000. Split out so the decision step can decide in
 * one cheap test whether to look at hulks at all.
 */
export function npcPlundersHulks(aiType: number,
    plundersBeforeDestroying: boolean | undefined): boolean {
    return plundersBeforeDestroying === true
        && NPC_PLUNDER_BOARDER_AI_TYPES.has(aiType);
}

/**
 * Whether a warship of a plundering government would run a boarding
 * approach on this victim — the gövt Flags 0x1000 rule, as a pure
 * predicate over already-resolved facts so it can be pinned directly.
 */
export function npcPlunderEligible(boarder: {
    aiType: number, plundersBeforeDestroying: boolean | undefined,
}, victim: {
    /** The victim's NpcComponent aiType; undefined when it has no NPC
     * brain (a player's ship, a dev-spawned hull). */
    aiType: number | undefined,
    disabled: boolean,
    /** Its one plunder has already been spent (plunderSpent). */
    plunderSpent: boolean,
    /** It is a mission special ship — the flag's "non-mission". */
    missionShip: boolean,
    /** Somebody is flying it (ControlledByComponent). */
    controlled: boolean,
    /** The boarder's government calls it an enemy. */
    hostile: boolean,
}): boolean {
    if (!npcPlundersHulks(boarder.aiType,
        boarder.plundersBeforeDestroying)) {
        return false;
    }
    if (!victim.disabled || victim.plunderSpent || victim.missionShip
        || !victim.hostile) {
        return false;
    }
    if (victim.controlled) {
        return NPC_PLUNDER_TAKES_FROM_PLAYERS;
    }
    return victim.aiType !== undefined
        && NPC_PLUNDER_VICTIM_AI_TYPES.has(victim.aiType);
}

export const NpcState = t.intersection([t.type({
    /** Effective AI type 1-4 (düde AIType, or the shïp InherentAI when
     * the düde says 0). */
    aiType: t.number,
}), t.partial({
    mode: NpcMode,
    /** Planet uuid: travel destination (traders) or home (interceptors). */
    destination: t.string,
    /** Current waypoint (patrol legs, orbit points, flee headings). */
    waypoint: t.tuple([t.number, t.number]),
    /** Sim time (ms) when the current dwell ends. */
    until: t.number,
    /** Sim time (ms) of the next decision re-evaluation. */
    nextDecision: t.number,
    /** Uuid of the ship that most recently damaged this NPC. */
    aggressor: t.string,
    /** Sim time (ms) after which the NPC heads for a jump-out. */
    departAt: t.number,
    /** Uuid of the disabled hulk this NPC is flying to plunder (mode
     * 'board'; gövt Flags 0x1000). Cleared the moment the approach ends,
     * however it ends. */
    boardTarget: t.string,
    /** Uuid of a ship this NPC has been bribed to leave alone (hail bribe /
     * beg-for-mercy). While `pacifiedUntil` has not lapsed, this ship is
     * skipped as a hostile and forgotten as an aggressor. */
    pacifiedFrom: t.string,
    /** Sim time (ms) until which `pacifiedFrom` is ignored. */
    pacifiedUntil: t.number,
})]);
export type NpcState = t.TypeOf<typeof NpcState>;
export const NpcComponent = new Component<NpcState>('NpcComponent');

/**
 * Holds an escort in a deterministic formation slot on its leader when
 * it is not engaged. Used by fleet escorts and by bay fighters that
 * have no target.
 */
export const Formation = t.intersection([t.type({
    /** Leader entity uuid. */
    leader: t.string,
    /** 0-based slot index; see formationOffset for the geometry. */
    slot: t.number,
}), t.partial({
    /** Bay fighters: sim time (ms) at which the fighter stops holding
     * and turns home to dock (see bay_plugin). */
    dockAt: t.number,
    /** Whether the follower is currently station-keeping on RCS (the
     * hysteresis state of the formation controller). Sim state: it
     * must roll back and cross the wire with the ship or peers flip
     * modes at different ticks. */
    rcs: t.boolean,
})]);
export type Formation = t.TypeOf<typeof Formation>;
export const FormationComponent = new Component<Formation>('FormationComponent');

/**
 * The first free formation slot on `leaderUuid`: one past the highest
 * slot number any live sibling holds (0 when the leader has no
 * followers yet).
 *
 * COUNTING siblings instead would collide after a mid-formation death:
 * a leader holding slots {0, 1, 2} that loses slot 1 has a sibling
 * count of 2, which is still a live escort's slot, and FormationSystem
 * ranks stations by `siblingSlots.indexOf(slot)` — the two duplicates
 * would resolve to the same rank and stack on one station while
 * another sits empty.
 *
 * Taking a MAX (rather than accumulating) makes the result independent
 * of iteration order, so this is safe to run over an unordered entity
 * map in the deterministic simulation.
 */
export function nextFormationSlot(formations: Iterable<Formation>,
    leaderUuid: string): number {
    let slot = 0;
    for (const formation of formations) {
        if (formation.leader === leaderUuid) {
            slot = Math.max(slot, formation.slot + 1);
        }
    }
    return slot;
}

/**
 * Every formation present in `entities` — the adapter for sim systems
 * that hold an EntityMap rather than a formation query result, so they
 * can feed `nextFormationSlot`.
 */
export function* formationsIn(entities: EntityMap): Iterable<Formation> {
    for (const [, entity] of entities) {
        const formation = entity.components.get(FormationComponent);
        if (formation) {
            yield formation;
        }
    }
}

/**
 * Formation slot geometry: the LEADER is the apex of the triangle, and
 * escort rows widen behind it — row r sits r * FORMATION_ROW_SPACING
 * astern and is (r + 1) cells wide (2, 3, 4, ... cells), each row
 * centered on the leader's axis with adjacent cells
 * FORMATION_LATERAL_SPACING apart. No escort ever occupies the apex
 * (that's the player's ship — Matthew's spec); the first escort row is
 * the flanking pair. RANKS are laid out so that EVERY escort count
 * flies a formation symmetric about the leader's axis. Counts 1-7 use
 * an explicit table (diagrams below — Matthew gets to veto specifics);
 * larger counts fill the widening rows with each row's occupants
 * arranged center-out, which keeps any occupancy symmetric.
 *
 *  count 1        count 2        count 3        count 4
 *     L              L              L              L
 *     1            1   2          1   2          1   2
 *                                   3          3       4
 *
 *  count 5        count 6          count 7
 *     L              L                L
 *   1   2          1   2            1   2
 *  3  4  5       3       4        3   4   5
 *                  5   6            6   7
 *
 *  - Count 1's lone escort sits centered one row back (a two-ship
 *    column; with one escort there is no triangle to have a top).
 *  - Count 3 is the leader-apex diamond: pair, then one centered in
 *    the 3-wide row. Count 5 fills that row (pair + full triple);
 *    count 7 adds a centered pair in the 4-wide row.
 *  - Counts 2 and 4 fly center-free flanking pairs — count 4 is the
 *    widening V from Paul's fork (escortPosition's hand-tuned 4-case).
 *  - Count 6 is the fork's other special case: three PAIRS with the
 *    middle column EMPTY (a hexagon). Filling the rows instead would
 *    park the sixth ship alone off-axis in the 4-wide row; the middle
 *    of the 3-wide row is skipped and the last pair tucks in behind.
 *  (Fork provenance: paul-npcs-era `escortPosition` special-cases 4
 *  and 6 exactly this way, and its base `triangleRaster` also starts
 *  rows at two cells — the leader-apex shape matches the fork's; the
 *  odd-count centered layouts here are new.)
 *
 * The layout is a function of (rank, count), NOT the persistent slot
 * number: slot ASSIGNMENT (hire order, continuation numbering) is
 * unchanged, but the formation-keeping systems convert a ship's slot
 * to its RANK among the live same-leader slots and pass the live
 * count. An escort joining or leaving therefore re-flows everyone to
 * the new count's layout — pure geometry, deterministic on every peer
 * (ranks come from sorting the synced slot numbers), and the RCS
 * controller slides ships the short hop to their new stations.
 */
export function formationOffset(rank: number,
    count?: number): { back: number, lateral: number } {
    // [row, lateral] in row/cell units, per rank, for counts 1-7.
    const SMALL_FORMATIONS: ReadonlyArray<
        ReadonlyArray<readonly [number, number]>> = [
            [],
            [[1, 0]],
            [[1, 0.5], [1, -0.5]],
            [[1, 0.5], [1, -0.5], [2, 0]],
            [[1, 0.5], [1, -0.5], [2, 1], [2, -1]],
            [[1, 0.5], [1, -0.5], [2, -1], [2, 0], [2, 1]],
            [[1, 0.5], [1, -0.5], [2, 1], [2, -1], [3, 0.5], [3, -0.5]],
            [[1, 0.5], [1, -0.5], [2, -1], [2, 0], [2, 1],
                [3, 0.5], [3, -0.5]],
        ];
    if (count !== undefined && count >= 1 && count <= 7 && rank < count) {
        const [row, lateralUnits] = SMALL_FORMATIONS[count][rank];
        return {
            back: row * FORMATION_ROW_SPACING,
            lateral: lateralUnits * FORMATION_LATERAL_SPACING,
        };
    }
    // General leader-apex triangle: row r (1-based) is (r + 1) cells
    // wide and holds ranks C(r-1) .. C(r)-1, where C(r) = r(r+3)/2 is
    // the cumulative capacity of rows 1..r.
    const row = Math.ceil((Math.sqrt(8 * rank + 17) - 3) / 2);
    const capacityBefore = ((row - 1) * (row + 2)) / 2;
    const indexInRow = rank - capacityBefore;
    // This row's occupancy: full (r + 1 cells) unless it is the
    // deepest, partially filled row of the formation.
    const occupancy = count === undefined ? row + 1
        : Math.min(row + 1, count - capacityBefore);
    // Occupants arranged center-out and symmetric for ANY occupancy:
    // odd k sits at 0, -1, +1, -2, +2, ...; even k at -0.5, +0.5,
    // -1.5, +1.5, ... (cell units).
    const oddRow = occupancy % 2 === 1;
    const pairIndex = oddRow
        ? Math.floor((indexInRow + 1) / 2) : Math.floor(indexInRow / 2) + 0.5;
    const side = (oddRow ? indexInRow : indexInRow + 1) % 2 === 1 ? -1 : 1;
    const lateralUnits = oddRow && indexInRow === 0 ? 0 : side * pairIndex;
    return {
        back: row * FORMATION_ROW_SPACING,
        lateral: lateralUnits * FORMATION_LATERAL_SPACING,
    };
}

/**
 * The world-space position of a leader's formation station for the
 * escort of the given RANK (see formationOffset) — pass the live
 * formation count for the per-count symmetric layouts.
 */
export function formationSlotPosition(leaderPosition: Position,
    leaderRotation: Angle, rank: number, count?: number): Position {
    const { back, lateral } = formationOffset(rank, count);
    const u = leaderRotation.getUnitVector();
    // Perpendicular (rotate u by +90°).
    const p = new Vector(-u.y, u.x);
    return new Position(
        leaderPosition.x - u.x * back + p.x * lateral,
        leaderPosition.y - u.y * back + p.y * lateral);
}

/**
 * A candidate hostile for target selection: uuid plus its squared
 * distance. Selection picks the nearest; exactly equal distances break
 * ties by the lexicographically smaller uuid so every peer picks the
 * same target regardless of entity-map iteration order (the same rule
 * ChooseTargetSystem uses).
 */
export function chooseNearest(
    candidates: Iterable<readonly [string, number]>): string | undefined {
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const [uuid, distanceSquared] of candidates) {
        if (distanceSquared < bestDistance
            || (distanceSquared === bestDistance
                && best !== undefined && uuid < best)) {
            best = uuid;
            bestDistance = distanceSquared;
        }
    }
    return best;
}

function randomBetween(random: Random, min: number, max: number): number {
    return min + random.next() * (max - min);
}

/** Draws the sim time at which a freshly spawned NPC will depart. */
export function rollDepartureTime(now: number, random: Random): number {
    return now + randomBetween(random, NPC_DEPART_MIN_MS, NPC_DEPART_MAX_MS);
}

// --- Aggression tracking ---

const DamagerSourceQuery = new Query([Optional(SourceComponent)] as const);

/**
 * Records who last damaged an NPC. The damager of a DamagedEvent is
 * the projectile/beam entity; its SourceComponent is the firing ship.
 */
const NpcAggressionSystem = new System({
    name: 'NpcAggressionSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, NpcComponent, UUID, RunQuery] as const,
    step({ damager }, npc, uuid, runQuery) {
        const source = runQuery(DamagerSourceQuery, damager)[0]?.[0];
        if (source && source !== uuid) {
            npc.aggressor = source;
            // React at the next think, not next frame: reaction time.
            // A bribe (hail beg-for-mercy) only lasts "until the player
            // provokes them again": if the briber is the one now shooting
            // us, the reprieve is void — clear it so NpcDecisionSystem stops
            // skipping them and resumes hostility.
            if (npc.pacifiedFrom === source) {
                npc.pacifiedFrom = undefined;
                npc.pacifiedUntil = undefined;
            }
        }
    },
});

// --- Decision making ---

const PlanetsQuery = new Query(
    [UUID, MovementStateComponent, PlanetComponent,
        PlanetDataComponent] as const);
const NpcTargetsQuery = new Query([UUID, MovementStateComponent, ShipComponent,
    ShipDataComponent, Optional(GovtComponent), Optional(ShieldComponent),
    Optional(CloakActiveComponent), Optional(DisabledComponent),
    Optional(LegalRecordsComponent), Optional(ActiveRanksComponent)] as const);

function lookupGovt(gameData: SimulationGameDataInterface,
    govt: { id: string } | undefined) {
    // getCached is deterministic here because NPC spawning stages every
    // govt it assigns, and player ships have no govt. A ship arriving
    // via wire snapshot goes through loadWireSnapshotGameData, which
    // stages its govt too.
    return govt ? gameData.data.Govt.getCached(govt.id) : undefined;
}

function shieldFraction(shield: { current: number, max: number } | undefined) {
    if (!shield || shield.max <= 0) {
        return 1;
    }
    return Math.max(0, shield.current / shield.max);
}

/** A PlanetsQuery row: [uuid, movement, planet, planetData]. */
export type PlanetEntry = readonly [string, MovementState, unknown, PlanetData];

/**
 * The stellars NPCs treat as landing destinations / patrol homes.
 *
 *  - Wormholes are excluded: they are transit portals, not places a ship
 *    parks (the player can still deliberately fly into one to transit —
 *    that path is AttemptLandingSystem, not the AI).
 *  - Stellars that are not ports are excluded through the SAME predicate
 *    the player's land gate uses (landable.ts). That is what stops traders
 *    from cheerfully hauling cargo to Jupiter and to the destroyed
 *    hypergates of the collapsed network, which they did because nothing
 *    in the AI ever looked at the spöb can-land bit.
 *
 * Filtered the same way on every peer because PlanetDataComponent is
 * genesis state, so the AI stays deterministic; and the filter costs no
 * PRNG draws (pickPlanet always draws exactly once).
 */
export function landingDestinations(planets: PlanetEntry[]): PlanetEntry[] {
    return planets.filter(([, , , data]) =>
        data.gate?.kind !== 'wormhole' && landable(data));
}

/** Picks the next planet a trader heads for (uuid order for
 * determinism; Random for variety; excludes the one it's at). */
function pickPlanet(planets: PlanetEntry[],
    random: Random, exclude?: string): string | undefined {
    const ids = planets.map(([uuid]) => uuid)
        .filter(uuid => uuid !== exclude)
        .sort();
    if (ids.length === 0) {
        return undefined;
    }
    return ids[random.below(ids.length)];
}

function nearestPlanet(planets: PlanetEntry[],
    position: Position): string | undefined {
    return chooseNearest(planets.map(([uuid, movement]) => [uuid,
        movement.position.subtract(position).lengthSquared] as const));
}

/**
 * What a trader that has just picked (or failed to pick) a destination
 * does next: fly there, or — with nowhere to go — leave the system.
 *
 * A HELD ship (system_hold.ts) never takes the second branch. With no
 * landable stellar to head for it is left with NO mode at all, so it
 * simply drifts where it is and re-plans on each think until a
 * destination appears or the hold is released. That is the honest
 * outcome: every other trader mode is "go somewhere", and there is
 * nowhere to go. It costs no extra PRNG draw, because pickPlanet only
 * draws when it has candidates — and if it had candidates the ship would
 * be travelling.
 */
function travelOrDepart(destination: string | undefined,
    held: boolean): 'travel' | 'depart' | undefined {
    if (destination) {
        return 'travel';
    }
    return held ? undefined : 'depart';
}

/**
 * The per-NPC think step. Runs at NPC_DECISION_INTERVAL_MS (scaled by
 * the govt's SkillMult) and owns all mode transitions; the steering
 * system below only executes the current mode.
 */
const NpcDecisionSystem = new System({
    name: 'NpcDecisionSystem',
    args: [NpcComponent, MovementStateComponent, TargetComponent,
        Optional(GovtComponent), Optional(ShieldComponent),
        ShipDataComponent, Optional(FormationComponent),
        Optional(EscortCommandComponent), Optional(AssistingComponent),
        Optional(JumpComponent), Optional(SystemHoldComponent),
        NpcTargetsQuery,
        PlanetsQuery, TimeResource, RandomResource, Entities, UUID,
        SimulationGameDataResource, GetEntity] as const,
    step(npc, movement, target, govt, shield, shipData, formation,
        escortCommand, assisting, jump, hold, ships, planets, time, random,
        entities, uuid, gameData, entity) {
        // Unfinished business here (a refuel offer on the table, a rescue
        // target waiting to be boarded): this ship never DECIDES to leave.
        // See system_hold.ts; the jump exits themselves are gated in
        // NpcSteeringSystem, so a hold added mid-departure still stops it.
        const held = hold !== undefined;
        if (escortCommand) {
            // A player-commanded escort: its brain is the escort
            // command framework (escort_command_plugin), not NPC AI.
            return;
        }
        if (assisting) {
            // A ship coming to the player's aid (hail request-assistance):
            // AssistBehaviorSystem owns its steering until it has helped.
            return;
        }
        if (npc.mode === 'depart') {
            return;
        }
        if (jump) {
            // Already warping out: the decision is made and the ship is
            // committed, so it must not talk itself back into a fight
            // (a warship in 'flee' would otherwise re-target and start
            // shooting from inside its own departure burn).
            //
            // SEQUENCE-NEUTRAL: this bails alongside the 'depart' bail,
            // above every draw site, and costs no draws that would
            // otherwise happen. The only unconditional draw is
            // rollDepartureTime below, and it has provably already
            // happened for any ship that is jumping: 'flee' and 'depart'
            // are only ever set further down this same step, past that
            // line. So no other NPC's roll shifts.
            return;
        }
        const govtData = lookupGovt(gameData, govt);
        if ((npc.nextDecision ?? 0) > time.time) {
            return;
        }
        const skillMult = Math.max(1, govtData?.skillMult ?? 100);
        npc.nextDecision = time.time
            + NPC_DECISION_INTERVAL_MS * 100 / skillMult;
        if (npc.departAt === undefined) {
            npc.departAt = rollDepartureTime(time.time, random);
        }

        // Forget aggressors that no longer exist.
        if (npc.aggressor && !entities.has(npc.aggressor)) {
            npc.aggressor = undefined;
        }
        // A bribe (hail beg-for-mercy) buys a reprieve: while it holds, the
        // briber is skipped as a hostile below and forgotten as an
        // aggressor; when it lapses, the ship resumes hunting a criminal.
        if (npc.pacifiedUntil !== undefined && time.time >= npc.pacifiedUntil) {
            npc.pacifiedFrom = undefined;
            npc.pacifiedUntil = undefined;
        }
        const pacifiedFrom = npc.pacifiedUntil !== undefined
            ? npc.pacifiedFrom : undefined;
        if (pacifiedFrom && npc.aggressor === pacifiedFrom) {
            npc.aggressor = undefined;
        }

        const position = Position.fromVectorLike(movement.position);
        const myStrength = effectiveStrength(
            shipData.strength, shieldFraction(shield));

        // Gather enemies: govt-hostile ships plus the recorded
        // aggressor. Cloaked ships are excluded (invisible to AI), and
        // so are DISABLED ships: a disabled ship is no longer a threat,
        // so warships and interceptors drop it and pick a new target.
        // Ships with legal records (players) whose record with this govt
        // is below its crime tolerance are enemies too: crime has
        // consequences.
        //
        // Disabled enemies are collected SEPARATELY as plunder candidates
        // (gövt Flags 0x1000; see npcPlunderEligible). They are still not
        // hostiles — a warship never shoots at a hulk — but a warship of a
        // plundering government will fly over and board one.
        const hostiles: Array<readonly [string, number]> = [];
        const plunderable: Array<readonly [string, number]> = [];
        // Only a warship of a plundering government looks at hulks at all,
        // so the extra per-hulk entity lookups below cost nothing for
        // every other NPC in the system.
        const plunders = npcPlundersHulks(npc.aiType,
            govtData?.flags.plundersBeforeDestroying);
        let aggressorEntry: readonly [string, number, number] | undefined;
        for (const [otherUuid, otherMovement, , otherData, otherGovt,
            otherShield, cloak, otherDisabled, otherRecords,
            otherRanks] of ships) {
            if (otherUuid === uuid || !isTargetable(cloak)) {
                continue;
            }
            if (otherUuid === pacifiedFrom) {
                // Bribed to leave this ship alone (reprieve still active).
                continue;
            }
            const distanceSquared = otherMovement.position
                .subtract(position).lengthSquared;
            if (otherDisabled) {
                if (plunders && distanceSquared
                    <= NPC_PLUNDER_SEEK_RANGE * NPC_PLUNDER_SEEK_RANGE
                    && govtDispositionTo(govtData,
                        lookupGovt(gameData, otherGovt), otherRecords,
                        ranksSuppressAggression(otherRanks,
                            id => gameData.data.Rank.getCached(id),
                            govtData?.id)) === 'enemy') {
                    const hulk = entities.get(otherUuid);
                    if (hulk && npcPlunderEligible({
                        aiType: npc.aiType,
                        plundersBeforeDestroying:
                            govtData?.flags.plundersBeforeDestroying,
                    }, {
                        aiType: hulk.components.get(NpcComponent)?.aiType,
                        disabled: true,
                        plunderSpent: plunderSpent(
                            hulk.components.get(BoardedComponent)),
                        missionShip:
                            hulk.components.has(MissionShipComponent),
                        controlled:
                            hulk.components.has(ControlledByComponent),
                        hostile: true,
                    })) {
                        plunderable.push([otherUuid, distanceSquared] as const);
                    }
                }
                continue;
            }
            const otherStrength = effectiveStrength(
                otherData.strength, shieldFraction(otherShield));
            if (otherUuid === npc.aggressor) {
                aggressorEntry = [otherUuid, distanceSquared, otherStrength];
            }
            const disposition = govtDispositionTo(govtData,
                lookupGovt(gameData, otherGovt), otherRecords,
                // ränk 0x0100 for THIS ship's government: its holder is not
                // attacked on sight.
                ranksSuppressAggression(otherRanks,
                    id => gameData.data.Rank.getCached(id), govtData?.id));
            if (disposition === 'enemy') {
                hostiles.push([otherUuid, distanceSquared] as const);
            }
        }

        switch (npc.aiType) {
            case 2: // Brave trader: fight back while the odds hold.
                if (aggressorEntry) {
                    const favorable = oddsFavorable(govtData?.maxOdds ?? 100,
                        myStrength, aggressorEntry[2]);
                    if (favorable) {
                        npc.mode = 'attack';
                        target.target = aggressorEntry[0];
                        return;
                    }
                    npc.mode = 'flee';
                    return;
                }
                if (npc.mode === 'attack' || npc.mode === 'flee') {
                    // Attacker gone or lost: back to business.
                    npc.mode = undefined;
                    target.target = undefined;
                }
                break;
            case 1: // Wimpy trader: any aggression means run.
                if (aggressorEntry) {
                    npc.mode = 'flee';
                    return;
                }
                if (npc.mode === 'flee') {
                    npc.mode = undefined;
                }
                break;
        }

        switch (npc.aiType) {
            case 1:
            case 2: {
                // Planet-to-planet loop.
                if (npc.mode === 'travel') {
                    if (!npc.destination || !entities.has(npc.destination)) {
                        npc.mode = undefined;
                    }
                } else if (npc.mode === 'dwell') {
                    if (time.time >= (npc.until ?? 0)) {
                        // The loiter is over: this trader has "landed and
                        // departed" as far as this engine models it (dwell
                        // is the documented stand-in for a landing, since a
                        // real one would despawn and respawn the ship), so
                        // its PLUNDER LIFE SEGMENT ends here — Matthew's
                        // ruling that the one-plunder record resets when a
                        // ship lands and departs. It is rare in practice
                        // (a plundered hulk has to be repaired before it
                        // can travel at all) but it is the boundary the
                        // ruling names, and the sibling boundaries live in
                        // jump_plugin, player_escort_plugin and
                        // boarding_plugin's landing reset.
                        clearPlunderRecord(entity);
                        if (!held && time.time >= npc.departAt) {
                            npc.mode = 'depart';
                            return;
                        }
                        npc.destination = pickPlanet(
                            landingDestinations(planets), random,
                            npc.destination);
                        npc.mode = travelOrDepart(npc.destination, held);
                    }
                }
                if (npc.mode === undefined) {
                    npc.destination = pickPlanet(
                        landingDestinations(planets), random);
                    npc.mode = travelOrDepart(npc.destination, held);
                }
                break;
            }
            case 3: { // Warship: hunt, else patrol; jump out eventually.
                if (govtData?.flags.warshipsRetreatAt25
                    && shield && shield.max > 0
                    && shield.current < 0.25 * shield.max) {
                    npc.mode = 'flee';
                    target.target = undefined;
                    return;
                }
                const engageable = hostiles.filter(([, d2]) =>
                    d2 <= WARSHIP_ENGAGE_RANGE * WARSHIP_ENGAGE_RANGE);
                if (aggressorEntry) {
                    engageable.push([aggressorEntry[0], aggressorEntry[1]]);
                }
                const chosen = chooseNearest(engageable);
                if (chosen) {
                    // MaxOdds: engage only while the fight looks
                    // favorable (per-pair simplification of the
                    // Bible's friends-vs-enemies strength sums).
                    const chosenEntry = ships.find(([u]) => u === chosen);
                    const chosenStrength = chosenEntry ? effectiveStrength(
                        chosenEntry[3].strength,
                        shieldFraction(chosenEntry[5])) : 0;
                    if (oddsFavorable(govtData?.maxOdds ?? 100,
                        myStrength, chosenStrength)) {
                        npc.mode = 'attack';
                        target.target = chosen;
                        return;
                    }
                }
                if (npc.mode === 'attack' || npc.mode === 'flee') {
                    npc.mode = undefined;
                    target.target = undefined;
                }
                // PLUNDER RUN (gövt Flags 0x1000): with nothing left to
                // shoot, a warship of a plundering government goes over to
                // a hulk it has a quarrel with and boards it. Ordered
                // AFTER the engagement decision, so a live enemy always
                // wins over a hulk, and BEFORE departure and patrol, so a
                // pirate does not wander off past a prize.
                //
                // STICKY: the ship keeps the hulk it already chose while
                // that hulk is still a candidate, so a long approach is not
                // re-aimed at whatever drifted nearer this second. The
                // fallback picks the nearest, which breaks exact ties by
                // uuid (chooseNearest), so every peer chooses alike.
                if (plunderable.length > 0) {
                    const keep = npc.mode === 'board' && npc.boardTarget
                        !== undefined && plunderable.some(
                            ([u]) => u === npc.boardTarget);
                    npc.boardTarget = keep
                        ? npc.boardTarget : chooseNearest(plunderable);
                    npc.mode = 'board';
                    return;
                }
                if (npc.mode === 'board') {
                    // The prize was taken, repaired, destroyed, or drifted
                    // out of range: back to ordinary warship business.
                    npc.mode = undefined;
                    npc.boardTarget = undefined;
                }
                if (!held && time.time >= npc.departAt) {
                    npc.mode = 'depart';
                    return;
                }
                if (npc.mode === undefined || npc.mode === 'patrol') {
                    // In formation with a live leader: hold instead of
                    // patrolling on our own.
                    if (formation && entities.has(formation.leader)) {
                        npc.mode = 'patrol';
                        npc.waypoint = undefined;
                        return;
                    }
                    const [x, y] = npc.waypoint ?? [0, 0];
                    const reached = npc.waypoint === undefined
                        || new Vector(x - position.x, y - position.y)
                            .lengthSquared < WAYPOINT_RADIUS * WAYPOINT_RADIUS;
                    if (reached) {
                        npc.waypoint = [
                            randomBetween(random,
                                -PATROL_HALF_SIZE, PATROL_HALF_SIZE),
                            randomBetween(random,
                                -PATROL_HALF_SIZE, PATROL_HALF_SIZE)];
                    }
                    npc.mode = 'patrol';
                }
                break;
            }
            case 4: { // Interceptor: orbit home, engage intruders.
                if (!npc.destination || !entities.has(npc.destination)) {
                    npc.destination =
                        nearestPlanet(landingDestinations(planets), position);
                    npc.waypoint = undefined;
                }
                const home = npc.destination
                    ? entities.get(npc.destination)?.components
                        .get(MovementStateComponent)?.position
                    : undefined;
                const engageable = hostiles.filter(([otherUuid, d2]) => {
                    if (d2 <= INTERCEPTOR_ENGAGE_RANGE
                        * INTERCEPTOR_ENGAGE_RANGE) {
                        return true;
                    }
                    if (!home) {
                        return false;
                    }
                    const otherMovement = entities.get(otherUuid)
                        ?.components.get(MovementStateComponent);
                    return otherMovement !== undefined
                        && otherMovement.position.subtract(home).lengthSquared
                        <= INTERCEPTOR_ENGAGE_RANGE * INTERCEPTOR_ENGAGE_RANGE;
                });
                if (aggressorEntry) {
                    engageable.push([aggressorEntry[0], aggressorEntry[1]]);
                }
                const chosen = chooseNearest(engageable);
                if (chosen) {
                    npc.mode = 'attack';
                    target.target = chosen;
                    return;
                }
                if (npc.mode === 'attack') {
                    npc.mode = undefined;
                    target.target = undefined;
                }
                if (!held && time.time >= npc.departAt) {
                    npc.mode = 'depart';
                    return;
                }
                npc.mode = 'patrol';
                if (!home) {
                    // No planets: fall back to warship-style waypoints.
                    if (npc.waypoint === undefined) {
                        npc.waypoint = [
                            randomBetween(random,
                                -PATROL_HALF_SIZE, PATROL_HALF_SIZE),
                            randomBetween(random,
                                -PATROL_HALF_SIZE, PATROL_HALF_SIZE)];
                    }
                    break;
                }
                // Orbit: advance the waypoint around the home planet.
                const homePosition = Position.fromVectorLike(home);
                let orbitAngle: Angle;
                if (npc.waypoint === undefined) {
                    orbitAngle = position.subtract(homePosition).angle;
                } else {
                    const [x, y] = npc.waypoint;
                    const toWaypoint = new Vector(
                        x - position.x, y - position.y);
                    if (toWaypoint.lengthSquared
                        > WAYPOINT_RADIUS * WAYPOINT_RADIUS) {
                        break; // Still flying to the current point.
                    }
                    orbitAngle = new Vector(x - homePosition.x,
                        y - homePosition.y).angle
                        .add(INTERCEPTOR_ORBIT_STEP);
                }
                const unit = orbitAngle.getUnitVector();
                npc.waypoint = [
                    homePosition.x + unit.x * INTERCEPTOR_ORBIT_RADIUS,
                    homePosition.y + unit.y * INTERCEPTOR_ORBIT_RADIUS];
                break;
            }
        }
    },
    after: [TimeSystem],
    before: [MovementSystem],
});

// --- Steering ---

/**
 * Point-and-thrust arrival: turn toward the goal and burn while far;
 * inside the slow radius, turn retrograde and brake until slow.
 * Built from the same movement primitives the jump sequence's
 * 'stopping' stage uses. Returns true once arrived.
 */
export function steerArrive(movement: MovementState, physics: {
    acceleration: number, turnRate: number,
}, goal: Position, arriveRadius: number, arriveSpeed: number): boolean {
    const toGoal = goal.subtract(movement.position);
    const distance = toGoal.length;
    const speed = movement.velocity.length;
    if (distance < arriveRadius && speed < arriveSpeed) {
        movement.accelerating = 0;
        movement.turnTo = null;
        movement.turnBack = false;
        return true;
    }
    // Time to stop at current speed vs. time to reach the goal:
    // brake when stopping distance (with margin) exceeds what's left.
    const stopDistance = physics.acceleration > 0
        ? speed * speed / (2 * physics.acceleration) : 0;
    if (distance < Math.max(arriveRadius, stopDistance * 1.5)
        || (distance < ARRIVE_SLOW_RADIUS && speed > arriveSpeed)) {
        // Brake: turn retrograde, thrust when roughly aligned.
        movement.turnTo = null;
        movement.turnBack = true;
        movement.accelerating = 0;
        if (speed > arriveSpeed * 0.5) {
            const reverse = movement.velocity.angle.add(Math.PI);
            const misalignment = movement.rotation.distanceTo(reverse).angle;
            if (Math.abs(misalignment) < 0.4) {
                movement.accelerating = 1;
            }
        }
        return false;
    }
    // Cruise: point at the goal, thrust when roughly aligned.
    movement.turnBack = false;
    const goalAngle = toGoal.angle;
    movement.turnTo = goalAngle;
    const misalignment = movement.rotation.distanceTo(goalAngle).angle;
    movement.accelerating = Math.abs(misalignment) < 0.6 ? 1 : 0;
    return false;
}

/**
 * Hands a departing or fleeing NPC to the hyperspace jump sequence,
 * which owns it from here (NpcSteeringSystem bails while a
 * JumpComponent is present) until it warps out of the world.
 *
 * Returns false in the two cases the ship CANNOT jump:
 *
 *  - it is DISABLED — dead in space, unable to turn onto a jump heading
 *    or run its hyperdrive, the same reason PlayerJumpControl refuses a
 *    disabled player. Nothing else about a player's jump applies: this
 *    needs no route, no destination system data, and no fuel. A ship
 *    disabled on its way out keeps drifting and is deleted at
 *    NPC_DEPART_RADIUS as before; if it is repaired first, it jumps
 *    normally.
 *  - it is HELD in the system (system_hold.ts): a person whose refuel
 *    offer is still on the table, or a rescue target waiting to be
 *    boarded. Gated HERE rather than only in the decision system so that
 *    a 'flee' — which is not a departure decision at all, and which
 *    reaches the jump exit on its own — cannot carry the ship out of the
 *    system either. Held ships are exempted from the delete-at-the-edge
 *    fallback below for the same reason: refusing the jump must not
 *    despawn them through the back door.
 *
 * This is the only disabled check the NPC jump path needs. A ship
 * disabled AFTER the sequence starts is handled by the general
 * disabled-cancels-jump rule (JumpDisableCancelSystem), which stops it
 * dead and takes the JumpComponent away; because 'depart' and 'flee'
 * re-run this on every tick they own the ship, a repair simply lands the
 * NPC back here and it starts a fresh sequence. There is nothing to
 * resume, and no resume logic.
 */
function departByJump(entity: Entity, movement: MovementState,
    physics: ShipPhysics, disabled: DisabledState | undefined): boolean {
    if (disabled || heldInSystem(entity)) {
        return false;
    }
    beginDepartureJump(entity, movement, physics);
    return true;
}

/** Fly outward and report whether the ship has reached the radius at
 * which a ship that never managed to jump is removed anyway. */
function steerOutward(movement: MovementState, away: Vector): boolean {
    if (movement.position.length > NPC_DEPART_RADIUS) {
        return true;
    }
    const heading = away.lengthSquared > 1e-12 ? away.angle
        : new Angle(0);
    movement.turnTo = heading;
    movement.turnBack = false;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.8 ? 1 : 0;
    return false;
}

/**
 * Executes the NPC's current mode every tick. Departing and fleeing
 * ships hand themselves to the hyperspace jump sequence (see the module
 * comment); everything else steers here.
 */
export const NpcSteeringSystem = new System({
    name: 'NpcSteeringSystem',
    args: [NpcComponent, MovementStateComponent, ShipPhysicsComponent,
        TargetComponent, Optional(FormationComponent),
        Optional(EscortCommandComponent), Optional(EscortLandingComponent),
        Optional(DisabledComponent), Optional(JumpComponent),
        TimeResource, Entities, GetEntity, UUID] as const,
    step(npc, movement, physics, target, formation, escortCommand, landing,
        disabled, jump, time, entities, entity, uuid) {
        if (jump) {
            // Committed to the hyperspace jump: JumpSequenceSystem owns
            // this ship's controls until it leaves (it overrides them
            // anyway). A ship disabled mid-sequence is no exception here
            // any more: the general disabled-cancels-jump rule
            // (JumpDisableCancelSystem) has already taken the
            // JumpComponent away before this system runs, so a disabled
            // ship never reaches this branch at all. If it is repaired
            // later it falls through to the mode switch below and decides
            // to depart afresh, starting a whole new sequence.
            return;
        }
        if (landing) {
            // Following the player down to a planet (player_escort_plugin
            // steers this ship). Checked before the escort-command bail so
            // an escort without command state still yields.
            return;
        }
        if (escortCommand) {
            return; // Player-commanded: see escort_command_plugin.
        }
        // Escorts holding formation are steered by FormationSystem —
        // unless they are off doing something of their own, a plunder run
        // included (a warship peeling out of formation to board a hulk
        // must not be dragged back to its station).
        if (formation && entities.has(formation.leader)
            && npc.mode !== 'attack' && npc.mode !== 'flee'
            && npc.mode !== 'depart' && npc.mode !== 'board') {
            return;
        }
        switch (npc.mode) {
            case 'travel': {
                const destination = npc.destination
                    ? entities.get(npc.destination)?.components
                        .get(MovementStateComponent)?.position
                    : undefined;
                if (!destination) {
                    return; // Decision system will re-plan.
                }
                const arrived = steerArrive(movement, physics,
                    Position.fromVectorLike(destination),
                    PLANET_ARRIVE_RADIUS, PLANET_ARRIVE_SPEED);
                if (arrived) {
                    npc.mode = 'dwell';
                    npc.until = time.time + TRADER_DWELL_MS;
                }
                break;
            }
            case 'dwell': {
                // Loiter: brake to a stop and sit.
                movement.turnTo = null;
                movement.accelerating = 0;
                const speed = movement.velocity.length;
                movement.turnBack = speed > 10;
                if (speed > 10) {
                    const reverse = movement.velocity.angle.add(Math.PI);
                    if (Math.abs(movement.rotation.distanceTo(reverse).angle)
                        < 0.4) {
                        movement.accelerating = 1;
                    }
                }
                break;
            }
            case 'patrol': {
                if (!npc.waypoint) {
                    return;
                }
                steerArrive(movement, physics,
                    new Position(npc.waypoint[0], npc.waypoint[1]),
                    WAYPOINT_RADIUS, physics.speed);
                break;
            }
            case 'board': {
                // Flying over to plunder a hulk (gövt Flags 0x1000). This
                // arm only STEERS; the arrival and the claim itself belong
                // to NpcPlunderBoardSystem, which sweeps in uuid order so
                // two warships reaching the same hulk on the same tick
                // cannot resolve differently on different peers.
                const prize = npc.boardTarget
                    ? entities.get(npc.boardTarget) : undefined;
                const prizeMovement =
                    prize?.components.get(MovementStateComponent);
                if (!prize || !prizeMovement
                    || !prize.components.has(DisabledComponent)) {
                    // Destroyed, jumped out, or patched up while we flew.
                    npc.mode = undefined;
                    npc.boardTarget = undefined;
                    return;
                }
                steerArrive(movement, physics,
                    Position.fromVectorLike(prizeMovement.position),
                    NPC_BOARD_RADIUS, NPC_BOARD_SPEED);
                break;
            }
            case 'attack': {
                const other = target.target
                    ? entities.get(target.target)?.components
                        .get(MovementStateComponent)
                    : undefined;
                if (!other) {
                    return;
                }
                const toTarget = other.position.subtract(movement.position);
                movement.turnTo = target.target!;
                movement.turnBack = false;
                movement.accelerating =
                    toTarget.length > ATTACK_STANDOFF ? 1 : 0;
                break;
            }
            case 'flee': {
                const aggressor = npc.aggressor
                    ? entities.get(npc.aggressor)?.components
                        .get(MovementStateComponent)
                    : undefined;
                // Far enough from the center to jump: start the jump
                // sequence (same exit as 'depart') — unless the chaser
                // is right behind (see chaserBlocksJump). The decision
                // is unchanged; only the exit is, so a fleeing ship is
                // now seen to align and warp out rather than blink away
                // — and it stays shootable, and interruptible by being
                // disabled, for the length of the sequence.
                if (movement.position.length > JUMP_DISTANCE
                    && !(aggressor
                        && chaserBlocksJump(movement, aggressor))
                    && departByJump(entity, movement, physics, disabled)) {
                    break;
                }
                // Run from the attacker; with no attacker position,
                // run outward from the system center.
                const away = aggressor
                    ? movement.position.subtract(aggressor.position)
                    : new Vector(movement.position.x, movement.position.y);
                // At the depart radius the ship is off the edge of the
                // playfield, so a chaser on its tail no longer holds it
                // here: it jumps anyway, and is deleted outright only if
                // it cannot (disabled). See departByJump.
                if (steerOutward(movement, away)
                    && !departByJump(entity, movement, physics, disabled)
                    && !heldInSystem(entity)) {
                    entities.delete(uuid);
                }
                break;
            }
            case 'depart': {
                // Fly outward until clear of the no-jump zone (the same
                // threshold the flee exit uses), then jump out.
                if (movement.position.length > JUMP_DISTANCE
                    && departByJump(entity, movement, physics, disabled)) {
                    break;
                }
                const away = new Vector(
                    movement.position.x, movement.position.y);
                // Only a ship that could not jump at all reaches the
                // depart radius (it is well outside the no-jump zone, so
                // the branch above already tried and was refused): the
                // old delete-at-the-edge exit, now the disabled-ship
                // fallback. A HELD ship is exempt: it is not allowed to
                // leave the system, and despawning it here would be
                // leaving by another name (see departByJump). It cannot
                // normally be in 'depart' at all — the decision system
                // refuses to put it there — but a hold applied to a ship
                // already on its way out must still stop it.
                if (steerOutward(movement, away) && !heldInSystem(entity)) {
                    entities.delete(uuid);
                }
                break;
            }
        }
    },
    after: [TimeSystem, NpcDecisionSystem],
    // Explicit edge rather than a toposort accident: a ship that decides
    // to leave this tick enters the sequence and starts stopping on the
    // same tick, and the ordering is stable across a snapshot restore
    // (determinism rule 4). The reverse edge would be a cycle via
    // DisabledMovementSystem, which is after both.
    before: [MovementSystem, JumpSequenceSystem],
});

/**
 * Emitted (targeted at the PLUNDERED PLAYER's ship) when pirates board a
 * disabled player and take a cut of their cash. The boarding is over in
 * the tick it happens — no dialog opens, nothing is negotiated — so this
 * event is the only feedback there is; the display turns it into a status
 * line and the boarding beep (status_message_plugin). Carries the credits
 * actually taken so the line can name the sum; the sim never reads it
 * back. Never mutates the simulation.
 */
export const PlayerPlunderedEvent =
    new EcsEvent<{ credits: number }>('PlayerPlunderedEvent');
export const PlayerPlunderedEventType = t.type({ credits: t.number });
registerSimulationBridgeEvent({ event: PlayerPlunderedEvent });

/**
 * Whether an NPC on a plunder approach has arrived: pulled alongside the
 * hulk and matched to its drift. Deliberately looser than the player's
 * gate (boardingBlockedReason) — an NPC is not asked to line its axis up
 * with the hulk's.
 */
export function npcBoardArrived(boarder: MovementState,
    hulk: MovementState): boolean {
    return hulk.position.subtract(boarder.position).lengthSquared
        <= NPC_BOARD_RADIUS * NPC_BOARD_RADIUS
        && hulk.velocity.subtract(boarder.velocity).lengthSquared
        <= NPC_BOARD_SPEED * NPC_BOARD_SPEED;
}

/**
 * "SOME OTHER PIRATE GOT HERE FIRST": the terminal of an NPC plunder run
 * (gövt Flags 0x1000). A warship that has reached its hulk spends the
 * hulk's ONE boarding — the same durable BoardedComponent record a player
 * writes (boarding_component.ts) — and the player who turns up afterwards
 * is refused with "You can't board this ship." (stock STR# 2002 index
 * 129). The converse falls out of the same record: an NPC whose prize the
 * player boarded first finds it already spent and gives up its approach.
 *
 * FROM AN NPC HULK the boarder takes nothing material: there is nowhere
 * for an NPC's plunder to go and no way for the player to observe it, so
 * the point of the behavior is the denial alone.
 *
 * FROM A DISABLED PLAYER it takes credits — Matthew's ruling, and the
 * corrected Bible's "(including the player)". The cut is npcPlunderCredits
 * (pegged above what bribing the same ship off would have cost), it is
 * deducted here in the shared sim off the synced CreditsComponent, and
 * PlayerPlunderedEvent tells the victim what happened: the boarding is
 * over in one tick, with no dialog, so the status line is the only
 * feedback there is. The durable `plundered` record makes it
 * EXACTLY-ONCE — the same record that stops a second pirate queueing up
 * behind the first — and it clears at the same life-segment boundaries a
 * hulk's does, so jumping out or landing and departing makes the player
 * plunderable again.
 *
 * WHY THIS IS ITS OWN SYSTEM RATHER THAN AN ARM OF NpcSteeringSystem.
 * The claim is a race between ships: two warships can reach the same hulk
 * on the same tick, and a per-entity system visits them in ENTITY-MAP
 * order, which differs between a peer that built its map by insertion and
 * one restored from a wire snapshot — so whichever of them "got there
 * first" would differ between peers, and the hulk's recorded `boarder` is
 * hashed shared state. Sweeping the map in UUID-SORTED order from a
 * single once-per-tick system (SingletonComponent) removes the race
 * outright: the lexicographically smallest arrived claimant wins, on
 * every peer, always. No PRNG is involved.
 */
export const NpcPlunderBoardSystem = new System({
    name: 'NpcPlunderBoardSystem',
    args: [SingletonComponent, Entities, Emit] as const,
    step(_singleton, entities, emit) {
        for (const uuid of [...entities.keys()].sort()) {
            const boarder = entities.get(uuid);
            const npc = boarder?.components.get(NpcComponent);
            if (!boarder || !npc || npc.mode !== 'board') {
                continue;
            }
            const giveUp = () => {
                npc.mode = undefined;
                npc.boardTarget = undefined;
            };
            const prize = npc.boardTarget
                ? entities.get(npc.boardTarget) : undefined;
            const prizeMovement =
                prize?.components.get(MovementStateComponent);
            const boarderMovement =
                boarder.components.get(MovementStateComponent);
            if (!prize || !prizeMovement || !boarderMovement
                || !prize.components.has(DisabledComponent)) {
                giveUp();
                continue;
            }
            const boarded: BoardedState | undefined =
                prize.components.get(BoardedComponent);
            if (plunderSpent(boarded)) {
                // Beaten to it — by the player, by a rival player, or by
                // a warship earlier in this very sweep.
                giveUp();
                continue;
            }
            if (!npcBoardArrived(boarderMovement, prizeMovement)) {
                continue; // Still on the way; NpcSteeringSystem flies it.
            }
            prize.components.set(BoardedComponent, {
                ...boarded, boarder: uuid, active: false, plundered: true,
            });
            // A DISABLED PLAYER is boarded exactly like a hulk, but there
            // is somewhere for the booty to go, so credits actually move.
            // Written after the record, so the deduction and the
            // exactly-once mark are the same event: any path that reaches
            // this line has just flipped `plundered` from unset.
            const credits = prize.components.get(CreditsComponent);
            if (credits) {
                const taken = npcPlunderCredits(credits.credits);
                credits.credits -= taken;
                emit(PlayerPlunderedEvent, { credits: taken },
                    [npc.boardTarget!]);
            }
            giveUp();
        }
    },
    after: [TimeSystem, NpcSteeringSystem],
});

/**
 * Fires every weapon at the NPC's target while attacking and in range;
 * ceases fire otherwise.
 *
 * BAYS INCLUDED: a bay's ammo is its fighters (weapon_parse's
 * AmmoTypeParse), so the magazine bounds the total and the reload clock
 * paces the launches. No separate "has a target" gate is needed here —
 * `inRange` is already false unless the NPC is in attack mode with a
 * LIVE target entity, so an idle carrier never opens its hangar.
 * Launched fighters are pointed at the carrier's victim by
 * NpcWingCommandSystem (escort_command_plugin).
 *
 * A SHIP IN A JUMP SEQUENCE HOLDS ITS FIRE. NpcDecisionSystem bails on a
 * jumping ship so it cannot talk itself back into a fight, but bailing
 * PRESERVES the mode and target it was carrying when the sequence began —
 * so a ship already in 'attack' with a live victim goes on firing all
 * through its stop, its turn, its spin-up and its departure burn. That is
 * exactly the opposite of the "committed, so it disengages" the visible
 * sequence exists to show.
 *
 * WHO ACTUALLY REACHES THAT STATE. Not the NPC departure path:
 * departByJump is called from NpcSteeringSystem's 'flee' and 'depart'
 * arms, so the mode at the moment beginDepartureJump attaches the
 * component is structurally never 'attack'. The reachable case is a
 * FOLLOW jump. sweepableEscorts keys on the flock chain, not on
 * EscortCommandComponent, so an NPC FLEET ESCORT whose leader the player
 * captured (convertToEscort re-parents the leader onto the player; the
 * leader's own fleet escorts keep formation on it and are marked as the
 * player's) is swept into beginFollowJump while still running its own NPC
 * AI — including 'attack' with a live target, since it has no escort
 * command to make NpcDecisionSystem yield. Hired escorts, bay fighters
 * and mission ships all avoid it for their own reasons; this one does not.
 *
 * GATED, NOT CLEARED. The ship keeps its mode and target and simply does
 * not shoot while the JumpComponent is there; the weapons are released
 * (`firing = false`) on the tick the gate takes effect, which is what
 * stops a beam or a stream weapon that was already firing. Clearing the
 * target instead would be a one-way door: a sequence CANCELLED by a
 * disable (JumpDisableCancelSystem deletes the JumpComponent) would leave
 * the repaired ship blank and unable to defend itself until its next
 * think tick. With the gate, the same ship resumes firing on the very
 * tick the component goes, at the target it already had.
 */
const NpcFireControlSystem = new System({
    name: 'NpcFireControlSystem',
    args: [NpcComponent, WeaponsStateComponent, TargetComponent,
        MovementStateComponent, Optional(JumpComponent), Entities,
        SimulationGameDataResource,
        Optional(EscortCommandComponent)] as const,
    step(npc, weapons, target, movement, jump, entities, gameData,
        escortCommand) {
        if (escortCommand) {
            // A player-commanded escort: the escort command framework
            // (escort_command_plugin) owns its TRIGGERS as well as its
            // steering. The other two halves of this AI already yield
            // to it — NpcDecisionSystem and NpcSteeringSystem both bail
            // on EscortCommandComponent — and fire control not doing so
            // was Matthew's "escorts sometimes don't fire when
            // commanded; they just circle the enemy" playtest report.
            //
            // THE MECHANISM. Because NpcDecisionSystem bails, a
            // commanded escort's `npc.mode` is never 'attack', so
            // `inRange` below is always false and this system used to
            // clear `firing` on EVERY weapon of EVERY escort that has an
            // NpcComponent — while EscortCommandBehaviorSystem set those
            // very same flags in the same tick. Neither system ordered
            // itself against the other, and this one runs later, so its
            // cease-fire was the write that survived into the latched
            // state WeaponsSystem reads.
            //
            // WHY IT LOOKED INTERMITTENT RATHER THAN TOTAL. Not
            // flakiness — system order is deterministic
            // (topologicalSortList is a stable function of registration
            // order), so an affected escort NEVER fired. What varied was
            // WHICH ESCORT, because only some kinds carry NpcComponent
            // at all:
            //   - hired escorts (spawnHiredEscorts -> makeNpcShip) and
            //     captured prizes (convertToEscort keeps the NPC brain,
            //     only clearing mode/aggressor) HAVE it -> silent;
            //   - bay-launched fighters do NOT (bay_plugin builds them
            //     with makeShip) -> they fired correctly all along.
            // So the same player, in the same session, saw some escorts
            // shoot and others just circle.
            //
            // STEERING NEVER SHOWED IT: EscortCommandBehaviorSystem is
            // the only writer of a commanded escort's movement, so the
            // ship orbited its victim at standoff exactly as ordered
            // while its guns stayed cold — the reported symptom.
            //
            // Bailing (rather than ordering the two systems) is what
            // keeps ALL of the escort framework's firing decisions
            // intact, not just the attack case: hold-fire while
            // landing/jumping, holdPosition's cease-fire, and the
            // formation-time front-quadrant-turret rule are equally
            // this system's to leave alone.
            //
            // NPC-CARRIER WINGS ARE COVERED, NOT ORPHANED. A bay fighter
            // launched by an NPC carrier carries EscortCommandComponent
            // too, and NpcWingCommandSystem mirrors the carrier's victim
            // onto it as an 'attack' command; EscortCommandBehaviorSystem
            // then fires its weapons. So the wings that reach this bail
            // have a live trigger-owner either way.
            return;
        }
        if (jump) {
            // Committed to leaving: cease fire for the whole sequence.
            // Falling through with `inRange` false would do the same, but
            // saying it here keeps the reason legible and skips the range
            // math for a ship that is not allowed to shoot regardless.
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
            return;
        }
        const other = npc.mode === 'attack' && target.target
            ? entities.get(target.target)?.components
                .get(MovementStateComponent)
            : undefined;
        const inRange = other !== undefined
            && other.position.subtract(movement.position).lengthSquared
            <= NPC_FIRE_RANGE * NPC_FIRE_RANGE;
        for (const [id, weapon] of weapons) {
            if (!inRange) {
                weapon.firing = false;
                continue;
            }
            const weaponType = gameData.data.Weapon.getCached(id)?.type;
            if (weaponType == null) {
                continue;
            }
            weapon.target = target.target;
            weapon.firing = true;
        }
    },
    after: [NpcDecisionSystem],
});

// --- Formation keeping ---

/**
 * Steers a follower toward its slot. Two regimes with hysteresis
 * (state in formation.rcs):
 *
 *  - Large correction (above RCS_DISENGAGE_SPEED, or above
 *    RCS_ENGAGE_SPEED when not yet on RCS): the classic turn-and-burn
 *    — point at the correction and use the main engine.
 *  - Small correction: RCS station-keeping — a velocity nudge budgeted
 *    at RCS_ACCEL_FRACTION of the ship's main acceleration, applied
 *    directly with NO rotation and NO `accelerating` (so no engine
 *    flare); the ship holds its heading on the leader's.
 *
 * The correction is the desired velocity (leader's, plus a
 * proportional pull toward the slot) minus the follower's. Pure so
 * tests can check convergence and that RCS never turns the ship.
 */
export function steerFormation(movement: MovementState, leader: MovementState,
    formation: Formation, acceleration: number, delta_s: number,
    rank = formation.slot, count?: number): void {
    const slotPosition = formationSlotPosition(
        Position.fromVectorLike(leader.position),
        Angle.fromAngleLike(leader.rotation), rank, count);
    const lead = Vector.fromVectorLike(leader.velocity)
        .scale(FORMATION_LOOKAHEAD_S);
    const error = slotPosition.add(lead).subtract(movement.position);
    // Desired velocity: the leader's, plus a correction proportional
    // to the position error.
    const desired = Vector.fromVectorLike(leader.velocity)
        .add(error.scale(FORMATION_POSITION_GAIN));
    const correction = desired.subtract(movement.velocity);

    // Hysteresis: engage RCS below the low threshold, drop it above
    // the high one, keep the previous regime in between.
    const magnitude = correction.length;
    if (formation.rcs) {
        if (magnitude > RCS_DISENGAGE_SPEED) {
            formation.rcs = false;
        }
    } else if (magnitude < RCS_ENGAGE_SPEED) {
        formation.rcs = true;
    }

    if (formation.rcs) {
        // RCS station-keeping: nudge velocity toward desired, capped
        // by this tick's RCS budget; never rotate, never light the
        // main engine. Replaces (does not mutate) the velocity object
        // per the movement contract.
        const budget = acceleration * RCS_ACCEL_FRACTION * delta_s;
        const nudge = magnitude <= budget
            ? correction : correction.normalize(budget);
        movement.velocity = Vector.fromVectorLike(movement.velocity)
            .add(nudge);
        movement.accelerating = 0;
        movement.turnBack = false;
        movement.turnTo = Angle.fromAngleLike(leader.rotation);
        return;
    }

    // Turn-and-burn: point at the correction, main engine when
    // roughly aligned.
    const heading = correction.angle;
    movement.turnTo = heading;
    movement.turnBack = false;
    const misalignment = movement.rotation.distanceTo(heading).angle;
    movement.accelerating = Math.abs(misalignment) < 0.7 ? 1 : 0;
}

export const AllFormationsQuery = new Query([FormationComponent] as const);

export const FormationSystem = new System({
    name: 'FormationSystem',
    args: [FormationComponent, MovementStateComponent, ShipPhysicsComponent,
        Optional(NpcComponent), Optional(EscortCommandComponent),
        Optional(EscortLandingComponent), Optional(JumpComponent),
        Optional(DisabledComponent), AllFormationsQuery, TimeResource,
        Entities, GetEntity, UUID] as const,
    step(formation, movement, physics, npc, escortCommand, landing, jump,
        disabled, allFormations, time, entities, entity) {
        if (disabled) {
            // A hulk drifts. DisabledMovementSystem runs after this one and
            // erases steering intent, but the RCS regime writes
            // movement.velocity DIRECTLY — and all that erasure does to a
            // direct velocity write is bleed it off at
            // DISABLED_DECELERATION, which is exactly the station-keeping
            // nudge again next tick. So a disabled escort held its slot,
            // matching its leader's course while dead in space. Ordering
            // cannot fix that (same reason the jump bail below exists); the
            // gate has to be here, before anything is written.
            return;
        }
        if (landing) {
            // Following the player down to a planet: EscortLandingSystem
            // owns this ship's steering until it lands.
            return;
        }
        if (jump) {
            // Committed to a hyperspace jump — an escort warping out with
            // its player, or a formation leader of its own doing so.
            // JumpSequenceSystem owns the steering until the ship leaves.
            // Station-keeping must not run alongside it: the RCS regime
            // nudges velocity DIRECTLY, so ordering alone would not stop a
            // ship that is supposed to be holding still for its spin-up
            // from creeping toward its slot. Same bail NpcSteeringSystem
            // takes, for the same reason.
            return;
        }
        // Engaged escorts fight (or go plundering); FormationSystem only
        // holds station.
        if (npc && !escortCommand && (npc.mode === 'attack'
            || npc.mode === 'flee' || npc.mode === 'depart'
            || npc.mode === 'board')) {
            return;
        }
        // Player-commanded escorts: station-keep only while the
        // command is formation (or defend with no intruder engaged) —
        // the command behavior system steers everything else.
        if (escortCommand && !(escortCommand.command === 'formation'
            || (escortCommand.command === 'defend'
                && escortCommand.target === undefined))) {
            return;
        }
        const leader = entities.get(formation.leader)?.components
            .get(MovementStateComponent);
        if (!leader) {
            // Leader gone: escorts revert to their own AI (the
            // decision system re-plans since mode stays whatever it
            // was); bay fighters are handed back to bay_plugin, which
            // watches for this.
            entity.components.delete(FormationComponent);
            return;
        }
        // Rank + live count drive the per-count symmetric layouts:
        // the ship's persistent slot number is only an ORDER; its
        // station comes from its rank among the live same-leader
        // slots. Deterministic (sorting synced slot numbers) and
        // cheap (formations are tiny); an escort joining or leaving
        // re-flows the rest to the new count's layout.
        const siblingSlots = allFormations
            .filter(([other]) => other.leader === formation.leader)
            .map(([other]) => other.slot)
            .sort((a, b) => a - b);
        const rank = siblingSlots.indexOf(formation.slot);
        // Base acceleration (not the per-tick effective physics):
        // afterburners must not boost the RCS budget.
        steerFormation(movement, leader, formation,
            physics.acceleration, time.delta_s,
            rank < 0 ? formation.slot : rank, siblingSlots.length);
    },
    after: [TimeSystem, NpcDecisionSystem],
    before: [MovementSystem],
});

export const NpcAiPlugin: Plugin = {
    name: 'NpcAiPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        // Serializer registration makes NPC AI state real simulation
        // state: hashed for desync detection, cloned into rollback
        // snapshots, and carried by wire baselines — the opposite of
        // the legacy owner-only AI, whose components were excluded
        // from multiplayer state.
        serializer?.addComponent(NpcComponent, NpcState);
        serializer?.addEvent(PlayerPlunderedEvent, PlayerPlunderedEventType);
        serializer?.addComponent(FormationComponent, Formation);
        // Registered with the AI that enforces it (the AI is the only
        // reader): a held ship never decides to leave and never begins a
        // departure jump. See system_hold.ts.
        serializer?.addComponent(SystemHoldComponent, SystemHoldType);
        world.addSystem(NpcAggressionSystem);
        world.addSystem(NpcDecisionSystem);
        world.addSystem(NpcSteeringSystem);
        world.addSystem(NpcPlunderBoardSystem);
        world.addSystem(NpcFireControlSystem);
        world.addSystem(FormationSystem);
    },
};
