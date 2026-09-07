import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { BayFighterComponent, OrphanedBayFighterSystem, ReturnWhenTargetRemovedComponent, startReturnHome } from './bay_plugin.js';
import { ChooseTargetSystem } from '../combat/index.js';
import { AggressionComponent, isRecentAggressor } from '../combat/index.js';
import { blindSpotBlocksFiring } from '../combat/index.js';
import { DisabledComponent } from '../ship/index.js';
import { EscortCommandComponent, EscortCommandState, EscortOrders, EscortOrdersComponent } from '../player/index.js';
import { OwnerComponent } from '../ship/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { ExplodingComponent } from '../ship/index.js';
import { isInFlock } from '../combat/index.js';
import { GovtComponent } from '../core/index.js';
import { AggressionSuppressGovtsComponent } from '../ncb/index.js';
import { ranksSuppressAggression } from '../ncb/index.js';
import { shipDisposition } from '../reputation/index.js';
import { JumpComponent, JumpRouteReconcileSystem } from '../travel/index.js';
import { chooseNearest, FormationComponent, isPacifiedToward, NpcComponent, NpcSteeringSystem, RCS_ACCEL_FRACTION } from '../npc/index.js';
import { NpcPlunderBoardSystem, ShootAllWeaponsComponent } from '../npc/index.js';
import { LegalRecordsComponent, LegalRecordsState } from '../reputation/index.js';
import { EscortLandingComponent, PlayerEscortComponent } from '../player/index.js';
import { ShipComponent, ShipDataComponent, ShipPhysicsComponent } from '../ship/index.js';
import { ShipControlEvent, ShipControlStateComponent } from '../player/index.js';
import { TargetComponent } from '../ship/index.js';
import {
    shortestSuicideReachOfStates, suicideWeaponInReachState,
} from '../ship/index.js';
import { WeaponsStateComponent, WeaponState } from '../ship/index.js';

/**
 * ============================================================================
 * Escort commands (attack / defend / formation / holdPosition / returnToBay)
 * ============================================================================
 *
 * Commands apply to the player's DIRECT escorts only — one parent-link
 * hop: hired escorts holding formation on the player, and fighters
 * launched from the PLAYER's own bays. Fighters launched from an
 * ESCORT's bays are indirect: the player never commands them; their
 * carrier escort mirrors its own command to its wings every tick
 * (EscortCommandPropagationSystem). Transitive flock MEMBERSHIP is
 * flock.ts's isInFlock; this module adds the one-hop-vs-deeper split.
 *
 * Flow: player keypress -> control input record -> ShipControlEvent on
 * the player's ship -> EscortCommandInputSystem writes per-escort
 * EscortCommandComponent state (serializer-registered, so it is
 * hashed, rolls back, and crosses the wire). Any new command
 * interrupts the current one. State resets to 'formation' at the
 * boundaries where escorts are (re)created — jumping into a system and
 * lifting off from a planet both rebuild the escort entities with the
 * default command (bay fighters launch with it; spawnHiredEscorts
 * spawns fresh) — so the reset rule falls out of creation rather than
 * needing a boundary hook.
 *
 * This framework REPLACES the old bay behavior ("launch at the current
 * target and attack it until it dies, then auto-dock"): fighters now
 * launch into formation like every other escort and fight only when
 * commanded; docking happens only on the returnToBay command.
 *
 * DEFEND ENDPOINT: attack-until-DISABLED. A defend engagement ends the
 * moment the intruder becomes disabled (DisabledComponent), and
 * disabled ships are never picked as intruders — matching the NPC AI's
 * rule that a disabled ship stops being a valid attack target.
 */

// --- Tuning constants ---

/** defend: engage iff-hostile ships that come within this distance of
 * the escort. Matthew wants to tune this. */
export const DEFEND_RADIUS = 1000;
/** Attacking escorts stop thrusting toward their victim inside this
 * range (same standoff feel as NPC warships). */
export const ESCORT_ATTACK_STANDOFF = 250;
/** Attacking escorts only fire within this range of their victim. */
export const ESCORT_FIRE_RANGE = 1200;
/** holdPosition counts as "stopped" below this speed (px/s); under it
 * the RCS-style damping just pins velocity to zero. */
export const HOLD_STOPPED_SPEED = 5;

