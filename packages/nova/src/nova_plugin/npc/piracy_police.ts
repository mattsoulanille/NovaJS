import { Entity } from 'nova_ecs/entity';
import { Position } from 'nova_ecs/datatypes/position';
import { GovtData } from 'novadatainterface/govt_data';
import { GovtComponent } from '../core/index.js';
import { alliedEitherWay, govtDisposition } from '../reputation/index.js';
import { flockPlayer } from './allegiance.js';
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
 *  5. The WATCH RANGE is the WHOLE SYSTEM: nosy police anchored 300 and
 *     2500 px (wave 16), 5000 and 9000 px (wave 17) from the victim and the
 *     player all turned hostile at once.
 *  6. NPC raiders are NOT policed: a nosy police in its own system flew
 *     round a raider attacking a non-enemy trader and never fired (wave
 *     16). The victim's own and allied warships do join such a fight
 *     (allied_defenders.ts), but that is the alliance, not policing.
 *  7. Shooting a ship of an always-hostile govt (gövt 0x0004) that had NOT
 *     fired at the player (it stood off about 500 px) is still piracy: the
 *     nosy police turned hostile (wave 16, one run).
 *  8. So is shooting one that HAD fired first: a 0x0004 ship hit the
 *     player once (1200 damage) and stayed hostile, its gun reloading; the
 *     player beamed it 72 s later and the nosy police 300 px off turned
 *     hostile at once (wave 17, one take).
 *  9. And so is shooting one that is FIRING ON THE PLAYER AT THAT MOMENT:
 *     a 0x0004 pest put a bolt into the strip between them every 1.2 s,
 *     the last about 1 s before the player's beam, and the nosy police
 *     turned hostile all the same (wave 18, "P1 / H1 wave 18", one run).
 *     So there is NO self-defence exemption for the player at all: the
 *     police react to any hit on a victim they defend, whatever the
 *     victim is doing to the player.
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
 *  - only FIRING counts: an attempt to board was never seen to provoke
 *    (wave 13's board drew nothing from non-nosy police; nosy police were
 *    not tested with a board);
 *  - every hit that provokes the victim provokes the witnesses, stray
 *    player-side hits included (the victim's own rule);
 *  - the player's ESCORT has no self-defence exemption either (finding 9
 *    measured the player only): an escort firing back at a hostile that
 *    is shooting at it is policed like the player. Chosen because the
 *    original's police evidently do not look at what the victim is doing
 *    at all, an escort is the player's own side (its fire is attributed
 *    and policed through the same responsibleShip path), and one rule for
 *    every player-side attacker is the simplest that fits;
 *  - a ONE-WAY alliance counts for 3 (local_law.ts's alliedEitherWay, the
 *    A14 enforcement rule), and gövt 0x0020 does not shield a victim from
 *    its OWN govt's police (the Bible's "non-allied"; the ally's police
 *    was measured in wave 15, the own govt's was not).
 */

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
 * disabled ship. No range: an interceptor anywhere in the system sees it
 * (finding 5). No self-defence excuse (finding 9): what the victim is
 * doing to the attacker does not matter.
 *
 * Reads synced components and game data only, and the answer is a set (the
 * caller writes the same value to each), so iteration order changes
 * nothing.
 */
export function piracyWitnesses(victim: string, attacker: string,
    getEntity: (uuid: string) => Entity | undefined,
    candidates: Iterable<PoliceCandidate>,
    getGovt: (id: string) => GovtData | undefined,
    victimGovt: GovtData | undefined): string[] {
    const attackerEntity = getEntity(attacker);
    if (!attackerEntity) {
        return [];
    }
    const attackerGovtId = attackerEntity.components.get(GovtComponent)?.id;
    const attackerGovt = attackerGovtId ? getGovt(attackerGovtId) : undefined;
    const witnesses: string[] = [];
    for (const [npc, uuid, , govt, escortCommand, disabled] of candidates) {
        if (npc.aiType !== 4 || uuid === victim || uuid === attacker
            || escortCommand !== undefined || disabled !== undefined
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
