import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import {
    BoardedComponent, clearPlunderRecord, plunderSpent,
} from '../ship/index.js';
import { CloakActiveComponent, isTargetable } from '../ship/index.js';
import { ExplodingComponent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { EscortCommandComponent } from '../player/index.js';
import {
    AsteroidComponent, DebrisComponent, SimulationGameDataResource,
    SystemIdResource,
} from '../core/index.js';
import { GovtComponent } from '../core/index.js';
import { AssistingComponent } from './hail_component.js';
import { flockPlayer, isAttackingPlayer, isInFlock } from './allegiance.js';
import {
    govtDisposition, govtDispositionTo, effectiveStrength, localLawIn,
    oddsFavorable,
} from '../reputation/index.js';
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
import { attacksOnSight, huntsOnSight } from './on_sight.js';
import { warshipRetreat } from './npc_retreat.js';
import { ShootAllWeaponsAI } from './npc_plugin.js';
import {
    chooseScanTarget, ContrabandScannedComponent,
} from './contraband_target.js';
import { scansHere } from './contraband.js';
import { PlanetComponent, PlanetDataComponent } from '../travel/index.js';
import { ranksSuppressAggression } from '../ncb/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { ControlledByComponent } from '../player/index.js';
import {
    CargoComponent, cargoUsed, OutfitsStateComponent, ShipComponent,
    ShipDataComponent, ShipPhysicsComponent,
} from '../ship/index.js';
import { SystemHoldComponent } from './system_hold.js';
import {
    chooseMiningJob, isMinerHull, miningReach, scoopsDebris,
} from './npc_mining.js';
import {
    friendlyStellar, isShuttle, shuttleLaneEnd, shuttleStops,
} from './npc_shuttle.js';
import { outOfAmmo } from './npc_out_of_ammo.js';
import { TargetComponent } from '../ship/index.js';
import { longestReachOfStates, WeaponsStateComponent } from '../ship/index.js';

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
/** Interceptors orbit their home planet at this radius (steered smoothly
 * by npc_steering.ts's steerOrbit). */
export const INTERCEPTOR_ORBIT_RADIUS = 400;
/** Interceptors engage enemies within this range of themselves or
 * their home planet. */
export const INTERCEPTOR_ENGAGE_RANGE = 1800;
/** Warships hunt enemies anywhere in the inhabited field; beyond this
 * they don't see them (keeps fights near the action). */
export const WARSHIP_ENGAGE_RANGE = 6000;
/** NPCs stay in the system between these bounds before jumping out.
 * Unmeasured for ordinary sÿst traffic (reference A-series wave 4 left
 * it open), so kept as it was. Rolled for every NPC, but an AI 1/2
 * TRADER leaves after its one stop instead (reference "Shuttles and T1
 * traders, wave 15"), a SHUTTLE with a two-stop lane never leaves and one
 * with a single stop leaves after it (npc_shuttle.ts), and an AI 4
 * INTERCEPTOR of ordinary traffic never leaves on it (reference "Stock
 * Sol, wave 16": three stayed 21+ minutes while an AI 3 destroyer left
 * within 5; "Stock traffic, wave 17": five more in Arcturus and Tau
 * Ceti), and a MINER with rocks to work never leaves on it (the stock
 * Asteroid Miner stayed 20+ minutes in Sol and Tau Ceti, waves 16-17; it
 * leaves once its hold is full, npc_mining.ts). AI 3 warships go by it. */
export const NPC_DEPART_MIN_MS = 120_000;
export const NPC_DEPART_MAX_MS = 300_000;
/**
 * The departure window of a PASSING-THROUGH ship (NpcState
 * `passingThrough`: a mïsn special ship with ShipGoal -1, ShipBehav -1
 * and AI 1). Reference A-series wave 4: nine of nine such ships left by
 * jumping out about 30-40 s after they appeared, never landing; the
 * window is that measurement. (The original's ships were GONE by then;
 * here the departure decision falls in the window and the outbound
 * flight and jump sequence follow it.)
 */
export const PASS_THROUGH_DEPART_MIN_MS = 30_000;
export const PASS_THROUGH_DEPART_MAX_MS = 40_000;

function randomBetween(random: Random, min: number, max: number): number {
    return min + random.next() * (max - min);
}

/**
 * Draws the sim time at which a freshly spawned NPC will depart: one PRNG
 * draw either way, so a passing-through ship shifts no other NPC's rolls.
 */
export function rollDepartureTime(now: number, random: Random,
    passingThrough = false): number {
    return passingThrough
        ? now + randomBetween(random,
            PASS_THROUGH_DEPART_MIN_MS, PASS_THROUGH_DEPART_MAX_MS)
        : now + randomBetween(random, NPC_DEPART_MIN_MS, NPC_DEPART_MAX_MS);
}

// --- Decision making ---

const PlanetsQuery = new Query(
    [UUID, MovementStateComponent, PlanetComponent,
        PlanetDataComponent] as const);
/** Asteroids and debris boxes, for miners (npc_mining.ts). */
const AsteroidsQuery = new Query(
    [UUID, MovementStateComponent, AsteroidComponent] as const);
const DebrisQuery = new Query(
    [UUID, MovementStateComponent, DebrisComponent] as const);
const NpcTargetsQuery = new Query([UUID, MovementStateComponent, ShipComponent,
    ShipDataComponent, Optional(GovtComponent), Optional(ShieldComponent),
    Optional(CloakActiveComponent), Optional(DisabledComponent),
    Optional(LegalRecordsComponent),
    // The ränk 0x0100 suppression set, baked at grant time: the sim
    // worker never loads Rank data, so the flag cannot be read here.
    Optional(AggressionSuppressGovtsComponent),
    // A contraband detection on this stay in space (contraband_target.ts):
    // the scanning govt's hunters attack the pilot whatever its CrimeTol.
    Optional(ContrabandScannedComponent),
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

/**
 * Where an ordinary AI 1/2 trader may stop: the landing destinations that
 * are not an ENEMY govt's (npc_shuttle.ts's `friendlyStellar`, the rule
 * the shuttles use). Reference "Shuttles and T1 traders, wave 15": 70
 * trader visits fell about evenly on the own govt's two ports and the
 * NEUTRAL govt's port (21 / 25 / 24), none on the enemy's port (listed
 * first) and none on the uninhabited marker (not landable, so already out).
 * Pure over genesis state and the staged govt cache; no PRNG.
 */
export function traderDestinations(planets: PlanetEntry[],
    shipGovt: GovtData | undefined,
    govtOf: (id: string) => GovtData | undefined): PlanetEntry[] {
    return landingDestinations(planets).filter(([, , , data]) =>
        friendlyStellar(shipGovt, data.govt, govtOf));
}

/** Picks the next planet a trader heads for (uuid order for
 * determinism; Random for variety, evenly over the candidates; excludes
 * the one it's at). No draw when there is no choice. */
function pickPlanet(planets: PlanetEntry[],
    random: Random, exclude?: string): string | undefined {
    const ids = planets.map(([uuid]) => uuid).sort()
        .filter(uuid => uuid !== exclude);
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
        Optional(WeaponsStateComponent),
        NpcTargetsQuery,
        PlanetsQuery, TimeResource, RandomResource, Entities, UUID,
        SimulationGameDataResource, GetEntity,
        // Miners' rocks and boxes (npc_mining.ts).
        AsteroidsQuery, DebrisQuery,
        // The world's own system: whose law a criminal record is judged
        // by (reference A14, local_law.ts). Optional only so a bare test
        // world still thinks; every makeSystem world sets it.
        Optional(SystemIdResource)] as const,
    step(npc, movement, target, govt, shield, shipData, formation,
        escortCommand, assisting, jump, hold, weapons, ships, planets, time,
        random, entities, uuid, gameData, entity, asteroids, debrisBoxes,
        systemId) {
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
            npc.departAt = rollDepartureTime(time.time, random,
                npc.passingThrough);
        }

        // Forget aggressors that no longer exist.
        if (npc.aggressor && !entities.has(npc.aggressor)) {
            npc.aggressor = undefined;
        }

        // THE PLAYER THIS SHIP PROTECTS, if it flies in a player's flock
        // (allegiance.ts's flockPlayer): a mïsn ShipBehav 1 / escort-goal
        // special ship, or a captured leader's fleet escort. The target
        // brackets paint such a ship FRIENDLY ahead of every political tier
        // (hostility.ts's styleForTarget, tier 2), so its own brain must
        // agree, by the same flock walk:
        //  - its OWN SIDE — the player and everything in their flock — is
        //    never a hostile, whatever its government thinks of them. The
        //    "Escort Moash Dignitary" report: the player's legal record with
        //    the Moash was criminal, so the dignitary's warship counted the
        //    player as an enemy and, flying in formation beside them, as
        //    the NEAREST one — and attacked the ship it was escorting.
        //  - nor is it ever an AGGRESSOR to retaliate against. Friendly
        //    fire only connects with a flock member that is disabled
        //    (firing_group.ts's carve-out), and a guided lock on one
        //    provokes nothing (flock.ts), but however the record got there
        //    a protector does not turn on its player.
        //  - and whoever is ATTACKING the player (tier 3 of the same rule,
        //    isAttackingPlayer) is a hostile, so "protect the player" means
        //    defending them, not just holding formation — UNLESS the
        //    attacker flies for the protector's OWN government or one it
        //    counts as an ALLY (govtDisposition 'ally', from the protector's
        //    side). Reference Q3 (docs/reference_experiments.md): on the
        //    original, raiders of the escort's own govt attacked the
        //    criminal player for 70 s and the escort never engaged them; it
        //    defends the player, not against its own government's law.
        //    Allies were NOT measured; they are treated like the own govt
        //    (the Bible: allies "communicate your actions", and nothing else
        //    in a protector's brain ever makes an ally a hostile). Shared
        //    classes alone are not an alliance (Bible, gövt Class1-4).
        // Everything read is synced state and the sim clock; no PRNG draw
        // is added or skipped.
        const getEntity = (id: string) => entities.get(id);
        const protectee = flockPlayer(uuid, getEntity);
        const protecteeEntity =
            protectee !== undefined ? entities.get(protectee) : undefined;
        const ownSide = (other: string) => protectee !== undefined
            && (other === protectee || isInFlock(other, protectee, getEntity));
        const attackingProtectee = (other: string) => {
            if (protectee === undefined || protecteeEntity === undefined) {
                return false;
            }
            const otherEntity = entities.get(other);
            return otherEntity !== undefined && isAttackingPlayer(other,
                otherEntity, protectee, protecteeEntity, time.time);
        };
        if (npc.aggressor !== undefined && ownSide(npc.aggressor)) {
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
        // Ships with legal records (players) are enemies too when this
        // govt enforces the law HERE and their record here is below its
        // crime tolerance (reference A14, local_law.ts): crime has
        // consequences, in the system where it counts.
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
        // PLAYER ships an interceptor might scan for contraband (case 4,
        // contraband_scan.ts): every live, visible one that is not on this
        // ship's own side and not its briber. Gathered only by an AI 4 of
        // a govt that scans here, so no other NPC pays for it.
        const scanCandidates: Array<readonly [string, number]> = [];
        const law = localLawIn(gameData, systemId);
        const scans = npc.aiType === 4 && scansHere(govtData, law);
        // Only a warship of a plundering government looks at hulks at all,
        // so the extra per-hulk entity lookups below cost nothing for
        // every other NPC in the system.
        const plunders = npcPlundersHulks(npc.aiType,
            govtData?.flags.plundersBeforeDestroying);
        let aggressorEntry: readonly [string, number, number] | undefined;
        for (const [otherUuid, otherMovement, , otherData, otherGovt,
            otherShield, cloak, otherDisabled, otherRecords,
            otherSuppressGovts, otherScanned, otherExploding] of ships) {
            if (otherUuid === uuid || !isTargetable(cloak)
                || otherExploding !== undefined) {
                continue;
            }
            if (otherUuid === pacifiedFrom) {
                // Bribed to leave this ship alone (reprieve still active).
                continue;
            }
            if (ownSide(otherUuid)) {
                // The player this ship protects, and their flock: never a
                // target, nor (disabled) a prize to plunder.
                continue;
            }
            const distanceSquared = otherMovement.position
                .subtract(position).lengthSquared;
            if (otherDisabled) {
                if (plunders && distanceSquared
                    <= NPC_PLUNDER_SEEK_RANGE * NPC_PLUNDER_SEEK_RANGE
                    && govtDispositionTo(govtData,
                        lookupGovt(gameData, otherGovt), otherRecords, law,
                        ranksSuppressAggression(otherSuppressGovts,
                            govtData?.id), otherScanned?.hostile) === 'enemy') {
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
            if (scans && otherRecords !== undefined) {
                scanCandidates.push([otherUuid, distanceSquared] as const);
            }
            const otherStrength = effectiveStrength(
                otherData.strength, shieldFraction(otherShield));
            if (otherUuid === npc.aggressor) {
                aggressorEntry = [otherUuid, distanceSquared, otherStrength];
            }
            // THE ON-SIGHT PREDICATE (on_sight.ts's attacksOnSight): the
            // one the IFF colour reads too (hostility.ts's styleForTarget,
            // tier 4), so a ship the brackets paint red is one this brain
            // hunts and a trader of the same government, painted yellow,
            // is not. Only the hunting cases (3 and 4) read `hostiles`, so
            // gating the list on the AI type changes no decision; it is
            // here so the colour and the brain share one call.
            const otherGovtData = lookupGovt(gameData, otherGovt);
            if (attacksOnSight(npc.aiType, govtData, otherGovtData,
                otherRecords, law,
                // ränk 0x0100 for THIS ship's government: its holder is not
                // attacked on sight.
                ranksSuppressAggression(otherSuppressGovts, govtData?.id),
                otherScanned?.hostile)
                || (huntsOnSight(npc.aiType)
                    && attackingProtectee(otherUuid)
                    && govtDisposition(govtData, otherGovtData) !== 'ally')) {
                hostiles.push([otherUuid, distanceSquared] as const);
            }
        }

        // OUT OF AMMO (shïp Flags2 0x0080; npc_out_of_ammo.ts, reference
        // W1 wave 15): a hull with the flag whose every weapon draws from
        // an empty magazine leaves by the ordinary jump-out, whatever its
        // AI type. Not while held, not a ship already fleeing (it is
        // leaving anyway), and not a ship protecting a player (it stays
        // with them; unmeasured). Synced state and staged caches only; it
        // returns before any draw below, the same way for every peer.
        if (shipData.aiFlags.runsAwayWhenOutOfAmmo && !held
            && npc.mode !== 'flee'
            && protectee === undefined && weapons !== undefined
            && outOfAmmo(weapons, entity.components.get(OutfitsStateComponent),
                id => gameData.data.Weapon.getCached(id),
                id => gameData.data.Outfit.getCached(id))) {
            npc.mode = 'depart';
            target.target = undefined;
            delete npc.mineTarget;
            delete npc.scanTarget;
            npc.boardTarget = undefined;
            return;
        }

        switch (npc.aiType) {
            case 2: // Brave trader: fight back while the odds hold.
                if (aggressorEntry) {
                    const [aggressorUuid, aggressorD2, aggressorStrength] =
                        aggressorEntry;
                    // "...but runs away when his attacker is out of range"
                    // (Bible AIType 2). Reference "A wave 7: does an AI 2
                    // trader run when its attacker is out of range?": once
                    // the player that had been fighting it flew off past
                    // its guns' reach, it ran directly away and left the
                    // system about 20 s later. "Out of range" is beyond
                    // its LONGEST weapon reach (synced WeaponState.reach),
                    // and only after the attacker has been within it: a
                    // trader provoked from afar closes in to fight first
                    // (waves 2 and 4: tickled from up to 2250 px, it came
                    // in and fought). Unarmed or bay-only, there is no
                    // reach and the rule never fires. Not committed: an
                    // attacker that comes back into reach is fought again.
                    // Synced state and distances only; no PRNG draw.
                    if (npc.reachedAggressor !== undefined
                        && npc.reachedAggressor !== aggressorUuid) {
                        delete npc.reachedAggressor;
                    }
                    const reach = weapons
                        ? longestReachOfStates(weapons) : undefined;
                    const inReach = reach !== undefined
                        && aggressorD2 <= reach * reach;
                    if (inReach) {
                        npc.reachedAggressor = aggressorUuid;
                    }
                    const brokeOff = reach !== undefined && !inReach
                        && npc.reachedAggressor === aggressorUuid;
                    const favorable = oddsFavorable(govtData?.maxOdds ?? 100,
                        myStrength, aggressorStrength);
                    if (favorable && !brokeOff) {
                        npc.mode = 'attack';
                        target.target = aggressorUuid;
                        return;
                    }
                    npc.mode = 'flee';
                    return;
                }
                // Dropped with the aggressor itself, not on every think
                // its entry is missing: a cloaked or disabled attacker
                // drops out of the ships query for a while (and, before
                // npc_targeting.ts's responsibleShip, a submunition left a
                // PROJECTILE uuid here for a moment); neither should cost
                // the trader its record.
                if (npc.reachedAggressor !== undefined
                    && npc.aggressor === undefined) {
                    delete npc.reachedAggressor;
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
                // A ship only passing through (mission ShipGoal -1, AI 1)
                // goes the moment its short window is up, straight to a
                // jump: it does not finish a trip or a dwell first.
                // Reference A-series wave 4. Reached only when not
                // fleeing (the aggression switch above returns first).
                if (npc.passingThrough && !held
                    && time.time >= npc.departAt) {
                    npc.mode = 'depart';
                    return;
                }
                // MINING (npc_mining.ts; reference N1 wave 13): an AI 1/2
                // hull with Flags3 0x0001 shoots rocks apart and, with
                // Flags3 0x0002 and a scoop, flies over the debris; with
                // nothing to mine it flies the trader loop below. Not
                // while it holds a fleet formation slot (its leader's
                // business comes first). Synced state and staged caches
                // only; no PRNG draw.
                const inFormation =
                    formation !== undefined && entities.has(formation.leader);
                if (!inFormation && isMinerHull(npc.aiType, shipData)
                    && weapons !== undefined
                    && miningReach(weapons) !== undefined) {
                    const scoops = scoopsDebris(shipData,
                        entity.components.get(OutfitsStateComponent),
                        id => gameData.data.Outfit.getCached(id));
                    const cargo = entity.components.get(CargoComponent);
                    const physics =
                        entity.components.get(ShipPhysicsComponent);
                    // A scooping miner with a full hold has nothing left
                    // to mine for: back to the trader loop (GUESS).
                    const full = scoops && cargo !== undefined
                        && physics !== undefined
                        && cargoUsed(cargo) + 1 > physics.freeCargo;
                    const distances = (rows: ReadonlyArray<
                        readonly [string, MovementState, unknown]>) =>
                        rows.map(([other, otherMovement]) => [other,
                            otherMovement.position.subtract(position)
                                .lengthSquared] as const);
                    const job = full ? undefined : chooseMiningJob(npc,
                        distances(asteroids),
                        scoops ? distances(debrisBoxes) : [], scoops);
                    if (job) {
                        // A miner with work to do stays, whatever its
                        // departure roll (still drawn, so no other NPC's
                        // draws shift): the stock Asteroid Miner never
                        // left Sol or Tau Ceti in 20+ minutes (reference
                        // "Stock Sol, wave 16", "Stock traffic, wave 17").
                        // It leaves once its hold is full (`full` above:
                        // the trader loop, one stop and out), which is
                        // how the kit miners' 3-4 minute stays (wave 15)
                        // are read: GUESS, see npc_mining.ts.
                        npc.mode = job.mode;
                        npc.mineTarget = job.target;
                        return;
                    }
                }
                if (npc.mode === 'mine' || npc.mode === 'scoop') {
                    npc.mode = undefined;
                }
                if (npc.mineTarget !== undefined) {
                    delete npc.mineTarget;
                }
                // SHUTTLES (npc_shuttle.ts; reference N2 wave 13, waves
                // 15, 16): a hull with Flags3 0x0002 and no scoop keeps
                // one lane between two of the system's non-enemy
                // stellars, uninhabited ones included, and never leaves;
                // with only one such stellar it stops there once and
                // leaves, with none it leaves at once. Ordinary
                // traders (wave 15) make ONE stop at a non-enemy landable
                // port and then jump out.
                const shuttle = isShuttle(shipData);
                const govtOf = (id: string) => gameData.data.Govt.getCached(id);
                const destinations = shuttle
                    ? shuttleStops(planets, govtData, govtOf)
                    : traderDestinations(planets, govtData, govtOf);
                const isStop = (stop: string | undefined) => stop !== undefined
                    && destinations.some(([other]) => other === stop);
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
                        if (shuttle && npc.laneEnd === npc.destination
                            && !held && !npc.passingThrough) {
                            // A lane of ONE stop (the system's only
                            // non-enemy stellar): one visit and out, like
                            // a trader (reference "Shuttles wave 16": 20
                            // tracks, a 5-7 s stop, then over the edge).
                            npc.mode = 'depart';
                            return;
                        } else if (shuttle) {
                            // Back along the lane: the other end becomes
                            // the destination. A shuttle with a two-stop
                            // lane never leaves (waves 15, 16), whatever
                            // its departure time. If the other end is no
                            // longer a stop, re-plan.
                            if (isStop(npc.laneEnd)) {
                                const from = npc.destination;
                                npc.destination = npc.laneEnd;
                                npc.laneEnd = from;
                                npc.mode = 'travel';
                            } else {
                                npc.mode = undefined;
                            }
                        } else if (!held && !npc.passingThrough) {
                            // One stop per visit (wave 15: 70 visits, no
                            // second stop), then out by jump.
                            npc.mode = 'depart';
                            return;
                        } else {
                            // Held here (system_hold.ts), it may not leave;
                            // a ship passing through leaves on its own
                            // clock (above: reference A-series wave 4,
                            // 30-40 s after it appears). Either goes on to
                            // another port meanwhile.
                            npc.destination = pickPlanet(destinations, random,
                                npc.destination);
                            npc.mode = travelOrDepart(npc.destination, held);
                        }
                    }
                }
                if (npc.mode === undefined) {
                    if (shuttle && isStop(npc.destination)
                        && isStop(npc.laneEnd)) {
                        // Back from a flight or a fight: resume the lane.
                        npc.mode = 'travel';
                    } else {
                        npc.destination = pickPlanet(destinations, random);
                        if (shuttle && npc.destination !== undefined) {
                            npc.laneEnd = shuttleLaneEnd(destinations,
                                npc.destination, random);
                        } else if (npc.laneEnd !== undefined) {
                            delete npc.laneEnd;
                        }
                        npc.mode = travelOrDepart(npc.destination, held);
                    }
                }
                break;
            }
            case 3: { // Warship: hunt, else patrol; jump out eventually.
                const engageable = hostiles.filter(([, d2]) =>
                    d2 <= WARSHIP_ENGAGE_RANGE * WARSHIP_ENGAGE_RANGE);
                if (aggressorEntry) {
                    engageable.push([aggressorEntry[0], aggressorEntry[1]]);
                }
                const chosen = chooseNearest(engageable);
                // MaxOdds: engage only while the fight looks favorable
                // (per-pair simplification of the Bible's
                // friends-vs-enemies strength sums).
                let favorable = false;
                if (chosen) {
                    const chosenEntry = ships.find(([u]) => u === chosen);
                    const chosenStrength = chosenEntry ? effectiveStrength(
                        chosenEntry[3].strength,
                        shieldFraction(chosenEntry[5])) : 0;
                    favorable = oddsFavorable(govtData?.maxOdds ?? 100,
                        myStrength, chosenStrength);
                }
                // gövt Flags 0x0010: under 25% shield AND losing, one PRNG
                // draw decides jump out or stand off while losing
                // (npc_retreat.ts; the reference showed the shield level
                // alone does not do it, and that the choice is made once,
                // at the crossing). Synced state, the clock, and that
                // one draw per crossing.
                if (govtData?.flags.warshipsRetreatAt25) {
                    const retreat = warshipRetreat(npc, shield, time.time,
                        chosen !== undefined, favorable, random, !held);
                    if (retreat === 'jump') {
                        npc.mode = 'flee';
                        target.target = undefined;
                        return;
                    }
                    if (retreat === 'standoff') {
                        // Still 'attack', so it keeps firing what reaches;
                        // `retreatSince` makes NpcSteeringSystem hold the
                        // stand-off band instead of closing.
                        npc.mode = 'attack';
                        target.target = chosen;
                        return;
                    }
                }
                if (chosen && favorable) {
                    npc.mode = 'attack';
                    target.target = chosen;
                    return;
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
                    delete npc.scanTarget;
                    target.target = chosen;
                    return;
                }
                if (npc.mode === 'attack') {
                    npc.mode = undefined;
                    target.target = undefined;
                }
                // CONTRABAND SCAN (Bible AI 4: "buzzes incoming ships to
                // scan them for illegal cargo"; contraband_scan.ts). With
                // nobody to fight, an interceptor of a govt that scans
                // here flies to a player ship it has not scanned this
                // visit (clean or not), or one carrying contraband its
                // last scan did not find, and sits on it a while after the
                // scan (chooseScanTarget, holdingScan). Ordered after the
                // engagement decision (a criminal is attacked, not
                // scanned: the Bible's ScanFine applies only to a pilot
                // "not yet evil enough to attack") and before departure,
                // so it does not leave with a scan pending. A clean ship
                // is approached too (reference "A14 / contraband wave 16";
                // wave 11 had read the opposite).
                if (scans && govtData) {
                    const hostileSet = new Set(hostiles.map(([u]) => u));
                    const scanTarget = chooseScanTarget(npc.scanTarget,
                        scanCandidates.filter(([u]) => !hostileSet.has(u)),
                        govtData.scanMask, getEntity, gameData, time.time);
                    if (scanTarget !== undefined) {
                        npc.mode = 'scan';
                        npc.scanTarget = scanTarget;
                        return;
                    }
                }
                if (npc.mode === 'scan') {
                    npc.mode = undefined;
                }
                delete npc.scanTarget;
                // An interceptor of ordinary traffic NEVER LEAVES on its
                // departure roll (reference "Stock Sol, wave 16": the
                // three AI 4 Fed interceptors stayed 21+ minutes, with the
                // shuttles, until the system froze; an AI 3 destroyer
                // left within 5 minutes). Only one with no business here
                // leaves on its clock: a released mission ship
                // (mission_ship_release.ts) or a përs sent on its way
                // after its offer (mission_accept.ts), both
                // `passingThrough`. The roll is still drawn (above), so no
                // other NPC's draws shift.
                if (!held && npc.passingThrough
                    && time.time >= npc.departAt) {
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
                // Orbit the home planet: NpcSteeringSystem flies the circle
                // itself (steerOrbit), so there is no waypoint to hand it.
                // It used to chase a waypoint 45° ahead on the circle,
                // re-aimed each time it came within WAYPOINT_RADIUS:
                // fighter-speed hulls braked for each one and swung their
                // nose about once a second (a Firebird ~135 reversals in
                // 120 s).
                npc.waypoint = undefined;
                break;
            }
        }
    },
    // ShootAllWeaponsAI is a #237 pin (shared: *): NpcAiPlugin registers
    // after NpcPlugin.
    after: [TimeSystem, ShootAllWeaponsAI],
    before: [MovementSystem],
});