/**
 * The one-hop parent link used for command targeting: who this ship
 * directly follows. Formation leader first (hired escorts, idle
 * fighters), else the bay owner (fighters that are mid-fight when the
 * old formation component was replaced), else the DURABLE ownership
 * marker. One HOP only — command addressing is deliberately not
 * transitive (see the module comment).
 *
 * WHY THE DURABLE FALLBACK. Both live links can lapse while the ship is
 * still, unambiguously, the player's: returnToBay deletes the formation
 * link, FormationSystem drops it when the leader is briefly out of the
 * world, and a captured prize has no bay owner at all. When they lapse,
 * every other "is this my escort" predicate (the target-cycle exclusion,
 * the hail dialog, the target pane's label) can answer differently from
 * this one, and the player gets a ship that says it is an escort but
 * takes no orders — the playtest report this fallback closes together
 * with the component scrub in boarding_plugin's convertToEscort.
 *
 * PlayerEscort.parent comes first so the one-hop rule survives: a
 * fighter launched from a CARRIER ESCORT's bays falls back to that
 * carrier (which mirrors its own command down to it), not to the player,
 * so the player still never commands an indirect wing directly. NPC
 * fleets are untouched — nothing outside the player's flock ever carries
 * PlayerEscortComponent.
 */
export function escortParent(entity: Entity): string | undefined {
    const owned = entity.components.get(PlayerEscortComponent);
    return entity.components.get(FormationComponent)?.leader
        ?? entity.components.get(OwnerComponent)?.owner
        ?? owned?.parent ?? owned?.player;
}

const EscortsQuery = new Query([UUID, GetEntity, ShipComponent,
    Optional(FormationComponent), Optional(OwnerComponent),
    EscortCommandComponent] as const);

const COMMAND_ACTIONS = ['attack', 'defend', 'formation', 'holdPosition',
    'returnToBay'] as const;
type CommandAction = typeof COMMAND_ACTIONS[number];

/**
 * Applies the player's escort-command keys to their direct escorts.
 * Runs on the commanding ship (the ShipControlEvent target).
 */
export const EscortCommandInputSystem = new System({
    name: 'EscortCommandInput',
    events: [ShipControlEvent],
    args: [ShipControlStateComponent, TargetComponent, UUID, GetEntity,
        EscortsQuery] as const,
    step(controlState, target, uuid, entity, escorts) {
        // The restrict-turrets toggle rides the same input path (see
        // EscortOrdersComponent's rationale in escort_command.ts).
        if (controlState.get('escortRestrictFire') === 'start') {
            const orders = entity.components.get(EscortOrdersComponent);
            entity.components.set(EscortOrdersComponent, {
                restrictTurretsToTarget: !(orders?.restrictTurretsToTarget
                    ?? false),
            });
        }

        let action: CommandAction | undefined;
        for (const candidate of COMMAND_ACTIONS) {
            if (controlState.get(candidate) === 'start') {
                action = candidate;
                break;
            }
        }
        if (!action) {
            return;
        }
        // attack needs a victim: the player's current target at
        // command time. With no target the command is ignored.
        if (action === 'attack' && !target.target) {
            return;
        }
        for (const [, escortEntity] of escorts) {
            // One shared definition of the parent link (escortParent),
            // rather than a second inline copy of the same chain that
            // could drift from it.
            if (escortParent(escortEntity) !== uuid) {
                continue; // Not a DIRECT escort of the commander.
            }
            const state: EscortCommandState = action === 'attack'
                ? { command: 'attack', target: target.target }
                : { command: action };
            escortEntity.components.set(EscortCommandComponent, state);
        }
    },
    // #237 pin (shared: *): among the ShipControlEvent handlers, after
    // combat's target cycling.
    after: [ChooseTargetSystem],
});

/**
 * Carrier escorts mirror their own command to their wings (fighters
 * from THEIR bays) every tick: the indirect layer the player never
 * commands directly. Idempotent copy, so ordering within the tick
 * doesn't matter.
 */
const EscortCommandPropagationSystem = new System({
    name: 'EscortCommandPropagation',
    args: [EscortCommandComponent, UUID, GetEntity, Entities] as const,
    step(command, uuid, entity, entities) {
        // Only escorts that CARRY fighters propagate; walk this
        // entity's one-hop followers.
        for (const [, other] of entities) {
            const otherCommand = other.components.get(EscortCommandComponent);
            if (!otherCommand || other === entity) {
                continue;
            }
            if (escortParent(other) !== uuid) {
                continue;
            }
            if (otherCommand.command !== command.command
                || otherCommand.target !== command.target) {
                other.components.set(EscortCommandComponent,
                    { ...command });
            }
        }
    },
    // OrphanedBayFighterSystem and JumpRouteReconcileSystem are #237 pins
    // (shared: *): EscortCommandPlugin registers between BayPlugin and
    // JumpPlugin.
    after: [TimeSystem, OrphanedBayFighterSystem],
    before: [MovementSystem, JumpRouteReconcileSystem],
});

