import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Entity } from 'nova_ecs/entity';
import { ControlledByComponent } from '../player/index.js';

/**
 * ============================================================================
 * Behavioral aggression: who has recently attacked ME
 * ============================================================================
 *
 * The political layers (govt enemies/allies, legal record, the
 * always/never-attacks-player flags — see iff_plugin's shipDisposition)
 * have nothing to say about ANOTHER PLAYER's ship: a player carries no
 * government, so by politics alone every player is forever neutral. The
 * NPC behavioral layer doesn't reach them either — it reads NpcComponent
 * mode 'attack', and a human-flown ship has no NPC brain.
 *
 * So hostility toward a player ship has to be earned by what it DOES.
 * Matthew's rule: "we can consider other player ships hostile if they've
 * done something to us that would make a regular npc hostile, such as
 * fire a missile targeted on us, hit us with any projectile that does
 * damage [while targeting us], or do enough damage to us while not
 * targeting us."
 *
 * That is exactly the NPC provocation set, and it is recorded here in
 * the same shape NPCs use (npc.aggressor), except:
 *
 *  - it is keyed by AGGRESSOR uuid rather than being a single slot, so a
 *    brawl with several ships marks them all; and
 *  - it carries a timestamp, because a player goes back to neutral
 *    "if they haven't done a hostile action in the last 30 seconds"
 *    (Matthew) — see AGGRESSION_WINDOW_MS.
 *
 * WHERE IT LIVES. On the VICTIM, as AggressionComponent: a map from the
 * aggressor's uuid to what that ship has done to us lately. Reading it
 * is then a single map lookup from the viewer's own entity, which is
 * what both the target corners (display) and the nearest-hostile scan
 * (simulation) need.
 *
 * DETERMINISM. Every field is written from simulation events (damage
 * application, guided-missile launch) with the SIM clock, never the wall
 * clock, and the component is serializer-registered so it is hashed for
 * desync detection, captured in rollback snapshots, carried on wire
 * baselines, and mirrored into the display world. Entries are mutated in
 * place (the delta-safe accumulator pattern, cf. consumeAmmo) and the
 * only iteration over the map is the lapse sweep, whose result — the set
 * of surviving keys — does not depend on iteration order.
 */

/**
 * How long an aggressive act keeps its author hostile, in SIM
 * milliseconds. Matthew's spec: "players go back to neutral iff if they
 * haven't done a hostile action in the last 30 seconds." Any of the
 * three triggers restarts the clock.
 */
export const AGGRESSION_WINDOW_MS = 30_000;

/**
 * How much damage a ship that is NOT targeting us has to do to us,
 * within one window, before we call it hostile rather than clumsy
 * (trigger (c)).
 *
 * Rationale: a shot that was aimed at somebody else and caught us in the
 * crossfire should be forgiven, but a ship that keeps hosing us down is
 * attacking us whatever its lock says. 50 points of shield+armor damage
 * is more than any single shot from the light weapons that do most
 * stray-hit damage in Nova (a Space Blaster bolt is in the teens), so
 * one accident never flips a ship hostile; it is also less than two
 * seconds of sustained fire from anything serious, so deliberate
 * spraying flips it almost immediately. It is an ABSOLUTE figure rather
 * than a fraction of the victim's shield+armor pool on purpose: a
 * fraction would make a shuttle paranoid and a carrier oblivious, and
 * "how much have they shot at me" is a fact about the shooter.
 *
 * Because the accumulator is cleared when the pair lapses to neutral
 * (see sweepAggression), this is effectively "50 points within 30
 * seconds", not "50 points ever".
 */
export const AGGRESSION_DAMAGE_THRESHOLD = 50;

