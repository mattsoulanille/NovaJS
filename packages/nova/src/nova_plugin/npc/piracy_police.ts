import { Entity } from 'nova_ecs/entity';
import { Position } from 'nova_ecs/datatypes/position';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { GovtData } from 'novadatainterface/govt_data';
import { GovtComponent } from '../core/index.js';
import { alliedEitherWay, govtDisposition } from '../reputation/index.js';
import { flockPlayer, isAttackingPlayer } from './allegiance.js';
import { NpcState } from './npc_component.js';

/**
 * ============================================================================
 * Piracy police: AI 4s that turn on a player attacking somebody else
 * ============================================================================
 *
 * The Bible's AI 4 "will attack any ship that fires on or attempts to board
 * another, non-enemy ship while the interceptor is watching" (B:868-871).
 * Measured on the original (docs/reference_experiments.md, "P1 wave 13",
 * "P1 wave 14" and "P1 wave 15"):
 *
 *  1. Police of a NOSY govt (gövt Flags 0x0002) turned on the player the
 *     moment the player shot a ship of an UNRELATED govt in front of them
 *     (brackets red, closing and firing), with no record change. Police of
 *     a non-nosy govt watched hits, a kill and a board on such a ship and
 *     did nothing (wave 13).
 *  2. The same nosy police IGNORED an attack on a ship whose govt sets gövt
 *     Flags 0x0020 (the Bible: "Nosy ships of other non-allied governments
 *     ignore ships of this govt that are under attack").
 *  3. NON-nosy police defended a ship of their govt's ALLY (a two-way
 *     alliance in the rig): the player shot it and they turned on him.
 *     They did so too when the ally's govt sets 0x0020 (wave 15): 0x0020
 *     turns away only nosy govts that are NOT allied to the victim.
 *  4. The hostility ended with the visit (yellow again after a landing),
 *     and lasted as long as the visit did: still red after 30 s and 60 s,
 *     gone after a jump out and back (wave 15).
 *
 * So an AI 4 WITNESS takes the attacker as its own aggressor
 * (npc_targeting.ts's NpcAggressionSystem records it as if the witness had
 * been hit) when policeDefendVictim says so. The aggressor record lasts
 * until the attacker leaves the world (lands, jumps out, dies): the
 * decision step forgets an aggressor that is gone, and that is the "until
 * the visit ends" of finding 4.
 *
 * GUESSES (unmeasured; docs/npc_behavior_gaps.md "Piracy police: guesses to
 * measure"):
 *  - the WATCHING range, PIRACY_WATCH_RANGE: the interceptor's engagement
 *    range, around the victim OR the attacker (the reference police sat
 *    within a few hundred px of both);
 *  - only a PLAYER-SIDE attacker (a player's ship or a ship of a player's
 *    flock) is policed. NPC-on-NPC fights (raiders on traders) could not be
 *    separated from the melee in the wave-14 raid watch, so raiders are
 *    left to the ordinary enemy rules;
 *  - only FIRING counts: an attempt to board was never seen to provoke
 *    (wave 13's board drew nothing from non-nosy police; nosy police were
 *    not tested with a board);
 *  - every hit that provokes the victim provokes the witnesses, stray
 *    player-side hits included (the victim's own rule);
 *  - SELF-DEFENCE is not piracy: a victim that is itself attacking the
 *    attacker (allegiance.ts's isAttackingPlayer: in attack posture on it,
 *    or it shot the player within the last 30 s) is a combatant, and no
 *    witness reacts to hits on it;
 *  - a ONE-WAY alliance counts for 3 (local_law.ts's alliedEitherWay, the
 *    A14 enforcement rule), and gövt 0x0020 does not shield a victim from
 *    its OWN govt's police (the Bible's "non-allied"; the ally's police
 *    was measured in wave 15, the own govt's was not).
 */

/**
 * How far an interceptor watches: an attack whose victim or attacker is
 * within this many px of it is seen. GUESS: the interceptor's engagement
 * range (npc_decision.ts's INTERCEPTOR_ENGAGE_RANGE, 1800; a spec pins the
 * two together), the doc's proposal.
 */
export const PIRACY_WATCH_RANGE = 1800;