/**
 * NPC CARRIERS command their own wings: the NPC-side counterpart of
 * EscortCommandPropagationSystem.
 *
 * That system covers carriers that are themselves player ESCORTS (they
 * carry EscortCommandComponent and mirror their own command down). An
 * NPC warship has no command to mirror — its intent lives in
 * NpcComponent.mode plus TargetComponent — so without this its fighters
 * would launch into formation and sit there firing front-quadrant
 * turrets while the carrier fought.
 *
 * The rule is a MIRROR, not a one-shot order at launch, and that single
 * choice covers three of the four cases the feature needs:
 *
 *  - launch: the tick after a fighter appears it is already idle
 *    ('formation'), so it is ordered onto the carrier's victim;
 *  - re-engage: a fighter that killed its victim is reverted to
 *    'formation' by EscortCommandBehaviorSystem, and is re-ordered here
 *    on the next tick while the carrier is still fighting;
 *  - recall to station: when the carrier stops attacking (victim dead,
 *    fled, or the NPC AI dropped it), the mirror writes 'formation' and
 *    the wings fall back into their slots.
 *
 * (The fourth, carrier death, is OrphanedBayFighterSystem in
 * bay_plugin: this system stops running the moment the carrier entity
 * is gone.)
 *
 * DETERMINISM: the value written depends only on the carrier's own
 * synced state, never on iteration order, and the write is idempotent
 * (skipped when it would not change anything), so every peer converges
 * on the same commands regardless of entity-map order. It consumes no
 * randomness and no clock.
 *
 * PLAYER-LAUNCHED FIGHTERS ARE NEVER TOUCHED, structurally rather than
 * by convention: this system only visits entities with NpcComponent (a
 * player's ship has none), it bails on carriers that carry an escort
 * command of their own (a hired carrier escort — the propagation system
 * owns those), and it skips any wing marked PlayerEscortComponent,
 * which is stamped whenever the escort chain tops out at a player and
 * is never cleared.
 */
const NpcWingCommandSystem = new System({
    name: 'NpcWingCommand',
    args: [NpcComponent, TargetComponent, UUID, Entities,
        Optional(EscortCommandComponent)] as const,
    step(npc, target, uuid, entities, escortCommand) {
        if (escortCommand) {
            // A carrier that is itself a player escort: its wings mirror
            // ITS command (EscortCommandPropagationSystem), not the NPC
            // AI's opinion.
            return;
        }
        // Only a live victim counts: a stale uuid would leave the wings
        // chasing a ship that no longer exists.
        const victim = npc.mode === 'attack' && target.target !== undefined
            && entities.has(target.target) ? target.target : undefined;
        const desired: EscortCommandState = victim !== undefined
            ? { command: 'attack', target: victim }
            : { command: 'formation' };

        for (const [otherUuid, other] of entities) {
            if (otherUuid === uuid) {
                continue;
            }
            const otherCommand = other.components.get(EscortCommandComponent);
            // Bay-launched wings of THIS carrier only. Fleet escorts
            // holding formation on an NPC carrier have no escort command
            // and run their own NPC AI; they are deliberately left alone.
            if (!otherCommand
                || !other.components.has(BayFighterComponent)
                || other.components.has(PlayerEscortComponent)
                || escortParent(other) !== uuid) {
                continue;
            }
            if (otherCommand.command !== desired.command
                || otherCommand.target !== desired.target) {
                other.components.set(EscortCommandComponent, { ...desired });
            }
        }
    },
    // The carrier's mode/target are settled by the NPC decision system
    // (which NpcSteeringSystem already runs after) before the wings are
    // told what to do; EscortCommandBehaviorSystem then executes the
    // commands later in the same tick (it lists this system in its
    // `after`).
    after: [TimeSystem, NpcSteeringSystem],
    before: [MovementSystem],
});

function lookupGovt(gameData: SimulationGameDataInterface,
    govt: { id: string } | undefined) {
    return govt ? gameData.data.Govt.getCached(govt.id) : undefined;
}

