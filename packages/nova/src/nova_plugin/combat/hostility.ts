import { Entity } from 'nova_ecs/entity';
import { GovtData } from 'novadatainterface/govt_data';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { CloakActiveComponent, CloakScannerComponent, isTargetable } from '../ship/index.js';
import { ExplodingComponent } from '../ship/index.js';
import { DisabledComponent } from '../ship/index.js';
import { OwnerComponent } from '../ship/index.js';
import { attacksOnSight, isAttackingPlayer, isInFlock, onSightAiType } from '../npc/index.js';
import { GovtComponent } from '../core/index.js';
import {
    Disposition, govtDisposition, LegalRecords, LocalLaw, localLawIn,
    TargetCornerStyle, targetCornerStyle,
} from '../reputation/index.js';
import { isPacifiedToward, NpcComponent } from '../npc/index.js';
import { LegalRecordsComponent } from '../reputation/index.js';
import { AggressionSuppressGovtsComponent } from '../ncb/index.js';
import { ranksSuppressAggression } from '../ncb/index.js';
import { ShipComponent } from '../ship/index.js';
import { TargetComponent } from '../ship/index.js';

/**
 * Tier 3 on its own (isAttackingPlayer) lives in npc/allegiance.ts, beside
 * the flock walk, because the NPC decision step needs it too (a protecting
 * special ship engages whoever is attacking its player); re-exported here,
 * where the rest of the rule is.
 */
export { isAttackingPlayer } from '../npc/index.js';

/**
 * ============================================================================
 * The one hostility rule
 * ============================================================================
 *
 * `styleForTarget` below is THE answer to "how does this ship stand
 * toward me", and everything that needs that answer quotes it rather
 * than re-deriving it:
 *
 *  - the target corner brackets (display/target_corners_plugin),
 *  - the first-hostile cue (display/ui_sound_triggers_plugin),
 *  - the nearest-hostile scan behind the 'r' key (selectNearestHostile
 *    here, called by the simulation's ChooseTargetSystem), and
 *  - the "can't do that" beep when 'r' finds nothing
 *    (display/ui_sound_triggers_plugin again, through the same
 *    selectNearestHostile), and
 *  - the comm channel (isIffHostile: the hail dialog's Status line and
 *    Beg For Mercy offer, and the simulation's applyHail verdict — ruling
 *    #297), plus tier 3 alone (isAttackingPlayer) for the ship-offer gates,
 *  - and the brain of an NPC in the player's flock (a mïsn ShipBehav 1
 *    "protect the player" special ship): NpcDecisionSystem never counts
 *    the player or their flock as a hostile (tier 2, the same isInFlock
 *    walk) and does count whoever is attacking them (tier 3,
 *    isAttackingPlayer), so a ship the corners paint friendly is never one
 *    that hunts the player.
 *
 * so 'r' provably targets exactly the ships the corners paint red, and
 * the beep provably fires exactly when 'r' does nothing.
 *
 * It lives here, in nova_plugin, rather than in the display package it
 * grew up in, precisely because the simulation now needs it too: a
 * display module is not importable from the sim worker.
 *
 * Everything it reads is synced, serializer-registered simulation state
 * (GovtComponent, NpcComponent, TargetComponent, LegalRecordsComponent,
 * AggressionComponent, AggressionSuppressGovtsComponent, the
 * Formation/Owner/FiringGroup chain the flock walk follows, the legacy
 * ShootAllWeapons marker), so the display world and every peer's
 * simulation reach the same verdict.
 *
 * The one game-data read left is Govt, which entity staging warms on
 * every peer before the entity is inserted (entity_data_loader.ts). Rank
 * is NOT staged, which is exactly why the 0x0100 privilege is baked into
 * a synced component instead of being looked up here.
 */

