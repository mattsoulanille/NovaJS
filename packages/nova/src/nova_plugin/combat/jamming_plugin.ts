import * as t from 'io-ts';
import { JammingStrengths } from 'novadatainterface/outfit_data';
import { SeekerFlags, JammingVulnerabilities } from 'novadatainterface/weapon_data';
import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Position } from 'nova_ecs/datatypes/position';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Optional } from 'nova_ecs/optional';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../core/index.js';
import { registerEntityDeriver } from '../core/index.js';
import { Govt, GovtComponent } from '../core/index.js';
import { OutfitsState, OutfitsStateComponent } from '../ship/index.js';
import { ProjectileDataComponent } from '../core/index.js';
import { ProvideFromCache } from '../core/index.js';
import { OwnerComponent, SourceComponent } from '../ship/index.js';
import { TargetComponent } from '../ship/index.js';
import { DisableCreditSystem } from '../reputation/index.js';

/**
 * ============================================================================
 * Missile jamming (measured against the original; see docs/
 * reference_experiments.md, "J-series wave 3: how jamming decides a
 * missile's fate")
 * ============================================================================
 *
 * Bible fields (all plumbed through the data layer):
 *  - wëap JamVuln1-4: a guided weapon's vulnerability to each of the four
 *    jamming types (0-100%). "Ignored if the weapon is not a guided weapon."
 *  - oütf ModTypes 33-36 ("Jamming Type 1-4"): jamming strength an outfit
 *    gives its ship (percent).
 *  - gövt InhJam1-4: a government's inherent jamming. Parsed, but NOT applied:
 *    the reference measured no effect (see deriveJamming).
 *  - sÿst Interference: system sensor static (0-100), which additionally
 *    degrades radar-guided missiles (Seeker flag 0x0008, confusedByInterference).
 *  - Seeker flags: turnsAwayIfJammed (0x0010), attackParentIfJammed (0x8000),
 *    decoyedByAsteroids (0x0002), confusedByInterference (0x0008).
 *
 * THE MODEL (what the original does, measured over ~1850 missiles):
 *
 *  1. ONE decision per guided missile, made the first tick it has a target
 *     (in practice the tick it is launched), and PERMANENT for its life. The
 *     loss share does not grow with flight time and a jammed missile never
 *     re-acquires.
 *  2. Per jamming type k, with J_k the target's effective jamming and V_k the
 *     missile's JamVuln (both 0-100), and r_k a fresh uniform [0, 1) draw:
 *         jammed_k  iff  J_k > (100 - V_k) + r_k * V_k
 *     i.e. the missile resists with 100 - V plus a random share of V, so
 *         P_k = clamp((J_k - (100 - V_k)) / V_k, 0, 1)
 *     (V 100: P = J; V 50: 0 up to J 50, 1 at J 100). V_k = 0 never jams.
 *     The missile is jammed if any type jams it.
 *  3. A jammed plain missile flies dead straight along its heading at the
 *     decision (its launch heading); a turnsAwayIfJammed one steers directly
 *     away from its target. attackParentIfJammed / decoyedByAsteroids missiles
 *     retarget with the reaction roll's odds (ATTACK_PARENT_IF_JAMMED_PROBABILITY,
 *     DECOY_RETARGET_PROBABILITY), decided at the same moment, and otherwise
 *     fall back to veer/straight. A retargeted missile then tracks its new
 *     target with no further roll.
 *
 * The decision lives in JamDecisionComponent, which is serializer-registered:
 * it rides in snapshots, the wire and the desync hash, so a rollback replays it
 * rather than re-rolling it.
 */

/**
 * Given a jammed missile, the probability that a missile whose Seeker flag
 * makes it *eligible* for a special retarget reaction actually takes it
 * (instead of falling through to veer/fly-straight).
 * JUDGMENT CALL: the Bible gives no rate (its only hint is the word "may" in
 * "May attack parent ship if jammed") and the reference left the parent half
 * unmeasured; 10% is an eyeballed starting point. Tune freely.
 */
export const ATTACK_PARENT_IF_JAMMED_PROBABILITY = 0.1;
/** See ATTACK_PARENT_IF_JAMMED_PROBABILITY. */
export const DECOY_RETARGET_PROBABILITY = 0.1;

/**
 * A ship's jamming strength for each of the four jamming types, derived from
 * its outfits (oütf ModTypes 33-36): per type, the LARGEST single outfit's
 * value (see deriveJamming). Clamped to be non-negative when applied against
 * missiles.
 *
 * Ordered [type1, type2, type3, type4] to match weapon JamVulnerabilities.
 */