/**
 * Everything the escort's hostility question needs about its OWNER, read
 * once per tick in EscortCommandBehaviorSystem and handed to every
 * candidate test. The owner is the point of view: an escort has no
 * politics, no reputation and no grudges of its own — it fights whoever
 * its owner would call hostile.
 */
export interface EscortHostilityContext {
    /** The owner root's government (already staged; see lookupGovt). */
    rootGovt: ReturnType<typeof lookupGovt>;
    gameData: SimulationGameDataInterface;
    /** The owner root, when it is still in this system. */
    rootEntity?: Entity;
    /** The owner's legal records. */
    rootRecords?: LegalRecordsState;
    /** The SIMULATION clock, in milliseconds (TimeResource.time). */
    now: number;
    /** Entity lookup, for the own-flock tier (flock.ts's isInFlock). */
    getEntity: (uuid: string) => Entity | undefined;
}

/**
 * Whether `other` is iff-hostile toward the escort's owner root — THE SAME
 * ANSWER the target corners give that owner (hostility.ts's
 * `styleForTarget`), tier for tier, so a ship painted red by the HUD is a
 * ship the owner's escorts engage and a ship painted neutral is one they
 * leave alone:
 *
 *  - OWN FLOCK (tier 2): a ship inside the owner's own flock — a sibling
 *    escort, a bay fighter, anything transitively following them — is
 *    never a target, ahead of everything else, exactly as the corners
 *    paint it friendly ahead of everything else. Not reachable on the
 *    stock paths today (every way a ship joins the player's flock sheds
 *    its GovtComponent: makeNpcShip never sets one, convertToEscort
 *    deletes it, a bay fighter copies a carrier that hasn't got one, and a
 *    captured leader's wing is re-parented straight back OUT of the flock
 *    — see boarding_plugin's reassignCapturedWing), so this is a guard
 *    rather than a fix. It is here because the tier list below is a claim
 *    about agreeing with styleForTarget TIER FOR TIER, and a claim with a
 *    hole in it is worth less than the line of code that closes it; a
 *    plug-in that hands an escort a government would otherwise have the
 *    owner's own wing shooting each other while the HUD painted them all
 *    friendly.
 *  - BOUGHT OFF (tier 2b): a ship the OWNER bribed to leave them alone
 *    (beg for mercy; NpcComponent.pacifiedFrom/pacifiedUntil) is not
 *    hostile to their escorts either, ahead of everything else. Without
 *    this a defending escort — or an opportunistic turret on a formation
 *    one — kept shooting the pirate the player had just paid off, which
 *    voids the reprieve the moment the damage lands (NpcDecisionSystem
 *    drops pacifiedFrom when the briber hurts it) and restarts the fight
 *    the money had ended. Exactly the failure the point-defense prey
 *    filter was fixed for.
 *  - POLITICS (tier 4): shipDisposition over the owner's govt and legal
 *    records, with the owner's ränk 0x0100 suppression set folded in the
 *    way the corners fold it (the baked synced component; the sim cannot
 *    read ränk data — see rank_logic.ts).
 *  - POSTURE (tier 3a): currently attacking the root or the escort itself.
 *    Two ways a ship can be flying an attack: an NPC brain in mode
 *    'attack' (or the legacy dev-enemy ShootAllWeapons marker), and — for
 *    a RIVAL'S ESCORT, which flies on its own owner's escort command and
 *    never on an NpcComponent mode — an EscortCommandComponent of
 *    'attack' or 'defend'. The corners have counted that second reading
 *    since "when an escort is attacking another player (due to 'f' or due
 *    to defending), it should be IFF hostile from that player's
 *    perspective"; without it here, an escort ordered onto us painted red
 *    on the HUD while our own defend/formation brains ignored it until its
 *    first shot landed and tier 3b caught up. Gated on the same target
 *    test as the rest of the posture tier — an escort defending a leader
 *    somewhere else, with no target or another target, is not attacking
 *    US.
 *  - RECENT AGGRESSION (tier 3b): it shot the OWNER, or locked a guided
 *    missile on them, inside the aggression window. This is the tier that
 *    reaches another PLAYER's ship, which has neither a government nor an
 *    NPC brain: without it, 'defend' would stand and watch a rival player
 *    empty their guns into its owner because the attacker's
 *    TargetComponent had already moved on.
 *
 * Pure over synced state and the simulation clock, so every peer agrees.
 *
 * EXPORTED FOR ONE REASON: escort_hostility_agreement_test.ts drives this
 * and `styleForTarget` over the same matrix of states and asserts they
 * agree, which is the only way the tier-for-tier claim above stays true as
 * either side gains a tier. Nothing else outside this module should call
 * it — the escort brains hand it the context they build per tick.
 */