/**
 * Which corner-bracket set (TargetCornersData.images key) a targeted
 * SHIP gets, from `player`'s point of view. THE HOSTILITY RULE, in
 * priority order:
 *
 *  1. DISABLED: a disabled ship (DisabledComponent) shows the gray
 *     'disabled' corner set (cicn 10020-10023) regardless of iff or
 *     politics — dead in space trumps every allegiance.
 *  2. OWN FLOCK: hired escorts, idle bay fighters, and anything
 *     transitively following them (see flock.ts) always show the
 *     friendly corners, ahead of every political/behavioral tier: your
 *     own ships are yours regardless of government.
 *  2b. BOUGHT OFF: a ship this player has bribed to leave them alone
 *     (beg for mercy — NpcComponent.pacifiedFrom/pacifiedUntil, set by
 *     hail_plugin's applyHail) reads NEUTRAL to the briber, ahead of both
 *     the behavioral and the political tiers, for as long as the reprieve
 *     runs. Matthew: "when an NPC accepts a beg-for-mercy bribe, its IFF
 *     should become neutral again so PD weapons don't shoot at it and
 *     anger it again." That is not cosmetic — the point defense prey
 *     filter (point_defense.ts) shoots hostile fighters, so a pirate that
 *     stayed red after taking the money was hosed down by the player's own
 *     turrets, which voided the reprieve (NpcDecisionSystem drops
 *     pacifiedFrom the moment the briber damages it) and restarted the
 *     fight the bribe had just bought off. The political tier alone can
 *     never clear it: a pirate government is hostile by its flags forever.
 *     It is per-briber, so only the ship that paid sees the change; every
 *     other pilot still sees a pirate.
 *  3. Behavioral: a ship that is *currently attacking the player* shows
 *     hostile corners regardless of politics — a brave trader fighting
 *     the player back, or a neutral-govt warship the player provoked,
 *     is hostile in every sense that matters to the pilot. Two
 *     independent readings feed this tier:
 *       (a) NPC posture, derived from synced state: the target's own
 *           TargetComponent points at the player AND its AI is in an
 *           attacking posture (NpcComponent mode 'attack', or the
 *           legacy dev-enemy ShootAllWeapons marker). A ship merely
 *           *fleeing* the player keeps its political corners.
 *       (b) RECENT AGGRESSION against the player (aggression.ts): it
 *           shot us, or locked a guided missile on us, within the last
 *           30 seconds. This is the only tier that can reach ANOTHER
 *           PLAYER's ship, which has neither a government nor an NPC
 *           brain, and it is also what keeps an attacker red for a
 *           moment after it breaks its lock instead of flickering
 *           neutral between volleys.
 *       (c) FIGHTING BACK AGAINST THE PLAYER'S FLOCK
 *           (isFightingPlayerFlock): in mode 'attack' against a ship of
 *           the player's flock that it recorded as its aggressor — a
 *           trader the player's escort shot, now shooting the escort.
 *           An NPC hit by a player's escort goes after the escort, not
 *           the player (npc_targeting.ts's responsibleShip), and the
 *           original paints it red all the same (reference "A trader shot
 *           by the player's escort, wave 12").
 *  4. Political: onSightDisposition below — hostile when the ship would
 *     attack the player ON SIGHT (a warship or interceptor of a govt
 *     hostile to them; NOT a trader of one), friendly when its govt is
 *     allied with the player's.
 *  5. Everything else: neutral.
 *
 * `now` is the SIMULATION clock in milliseconds (tier 3b compares
 * against sim timestamps). Display callers must pass
 * SimulationTimeResource, NOT the display world's wall-clock
 * TimeResource.
 *
 * `systemId` is the system both ships are in (the world's
 * SystemIdResource): tier 4's criminal-record test is the law of THAT
 * system (reference A14, ruling #376, reputation/local_law.ts).
 *
 * Planets use their own corner instance (planet_corners_plugin) and are
 * unaffected.
 */
