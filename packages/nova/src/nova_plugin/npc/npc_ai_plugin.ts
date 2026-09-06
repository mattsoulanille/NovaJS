import { Plugin } from 'nova_ecs/plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { NpcComponent, NpcState } from './npc_component.js';
import { NpcDecisionSystem } from './npc_decision.js';
import { NpcFireControlSystem } from './npc_fire_control.js';
import { Formation, FormationComponent } from './npc_formation.js';
import { FormationSystem } from './npc_formation_system.js';
import {
    NpcPlunderBoardSystem, PlayerPlunderedEvent, PlayerPlunderedEventType,
} from './npc_plunder_board.js';
import { NpcSteeringSystem } from './npc_steering.js';
import { NpcAggressionSystem } from './npc_targeting.js';
import { SystemHoldComponent, SystemHoldType } from './system_hold.js';

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
 * steering geometry, so the numbers in these modules (ranges, dwell
 * times, formation spacing) are judgment calls, kept as named constants
 * for tuning:
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
 *
 * MODULE MAP. The AI is split by concern; this file registers it and
 * re-exports the public surface so callers import from one place:
 *
 *  npc_component.ts         NpcMode / NpcState / NpcComponent, the
 *                           bribe-reprieve predicate (isPacifiedToward)
 *  npc_targeting.ts         chooseNearest (uuid tie-break) and
 *                           NpcAggressionSystem (who shot me)
 *  npc_decision.ts          NpcDecisionSystem: the think step and every
 *                           mode transition; its tuning constants
 *  npc_departure.ts         flee/depart exits: chaserBlocksJump,
 *                           departByJump, steerOutward, NPC_DEPART_RADIUS
 *  npc_steering.ts          NpcSteeringSystem and steerArrive
 *  npc_fire_control.ts      NpcFireControlSystem
 *  npc_plunder.ts           gövt Flags 0x1000 rules and tunables
 *  npc_plunder_board.ts     NpcPlunderBoardSystem, PlayerPlunderedEvent
 *  npc_formation.ts         Formation / FormationComponent, slot
 *                           geometry, steerFormation, RCS tuning
 *  npc_formation_system.ts  FormationSystem
 */

export {
    NpcMode, NpcState, NpcComponent, isPacifiedToward,
} from './npc_component.js';
export { chooseNearest } from './npc_targeting.js';
export {
    NPC_DECISION_INTERVAL_MS, INTERCEPTOR_ENGAGE_RANGE, WARSHIP_ENGAGE_RANGE,
    NPC_DEPART_MIN_MS, NPC_DEPART_MAX_MS, rollDepartureTime,
    PlanetEntry, landingDestinations,
} from './npc_decision.js';
export {
    NPC_DEPART_RADIUS, FLEE_JUMP_BLOCK_RANGE, FLEE_JUMP_BLOCK_HALF_ANGLE,
    chaserBlocksJump,
} from './npc_departure.js';
export {
    TRADER_DWELL_MS, steerArrive, NpcSteeringSystem,
} from './npc_steering.js';
export {
    NPC_PLUNDER_BOARDER_AI_TYPES, NPC_PLUNDER_VICTIM_AI_TYPES,
    NPC_PLUNDER_TAKES_FROM_PLAYERS, NPC_PLUNDER_CREDIT_FRACTION,
    NPC_PLUNDER_CREDIT_MINIMUM, npcPlunderCredits, NPC_PLUNDER_SEEK_RANGE,
    NPC_BOARD_RADIUS, NPC_BOARD_SPEED, npcPlundersHulks, npcPlunderEligible,
    npcBoardArrived,
} from './npc_plunder.js';
export {
    PlayerPlunderedEvent, PlayerPlunderedEventType, NpcPlunderBoardSystem,
} from './npc_plunder_board.js';
export {
    FORMATION_ROW_SPACING, FORMATION_LATERAL_SPACING, RCS_ACCEL_FRACTION,
    RCS_ENGAGE_SPEED, RCS_DISENGAGE_SPEED, Formation, FormationComponent,
    nextFormationSlot, formationsIn, formationOffset, formationSlotPosition,
    steerFormation,
} from './npc_formation.js';
export { AllFormationsQuery, FormationSystem } from './npc_formation_system.js';

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