export const AggressionEntry = t.type({
    /**
     * Sim time (ms) of this ship's most recent aggressive act against
     * us — a damaging hit, a guided-missile lock, or any hit that fed
     * the damage accumulator. The whole entry lapses (and is deleted)
     * once AGGRESSION_WINDOW_MS has passed since this instant.
     *
     * Note that a SUB-THRESHOLD stray hit refreshes this too. That is
     * deliberate: a ship that keeps clipping us is still shooting at
     * us, so its accumulator should keep running rather than resetting
     * out from under it every 30 seconds. It cannot make a ship hostile
     * on its own — that still takes `hostile` below.
     */
    at: t.number,
    /**
     * Cumulative shield+armor damage this ship has done to us while NOT
     * targeting us, since the entry was (re)created. Compared against
     * AGGRESSION_DAMAGE_THRESHOLD for trigger (c).
     */
    damage: t.number,
    /**
     * Whether one of the three triggers has actually fired. Damage done
     * while targeting us, or a guided missile locked onto us, sets this
     * immediately; stray damage sets it once the accumulator crosses
     * the threshold.
     */
    hostile: t.boolean,
});
export type AggressionEntry = t.TypeOf<typeof AggressionEntry>;

export const AggressionState =
    map(t.string /* aggressor uuid */, AggressionEntry);
export type AggressionState = t.TypeOf<typeof AggressionState>;

/**
 * What ships have recently attacked THIS ship. Absent until something
 * attacks it, and removed again once every entry has lapsed, so ships
 * nobody is shooting at carry no state at all.
 */
export const AggressionComponent =
    new Component<AggressionState>('AggressionComponent');

/**
 * Whether `aggressorUuid` counts as hostile to the owner of `state` at
 * sim time `now`: it tripped a trigger, and it did so within the last
 * AGGRESSION_WINDOW_MS. Pure, total, and safe on an absent component.
 *
 * The comparison is strict (`< AGGRESSION_WINDOW_MS`), so the pair goes
 * neutral at EXACTLY the 30-second boundary — the same instant
 * sweepAggression drops the entry, so the predicate and the stored state
 * can never disagree about which side of the boundary they are on.
 */
export function isRecentAggressor(state: AggressionState | undefined,
    aggressorUuid: string, now: number): boolean {
    const entry = state?.get(aggressorUuid);
    if (!entry || !entry.hostile) {
        return false;
    }
    return now - entry.at < AGGRESSION_WINDOW_MS;
}

/** What a single aggressive act was. */
export interface AggressiveAct {
    /**
     * Shield+armor damage the act delivered to us (0 for a
     * guided-missile lock, which draws no blood but is an act of war
     * all the same).
     */
    damage: number;
    /**
     * Whether the act is hostile on its face — a guided missile locked
     * onto us, or a damaging hit landed while the shooter's own target
     * was us. When false the act only feeds the damage accumulator, and
     * hostility waits for AGGRESSION_DAMAGE_THRESHOLD.
     */
    deliberate: boolean;
}

/**
 * Folds one aggressive act into `state`, in place (the delta-safe
 * accumulator pattern: mutate the existing entry rather than replacing
 * the map). Returns nothing; the caller owns the component.
 *
 * Every act refreshes `at`, which both restarts the 30-second hostility
 * window for an already-hostile ship and keeps a stray-damage entry
 * alive while its accumulator fills.
 */
export function recordAggression(state: AggressionState,
    aggressorUuid: string, now: number, act: AggressiveAct): void {
    const existing = state.get(aggressorUuid);
    const entry = existing ?? { at: now, damage: 0, hostile: false };
    entry.at = now;
    if (act.deliberate) {
        entry.hostile = true;
    } else if (act.damage > 0) {
        entry.damage += act.damage;
        if (entry.damage >= AGGRESSION_DAMAGE_THRESHOLD) {
            entry.hostile = true;
        }
    }
    if (!existing) {
        state.set(aggressorUuid, entry);
    }
}

/**
 * Records an aggressive act against a whole ENTITY, creating its
 * AggressionComponent on first offence. Returns whether anything was
 * recorded.
 *
 * ONLY PLAYER-CONTROLLED SHIPS keep this state (ControlledByComponent,
 * which is synced sim state — the same gate PlayerDeathSystem uses to
 * mean "a player's ship" without touching the peer-local
 * PlayerShipSelector). Two reasons: NPCs already have their own
 * provocation channel in npc.aggressor, which their AI acts on, so
 * tracking it twice for them would be duplication rather than reuse;
 * and the only readers of this component are the target corners and the
 * nearest-hostile scan, both of which ask about the VIEWER's ship, and
 * a viewer is by definition a controlled ship. The result is that ships
 * nobody is flying carry no extra snapshot state at all.
 *
 * Self-harm is ignored (a ship's own blast catching itself).
 */