export function styleForTarget(targetUuid: string, targetEntity: Entity,
    playerUuid: string, playerEntity: Entity,
    gameData: SimulationGameDataInterface,
    getEntity: (uuid: string) => Entity | undefined,
    now: number, systemId: string | undefined): TargetCornerStyle {
    // Disabled beats everything, own flock included: gray corners mean
    // "dead in space" whoever the hulk belongs to.
    if (targetEntity.components.has(DisabledComponent)) {
        return targetCornerStyle('neutral', false, true);
    }
    if (isInFlock(targetUuid, playerUuid, getEntity)) {
        return 'friendly';
    }
    // Bought off (beg for mercy): neutral to the briber until the reprieve
    // lapses, ahead of both the behavioral and the political tiers — see
    // tier 2b above. Not 'friendly': the money buys indifference, not an
    // ally, and the ship goes back to hostile the moment it lapses or the
    // player shoots it (NpcDecisionSystem clears pacifiedFrom on damage from
    // the briber, which flips this tier straight back off).
    if (isPacifiedToward(targetEntity.components.get(NpcComponent),
        playerUuid, now)) {
        return targetCornerStyle('neutral', false);
    }
    const govtId = targetEntity.components.get(GovtComponent)?.id;
    // Display-side getCached: a cold cache shows neutral corners for a
    // tick or two while the govt data loads.
    const targetGovt = govtId
        ? gameData.data.Govt.getCached(govtId) : undefined;
    const playerGovtId = playerEntity.components.get(GovtComponent)?.id;
    const playerGovt = playerGovtId
        ? gameData.data.Govt.getCached(playerGovtId) : undefined;

    // Tier 3: (a) and (b) are isAttackingPlayer, (c) the flock reading.
    const attackingPlayer = isAttackingPlayer(targetUuid, targetEntity,
        playerUuid, playerEntity, now)
        || isFightingPlayerFlock(targetEntity, playerUuid, getEntity);

    // The player's legal records (delta-synced): a criminal record in
    // THIS system makes the hunters of every govt that enforces its law
    // hostile, same rule as the sim (reference A14).
    const playerRecords = playerEntity.components.get(LegalRecordsComponent);
    return targetCornerStyle(
        onSightDisposition(targetUuid, targetEntity, targetGovt, playerGovt,
            playerRecords, localLawIn(gameData, systemId),
            // ränk 0x0100, read off the BAKED synced set rather than the
            // ränk table: the simulation shares this predicate and its
            // worker never loads Rank data (see rank_logic.ts).
            ranksSuppressAggression(playerEntity.components
                .get(AggressionSuppressGovtsComponent), targetGovt?.id),
            getEntity),
        attackingPlayer);
}

/**
 * TIER 3c OF THE HOSTILITY RULE: whether `targetEntity` is fighting back
 * against a ship of `playerUuid`'s flock that attacked it — NPC mode
 * 'attack', its TargetComponent on a flock member (isInFlock), and that
 * member its recorded aggressor (NpcComponent.aggressor).
 *
 * A ship hit by a player's escort records the ESCORT as its aggressor and
 * goes after it (npc_targeting.ts's responsibleShip; reference "A trader
 * shot by the player's escort, wave 12": the trader fought the escort and
 * never fired at the player), yet the original paints its corners red to
 * the player throughout. The aggressor test keeps it to that case: a ship
 * merely attacking the player's escort of its own accord is the escort's
 * business, not the owner's corners' (escort_hostility_agreement_test,
 * "ATTACKING THE ESCORT ITSELF").
 *
 * Pure over synced state. The escort brains' isHostileTo reads it too.
 */
export function isFightingPlayerFlock(targetEntity: Entity,
    playerUuid: string,
    getEntity: (uuid: string) => Entity | undefined): boolean {
    const npc = targetEntity.components.get(NpcComponent);
    const target = targetEntity.components.get(TargetComponent)?.target;
    return npc?.mode === 'attack' && target !== undefined
        && npc.aggressor === target
        && isInFlock(target, playerUuid, getEntity);
}

