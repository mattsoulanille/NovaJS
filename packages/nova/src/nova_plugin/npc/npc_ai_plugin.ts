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
import { NpcAfterburnerSystem } from './npc_afterburner.js';
import { NpcAggressionSystem } from './npc_targeting.js';
import { SystemHoldComponent, SystemHoldType } from './system_hold.js';
import {
    ContrabandScanEvent, ContrabandScanEventType, ContrabandScanSystem,
} from './contraband_scan.js';
import {
    ContrabandScannedComponent, ContrabandScannedType,
} from './contraband_target.js';
import { DistressCallEvent, DistressCallEventType } from './distress.js';

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
 *  1 wimpy trader:  flies to one non-enemy port, parks beside it
 *                   (arrive -> dwell) and jumps out; flees for a
 *                   jump-out when attacked. A goal-less
 *                   mission ship of AI 1 only passes through: it jumps
 *                   out 30-40 s after it appears. A SHUTTLE hull (shïp
 *                   Flags3 0x0002, no scoop) keeps one lane between two
 *                   non-enemy stellars and never leaves (npc_shuttle.ts).
 *                   A MINER hull (Flags3 0x0001) shoots
 *                   rocks apart and, with 0x0002 and a scoop, flies over
 *                   the debris before resuming the loop (npc_mining.ts).
 *  2 brave trader:  same, but fights its attacker back while the govt
 *                   MaxOdds calculation stays favorable, then flees;
 *                   it also flees once an attacker that had been
 *                   within its longest weapon reach is beyond it.
 *  3 warship:       hunts govt enemies (disposition via GovtData
 *                   classes/allies/enemies); patrols waypoints when
 *                   there is nothing to hunt; jumps out eventually.
 *                   With gövt Flags 0x0010, under 25% shield and
 *                   losing, one draw decides: jump out at once, or
 *                   stand off while losing (npc_retreat.ts).
 *  4 interceptor:   orbits a home planet and engages govt enemies that
 *                   come within its engagement bubble. Where its govt
 *                   scans (a ScanMask, and it enforces the law here) it
 *                   "buzzes" each player ship once a visit (again
 *                   when it takes on new contraband), scans it and sits
 *                   on it a while (contraband*.ts). PIRACY POLICE: it turns
 *                   on a player it watches attack another ship its govt
 *                   defends (a nosy govt: any non-enemy, non-0x0020
 *                   victim; any govt: its own or an ally's ship;
 *                   piracy_police.ts). (Boarding exists, for the player
 *                   and for NPC plunder, npc_plunder.ts, which keeps AI
 *                   4 out of it.)
 *
 * Traders (AI 1/2) under NPC attack send DISTRESS CALLS to the status line
 * unless their govt sets Flags2 0x0008 or they are mission ships
 * (distress.ts); nobody answers them. The help comes from the alliance:
 * WARSHIPS of an NPC victim's own govt, and after 20 s of an allied govt,
 * take on its NPC attacker (allied_defenders.ts).
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
 * A ship that cannot jump at all (disabled, or held in the system) is
 * never deleted instead: it stays where it is (NpcSteeringSystem's
 * 'depart' arm). NPC_DEPART_RADIUS is only where a fleeing ship with a
 * chaser on its tail jumps anyway.
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
 *  npc_retreat.ts           gövt Flags 0x0010 retreat: damage load,
 *                           warshipRetreat, its guessed thresholds
 *  npc_steering.ts          NpcSteeringSystem, steerArrive, steerStandoff
 *  npc_fire_control.ts      NpcFireControlSystem
 *  npc_plunder.ts           gövt Flags 0x1000 rules and tunables
 *  npc_plunder_board.ts     NpcPlunderBoardSystem, PlayerPlunderedEvent
 *  let_go.ts                letGo: a bribed ship / a pirate done
 *                           plundering lets the player go (and leaves)
 *  npc_formation.ts         Formation / FormationComponent, slot
 *                           geometry, steerFormation, RCS tuning
 *  npc_formation_system.ts  FormationSystem
 *  contraband.ts            the contraband rules: what a govt finds
 *                           illegal, the fine, SmugPenalty, mission 0x0020
 *  contraband_target.ts     ContrabandScannedComponent, chooseScanTarget
 *  contraband_scan.ts       ContrabandScanSystem, ContrabandScanEvent
 *  npc_shuttle.ts           shïp Flags3 0x0002 shuttles: their stops,
 *                           lane (shuttleLaneEnd) and turn point
 *  npc_mining.ts            shïp Flags3 0x0001/0x0002 miners: who mines,
 *                           chooseMiningJob, which weapons fire at rocks
 *  piracy_police.ts         AI 4 witnesses of an attack on a third ship:
 *                           policeDefendVictim, piracyWitnesses
 *  distress.ts              traders' distress calls: who calls, how often,
 *                           DistressCallEvent, the line
 *  allied_defenders.ts      own-govt and allied warships joining an NPC
 *                           victim's fight: alliedDefenders
 *  npc_out_of_ammo.ts       shïp Flags2 0x0080: out of ammo, leave
 *  npc_afterburner.ts       shïp Flags 0x0040: NpcAfterburnerSystem, the AI
 *                           afterburner
 *  npc_cloak.ts             shïp Flags2 0x0800: traders cloaked while
 *                           flying around (updateNpcCloak, run by
 *                           NpcSteeringSystem)
 */