export function isHostileTo(other: Entity, otherUuid: string, rootUuid: string,
    escortUuid: string, ctx: EscortHostilityContext): boolean {
    // The owner's own ships are the owner's, whatever their politics —
    // the corners' tier 2, ahead of everything.
    if (isInFlock(otherUuid, rootUuid, ctx.getEntity)) {
        return false;
    }
    // Bought off by the owner: not a target, whatever the politics say.
    if (isPacifiedToward(other.components.get(NpcComponent), rootUuid,
        ctx.now)) {
        return false;
    }
    const otherGovt =
        lookupGovt(ctx.gameData, other.components.get(GovtComponent));
    const disposition = shipDisposition(otherGovt, ctx.rootGovt,
        ctx.rootRecords,
        ranksSuppressAggression(ctx.rootEntity?.components
            .get(AggressionSuppressGovtsComponent), otherGovt?.id));
    if (disposition === 'hostile') {
        return true;
    }
    const theirTarget = other.components.get(TargetComponent)?.target;
    // A rival's escort flies on ITS owner's escort command, not on an
    // NpcComponent mode, so 'attack'/'defend' is that ship's attack
    // posture — the same reading the corners take (hostility.ts's
    // `escortEngaging`), under the same target gate.
    const theirCommand = other.components
        .get(EscortCommandComponent)?.command;
    const attackingUs = (theirTarget === rootUuid
        || theirTarget === escortUuid)
        && (other.components.get(NpcComponent)?.mode === 'attack'
            || theirCommand === 'attack' || theirCommand === 'defend'
            || other.components.has(ShootAllWeaponsComponent));
    return attackingUs
        || isRecentAggressor(
            ctx.rootEntity?.components.get(AggressionComponent),
            otherUuid, ctx.now);
}

const HostileCandidatesQuery = new Query(
    [UUID, GetEntity, MovementStateComponent, ShipComponent] as const);

/**
 * Point-and-thrust pursuit of a target (attack/defend engagements).
 *
 * `standoff` is the range the escort stops closing at — normally
 * ESCORT_ATTACK_STANDOFF, but shorter for a ship whose killing blow only
 * lands closer than that (see attackStandoff).
 */
function steerAttack(movement: MovementState, target: MovementState,
    standoff: number) {
    const toTarget = target.position.subtract(movement.position);
    movement.turnTo = toTarget.angle;
    movement.turnBack = false;
    movement.accelerating = toTarget.length > standoff ? 1 : 0;
}

/**
 * How close this escort flies to the ship it is attacking.
 *
 * Ordinarily ESCORT_ATTACK_STANDOFF — a comfortable gunnery range that
 * keeps escorts out of each other's way. A ship carrying a SUICIDE
 * weapon (wëap AmmoType -999) is a different animal: its one shot has a
 * fixed, usually very short reach, and holding station outside that
 * reach means it can never use the only thing it is for. Such a ship
 * closes to the reach of its shortest-ranged suicide weapon instead —
 * which for the Intelligent EMP Torpedo plug-in is what turns a drone
 * that orbits at 250px into one that flies into its victim and detonates.
 *
 * Never LONGER than the ordinary standoff: a suicide weapon that
 * outranges it (a long beam, say) changes nothing about how the ship
 * flies.
 */
function attackStandoff(weapons: Iterable<readonly [string, WeaponState]>): number {
    // From the SYNCED weapon states, never from getCached: the reach was
    // copied out of the weapon data when the states derived (outfit_plugin
    // deriveWeaponsState), so every peer steers by the same number
    // whatever its cache holds (review r13 MEDIUM).
    const reach = shortestSuicideReachOfStates(weapons);
    return reach === undefined
        ? ESCORT_ATTACK_STANDOFF
        : Math.min(ESCORT_ATTACK_STANDOFF, reach);
}

/**
 * holdPosition steering: come to rest relative to the system. Fast:
 * retro turn-and-burn. Slow: RCS-style direct damping (budgeted like
 * formation RCS), so the last few px/s bleed off without the ship
 * spinning around. No anchor: if weapon hits knock the ship around, it
 * stops again WHERE IT IS (per the spec, it does not fly back to the
 * original hold point, and it does not return fire).
 */
