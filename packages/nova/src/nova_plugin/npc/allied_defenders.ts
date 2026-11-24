import { Entity } from 'nova_ecs/entity';
import { GovtData } from 'novadatainterface/govt_data';
import { GovtComponent } from '../core/index.js';
import { alliedEitherWay } from '../reputation/index.js';
import { flockPlayer, sameFlock } from './allegiance.js';
import { PoliceCandidate } from './piracy_police.js';

/**
 * ============================================================================
 * Allied defenders: warships that join a fight on the side of a ship of
 * their own or an allied govt
 * ============================================================================
 *
 * Measured on the original (docs/reference_experiments.md, "P1 wave 16:
 * who answers a distress call ..."): an anchored AI 1 victim of gövt 343
 * attacked by a raider of gövt 328 (which lists 343 as an enemy), with ONE
 * candidate ship at the spaceport 160-300 px from the fight:
 *
 *  - an AI 3 of 343 itself (the victim's OWN govt) fought the raider at
 *    once: by 17 s the raider's shield was at 50%, gone by 45 s;
 *  - an AI 3 of 317, ALLIED to 343 and with no relation to 328, joined
 *    about 20-25 s after the raider's first shots and destroyed its
 *    shield;
 *  - an AI 3 of an unrelated govt left the system; an unrelated, non-nosy
 *    AI 4 patrolled round the port; a nosy AI 4 police in its own system
 *    flew round the fight taking stray hits: none of them ever fired at
 *    the raider ("NPC raiders are not policed", piracy_police.ts);
 *  - no distress call was involved (the victims were mission ships, which
 *    never call, distress.ts): the help comes from the alliance, call or
 *    no call.
 *
 * And ("P1 wave 17: ... an AI 4 ally defends"): an AI 4 of the same allied
 * 317, at the same port, was already fighting the raider at the first
 * look, 10 s after take-off (raider 76%, the ally 84%), and destroyed it
 * within two minutes.
 *
 * So, when an NPC is ATTACKED (npc_targeting.ts's provoke rule) by a ship
 * that is NOT on a player's side, every warship (AI 3) and interceptor
 * (AI 4) of the victim's own govt in the system takes the attacker as its
 * aggressor at once; so does every interceptor of a govt allied with the
 * victim's (local_law.ts's alliedEitherWay, either direction), and every
 * warship of one once the victim has been under that attacker for
 * ALLIED_DEFENCE_DELAY_MS (alliedDefenceDelay). Their fleet escorts follow
 * them, as for a hit on them (provokeFleet).
 *
 * Never a defender: a ship of the ATTACKER's own govt or one allied with it
 * (it would be choosing between two friends), a ship in the attacker's
 * flock, a ship under an escort command (its brain is the escort
 * framework), a ship in a player's flock (a protector follows its player),
 * a disabled ship, and the victim and attacker themselves. A victim with no
 * govt has no defenders.
 *
 * GUESSES (unmeasured; docs/npc_behavior_gaps.md):
 *  - INTERCEPTORS (AI 4) of the victim's OWN govt defend too (an allied
 *    govt's AI 4 was measured, wave 17; the own govt's was not);
 *  - an allied AI 4 joins AT ONCE: measured only "within 10 s" (the first
 *    look); an allied AI 3 after 20 s. One run each, so whether the two
 *    delays differ by rule (an interceptor watches, as the piracy police
 *    do; a warship hunts) or by chance is open;
 *  - NO RANGE: the candidates sat 160-300 px from the fight, so how far a
 *    warship notices is unknown; the whole system is the conservative
 *    reading of "the alliance rule";
 *  - the own govt joins at once and an allied warship after a delay: ONE
 *    run each; whether the delay is a rule, the ally's think rate, or
 *    chance is open;
 *  - only NPC attackers: a PLAYER's attack on an own-govt or allied ship is
 *    left to the piracy police (AI 4, piracy_police.ts) and the legal
 *    record (A14), as before; whether AI 3s of the victim's govt join
 *    against the player was not part of this measurement.
 */

/**
 * How long a victim must have been under the same attacker before WARSHIPS
 * (AI 3) OF AN ALLIED GOVT join (the victim's own govt's join at once).
 * The reference AI 3 ally joined about 20-25 s after the raider's first
 * shots; the low end, from one run ("P1 wave 16").
 */
export const ALLIED_DEFENCE_DELAY_MS = 20_000;

/** Which AI types defend a ship of their own or an allied govt: warships
 * and interceptors (an allied one of each measured, waves 16-17). Traders
 * flee rather than fight. */
export const DEFENDER_AI_TYPES: readonly number[] = [3, 4];

/**
 * How long a victim must have been under its attacker before an ALLIED
 * govt's ship of AI type `aiType` joins: ALLIED_DEFENCE_DELAY_MS for a
 * warship (AI 3, "P1 wave 16": 20-25 s), none for an interceptor (AI 4,
 * "P1 wave 17": already fighting at the first look, 10 s in; "at once"
 * is the GUESS inside that bound). The victim's own govt's ships join at
 * once whatever their type.
 */
export function alliedDefenceDelay(aiType: number): number {
    return aiType === 4 ? 0 : ALLIED_DEFENCE_DELAY_MS;
}

/**
 * The uuids of the warships that take `attacker` as their aggressor for
 * its attack on `victim` (see the module comment). `attacker` is the ship
 * the victim recorded (npc_targeting.ts's responsibleShip) and must NOT be
 * on a player's side; the caller checks that. `attackedFor` is how long
 * (sim ms) the victim has been under this attacker (NpcState's
 * `aggressorSince`).
 *
 * Reads synced components and game data only, and the answer is a set
 * (the caller writes the same value to each), so iteration order changes
 * nothing.
 */
export function alliedDefenders(victim: string, attacker: string,
    victimGovt: GovtData | undefined, attackedFor: number,
    getEntity: (uuid: string) => Entity | undefined,
    candidates: Iterable<PoliceCandidate>,
    getGovt: (id: string) => GovtData | undefined): string[] {
    if (!victimGovt) {
        return [];
    }
    const attackerGovtId = getEntity(attacker)?.components
        .get(GovtComponent)?.id;
    const attackerGovt = attackerGovtId ? getGovt(attackerGovtId) : undefined;
    const defenders: string[] = [];
    for (const [npc, uuid, , govt, escortCommand, disabled] of candidates) {
        if (!DEFENDER_AI_TYPES.includes(npc.aiType)
            || uuid === victim || uuid === attacker
            || escortCommand !== undefined || disabled !== undefined
            || govt === undefined) {
            continue;
        }
        const own = govt.id === victimGovt.id;
        if (!own && attackedFor < alliedDefenceDelay(npc.aiType)) {
            continue;
        }
        const defenderGovt = getGovt(govt.id);
        if (!defenderGovt || !alliedEitherWay(defenderGovt, victimGovt)
            || (attackerGovt && alliedEitherWay(defenderGovt, attackerGovt))
            || sameFlock(uuid, attacker, getEntity)
            || flockPlayer(uuid, getEntity) !== undefined) {
            continue;
        }
        defenders.push(uuid);
    }
    return defenders;
}
