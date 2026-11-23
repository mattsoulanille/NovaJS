import * as t from 'io-ts';
import { JammingStrengths } from 'novadatainterface/outfit_data';
import { SeekerFlags, JammingVulnerabilities, ProjectileWeaponData }
    from 'novadatainterface/weapon_data';
import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EntityMap } from 'nova_ecs/entity_map';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Optional } from 'nova_ecs/optional';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { Random, RandomResource } from 'nova_ecs/plugins/random_plugin';
import { Query } from 'nova_ecs/query';
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
 *  - sÿst Interference: system sensor static (0-100), which confuses
 *    missiles with Seeker flag 0x0008 (confusedByInterference): rule 5.
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
 *     away from its target. An attackParentIfJammed missile retargets its
 *     parent with the reaction roll's odds (ATTACK_PARENT_IF_JAMMED_PROBABILITY),
 *     decided at the same moment, and otherwise falls through to the rules
 *     below. A jammed decoyedByAsteroids missile goes for the nearest rock
 *     ahead of it (the capture cone of rule 4) within
 *     DECOY_DISTRACTION_RANGE, always (the original lost every one of them
 *     to rocks against a full jammer), and flies straight (or veers) only
 *     when there is none. A retargeted missile then tracks its new
 *     target with no further roll.
 *  4. decoyedByAsteroids (Seeker 0x0002) is ALSO its own per-tick check,
 *     independent of jamming ("Asteroids and seeker flags, with and without
 *     jamming (wave 4)"): the first tick an asteroid AHEAD of a guided 0x0002
 *     missile (within ASTEROID_DECOY_CAPTURE_HALF_ANGLE of its heading) is
 *     within ASTEROID_DECOY_CAPTURE_RANGE, and the missile's target is not
 *     an asteroid (tracked or jammed off), the missile retargets onto it for
 *     good. The original lost 65% of unjammed 0x0002 missiles in a 16-rock
 *     field and 33% with 4 rocks, and ignored rocks beside or behind a
 *     missile even 60-85 px away ("Asteroid decoy capture, finer (wave 5)").
 *  5. confusedByInterference (Seeker 0x0008) is a separate decision, made
 *     at the same moment as the jam decision and NOT gated by JamVuln
 *     ("J-series wave 5: sensor interference and attack-parent"): in a
 *     system of Interference I, the missile is confused with probability
 *     interferenceConfusionProbability(I), and a confused missile turns at
 *     its full turn rate in one direction for the rest of its life, flying
 *     in circles. It takes precedence over the jam reaction (the missile's
 *     own sensors fail, whatever the target does). The original confused
 *     68% of JamVuln-0 0x0008 missiles at Interference 100, none at 0, and
 *     the confused ones looped until they expired. Rule 4 still applies: a
 *     circling 0x0002 missile that sweeps a rock into its cone is captured.
 *
 * The decision lives in JamDecisionComponent, which is serializer-registered:
 * it rides in snapshots, the wire and the desync hash, so a rollback replays it
 * rather than re-rolling it.
 */

/**
 * Given a jammed attackParentIfJammed (0x8000) missile, the probability that
 * it actually turns on its parent (instead of falling through to the decoy
 * rule and then veer/fly-straight).
 * JUDGMENT CALL: the Bible gives no rate (its only hint is the word "may" in
 * "May attack parent ship if jammed") and the reference left the parent half
 * unmeasured; 10% is an eyeballed starting point. Tune freely.
 * (Its decoy twin, DECOY_RETARGET_PROBABILITY 0.1, is gone: a jammed
 * decoyedByAsteroids missile now always goes for a rock in range.)
 */
export const ATTACK_PARENT_IF_JAMMED_PROBABILITY = 0.1;

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
 * Attach this component to any entity that a `decoyedByAsteroids` missile may
 * be lured onto. The entity MUST also carry a MovementStateComponent (so the
 * missile has a position to steer toward). A missile whose weapon has the
 * `decoyedByAsteroids` seeker flag switches its TargetComponent to a decoy
 * ahead of it (ASTEROID_DECOY_CAPTURE_HALF_ANGLE) that comes within
 * ASTEROID_DECOY_CAPTURE_RANGE of it, jammed or not; a jammed one goes for
 * the nearest decoy ahead of it within DECOY_DISTRACTION_RANGE at its jam
 * decision instead of applying the veer/straight-fly behaviour.
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

/** Every decoy (asteroid) with a position, for MissileJammingSystem. */
const DecoyQuery = new Query([UUID, DecoyTargetComponent,
    MovementStateComponent] as const, 'DecoyQuery');

/**
 * The radius within which a JAMMED decoy-vulnerable missile goes for a decoy
 * at its jam decision. The reference ("Asteroids and seeker flags ... (wave
 * 4)", finding 2) saw every jammed 0x0002 missile against a full jammer curve
 * onto "a nearby rock" in a 16-rock field, and proposed "no distance limit
 * beyond the field"; it did not measure a range. JUDGMENT CALL: the 1000 px
 * kept from before stands for "the field around the launch point": about a
 * screen and a half, reachable within a missile's life, without sending a
 * missile across the system after a far rock. Only rocks inside the capture
 * cone (ASTEROID_DECOY_CAPTURE_HALF_ANGLE) count, as the wave-5 proposal
 * asks ("keep the jammed case under the same cone"); that part is untested
 * on the original.
 */
export const DECOY_DISTRACTION_RANGE = 1000;

/**
 * The distance (px) at which an asteroid AHEAD of a decoyedByAsteroids
 * (Seeker 0x0002) missile captures it, jammed or not: the first tick such a
 * rock is this close, the missile retargets onto it for good.
 *
 * Measured in docs/reference_experiments.md, "Asteroid decoy capture, finer
 * (wave 5)": one missile at a time, every encounter tracked. Captures came
 * from up to about 190 px (175-197 px dead ahead from the launch point;
 * 100-120 px for mid-flight turns), and the proposal there is "up to about
 * 200 px". 200 keeps every capture seen. Wave 4's "200-260 px" (the 225 used
 * before) came from trails of many missiles in a fast-drifting 16-rock field
 * and could not tell bearing apart.
 *
 * A CERTAINTY within range and cone, as before: wave 5 also saw rocks
 * 150-260 px ahead that did not capture, which fits either a range of
 * 150-200 px with measurement scatter or a per-tick chance, and the
 * experiment could not separate the two. Certainty is the simpler reading.
 */
export const ASTEROID_DECOY_CAPTURE_RANGE = 200;

/**
 * The half-width (radians) of the forward cone in which an asteroid can
 * capture a decoyedByAsteroids missile: the rock's bearing from the missile
 * must be within this of the missile's heading. 25 degrees.
 *
 * Measured ("Asteroid decoy capture, finer (wave 5)"): every capture had its
 * rock within about 20 degrees of the heading; rocks 27-29 degrees off at
 * about 80 px were not captured; five rocks 59-84 px to the side of the
 * launch point (78-107 degrees off) were all ignored, as were rocks just
 * behind it. The proposal there says "about 30 degrees"; 25 sits between
 * the widest capture (20) and the narrowest miss (27), so it fits every
 * measured encounter, where 30 would capture the 27-29 degree misses.
 *
 * The cone is also what makes a captured missile HIT its rock (the original
 * never circled one): a rock within this half-angle of the heading at any
 * distance lies at most r(1 - cos 25deg), about 0.09 r, inside the missile's
 * turning circle of radius r, so even the worst placement is passed within
 * about 10 px for an IR Missile (r about 110 px), inside a rock's hull.
 * Without the cone a rock straight beside the missile, nearer than its
 * turning diameter, could be circled until the missile expired.
 *
 * Exact arithmetic only (no trig at module load): it is compared against
 * Angle differences in the sim, where Math is the deterministic one.
 */
export const ASTEROID_DECOY_CAPTURE_HALF_ANGLE = 25 * Math.PI / 180;

/**
 * FITTED: the probability, per point of sÿst Interference, that a
 * confusedByInterference (Seeker 0x0008) missile is confused at launch
 * (rule 5): P = 0.0068 * I, clamped to [0, 1].
 *
 * A line through the origin fitted to the two points measured in
 * docs/reference_experiments.md, "J-series wave 5: sensor interference and
 * attack-parent": Interference 0 confused none of 48.7 missiles a run, and
 * Interference 100 lost 68% (16 hits of 49.5 launched, so 1 - 16/49.5 =
 * 0.677) with JamVuln 0, so jamming played no part. Only those two levels
 * were measured; the line in between is an assumption (the doc's "about
 * I x 0.7 / 100"). Stock systems run from Interference 1 to 80 (Vellos).
 */
export const INTERFERENCE_CONFUSION_PER_POINT_FITTED = 0.0068;

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
 * experiences from the target ship's jamming: each type clamped into 0-100.
 * System interference is NOT part of it any more (it was folded into the
 * radar type before wave 5); it is its own decision, rule 5. Pure; does not
 * roll.
 */
export function effectiveJamming(
    targetJamming: JammingStrengths | Jamming | undefined,
): [number, number, number, number] {
    return [
        percent(targetJamming?.[0]),
        percent(targetJamming?.[1]),
        percent(targetJamming?.[2]),
        percent(targetJamming?.[3]),
    ];
}

/**
 * The chance that sÿst Interference `interference` confuses a
 * confusedByInterference missile at launch (rule 5):
 * INTERFERENCE_CONFUSION_PER_POINT_FITTED * I, clamped to [0, 1]. Pure.
 */
export function interferenceConfusionProbability(interference: number): number {
    return Math.min(1,
        INTERFERENCE_CONFUSION_PER_POINT_FITTED * percent(interference));
}

/** How a confused missile turns for life (rule 5). Clockwise on screen is
 * MovementState.turning +1 (clock angles grow clockwise). */
export type ConfusedSteer = 'circleClockwise' | 'circleCounterclockwise';

/**
 * A missile's interference decision (rule 5), from `roll`, a fresh uniform
 * [0, 1) draw: confused iff it is confusedByInterference and roll < P; the
 * same roll picks the direction (the lower half of [0, P) clockwise), so the
 * decision takes one draw. JamVuln plays no part. Returns undefined when the
 * missile is not confused. Pure.
 */
export function rollInterferenceConfusion(seeker: SeekerFlags,
    interference: number, roll: number): ConfusedSteer | undefined {
    if (!seeker.confusedByInterference) {
        return undefined;
    }
    const p = interferenceConfusionProbability(interference);
    if (!(roll < p)) {
        return undefined;
    }
    return roll < p / 2 ? 'circleClockwise' : 'circleCounterclockwise';
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
    // decoyedByAsteroids: the caller looks for the nearest decoy ahead within
    // DECOY_DISTRACTION_RANGE and steers by `fallback` if there is none.
    | { kind: 'retargetDecoy', fallback: 'veerAway' | 'flyStraight' }
    | { kind: 'veerAway' }                   // turnsAwayIfJammed
    | { kind: 'flyStraight' };               // default jammed behaviour

/**
 * Decides, deterministically, how a missile reacts to its jam decision.
 * `reactionRoll` must be a fresh draw from the deterministic PRNG in [0, 1).
 *
 * Precedence for a jammed missile:
 *  1. attackParentIfJammed, when `reactionRoll` <
 *     ATTACK_PARENT_IF_JAMMED_PROBABILITY (the roll's only use now);
 *  2. decoyedByAsteroids, always: the caller looks for a rock in range, and
 *     with none the missile takes `fallback`, so decoy vulnerability never
 *     makes a jammed missile *more* accurate;
 *  3. turnsAwayIfJammed > flyStraight.
 */
export function decideJamReaction(jammed: boolean, reactionRoll: number,
    seeker: SeekerFlags): JamReaction {
    if (!jammed) {
        return { kind: 'none' };
    }
    if (seeker.attackParentIfJammed
        && reactionRoll < ATTACK_PARENT_IF_JAMMED_PROBABILITY) {
        return { kind: 'retargetParent' };
    }
    const fallback = seeker.turnsAwayIfJammed ? 'veerAway' : 'flyStraight';
    if (seeker.decoyedByAsteroids) {
        return { kind: 'retargetDecoy', fallback };
    }
    return { kind: fallback };
}

/** A decoy as the decoy query yields it: uuid, its DecoyTargetComponent and
 * its MovementStateComponent. */
export type DecoyCandidate =
    readonly [string, { weight: number }, { position: Position }];

/**
 * A forward field of view: only decoys whose bearing from the searching
 * position is within `halfAngle` (radians) of `heading` qualify.
 */
export interface DecoyCone {
    heading: Angle;
    halfAngle: number;
}

/** The capture cone of a missile heading `heading` (rule 4). */
export function captureCone(heading: Angle): DecoyCone {
    return { heading, halfAngle: ASTEROID_DECOY_CAPTURE_HALF_ANGLE };
}

/**
 * Whether `offset` (decoy position minus searching position) lies within
 * `cone`. A decoy at the very position (zero offset) counts: the missile is
 * already on it. Uses atan2, so call it only in the sim (deterministic Math).
 */
export function inCone(offset: Vector, cone: DecoyCone): boolean {
    if (offset.x === 0 && offset.y === 0) {
        return true;
    }
    return Math.abs(cone.heading.distanceTo(offset.angle).angle)
        <= cone.halfAngle;
}

/**
 * Picks the best decoy within `range` of a position (and, given a `cone`,
 * inside it), deterministically.
 * "Best" = highest weight, ties broken by smallest distance, then by uuid for a
 * total order (so resimulation picks the same decoy whatever order `decoys`
 * comes in). Every asteroid has weight 1, so among rocks this is the nearest.
 * Returns the decoy uuid or undefined.
 */
export function nearestDecoy(decoys: Iterable<DecoyCandidate>,
    from: Position, range: number, cone?: DecoyCone): string | undefined {
    const rangeSq = range * range;
    let bestId: string | undefined;
    let bestWeight = -Infinity;
    let bestDistSq = Infinity;
    for (const [id, decoy, movement] of decoys) {
        // Position.subtract wraps around the toroidal ±BOUNDARY world, so this
        // is the true shortest-path distance (matching how point defense picks
        // its nearest target).
        const offset = movement.position.subtract(from);
        const distSq = offset.lengthSquared;
        if (distSq > rangeSq) {
            continue;
        }
        if (cone && !inCone(offset, cone)) {
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
 * nearestDecoy over a plain entity map (entities with a DecoyTargetComponent
 * and a MovementStateComponent), within `range` (default
 * DECOY_DISTRACTION_RANGE) and `cone` if given. For tests and tooling; the
 * sim iterates its decoy query instead.
 */
export function findNearestDecoy(entities: Iterable<[string, Entity]>,
    from: Position, range = DECOY_DISTRACTION_RANGE,
    cone?: DecoyCone): string | undefined {
    const candidates: DecoyCandidate[] = [];
    for (const [id, entity] of entities) {
        const decoy = entity.components.get(DecoyTargetComponent);
        const movement = entity.components.get(MovementStateComponent);
        if (decoy && movement) {
            candidates.push([id, decoy, movement]);
        }
    }
    return nearestDecoy(candidates, from, range, cone);
}

/**
 * The asteroid that captures a decoyedByAsteroids missile this tick, if any
 * (rule 4 at the top of this file): only while the missile has a target that
 * is not itself a decoy (once on a rock it stays there), and only a decoy
 * ahead of it (within ASTEROID_DECOY_CAPTURE_HALF_ANGLE of `heading`) and
 * within ASTEROID_DECOY_CAPTURE_RANGE. Independent of the jam decision.
 * Pure, given deterministic Math (it takes a bearing).
 */
export function asteroidCapture(seeker: SeekerFlags,
    target: string | undefined, targetIsDecoy: boolean, from: Position,
    heading: Angle, decoys: Iterable<DecoyCandidate>): string | undefined {
    if (!seeker.decoyedByAsteroids || !target || targetIsDecoy) {
        return undefined;
    }
    return nearestDecoy(decoys, from, ASTEROID_DECOY_CAPTURE_RANGE,
        captureCone(heading));
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
 * - `circleClockwise` / `circleCounterclockwise`: confused by sensor
 *   interference (rule 5); turn at the full turn rate in that direction for
 *   the rest of its life, whatever the target.
 * The one later change: an asteroid capture (rule 4) retargets the missile
 * onto the rock and sets `track`, jammed or confused or not.
 *
 * Its presence is also the "already decided" mark: MissileJammingSystem rolls
 * only for a guided missile that has a target and no decision yet. It is
 * serializer-registered (JammingPlugin), so snapshots, wire snapshots and the
 * desync hash carry it and a rollback replays the decision instead of
 * re-rolling it.
 */
export const JamDecision = t.type({
    steer: t.keyof({
        track: null, flyStraight: null, veerAway: null,
        circleClockwise: null, circleCounterclockwise: null,
    }),
});
export type JamDecision = t.TypeOf<typeof JamDecision>;
export type JamSteer = JamDecision['steer'];
export const JamDecisionComponent =
    new Component<JamDecision>('JamDecisionComponent');

/** MovementState.turning for a confused missile's steer, or undefined for
 * any other steer. */
export function confusedTurning(steer: JamSteer | undefined): 1 | -1 | undefined {
    switch (steer) {
        case 'circleClockwise':
            return 1;
        case 'circleCounterclockwise':
            return -1;
        default:
            return undefined;
    }
}

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
 * Deterministic: every decision draws exactly six numbers from the room's
 * PRNG (one per jamming type, then the reaction roll, then the interference
 * roll), whatever the jamming, interference, vulnerabilities and seeker
 * flags, in the ECS's stable system-iteration order (the same pattern as
 * weapon inaccuracy). A fixed count keeps the stream independent of jamming
 * state: adding or removing a jammer never shifts another missile's rolls.
 *
 * The same system then runs the per-tick asteroid capture of
 * decoyedByAsteroids missiles (rule 4; captureByAsteroid), which draws no
 * random numbers. It runs after the decision so a rock near the launch point
 * captures the missile on its launch tick, before its first aim.
 */
export const MissileJammingSystem = new System({
    name: 'MissileJammingSystem',
    args: [MovementStateComponent, TargetComponent, ProjectileDataComponent,
        Optional(JamDecisionComponent), GetEntity, UUID, Entities,
        RandomResource, SystemInterferenceResource, DecoyQuery] as const,
    // No longer reads the clock; TimeSystem stays in `after` so the system
    // order is unchanged. JammingProvider is a #237 pin (shared: *).
    after: [TimeSystem, JammingProvider],
    step(movement, targetRef, projectileData, decision, self, uuid, entities,
        random, systemInterference, decoys) {
        // Only guided missiles can be jammed or decoyed. Vulnerabilities are
        // "ignored if the weapon is not a guided weapon" (Bible).
        if (projectileData.guidance !== 'guided') {
            return;
        }
        // Decided once, for life: no re-roll and no re-acquisition.
        if (!decision) {
            decideJam(movement, targetRef.target, projectileData, self, uuid,
                entities, random, systemInterference.interference, decoys);
        }
        if (projectileData.seeker.decoyedByAsteroids) {
            captureByAsteroid(movement, projectileData.seeker, self, entities,
                decoys);
        }
    },
});

/**
 * MissileJammingSystem's one jam decision for a missile with no
 * JamDecisionComponent yet (see the system doc). Does nothing without a
 * target.
 */
function decideJam(movement: { position: Position, rotation: Angle },
    target: string | undefined, projectileData: ProjectileWeaponData,
    self: Entity, uuid: string, entities: EntityMap, random: Random,
    interference: number, decoys: Iterable<DecoyCandidate>) {
    if (!target) {
        return;
    }
    const seeker = projectileData.seeker;

    const targetEntity = entities.get(target);
    const targetJamming = targetEntity?.components.get(JammingComponent);
    const effJam = effectiveJamming(targetJamming);

    // Always six draws, in a fixed order (see the system doc).
    const rolls: [number, number, number, number] = [
        random.next(), random.next(), random.next(), random.next(),
    ];
    const reactionRoll = random.next();
    const interferenceRoll = random.next();

    // Rule 5 first: a missile confused by interference circles for life,
    // jammed or not.
    const confused = rollInterferenceConfusion(seeker, interference,
        interferenceRoll);
    if (confused) {
        self.components.set(JamDecisionComponent, { steer: confused });
        return;
    }

    const jammed = rollMissileJammed(projectileData.jamVulnerabilities,
        effJam, rolls);
    const reaction = decideJamReaction(jammed, reactionRoll, seeker);
    self.components.set(JamDecisionComponent, {
        steer: applyJamReaction(reaction, self, uuid, movement, decoys),
    });
}

/**
 * Rule 4 (Seeker 0x0002 without or with jamming): the first tick a rock ahead
 * of the missile is within ASTEROID_DECOY_CAPTURE_RANGE, and its target is
 * not already a rock, retarget onto the nearest such rock and track it for
 * good, whatever the jam decision said. Draws no random numbers.
 */
function captureByAsteroid(movement: { position: Position, rotation: Angle },
    seeker: SeekerFlags, self: Entity, entities: EntityMap,
    decoys: Iterable<DecoyCandidate>) {
    // Read fresh: the jam decision may have just retargeted the missile.
    const target = self.components.get(TargetComponent)?.target;
    const targetIsDecoy = target !== undefined
        && entities.get(target)?.components.has(DecoyTargetComponent) === true;
    const rock = asteroidCapture(seeker, target, targetIsDecoy,
        movement.position, movement.rotation, decoys);
    if (!rock) {
        return;
    }
    self.components.set(TargetComponent, { target: rock });
    self.components.set(JamDecisionComponent, { steer: 'track' });
}

/**
 * Carries out a missile's reaction: retargets it if the reaction says so, and
 * returns how guidance should steer it from now on. Kept separate so the
 * decision stays pure and testable.
 */
export function applyJamReaction(reaction: JamReaction, self: Entity,
    uuid: string, movement: { position: Position, rotation: Angle },
    decoys: Iterable<DecoyCandidate>): JamSteer {
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
            // Ahead of it only: the capture cone (rule 3).
            const decoy = nearestDecoy(decoys, movement.position,
                DECOY_DISTRACTION_RANGE, captureCone(movement.rotation));
            if (decoy) {
                self.components.set(TargetComponent, { target: decoy });
                return 'track';
            }
            // No rock in the field: the plain jammed behaviour (straight, or
            // away for turnsAwayIfJammed). Capture can still happen later.
            return reaction.fallback;
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