export {
    NpcMode, NpcState, NpcComponent, isPacifiedToward,
} from './npc_component.js';
export { chooseNearest } from './npc_targeting.js';
export {
    NPC_DECISION_INTERVAL_MS, INTERCEPTOR_ENGAGE_RANGE, WARSHIP_ENGAGE_RANGE,
    NPC_DEPART_MIN_MS, NPC_DEPART_MAX_MS, rollDepartureTime,
    PASS_THROUGH_DEPART_MIN_MS, PASS_THROUGH_DEPART_MAX_MS,
    PlanetEntry, landingDestinations, traderDestinations,
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
    NPC_PLUNDER_TAKES_FROM_PLAYERS, NPC_PLUNDER_CREDIT_STEP,
    NPC_PLUNDER_CREDIT_MIN_STEPS, NPC_PLUNDER_CREDIT_MAX_STEPS,
    npcPlunderCredits, npcPlunderCargoPlan, NPC_PLUNDER_DOCK_MS,
    NPC_PLUNDER_SEEK_RANGE,
    NPC_BOARD_RADIUS, NPC_BOARD_SPEED, npcPlundersHulks, npcPlunderEligible,
    npcBoardArrived,
} from './npc_plunder.js';
export {
    PlayerPlunderedEvent, PlayerPlunderedEventType, NpcPlunderBoardSystem,
} from './npc_plunder_board.js';
export {
    FORMATION_SPACING_PER_FRAME_PX, FORMATION_MIN_SPACING,
    FORMATION_MAX_SPACING, FORMATION_SLOT_DEADBAND, formationSpacing,
    RCS_ACCEL_FRACTION,
    RCS_ENGAGE_SPEED, RCS_DISENGAGE_SPEED, Formation, FormationComponent,
    nextFormationSlot, formationsIn, formationOffset, formationSlotPosition,
    steerFormation,
} from './npc_formation.js';
export { AllFormationsQuery, FormationSystem } from './npc_formation_system.js';
export { outOfAmmo } from './npc_out_of_ammo.js';
export {
    AI_AFTERBURNER_FACTOR, npcAfterburning, NpcAfterburnerSystem,
} from './npc_afterburner.js';
export {
    NPC_CLOAK_REVEAL_AFTER_STAY_MS, NPC_CLOAK_RESUME_FRACTION,
    npcCloaksWhileFlying, cloakSustainable, updateNpcCloak,
} from './npc_cloak.js';

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
        // The contraband scan (contraband_scan.ts): the scanned-this-visit
        // marker on a player ship is real shared state (it decides who is
        // buzzed), and the event tells the scanned pilot.
        serializer?.addComponent(ContrabandScannedComponent,
            ContrabandScannedType);
        serializer?.addEvent(ContrabandScanEvent, ContrabandScanEventType);
        // A trader's distress call (distress.ts): host -> display only, the
        // status line of every player in the system.
        serializer?.addEvent(DistressCallEvent, DistressCallEventType);
        world.addSystem(NpcAggressionSystem);
        world.addSystem(NpcDecisionSystem);
        world.addSystem(NpcSteeringSystem);
        world.addSystem(NpcPlunderBoardSystem);
        world.addSystem(ContrabandScanSystem);
        world.addSystem(NpcFireControlSystem);
        world.addSystem(FormationSystem);
        world.addSystem(NpcAfterburnerSystem);
    },
};
