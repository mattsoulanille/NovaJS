import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { PlanetData } from 'novadatainterface/planet_data';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import {
    BoardedComponent, clearPlunderRecord, plunderSpent,
} from '../ship/index.js';
import { CloakActiveComponent, isTargetable } from '../ship/index.js';
import { ExplodingComponent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { AssistingComponent } from './hail_component.js';
import { govtDispositionTo, effectiveStrength, oddsFavorable } from '../reputation/index.js';
import { ShieldComponent } from '../ship/index.js';
import { JumpComponent } from '../travel/index.js';
import { landable } from '../core/index.js';
import { MissionShipComponent } from '../player/index.js';
import { AggressionSuppressGovtsComponent } from '../ncb/index.js';
import { NpcComponent } from './npc_component.js';
import { FormationComponent } from './npc_formation.js';
import {
    NPC_PLUNDER_SEEK_RANGE, npcPlunderEligible, npcPlundersHulks,
} from './npc_plunder.js';
import { chooseNearest } from './npc_targeting.js';
import { PlanetComponent, PlanetDataComponent } from '../travel/index.js';
import { ranksSuppressAggression } from '../ncb/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { ControlledByComponent } from '../player/index.js';
import { ShipComponent, ShipDataComponent } from '../ship/index.js';
import { SystemHoldComponent } from './system_hold.js';
import { TargetComponent } from '../ship/index.js';

/**
 * The NPC think step: owns every mode transition (see the AI overview in
 * npc_ai_plugin.ts). The steering, fire-control and formation systems
 * only execute the mode this system chose, and order themselves after
 * it.
 */

// --- Tuning constants ---

/** Base think interval; divided by the govt's SkillMult/100, so more
 * skilled governments react faster (the natural home for SkillMult
 * until per-ship stat scaling exists). */
export const NPC_DECISION_INTERVAL_MS = 1000;
/** Warship patrol waypoints are drawn within this box half-size —
 * matching the asteroid field, where gameplay happens. */
const PATROL_HALF_SIZE = 2000;
/** A patrol waypoint counts as reached within this distance. */
export const WAYPOINT_RADIUS = 200;
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
/** NPCs stay in the system between these bounds before jumping out. */
export const NPC_DEPART_MIN_MS = 120_000;
export const NPC_DEPART_MAX_MS = 300_000;

function randomBetween(random: Random, min: number, max: number): number {
    return min + random.next() * (max - min);
}

/** Draws the sim time at which a freshly spawned NPC will depart. */
export function rollDepartureTime(now: number, random: Random): number {
    return now + randomBetween(random, NPC_DEPART_MIN_MS, NPC_DEPART_MAX_MS);
}

// --- Decision making ---

const PlanetsQuery = new Query(
    [UUID, MovementStateComponent, PlanetComponent,
        PlanetDataComponent] as const);
const NpcTargetsQuery = new Query([UUID, MovementStateComponent, ShipComponent,
    ShipDataComponent, Optional(GovtComponent), Optional(ShieldComponent),
    Optional(CloakActiveComponent), Optional(DisabledComponent),
    Optional(LegalRecordsComponent),
    // The ränk 0x0100 suppression set, baked at grant time: the sim
    // worker never loads Rank data, so the flag cannot be read here.
    Optional(AggressionSuppressGovtsComponent),
    Optional(ExplodingComponent)] as const);

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
 * system (npc_steering.ts) only executes the current mode.
 */
export const NpcDecisionSystem = new System({
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
        // EXPLODING ships (ExplodingComponent, the shïp DeathDelay
        // death sequence) are excluded too, matching every other
        // targeting path (ChooseTargetSystem, selectNearestHostile,
        // the escort attack arm): DropExplodingTargetSystem would clear
        // the lock again each tick, so re-choosing a fireball here left
        // the ship idling on a corpse — neither steering nor firing at
        // the next live enemy — for the victim's whole DeathDelay.
        // Ships with legal records (players) whose record with this govt
        // is below its crime tolerance are enemies too: crime has
        // consequences.
        //
        // Disabled enemies are collected SEPARATELY as plunder candidates
        // (gövt Flags 0x1000; see npcPlunderEligible). They are still not
        // hostiles — a warship never shoots at a hulk — but a warship of a
        // plundering government will fly over and board one. The
        // exploding skip below runs BEFORE the disabled branch on purpose:
        // a hulk that has begun its death sequence is a corpse, not a
        // prize (DeathEvent deletes it moments later), so it is never a
        // plunder candidate either.
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
            otherSuppressGovts, otherExploding] of ships) {
            if (otherUuid === uuid || !isTargetable(cloak)
                || otherExploding !== undefined) {
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
                        ranksSuppressAggression(otherSuppressGovts,
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
                ranksSuppressAggression(otherSuppressGovts, govtData?.id));
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