/**
 * TIER 4 OF THE HOSTILITY RULE: how a ship that is not attacking the
 * player right now stands toward them — HOSTILE when it would attack them
 * on sight, not when its government merely dislikes them.
 *
 *  - 'hostile': the ship's NPC brain hunts the player on sight
 *    (on_sight.ts's attacksOnSight: a warship or interceptor whose
 *    government counts the player as an enemy, by gövt enemies classes,
 *    the xenophobic or always-attacks flags, or a criminal record in the
 *    system `law` governs, when that government enforces it). It is
 *    the SAME call NpcDecisionSystem makes to build its hostiles list, so
 *    the brackets cannot paint red a ship the brain leaves alone, or the
 *    other way round.
 *  - 'friendly': the ship's government is allied with the player's
 *    (govtDispositionTo 'ally': the same govt, or Ally classes naming one
 *    of the player's).
 *  - 'neutral': everything else, INCLUDING a trader (AI 1/2) of a
 *    government that is hostile to the player. Reference K9 and Matthew's
 *    ruling (2026-11-23): "IFF bracket colors correspond to hostility
 *    regardless of govt's stance". On the original, AI 1 traders of an
 *    always-attacks govt, and of a govt the player is criminal with, show
 *    yellow brackets while that govt's warships show red. A trader that
 *    does turn on the player (a provoked AI 2) goes red through the
 *    behavioural tier, which is checked first.
 *
 * The AI type is the ship's own, or its flock root's for a bay fighter,
 * which has no brain of its own (on_sight.ts's onSightAiType).
 *
 * The government's stance on its own — what decides whether its ships
 * talk to the player, offer missions or come to help — is still
 * iff_plugin's shipDisposition; this is only the IFF's reading of it.
 */
export function onSightDisposition(targetUuid: string, targetEntity: Entity,
    targetGovt: GovtData | undefined, playerGovt: GovtData | undefined,
    playerRecords: LegalRecords | undefined, law: LocalLaw,
    rankSuppressesAggression: boolean,
    getEntity: (uuid: string) => Entity | undefined): Disposition {
    if (attacksOnSight(onSightAiType(targetUuid, targetEntity, getEntity),
        targetGovt, playerGovt, playerRecords, law,
        rankSuppressesAggression)) {
        return 'hostile';
    }
    return govtDisposition(targetGovt, playerGovt) === 'ally'
        ? 'friendly' : 'neutral';
}

/**
 * "IS THIS SHIP IFF-HOSTILE TO THE PLAYER?" — exactly when
 * {@link styleForTarget} paints the corners red. The comm channel asks this
 * question too (Matthew's ruling on #297: "Hostility in the hailing channel
 * should reflect the iff of that ship, not the government stance"), so the
 * hail dialog's Status: Hostile line and Beg For Mercy offer, and the
 * simulation's applyHail verdict, can never disagree with the brackets
 * around the same ship.
 *
 * It is deliberately NOT the government stance alone: a disabled hulk reads
 * 'disabled', a ship the player has bought off reads neutral to its briber,
 * and the player's own flock reads friendly, however hostile their
 * governments are.
 */
export function isIffHostile(targetUuid: string, targetEntity: Entity,
    playerUuid: string, playerEntity: Entity,
    gameData: SimulationGameDataInterface,
    getEntity: (uuid: string) => Entity | undefined,
    now: number, systemId: string | undefined): boolean {
    return styleForTarget(targetUuid, targetEntity, playerUuid, playerEntity,
        gameData, getEntity, now, systemId) === 'hostile';
}

/** Everything selectNearestHostile needs to make its choice. */
export interface HostileScanContext {
    /** The ship doing the looking (the one pressing 'r'). */
    viewerUuid: string;
    viewerEntity: Entity;
    /** Every entity in the system, in any order. */
    entities: Iterable<readonly [string, Entity]>;
    gameData: SimulationGameDataInterface;
    /** The SIMULATION clock, in milliseconds. */
    now: number;
    /** The system the scan runs in (its world's SystemIdResource): whose
     * law decides a criminal record (styleForTarget's `systemId`). */
    systemId: string | undefined;
}

/**
 * Whether `targetUuid` is a ship the viewer would call hostile — the
 * corner rule above, read as a boolean.
 *
 * Note what this excludes by construction, and deliberately: a DISABLED
 * ship reads 'disabled', not 'hostile', so a hulk is never "the nearest
 * hostile" however bloodthirsty it was a moment ago. That matches the
 * corners (gray), the NPC AI (which drops disabled ships as targets),
 * and common sense.
 */