export const Jamming = t.tuple([t.number, t.number, t.number, t.number]);
export type Jamming = t.TypeOf<typeof Jamming>;
export const JammingComponent = new Component<Jamming>('JammingComponent');

/**
 * The current system's inherent sensor interference (0-100), read from
 * SystemData.interference. Set once at world construction (make_system.ts) so it
 * is identical for every peer in a room, satisfying rollback determinism.
 */
export const SystemInterferenceResource =
    new Resource<{ interference: number }>('SystemInterference');

/**
 * Decoy hook for the asteroid agent (and any other distraction source).
 *
 * Attach this component to any entity that a jammed, `decoyedByAsteroids`
 * missile may be lured onto. The entity MUST also carry a
 * MovementStateComponent (so the missile has a position to steer toward). When
 * a missile loses lock and its weapon has the `decoyedByAsteroids` seeker flag,
 * the retarget system may switch the missile's TargetComponent to a nearby
 * decoy instead of applying the veer/straight-fly behaviour.
 *
 * `weight` biases selection: higher-weight decoys are more attractive. Use 1
 * for a plain decoy. (Asteroids can set this to model bigger rocks being more
 * distracting; leave it at 1 if you don't care.)
 *
 * CONTRACT FOR THE ASTEROID AGENT: to make asteroids able to distract jammed
 * missiles, attach `DecoyTargetComponent` (e.g. `{ weight: 1 }`) plus a
 * `MovementStateComponent` to each asteroid entity. No other wiring is needed;
 * this plugin discovers decoys by querying for the component.
 */
export const DecoyTargetComponent =
    new Component<{ weight: number }>('DecoyTargetComponent');

/**
 * The radius within which a jammed, decoy-vulnerable missile can be distracted
 * onto a decoy. JUDGMENT CALL: the Bible does not specify a range, so we use a
 * generous fixed radius in world units. Kept as a named constant so it is easy
 * to tune or make data-driven later.
 */
export const DECOY_DISTRACTION_RANGE = 1000;
const DECOY_DISTRACTION_RANGE_SQUARED =
    DECOY_DISTRACTION_RANGE * DECOY_DISTRACTION_RANGE;

/** The index of the radar jamming type (0-based) in the 4-tuple. */
export const RADAR_JAM_INDEX = 1;

/**
 * Derives a ship's jamming from its outfits (oütf ModTypes 33-36): per type,
 * the LARGEST value any single outfit gives, not the sum. The reference found
 * one, two, three or four +25 jammers on a hull all acting as 25, while one
 * +100 jammer acted as 100 ("Jammer outfits on a hull do not add up"; the
 * "count is ignored" alternative fits the data equally). An outfit's count
 * does not matter, and with no positive outfit a type stays at 0.
 *
 * gövt InhJam1-4 is deliberately NOT applied: a target of an InhJam1 100
 * government jammed nothing in the reference (0 of 149 missiles). What InhJam
 * actually does is open; see the "J leftovers" row of the pending table in
 * docs/reference_experiments.md. The field is still parsed (GovtData.inhJam).
 *
 * Pure and deterministic; returns a fresh 4-tuple. Returns undefined (retry
 * next step, matching deriveWeaponsState) if any outfit is not yet in the
 * game-data cache.
 */
export function deriveJamming(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): Jamming | undefined {
    const strongest: [number, number, number, number] = [0, 0, 0, 0];
    for (const [id, state] of outfits) {
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            // Not loaded yet; retry next step (matches deriveWeaponsState).
            return undefined;
        }
        if (!(state.count > 0)) {
            continue;
        }
        for (let i = 0; i < 4; i++) {
            strongest[i] = Math.max(strongest[i], outfit.jamming[i] ?? 0);
        }
    }
    return strongest;
}

/**
 * Computes the effective jamming strength (0-100 per type) a missile
 * experiences, combining the target ship's jamming with system interference for
 * radar-guided missiles. Pure; does not roll.
 */
export function effectiveJamming(
    targetJamming: JammingStrengths | Jamming | undefined,
    seeker: SeekerFlags,
    systemInterference: number): [number, number, number, number] {
    const jam: [number, number, number, number] = [
        Math.max(0, targetJamming?.[0] ?? 0),
        Math.max(0, targetJamming?.[1] ?? 0),
        Math.max(0, targetJamming?.[2] ?? 0),
        Math.max(0, targetJamming?.[3] ?? 0),
    ];
    // Radar-guided missiles flagged confusedByInterference are additionally
    // degraded by the system's inherent sensor static, as a radar-type
    // contribution. (Judgment call #3: the Bible ties interference to the radar
    // display and to this seeker flag but doesn't give a formula, so we fold it
    // in as extra radar jamming.)
    if (seeker.confusedByInterference) {
        jam[RADAR_JAM_INDEX] += Math.max(0, systemInterference);
    }
    for (let i = 0; i < 4; i++) {
        jam[i] = Math.min(100, jam[i]);
    }
    return jam;
}