function steerHold(movement: MovementState, acceleration: number,
    delta_s: number) {
    const speed = movement.velocity.length;
    movement.turnTo = null;
    if (speed <= HOLD_STOPPED_SPEED) {
        movement.turnBack = false;
        movement.accelerating = 0;
        const budget = acceleration * RCS_ACCEL_FRACTION * delta_s;
        movement.velocity = speed <= budget
            ? new Vector(0, 0)
            : Vector.fromVectorLike(movement.velocity)
                .normalize(speed - budget);
        return;
    }
    movement.turnBack = true;
    movement.accelerating = 0;
    const reverse = movement.velocity.angle.add(Math.PI);
    if (Math.abs(movement.rotation.distanceTo(reverse).angle) < 0.4) {
        movement.accelerating = 1;
    }
}

/** π/4: half-angle of the front quadrant (see frontQuadrant reading). */
const FRONT_QUADRANT_HALF_ANGLE = Math.PI / 4;

/**
 * Whether `target` lies in the ship's FRONT QUADRANT: within ±45° of
 * the ship's facing — the 90° cone centered on its heading. This is
 * the same reading fire_weapon_plugin's getQuadrant uses to aim
 * frontQuadrant-guidance weapons (and the natural reading of the
 * original game's front-quadrant turrets, which can only track targets
 * ahead of the ship).
 */
export function inFrontQuadrant(movement: MovementState,
    targetPosition: { x: number, y: number }): boolean {
    const toTarget = new Vector(targetPosition.x - movement.position.x,
        targetPosition.y - movement.position.y);
    if (toTarget.lengthSquared < 1e-12) {
        return true;
    }
    const misalignment = Angle.fromAngleLike(movement.rotation)
        .distanceTo(toTarget.angle).angle;
    return Math.abs(misalignment) < FRONT_QUADRANT_HALF_ANGLE;
}

/**
 * The reach of a front-quadrant turret's shots: projectile speed times
 * lifetime (the same math point-defense range uses).
 */
export function frontQuadrantWeaponRange(
    weapon: ProjectileWeaponData): number {
    return weapon.physics.speed * weapon.shotDuration / 1000;
}

/**
 * Executes each escort's current command every tick: steering, firing,
 * command completion, and the formation-time front-quadrant-turret
 * rule. Formation STATION-KEEPING itself stays in FormationSystem
 * (which yields to this system for non-formation commands).
 */