export function applyAggression(victim: Entity, aggressorUuid: string,
    now: number, act: AggressiveAct): boolean {
    if (!victim.components.has(ControlledByComponent)) {
        return false;
    }
    if (victim.uuid === aggressorUuid) {
        return false;
    }
    let state = victim.components.get(AggressionComponent);
    if (!state) {
        state = new Map();
        victim.components.set(AggressionComponent, state);
    }
    recordAggression(state, aggressorUuid, now, act);
    return true;
}

/**
 * Drops every entry whose last aggressive act is at least
 * AGGRESSION_WINDOW_MS old, and returns whether anything is left.
 *
 * Dropping the entry, rather than just flipping `hostile` off, is what
 * resets the stray-damage accumulator when a pair lapses to neutral —
 * otherwise 49 points of ancient crossfire would lie in wait and let a
 * single stray shot years later flip the shooter hostile instantly.
 * The forgiveness is total: lapsing forgets the whole encounter.
 *
 * Deterministic: which keys survive is a function of their timestamps
 * alone, so map iteration order cannot change the outcome.
 */
export function sweepAggression(state: AggressionState, now: number): boolean {
    for (const [uuid, entry] of [...state]) {
        if (now - entry.at >= AGGRESSION_WINDOW_MS) {
            state.delete(uuid);
        }
    }
    return state.size > 0;
}

/**
 * Drops an entity's whole aggression memory as it is CARRIED INTO A FRESH
 * WORLD — a hyperspace jump, a hypergate or wormhole transit, or a save
 * being restored.
 *
 * WHY THE SWEEP CANNOT DO IT. `at` is a SIM timestamp, and every per-system
 * simulation world runs on its own fixed-timestep clock that starts at ZERO
 * (nova_ecs's useFixedTimestep). An entry stamped at t=500,000 in the system
 * being left is compared, in the system being entered, against a clock that
 * has just restarted — so `now - entry.at` is NEGATIVE and
 * {@link sweepAggression} keeps the entry until the new world has run for as
 * long as the old one did. Until then the player arrives already holding a
 * grudge against uuids that mean nothing in this system (uuids are re-minted
 * across the transition), which shows up as target corners drawn hostile and
 * as `r` retargeting to the wrong ship.
 *
 * Rebasing the timestamps instead was rejected: an aggression entry names an
 * AGGRESSOR BY UUID, and none of those uuids exist in the destination world,
 * so there is nothing left worth keeping. Dropping it is also the same
 * forgiveness rule the lapse already implements — leaving a system by a route
 * you can come back from ends the encounter, exactly as it ends the plunder
 * life segment (boarding_component's clearPlunderRecord).
 *
 * Called from ONE place, through {@link clearCarriedAggressionForTransition}.
 * Idempotent, and free for the overwhelming majority of ships, which carry no
 * component at all.
 */
export function clearCarriedAggression(entity: Entity): void {
    entity.components.delete(AggressionComponent);
}

/**
 * THE GATE: {@link clearCarriedAggression} over everything crossing into a
 * fresh world — the player, and every escort riding along.
 *
 * It has to run at the point where the batch is FINAL, which is NOT where
 * the batch is taken off the client's rosters. A RESTORED SAVE's escorts are
 * decoded later, at the first moment in a session that a serializer exists,
 * and pushed onto the same batch (browser.ts's enterSystem); clearing at the
 * earlier point missed every one of them, so a pilot loaded from disk
 * arrived carrying its escorts' aggression tables — stamped against a world
 * that ended when the game was last quit, and naming uuids that no longer
 * exist. For the first 30 seconds of the new world's clock those escorts
 * read as freshly shot at, which paints hostile corners and sends 'defend'
 * after ships that never touched them.
 *
 * A LANDING is deliberately not a gate: the player lifts off back into the
 * SAME world, whose clock never restarted.
 */
export function clearCarriedAggressionForTransition(player: Entity,
    escorts: Iterable<{ entity: Entity }>): void {
    clearCarriedAggression(player);
    for (const escort of escorts) {
        clearCarriedAggression(escort.entity);
    }
}