/** Clamps a jamming or vulnerability value into 0-100 (NaN -> 0). */
function percent(value: number | undefined): number {
    const v = value ?? 0;
    return v > 0 ? Math.min(100, v) : 0;
}

/**
 * Whether ONE jamming type jams a missile, given its vulnerability V and the
 * effective jamming J it faces (both 0-100), and `roll`, a fresh uniform
 * [0, 1) draw from the deterministic PRNG:
 *     jammed  iff  J > (100 - V) + roll * V
 * V = 0 never jams (the missile resists with a full 100). Pure.
 */
export function jamTypeRollJams(vulnerability: number, jamming: number,
    roll: number): boolean {
    const v = percent(vulnerability);
    if (v <= 0) {
        return false;
    }
    return percent(jamming) > (100 - v) + roll * v;
}

/**
 * The probability that one jamming type jams a missile: jamTypeRollJams over
 * a uniform roll, P = clamp((J - (100 - V)) / V, 0, 1). V = 0 gives 0. The
 * measured anchors: V 100 gives P = J (J 25 -> 0.25, J 100 -> 1); V 50 gives
 * 0 for J <= 50, 0.5 at J 75 and 1 at J 100. Pure; does not roll.
 */
export function jamTypeProbability(vulnerability: number,
    jamming: number): number {
    const v = percent(vulnerability);
    if (v <= 0) {
        return 0;
    }
    return Math.max(0, Math.min(1, (percent(jamming) - (100 - v)) / v));
}

/**
 * The chance a missile is jammed at its one decision, all four types
 * together: the types roll independently, so 1 - Π(1 - P_k). Pure; for tests
 * and tooling (the sim rolls each type with jamTypeRollJams).
 */
export function missileJamProbability(
    vulnerabilities: JammingVulnerabilities,
    effectiveJam: readonly [number, number, number, number]): number {
    let keep = 1;
    for (let i = 0; i < 4; i++) {
        keep *= 1 - jamTypeProbability(vulnerabilities[i] ?? 0,
            effectiveJam[i] ?? 0);
    }
    return 1 - keep;
}

/**
 * Rolls a missile's one jam decision across the four types: jammed if any
 * type jams it. `rolls` holds one fresh [0, 1) draw per type, always all four
 * (see MissileJammingSystem for why the draw count never depends on the
 * jamming). Pure.
 */
export function rollMissileJammed(vulnerabilities: JammingVulnerabilities,
    effectiveJam: readonly [number, number, number, number],
    rolls: readonly [number, number, number, number]): boolean {
    let jammed = false;
    for (let i = 0; i < 4; i++) {
        if (jamTypeRollJams(vulnerabilities[i] ?? 0, effectiveJam[i] ?? 0,
            rolls[i])) {
            jammed = true;
        }
    }
    return jammed;
}

/**
 * How a missile reacts to its jam decision. Returned by the pure decision
 * helper so it can be unit-tested without an ECS world.
 */
export type JamReaction =
    | { kind: 'none' }                       // not jammed: tracks its target
    | { kind: 'retargetParent' }             // attackParentIfJammed
    | { kind: 'retargetDecoy' }              // decoyedByAsteroids (caller finds decoy)
    | { kind: 'veerAway' }                   // turnsAwayIfJammed
    | { kind: 'flyStraight' };               // default jammed behaviour

/**
 * Decides, deterministically, how a missile reacts to its jam decision.
 * `reactionRoll` must be a fresh draw from the deterministic PRNG in [0, 1).
 *
 * The retargeting flags gate on `reactionRoll`: each eligible retarget owns its
 * own slice of the unit interval (parent first, then decoy), so with both flags
 * set the outcomes are ATTACK_PARENT_IF_JAMMED_PROBABILITY parent,
 * DECOY_RETARGET_PROBABILITY decoy, remainder veer/straight -- and setting one
 * flag never changes the other's odds. When no retarget slice is hit, the
 * precedence is turnsAwayIfJammed > flyStraight.
 * (The caller is responsible for finding a decoy for `retargetDecoy`; if none is
 * nearby it falls back to veer/straight, so decoy vulnerability never makes a
 * missile *more* accurate.)
 */