export const EscortCommandBehaviorSystem = new System({
    name: 'EscortCommandBehavior',
    args: [EscortCommandComponent, MovementStateComponent,
        ShipPhysicsComponent, WeaponsStateComponent, TargetComponent,
        UUID, GetEntity, Entities, HostileCandidatesQuery, TimeResource,
        SimulationGameDataResource, Optional(EscortLandingComponent),
        Optional(JumpComponent), Optional(DisabledComponent)] as const,
    step(command, movement, physics, weapons, target, uuid, entity,
        entities, candidates, time, gameData, landing, jump, disabled) {
        if (disabled) {
            // A hulk drifts and does not shoot. Same reasoning as the jump
            // bail below and as FormationSystem's disabled bail: steerHold
            // nudges velocity DIRECTLY, so DisabledMovementSystem running
            // afterwards cannot undo it, and the latched `firing` flags
            // have to be cleared on the way out.
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
            return;
        }
        if (landing) {
            // Following the player down to a planet: EscortLandingSystem
            // owns the steering, and an escort on final approach holds
            // its fire.
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
            return;
        }
        if (jump) {
            // Warping out with the player (player_escort_plugin):
            // JumpSequenceSystem owns the steering until the ship leaves,
            // and a ship spinning up its hyperdrive holds its fire. Bailing
            // rather than relying on JumpSequenceSystem to overwrite the
            // steering afterwards, for two reasons: an ordered escort's
            // `firing` flags are latched state this system rewrites every
            // tick (an early return without this would freeze them on),
            // and steerHold nudges velocity directly, which no later
            // override erases.
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
            return;
        }
        const ceaseFire = () => {
            for (const [, weapon] of weapons) {
                weapon.firing = false;
            }
        };
        const fireAt = (victim: string) => {
            const victimMovement = entities.get(victim)?.components
                .get(MovementStateComponent);
            const distanceSquared = victimMovement === undefined
                ? Infinity
                : victimMovement.position.subtract(movement.position)
                    .lengthSquared;
            const inRange =
                distanceSquared <= ESCORT_FIRE_RANGE * ESCORT_FIRE_RANGE;
            for (const [id, weapon] of weapons) {
                const weaponData = gameData.data.Weapon.getCached(id);
                if (weaponData == null
                    || weaponData.type === 'BayWeaponData') {
                    continue;
                }
                weapon.target = victim;
                // The flat ESCORT_FIRE_RANGE is fine for a weapon whose
                // wasted shot costs a round of ammo. A SUICIDE weapon
                // (wëap AmmoType -999) spends the ship, so it is held
                // until the shot can actually connect — see
                // weapon_range.ts.
                weapon.firing = inRange
                    && suicideWeaponInReachState(weapon, distanceSquared);
            }
        };
        const root = escortParent(entity);
        const rootEntity = root ? entities.get(root) : undefined;
        const rootGovt = lookupGovt(gameData,
            rootEntity?.components.get(GovtComponent));
        // The owner's legal records: govts hostile to a criminal owner
        // are hostile to the escort's defend/patrol brain too.
        const rootRecords =
            rootEntity?.components.get(LegalRecordsComponent);
        const hostility: EscortHostilityContext = {
            rootGovt, gameData, rootEntity, rootRecords, now: time.time,
            getEntity: (id: string) => entities.get(id),
        };

        switch (command.command) {
            case 'attack': {
                const victim = command.target !== undefined
                    ? entities.get(command.target) : undefined;
                const victimMovement = victim?.components
                    .get(MovementStateComponent);
                if (!victim || !victimMovement
                    || victim.components.has(ExplodingComponent)) {
                    // Destroyed (or exploding — untargetable): back to
                    // formation.
                    entity.components.set(EscortCommandComponent,
                        { command: 'formation' });
                    target.target = undefined;
                    ceaseFire();
                    return;
                }
                target.target = command.target;
                steerAttack(movement, victimMovement,
                    attackStandoff(weapons));
                fireAt(command.target!);
                return;
            }
            case 'defend': {
                // Engagement upkeep. Defend is attack-until-DISABLED:
                // a disabled intruder is no longer a threat, so the
                // engagement ends there (matching the NPC AI's rule),
                // not at destruction.
                //
                // An EXPLODING intruder (its DeathDelay death sequence)
                // is gone too, as in the attack arm above and every
                // other targeting path: keeping it engaged would steer
                // at a fireball and latch `firing` on every fixed gun
                // for up to DeathDelay seconds.
                let engaged = command.target !== undefined
                    ? entities.get(command.target) : undefined;
                if (engaged && (engaged.components.has(DisabledComponent)
                    || engaged.components.has(ExplodingComponent)
                    || !isHostileTo(engaged, command.target!, root ?? uuid,
                        uuid, hostility))) {
                    engaged = undefined;
                }
                if (!engaged) {
                    // Watch for intruders inside the defend bubble
                    // (disabled and exploding ships are not intruders).
                    const nearby: Array<readonly [string, number]> = [];
                    for (const [otherUuid, other, otherMovement]
                        of candidates) {
                        if (otherUuid === uuid || otherUuid === root
                            || other.components.has(DisabledComponent)
                            || other.components.has(ExplodingComponent)) {
                            continue;
                        }
                        const distanceSquared = otherMovement.position
                            .subtract(movement.position).lengthSquared;
                        if (distanceSquared
                            > DEFEND_RADIUS * DEFEND_RADIUS) {
                            continue;
                        }
                        if (isHostileTo(other, otherUuid, root ?? uuid,
                            uuid, hostility)) {
                            nearby.push([otherUuid, distanceSquared]);
                        }
                    }
                    const chosen = chooseNearest(nearby);
                    command.target = chosen;
                    engaged = chosen ? entities.get(chosen) : undefined;
                }
                const engagedMovement = engaged?.components
                    .get(MovementStateComponent);
                if (!engaged || !engagedMovement) {
                    // Nothing to fight: FormationSystem keeps station;
                    // turrets stay opportunistic below.
                    command.target = undefined;
                    target.target = undefined;
                    break;
                }
                target.target = command.target;
                steerAttack(movement, engagedMovement,
                    attackStandoff(weapons));
                fireAt(command.target!);
                return;
            }
            case 'holdPosition': {
                steerHold(movement, physics.acceleration, time.delta_s);
                ceaseFire();
                return;
            }
            case 'returnToBay': {
                if (!entity.components.has(ReturnWhenTargetRemovedComponent)) {
                    // Not bay-launched: just fall back into formation.
                    entity.components.set(EscortCommandComponent,
                        { command: 'formation' });
                    ceaseFire();
                    return;
                }
                if (!entity.components.has(FormationComponent)) {
                    // Already flying home (startReturnHome ran).
                    return;
                }
                entity.components.delete(FormationComponent);
                startReturnHome(entity);
                ceaseFire();
                return;
            }
            case 'formation':
                break;
        }

        // --- Formation (and defend-with-no-intruder): the front-
        // quadrant-turret rule. Faithful to the original game's odd
        // behavior: while flying formation, ONLY front-quadrant-turret
        // weapons (wëap guidance 'frontQuadrant' — no other weapon
        // type, not even full turrets) opportunistically fire at
        // iff-hostile ships in range, and only while the hostile is in
        // the ship's front quadrant (±45° of its facing; see
        // inFrontQuadrant). The player's restrictTurretsToTarget order
        // narrows candidates to their current target.
        const orders = rootEntity?.components.get(EscortOrdersComponent);
        // This escort's OWN ship class, for its shïp-level turret blind
        // spots (the root's are irrelevant — the turrets are here).
        const shipData = entity.components.get(ShipDataComponent);
        const restrictTo = orders?.restrictTurretsToTarget
            ? rootEntity?.components.get(TargetComponent)?.target
            : undefined;
        for (const [id, weapon] of weapons) {
            const weaponData = gameData.data.Weapon.getCached(id);
            if (weaponData?.type !== 'ProjectileWeaponData'
                || weaponData.guidance !== 'frontQuadrant') {
                weapon.firing = false;
                continue;
            }
            const range = frontQuadrantWeaponRange(weaponData);
            const inReach: Array<readonly [string, number]> = [];
            for (const [otherUuid, other, otherMovement] of candidates) {
                if (otherUuid === uuid || otherUuid === root
                    // Disabled and exploding ships aren't valid attack
                    // targets.
                    || other.components.has(DisabledComponent)
                    || other.components.has(ExplodingComponent)) {
                    continue;
                }
                if (orders?.restrictTurretsToTarget
                    && otherUuid !== restrictTo) {
                    continue;
                }
                const distanceSquared = otherMovement.position
                    .subtract(movement.position).lengthSquared;
                if (distanceSquared > range * range) {
                    continue;
                }
                if (!inFrontQuadrant(movement, otherMovement.position)) {
                    continue;
                }
                // Turret blind spots. A candidate this turret would be
                // refused permission to shoot at (fire_weapon_plugin
                // would return undefined) must not be CHOSEN here
                // either, or the escort latches `firing` on a target it
                // cannot engage and ignores one it could. Vacuous on
                // the stock data — nothing gives a front-quadrant
                // weapon or a ship a front blind spot — but it keeps
                // the two halves reading the same rule.
                if (blindSpotBlocksFiring({
                    guidance: weaponData.guidance,
                    weaponBlindSpots: weaponData.turretBlindSpots,
                    shipBlindSpots: shipData?.turretBlindSpots,
                    sourcePosition: movement.position,
                    sourceRotation: movement.rotation,
                    targetPosition: otherMovement.position,
                })) {
                    continue;
                }
                if (isHostileTo(other, otherUuid, root ?? uuid, uuid,
                    hostility)) {
                    inReach.push([otherUuid, distanceSquared]);
                }
            }
            const chosen = chooseNearest(inReach);
            weapon.target = chosen ?? weapon.target;
            weapon.firing = chosen !== undefined;
        }
    },
    after: [TimeSystem, EscortCommandPropagationSystem, NpcWingCommandSystem],
    // NpcPlunderBoardSystem is a #237 pin (shared: *).
    before: [MovementSystem, NpcPlunderBoardSystem],
});

export const EscortCommandPlugin: Plugin = {
    name: 'EscortCommandPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(EscortCommandComponent, EscortCommandState);
        serializer?.addComponent(EscortOrdersComponent, EscortOrders);
        world.addSystem(EscortCommandInputSystem);
        world.addSystem(EscortCommandPropagationSystem);
        world.addSystem(NpcWingCommandSystem);
        world.addSystem(EscortCommandBehaviorSystem);
    },
};