export function isHostileTarget(targetUuid: string, targetEntity: Entity,
    ctx: HostileScanContext): boolean {
    return isIffHostile(targetUuid, targetEntity, ctx.viewerUuid,
        ctx.viewerEntity, ctx.gameData,
        uuid => entityFrom(ctx.entities, uuid), ctx.now, ctx.systemId);
}

/**
 * Entity lookup over the scan's entity collection. An `Iterable` of
 * pairs is the common denominator between the simulation's EntityMap and
 * the display world's, and both of those ARE Maps, so take the fast path
 * when one is handed to us.
 */
function entityFrom(entities: Iterable<readonly [string, Entity]>,
    uuid: string): Entity | undefined {
    if (entities instanceof Map) {
        return entities.get(uuid);
    }
    for (const [candidate, entity] of entities) {
        if (candidate === uuid) {
            return entity;
        }
    }
    return undefined;
}

/**
 * THE 'r' KEY: the nearest ship the viewer would call hostile, or
 * undefined when there is none.
 *
 * Pure over synced simulation state, so the simulation's retarget and
 * the display's "can't do that" beep can both call it and cannot
 * disagree about whether the key had anything to do.
 *
 * The filters are exactly the ones the general (tab / r) target cycle
 * has always applied, plus hostility:
 *  - never yourself;
 *  - ships only (planets have their own target slot);
 *  - not your own flock — owned fighters and transitive escorts are
 *    cycled by escortTarget instead — UNLESS the flock member is
 *    disabled and so back in the normal cycle (which the hostility
 *    filter then rejects anyway; the check is kept so the two scans
 *    stay literally the same shape);
 *  - not cloaked, unless the viewer's cloak scanner can target through
 *    it;
 *  - not already in its death sequence (ExplodingComponent);
 *  - hostile, per styleForTarget.
 *
 * DETERMINISM. The scan reads the entity map, whose iteration order
 * differs between a peer that built it by insertion and one restored
 * from a wire snapshot, so the result must not depend on that order: it
 * doesn't, because ties on exactly equal squared distance break toward
 * the lexicographically smaller uuid (the same rule chooseNearest uses
 * for NPC target selection). No PRNG is involved.
 */
export function selectNearestHostile(
    ctx: HostileScanContext): string | undefined {
    const viewerMovement =
        ctx.viewerEntity.components.get(MovementStateComponent);
    if (!viewerMovement) {
        return undefined;
    }
    const myScanner = ctx.viewerEntity.components.get(CloakScannerComponent);
    const getEntity = (uuid: string) => entityFrom(ctx.entities, uuid);

    let best: string | undefined;
    let bestDistance = Infinity;
    for (const [uuid, entity] of ctx.entities) {
        if (uuid === ctx.viewerUuid) {
            continue;
        }
        const components = entity.components;
        if (!components.has(ShipComponent)) {
            continue;
        }
        const movement = components.get(MovementStateComponent);
        if (!movement) {
            continue;
        }
        // The viewer's own flock is hidden from the normal cycle, except
        // when dead in space (then it rejoins so it can be boarded and
        // repaired).
        if (!components.has(DisabledComponent)
            && (components.get(OwnerComponent)?.owner === ctx.viewerUuid
                || isInFlock(uuid, ctx.viewerUuid, getEntity))) {
            continue;
        }
        if (!isTargetable(components.get(CloakActiveComponent), myScanner)) {
            continue;
        }
        if (components.has(ExplodingComponent)) {
            continue;
        }
        if (!isHostileTarget(uuid, entity, ctx)) {
            continue;
        }
        const distance = movement.position
            .subtract(viewerMovement.position).lengthSquared;
        if (distance < bestDistance
            || (distance === bestDistance && best !== undefined
                && uuid < best)) {
            best = uuid;
            bestDistance = distance;
        }
    }
    return best;
}