export function decideJamReaction(jammed: boolean, reactionRoll: number,
    seeker: SeekerFlags): JamReaction {
    if (!jammed) {
        return { kind: 'none' };
    }
    let threshold = 0;
    if (seeker.attackParentIfJammed) {
        threshold += ATTACK_PARENT_IF_JAMMED_PROBABILITY;
        if (reactionRoll < threshold) {
            return { kind: 'retargetParent' };
        }
    }
    if (seeker.decoyedByAsteroids) {
        threshold += DECOY_RETARGET_PROBABILITY;
        if (reactionRoll < threshold) {
            return { kind: 'retargetDecoy' };
        }
    }
    if (seeker.turnsAwayIfJammed) {
        return { kind: 'veerAway' };
    }
    return { kind: 'flyStraight' };
}

/**
 * Finds the best decoy entity within range of a position, deterministically.
 * "Best" = highest weight, ties broken by smallest distance, then by uuid for a
 * total order (so resimulation always picks the same decoy). Returns the decoy
 * uuid or undefined.
 */
export function findNearestDecoy(entities: Iterable<[string, Entity]>,
    from: Position): string | undefined {
    let bestId: string | undefined;
    let bestWeight = -Infinity;
    let bestDistSq = Infinity;
    for (const [id, entity] of entities) {
        const decoy = entity.components.get(DecoyTargetComponent);
        if (!decoy) {
            continue;
        }
        const movement = entity.components.get(MovementStateComponent);
        if (!movement) {
            continue;
        }
        // Position.subtract wraps around the toroidal ±BOUNDARY world, so this
        // is the true shortest-path distance (matching how point defense picks
        // its nearest target).
        const distSq = movement.position.subtract(from).lengthSquared;
        if (distSq > DECOY_DISTRACTION_RANGE_SQUARED) {
            continue;
        }
        const weight = decoy.weight;
        const better = weight > bestWeight
            || (weight === bestWeight && distSq < bestDistSq)
            || (weight === bestWeight && distSq === bestDistSq
                && (bestId === undefined || id < bestId));
        if (better) {
            bestId = id;
            bestWeight = weight;
            bestDistSq = distSq;
        }
    }
    return bestId;
}

/**
 * A guided missile's one, permanent jam decision (see the model at the top of
 * this file), consumed by ProjectileGuidanceSystem every tick:
 * - `track`: not jammed (or retargeted onto its parent or a decoy): steer at
 *   the current TargetComponent as usual.
 * - `flyStraight`: jammed; never steer again, keep the heading it had at the
 *   decision (its launch heading).
 * - `veerAway`: jammed turnsAwayIfJammed missile; steer directly away from its
 *   target for the rest of its life.
 *
 * Its presence is also the "already decided" mark: MissileJammingSystem rolls
 * only for a guided missile that has a target and no decision yet. It is
 * serializer-registered (JammingPlugin), so snapshots, wire snapshots and the
 * desync hash carry it and a rollback replays the decision instead of
 * re-rolling it.
 */
export const JamDecision = t.type({
    steer: t.keyof({ track: null, flyStraight: null, veerAway: null }),
});
export type JamDecision = t.TypeOf<typeof JamDecision>;
export type JamSteer = JamDecision['steer'];
export const JamDecisionComponent =
    new Component<JamDecision>('JamDecisionComponent');

/**
 * Live provider: keeps a ship's JammingComponent in sync as its outfits change.
 * Mirrors OutfitWeaponProvider in outfit_plugin.ts.
 */
const JammingProvider = ProvideFromCache({
    name: 'JammingProvider',
    provided: JammingComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: (outfits, gameData) => deriveJamming(outfits, gameData),
    // #237 pin (shared: *): JammingPlugin registers after ReputationPlugin
    // (and the debug cheats, which order after it).
    after: [DisableCreditSystem],
});

/**
 * Makes each guided missile's one jam decision. Runs before
 * ProjectileGuidanceSystem, and after WeaponsSystem and the submunition
 * spawners, so a missile is decided on the tick it is launched, before guidance
 * has turned it at all: a jammed plain missile keeps its launch heading.
 *
 * A missile is decided the first tick it is guided, has a target and has no
 * JamDecisionComponent yet: normally its launch tick, or the tick it first
 * acquires a target. Never again after that.
 *
 * Deterministic: every decision draws exactly five numbers from the room's
 * PRNG (one per jamming type, then the reaction roll), whatever the jamming
 * and vulnerabilities, in the ECS's stable system-iteration order (the same
 * pattern as weapon inaccuracy). A fixed count keeps the stream independent of
 * jamming state: adding or removing a jammer never shifts another missile's
 * rolls.
 */