/**
 * Whether police of govt `police` defend a ship of govt `victim` against an
 * attacker of govt `attacker` (any may be undefined: an independent ship,
 * the player). Pure over game data, so every peer agrees.
 *
 *  - never against an ALLY of their own (or their own govt's ship), the
 *    same alliance test as for the victim;
 *  - always for a ship of their own govt or an ally's (finding 3);
 *  - otherwise only a NOSY govt (0x0002) cares (finding 1), and not for a
 *    victim whose govt sets 0x0020 (finding 2) nor for one it counts as an
 *    ENEMY (the Bible's "non-enemy ship": an enemy's ship it would attack
 *    itself).
 */
export function policeDefendVictim(police: GovtData | undefined,
    victim: GovtData | undefined, attacker: GovtData | undefined): boolean {
    if (!police) {
        return false;
    }
    if (attacker && alliedEitherWay(police, attacker)) {
        return false;
    }
    if (victim && alliedEitherWay(police, victim)) {
        return true;
    }
    if (!police.flags.attacksPlayerIfCriminal) {
        return false;
    }
    if (victim?.flags.ignoredByOtherNosyGovts) {
        return false;
    }
    return govtDisposition(police, victim) !== 'enemy';
}

/** One possible witness: an NPC's synced state as PiracyPoliceQuery reads
 * it (npc_targeting.ts). */
export type PoliceCandidate = readonly [
    npc: NpcState, uuid: string, movement: { readonly position: Position },
    govt: { id: string } | undefined, escortCommand: unknown,
    disabled: unknown,
];

/**
 * The uuids of the AI 4 witnesses that take `attacker` as their aggressor
 * for its attack on `victim` (see the module comment). `attacker` is the
 * ship the victim recorded (npc_targeting.ts's responsibleShip) and must be
 * on a player's side; the caller checks that.
 *
 * Skipped: the victim and the attacker themselves; a ship under an escort
 * command (its brain is the escort framework, not NpcComponent); a ship in
 * a player's flock (a protector follows its player, allegiance.ts); a
 * disabled ship; anything out of PIRACY_WATCH_RANGE of both. Nobody reacts
 * when the victim was itself attacking the attacker (self-defence).
 *
 * Reads synced components and game data only, and the answer is a set (the
 * caller writes the same value to each), so iteration order changes
 * nothing.
 */
export function piracyWitnesses(victim: string, victimEntity: Entity,
    attacker: string, getEntity: (uuid: string) => Entity | undefined,
    candidates: Iterable<PoliceCandidate>,
    getGovt: (id: string) => GovtData | undefined,
    victimGovt: GovtData | undefined, now: number): string[] {
    const attackerEntity = getEntity(attacker);
    if (!attackerEntity
        || isAttackingPlayer(victim, victimEntity, attacker, attackerEntity,
            now)) {
        return [];
    }
    const victimPosition = victimEntity.components
        .get(MovementStateComponent)?.position;
    const attackerPosition = attackerEntity.components
        .get(MovementStateComponent)?.position;
    const attackerGovtId = attackerEntity.components.get(GovtComponent)?.id;
    const attackerGovt = attackerGovtId ? getGovt(attackerGovtId) : undefined;
    const rangeSquared = PIRACY_WATCH_RANGE * PIRACY_WATCH_RANGE;
    const watching = (position: Position) =>
        (victimPosition !== undefined
            && position.subtract(victimPosition).lengthSquared <= rangeSquared)
        || (attackerPosition !== undefined
            && position.subtract(attackerPosition).lengthSquared
            <= rangeSquared);
    const witnesses: string[] = [];
    for (const [npc, uuid, movement, govt, escortCommand, disabled]
        of candidates) {
        if (npc.aiType !== 4 || uuid === victim || uuid === attacker
            || escortCommand !== undefined || disabled !== undefined
            || !watching(movement.position)
            || flockPlayer(uuid, getEntity) !== undefined) {
            continue;
        }
        if (policeDefendVictim(govt ? getGovt(govt.id) : undefined,
            victimGovt, attackerGovt)) {
            witnesses.push(uuid);
        }
    }
    return witnesses;
}
