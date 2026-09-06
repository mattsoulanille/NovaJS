import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { AggressionComponent, isRecentAggressor } from './aggression.js';
import { CloakActiveComponent, CloakScannerComponent, isTargetable } from './cloak_plugin.js';
import { ExplodingComponent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { OwnerComponent } from './weapon_components.js';
import { isInFlock } from './flock.js';
import { GovtComponent } from './govt_component.js';
import { shipDisposition, TargetCornerStyle, targetCornerStyle } from './iff_plugin.js';
import { isPacifiedToward, NpcComponent } from './npc_ai_plugin.js';
import { EscortCommandComponent } from './escort_command.js';
import { ShootAllWeaponsComponent } from './npc_plugin.js';
import { LegalRecordsComponent } from './reputation_plugin.js';
import { AggressionSuppressGovtsComponent } from './ncb_plugin.js';
import { ranksSuppressAggression } from './rank_logic.js';
import { ShipComponent } from './ship_plugin.js';
import { TargetComponent } from './target_component.js';

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
 *    selectNearestHostile).
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
 *  4. Political: shipDisposition(target govt, player govt, records) —
 *     hostile and friendly map to their corner sets.
 *  5. Everything else: neutral.
 *
 * `now` is the SIMULATION clock in milliseconds (tier 3b compares
 * against sim timestamps). Display callers must pass
 * SimulationTimeResource, NOT the display world's wall-clock
 * TimeResource.
 *
 * Planets use their own corner instance (planet_corners_plugin) and are
 * unaffected.
 */
export function styleForTarget(targetUuid: string, targetEntity: Entity,
    playerUuid: string, playerEntity: Entity,
    gameData: SimulationGameDataInterface,
    getEntity: (uuid: string) => Entity | undefined,
    now: number): TargetCornerStyle {
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

    const targetsPlayer = targetEntity.components
        .get(TargetComponent)?.target === playerUuid;
    const npcMode = targetEntity.components.get(NpcComponent)?.mode;
    // Another player's ESCORT engaging us — ordered onto us with 'f'
    // (command 'attack') or holding its leader's perimeter against us
    // (command 'defend') — is attacking us in every sense that matters,
    // even before its first shot lands (which is when tier 3b would
    // catch it). Escorts fly on the escort command, not on NpcComponent
    // mode 'attack', so the posture reads from EscortCommandComponent;
    // both commands point TargetComponent at the victim. Matthew: "when
    // an escort is attacking another player (due to 'f' or due to
    // defending), it should be IFF hostile from that player's
    // perspective."
    const escortCommand = targetEntity.components
        .get(EscortCommandComponent)?.command;
    const escortEngaging = escortCommand === 'attack'
        || escortCommand === 'defend';
    const attackingPlayer = (targetsPlayer && (npcMode === 'attack'
        || escortEngaging
        || targetEntity.components.has(ShootAllWeaponsComponent)))
        // Tier 3b: what this ship has actually done to us lately.
        || isRecentAggressor(playerEntity.components.get(AggressionComponent),
            targetUuid, now);

    // The player's legal records (delta-synced): a govt the player is
    // criminal with shows hostile corners, same rule as the sim.
    const playerRecords = playerEntity.components.get(LegalRecordsComponent);
    return targetCornerStyle(
        shipDisposition(targetGovt, playerGovt, playerRecords,
            // ränk 0x0100, read off the BAKED synced set rather than the
            // ränk table: the simulation shares this predicate and its
            // worker never loads Rank data (see rank_logic.ts).
            ranksSuppressAggression(playerEntity.components
                .get(AggressionSuppressGovtsComponent), targetGovt?.id)),
        attackingPlayer);
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
    return styleForTarget(targetUuid, targetEntity, ctx.viewerUuid,
        ctx.viewerEntity, ctx.gameData,
        uuid => entityFrom(ctx.entities, uuid), ctx.now) === 'hostile';
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