export const MissileJammingSystem = new System({
    name: 'MissileJammingSystem',
    args: [MovementStateComponent, TargetComponent, ProjectileDataComponent,
        Optional(JamDecisionComponent), GetEntity, UUID, Entities,
        RandomResource, SystemInterferenceResource] as const,
    // No longer reads the clock; TimeSystem stays in `after` so the system
    // order is unchanged. JammingProvider is a #237 pin (shared: *).
    after: [TimeSystem, JammingProvider],
    step(movement, targetRef, projectileData, decision, self, uuid, entities,
        random, systemInterference) {
        // Decided once, for life: no re-roll and no re-acquisition.
        if (decision) {
            return;
        }
        // Only guided missiles with a target can be jammed. Vulnerabilities are
        // "ignored if the weapon is not a guided weapon" (Bible).
        if (projectileData.guidance !== 'guided') {
            return;
        }
        const target = targetRef.target;
        if (!target) {
            return;
        }
        const seeker = projectileData.seeker;

        const targetEntity = entities.get(target);
        const targetJamming = targetEntity?.components.get(JammingComponent);
        const effJam = effectiveJamming(targetJamming, seeker,
            systemInterference.interference);

        // Always five draws, in a fixed order (see the system doc).
        const rolls: [number, number, number, number] = [
            random.next(), random.next(), random.next(), random.next(),
        ];
        const reactionRoll = random.next();

        const jammed = rollMissileJammed(projectileData.jamVulnerabilities,
            effJam, rolls);
        const reaction = decideJamReaction(jammed, reactionRoll, seeker);
        self.components.set(JamDecisionComponent, {
            steer: applyJamReaction(reaction, self, uuid, movement, entities),
        });
    },
});

/**
 * Carries out a missile's reaction: retargets it if the reaction says so, and
 * returns how guidance should steer it from now on. Kept separate so the
 * decision stays pure and testable.
 */
export function applyJamReaction(reaction: JamReaction, self: Entity,
    uuid: string, movement: { position: Position },
    entities: EntityMap): JamSteer {
    switch (reaction.kind) {
        case 'none':
            return 'track';
        case 'retargetParent': {
            const source = self.components.get(SourceComponent);
            const owner = self.components.get(OwnerComponent)?.owner;
            const parent = source ?? owner;
            if (parent && parent !== uuid) {
                self.components.set(TargetComponent, { target: parent });
                return 'track';
            }
            return 'veerAway';
        }
        case 'retargetDecoy': {
            const decoy = findNearestDecoy(entities, movement.position);
            if (decoy) {
                self.components.set(TargetComponent, { target: decoy });
                return 'track';
            }
            // No decoy in range: don't reward the missile with better aim.
            return 'veerAway';
        }
        case 'veerAway':
            return 'veerAway';
        case 'flyStraight':
            return 'flyStraight';
    }
}

export const JammingPlugin: Plugin = {
    name: 'JammingPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(JammingComponent);
        deltaMaker.addComponent(JammingComponent, {
            componentType: Jamming,
        });

        // A ship's government. Registered for the delta/serializer so it
        // replicates and survives snapshots; it's a plain { id } object, so
        // the default codec/snapshot policy suffice. It no longer feeds
        // jamming (gövt InhJam is not applied, see deriveJamming), but it
        // stays registered here: many systems read it and this is where it
        // has always been registered.
        world.addComponent(GovtComponent);
        deltaMaker.addComponent(GovtComponent, {
            componentType: Govt,
        });

        // A guided missile's one jam decision: real simulation state, so the
        // serializer carries it in snapshots, wire snapshots and the desync
        // hash (registered like ProjectileComponent, without a delta).
        world.addComponent(JamDecisionComponent);
        world.resources.get(SerializerResource)?.addComponent(
            JamDecisionComponent, JamDecision);

        // Default to no interference; make_system.ts overrides this with the
        // current system's SystemData.interference. Defaulting here keeps the
        // MissileJammingSystem's required resource satisfied in any world that
        // installs this plugin (e.g. unit-test worlds).
        if (!world.resources.has(SystemInterferenceResource)) {
            world.resources.set(SystemInterferenceResource, { interference: 0 });
        }

        // Re-derive a ship's jamming from its outfits at completeEntity /
        // snapshot restore (mirrors WeaponsStateDeriver).
        registerEntityDeriver(world, {
            name: 'JammingDeriver',
            provided: JammingComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveJamming(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });
        world.addSystem(JammingProvider);
        world.addSystem(MissileJammingSystem);
    }
};
