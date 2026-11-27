import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Components, Emit, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementState, MovementStateComponent, MovementType, teleport } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Time, TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { BlastDamageComponent } from './blast_data.js';
import { ArmorComponent, IonizationColorComponent, IonizationComponent, ShieldComponent } from './health_plugin.js';
import { ProjectileComponent } from '../core/index.js';
import { ShipComponent, ShipDataComponent, ShipPhysicsComponent } from './ship_plugin.js';
import { SourceComponent } from './weapon_components.js';
import { nonLethalArmor, nonLethalArmorFloor } from './ship_explosion.js';
import { ControlledByComponent } from '../player/index.js';
import { Position } from 'nova_ecs/datatypes/position';
import { Component } from 'nova_ecs/component';
import { GetEntity } from 'nova_ecs/arg_types';
import { Stat } from '../core/index.js';

// const DamageQuery = new Query([Optional(ShieldComponent), Optional(ArmorComponent),
// Optional(IonizationComponent), Optional(IonizationColorComponent),
// Optional(ProjectileComponent), TimeResource] as const);

export const DeathEvent = new EcsEvent<Time>('DeathEvent');
export const ZeroArmorEvent = new EcsEvent<Time>('ZeroArmorEvent');

/**
 * A hit landing on an entity.
 *
 * `nonLethal` marks damage that must never take a SHIP out of the fight:
 * armor stops just above the victim's disable threshold (see
 * nonLethalArmorFloor) and no ZeroArmorEvent is emitted, so the death
 * sequence is never started by it. It is set by a ship's own final
 * explosion (ship_explosion_plugin.ts) — Matthew's rule that an
 * exploding hull can hurt anyone nearby but can neither disable nor
 * destroy them. Entities that are not ships (missiles caught in the
 * blast) are unaffected by the flag and die normally.
 */
export const DamagedEvent = new EcsEvent<{
    damage: WeaponDamage, damager: string, scale?: number,
    nonLethal?: boolean,
    /** Set by BeamDamageSystem: the push is a beam's (knockedVelocity's
     * lower BEAM_KNOCKBACK_TOP_SPEED_FRACTION cap). */
    beam?: boolean,
}>('DamagedEvent');

registerSimulationBridgeEvent({ event: DeathEvent });
registerSimulationBridgeEvent({ event: ZeroArmorEvent });

const DamageSystem = new System({
    name: 'DamageSystem',
    events: [DamagedEvent],
    args: [Emit, DamagedEvent, Optional(ShieldComponent), Optional(ArmorComponent),
        Optional(IonizationComponent), Optional(IonizationColorComponent),
        Optional(ProjectileComponent), TimeResource, UUID,
        Optional(ShipDataComponent)] as const,
    step(emit, { damage, scale = 1, nonLethal }, shield, armor, ionization,
        ionizationColor, isProjectile, time, uuid, shipData) {

        const hasShield = shield && shield.max > 0;
        if (isProjectile && !hasShield) {
            // This is a projectile, so use point defense damage scaling.
            damage = {
                ...damage,
                armor: damage.armor + damage.shield / 2,
            };
        }

        if (damage.ionization !== 0 && ionization) {
            ionization.current += damage.ionization * scale;
            // LAST IONIZING HIT WINS. The wëap IonizeColor of the weapon
            // that just ionized this ship becomes the colour it shows
            // while ionized (EVN Bible: "the color that a ship hit by
            // this weapon will appear after being sufficiently
            // ionized"). The Bible says nothing about two ionizing
            // weapons of different colours landing on one ship, so we
            // take the simplest deterministic rule: whichever ionizing
            // hit landed most recently owns the colour. Within a tick
            // that is the last DamagedEvent handled, which the ECS
            // orders deterministically, so every peer paints the same
            // hull — and a single-weapon barrage, the overwhelmingly
            // common case, looks identical under any rule.
            //
            // Gated on a POSITIVE amount: only a hit that actually adds
            // ionization is an "ionizing hit". A weapon with negative
            // Ionization is draining the charge, not painting the ship.
            if (ionizationColor && damage.ionization > 0) {
                ionizationColor.color = damage.ionizationColor;
            }
        }

        // A hit that takes the shield to 0 (or below) lands its armor
        // damage in full in the same hit. MEASURED (reference "Disabled
        // ships, wave 24"): one Kit Disable Gun hit (3000 shield / 2100
        // armor) disabled a 3000 / 3000 hull (30% armor, under 33%) and a
        // second destroyed it.
        //
        // The subtraction is deliberately UNCLAMPED here and the shield
        // may end below zero: the recharge step (health_plugin's
        // rechargeSystem) clamps it to the Stat's `min`, which is -5% of
        // capacity (SHIELD_FLOOR_FRACTION, maintainer ruling #313: a
        // collapsed shield must regenerate that 5% before it absorbs
        // again). Do not clamp it to 0 here: a 20-point shield showing
        // about -1 after a blast is that floor, as intended
        // (shield_floor_test.ts).
        if (shield && !damage.passThroughShield) {
            shield.current -= damage.shield * scale;
            if (shield.current > 0) {
                return;
            }
        }
        if (armor) {
            // A ship's own final explosion (nonLethal) can hurt but
            // never take a SHIP out of the fight: armor stops just above
            // the victim's disable threshold, and no ZeroArmorEvent is
            // emitted even if it was already at zero, so an explosion
            // can neither disable nor destroy. Gated on ShipDataComponent
            // because the threshold is a ship property (shïp Flags
            // 0x0010) — a missile swept up in the blast has none and
            // dies as usual.
            if (nonLethal && shipData) {
                armor.current = nonLethalArmor(armor.current,
                    damage.armor * scale,
                    nonLethalArmorFloor(armor.max,
                        shipData.disableArmorFraction));
                return;
            }
            // weap Flags2 0x1000 "can disable but not destroy": armor
            // damage from such a weapon clamps just above zero, so an
            // ion barrage can pound a ship far below its disable
            // threshold (leaving it thoroughly disabled) but can never
            // deliver the killing blow — that takes one tap from any
            // normal weapon.
            const floor = damage.disableOnly
                ? disableOnlyArmorFloor(armor.max) : 0;
            armor.current = Math.max(floor,
                armor.current - damage.armor * scale);
            if (armor.current === 0) {
                emit(ZeroArmorEvent, time, [uuid]);
            }
        }
    }
});

/**
 * The armor floor a disable-only weapon can reach: DISABLE_ONLY_ARMOR_FLOOR
 * (1 armor point) — far below any disable threshold, small enough that a
 * single hit from even the lightest lethal weapon finishes the ship.
 * Degenerate targets with max armor <= 1 floor at half their armor
 * instead so the clamp never exceeds the target's actual armor pool.
 */
export const DISABLE_ONLY_ARMOR_FLOOR = 1;
export function disableOnlyArmorFloor(maxArmor: number): number {
    return Math.min(DISABLE_ONLY_ARMOR_FLOOR, maxArmor / 2);
}

export const ExplodingComponent = new Component<number>('ShipExplodingComponent');

/**
 * Whether a ship's armor is full — the tell that it is NOT in a death
 * sequence, however it was asked.
 *
 * This exists because ZeroArmorEvent is *queued* the instant armor
 * reaches zero but handled later, and by then the ship may have come
 * back to life. The window is not hypothetical: ExplodingFinishedSystem
 * queues the DeathEvent that ends a death sequence from step system #30,
 * while every damage source runs after it (ProjectileCollisionSystem
 * #34, BlastCollisionSystem #118, BeamDamageSystem #138). One more hit
 * landing on a hulk in the very tick its explosion finishes therefore
 * queues a ZeroArmorEvent *behind* that DeathEvent, and PlayerDeathSystem
 * has already refilled the player's armor by the time it is handled. The
 * display sees a worse version of the same thing: the simulation bridge
 * forwards these events to the display world in *emit* order, batched
 * across every tick since the last frame, and replays them after the
 * frame's state (already showing the respawned, full-armor ship) has
 * been applied.
 *
 * Acting on such an event restarts the death sequence on a ship that is
 * flying around at full armor. In the simulation that re-attaches
 * ExplodingComponent — making the player untargetable and unable to
 * fire, and teleporting them back to the origin a deathDelay later. On
 * the display it pins SecondaryExplosionComponent to the ship, which is
 * only ever removed by a DeathEvent, so the ship trails explosions for
 * the rest of the flight. That is Matthew's playtest report: "my ship
 * was constantly playing the exploding animation while flying around ...
 * after I died and respawned and probably died again immediately".
 *
 * So every consumer that *starts* something on zero armor re-checks
 * against live state instead of trusting the event.
 *
 * WHY FULL ARMOR AND NOT MERELY ABOVE ZERO. 70 of the 288 stock ships
 * have a nonzero armor recharge, and ArmorRecharge (step system #56)
 * runs after the weapons that zero them, so a hulk's armor is typically
 * a hair *above* zero (one tick of recharge, ~0.01) by the time its
 * ZeroArmorEvent is handled — it then freezes there, since the hulk is
 * below its disable threshold and disabled ships regenerate nothing.
 * Treating "above zero" as alive would make every one of those ships
 * immortal. Full armor is unreachable that way: only a respawn
 * (PlayerDeathSystem refills to max) or an outside repair gets there.
 *
 * A ship with no armor stat, or a degenerate one with no armor to give,
 * cannot be judged this way and is taken at face value.
 */
export function armorFullyRestored(armor?: Stat): boolean {
    return Boolean(armor && armor.max > 0 && armor.current >= armor.max);
}

export const ShipZeroArmorSystem = new System({
    name: 'ShipZeroArmorSystem',
    args: [ShipDataComponent, ZeroArmorEvent, GetEntity,
        Optional(ArmorComponent)] as const,
    events: [ZeroArmorEvent],
    step(ship, zeroArmorTime, {components}, armor) {
        // Already dying (the hulk keeps taking hits), or the event
        // describes a life that has already ended.
        if (components.has(ExplodingComponent)
            || armorFullyRestored(armor)) {
            return;
        }
        // ShipData.deathDelay is in seconds; sim time is ms (tracker
        // issue: normalize novadatainterface durations to ms).
        const deathTime = ship.deathDelay * 1000 + zeroArmorTime.time;
        components.set(ExplodingComponent, deathTime);
    }
});

export const ExplodingFinishedSystem = new System({
    name: 'ExplodingFinishedSystem',
    args: [TimeResource, ExplodingComponent, UUID, Emit] as const,
    step(time, endExplosionTime, uuid, emit) {
        if (endExplosionTime < time.time) {
            // Deliberately does NOT delete ExplodingComponent here.
            // DeathEvent is queued, so it is handled after the rest of
            // this tick's step systems — including every weapon that
            // deals damage. Clearing the marker now would leave a
            // window in which the ship is neither exploding nor yet
            // respawned, and a hit landing in that window would start a
            // *second* death sequence through ShipZeroArmorSystem's
            // has-ExplodingComponent guard. ExplodingClearedSystem
            // clears it as part of handling the death instead, which is
            // still within this same tick.
            emit(DeathEvent, time, [uuid]);
        }
    },
    // Determinism rule 4: the explosion end check compares against
    // time.time, so this must run after TimeSystem advances the clock.
    after: [TimeSystem],
});

/**
 * Ends the death sequence when the death is *handled*, closing the
 * window described in ExplodingFinishedSystem. Runs exactly once per
 * death: ExplodingFinishedSystem is a step system, so it emits at most
 * one DeathEvent per tick per exploding entity, and the event queue is
 * drained before the next step.
 */
export const ExplodingClearedSystem = new System({
    name: 'ExplodingClearedSystem',
    events: [DeathEvent],
    args: [GetEntity] as const,
    step({ components }) {
        components.delete(ExplodingComponent);
    },
});

/**
 * The unit direction a knockback impulse shoves a target in, given the
 * damager that hit it.
 *
 * A blast pushes *radially outward from its center* — along the
 * difference between the target's position and the blast's — so an
 * explosion scatters what it catches away from itself. Every other
 * damager (projectile, beam) pushes along its own facing, which is the
 * direction it was travelling when it landed. A blast entity has a
 * rotation too, but it is meaningless (inherited from whatever spawned
 * the blast), so using it would fling targets off in an arbitrary
 * shared direction instead of outward.
 *
 * Returns null when a blast sits exactly on top of its target: the
 * position difference has no direction to normalize (Vector.normalize
 * throws on a zero-length vector), and "no impulse" is the only
 * well-defined answer. Callers skip the knockback.
 *
 * Deterministic: the degenerate test is an exact zero compare, and the
 * normalize is a correctly-rounded sqrt.
 */
export function knockbackDirection(targetPosition: Position,
    damagerMovement: MovementState, isBlast: boolean): Vector | null {
    if (!isBlast) {
        return damagerMovement.rotation.getUnitVector();
    }
    // Subtract as Positions — that wraps the delta to the shortest way
    // around the toroidal world — but drop to a plain Vector before
    // normalizing. Position's arithmetic re-wraps every result, so a
    // Position direction would silently wrap the caller's `.scale()`
    // once the impulse exceeded BOUNDARY, flipping a big shove around
    // to point back the way it came.
    const difference = Vector.fromVectorLike(
        targetPosition.subtract(damagerMovement.position));
    if (difference.lengthSquared === 0) {
        return null;
    }
    return difference.normalize();
}

/**
 * The knockback law's factor: one hit of wëap Impact `I` on a hull of
 * Mass `M` tons adds KNOCKBACK_PER_IMPACT x I / M px/s along the shot (a
 * blast: away from its centre; knockbackDirection), before the top-speed
 * cap (knockedVelocity). A beam lands it once per Count unit
 * (BeamDamageSystem's `scale`), capped lower
 * (BEAM_KNOCKBACK_TOP_SPEED_FRACTION).
 *
 * MEASURED (reference "Knockback (the hub's KNOCKBACK), wave 46", finding
 * 1): 30. Fifteen clean bolt hits over three Impact / Mass pairs (20 / 50:
 * +11.2 to +12.6 px/s a hit, law 12; 100 / 50: +58.3, +59.8, law 60;
 * 100 / 300: +9.7 to +10.9, law 10), from rest and on top of a drift
 * alike; a Count-30 Impact-20 beam gave +59 px/s a shot on the 300-ton
 * hull twice (30 x 2, finding 3). Was 5, six times too small.
 *
 * Every knockback shares it: weapon hits and beams (KnockbackSystem), a
 * ship's final explosion (SHIP_EXPLOSION_KNOCKBACK, ship_explosion.ts: one
 * fixed impact of 737 through KnockbackSystem, MEASURED as 1 / the
 * victim's mass, reference "The ship-explosion push", wave 47) and the
 * push on an asteroid (AsteroidDamageSystem: the same law on a röid's
 * Mass, MEASURED at about 29 x, reference "The asteroid push", wave 48).
 * A negative Impact (a tractor) brakes instead (tractoredVelocity), or
 * beyond TRACTOR_PULL_RANGE pulls at TRACTOR_PULL_PER_IMPACT.
 */
export const KNOCKBACK_PER_IMPACT = 30;

/**
 * A ship's velocity after a knockback `impulse`: the sum, limited so a
 * hit can never take the ship past its own top speed (`topSpeed`), nor
 * past the speed it already had when that was higher (an afterburner's
 * leftover overspeed keeps bleeding off at its own rate, untouched). A
 * hit can still turn a ship at its cap: only the length is limited.
 *
 * WHY. Nothing else bounded a knocked ship. MovementSystem's clamp is
 * the DECAYED cap (decayedSpeedCap, afterburner_plugin.ts), which rises
 * to meet any overspeed and bleeds it at 0.7 x the hull's acceleration,
 * and an inertialess hull sheds speed over its throttle's at only
 * INERTIALESS_SHED_PER_ACCELERATION x its acceleration
 * (inertialessControls) — while a thrusting one's targetSpeed climbed
 * with that risen cap and held the speed for good. Light hulls take far
 * more than that bleed under sustained fire: impact x
 * KNOCKBACK_PER_IMPACT / mass a hit, and a beam lands its impact once per
 * Count unit (a Thunderhead Lance shot is 10 of them, 1,500 px/s on a
 * mass-10 Hyperioid). Under a Kestrel's guns (at the old x 5) a Hyperioid
 * (top speed 90 px/s) reached 1,000 px/s in the first second and 9,300
 * px/s in ten, a Vell-os Dart 12,500 and even an inertial Shuttle 6,100.
 *
 * MEASURED (reference "Knockback (the hub's KNOCKBACK), wave 46", finding
 * 2): the cap is the hull's top speed. One Impact-100 bolt on a 20-ton
 * disc (top speed 131 px/s) gave 134 px/s, not the 150 the law gives,
 * and the speed held there through the next hit; pushes under the cap
 * add in full. (It was a GUESS from spöb gravity's measured cap.)
 *
 * Deterministic: one add, one compare, and a correctly-rounded sqrt in
 * shortenToLength; no state.
 */
export function knockedVelocity(velocity: Vector, impulse: Vector,
    topSpeed: number): Vector {
    const limit = Math.max(velocity.length, topSpeed);
    return velocity.add(impulse).shortenToLength(limit);
}

/**
 * The fraction of the victim's top speed that a BEAM's push stops at
 * (a bolt's stops at the full top speed; knockedVelocity's `topSpeed`).
 *
 * MEASURED (reference "A beam on a fast light hull (the KB leftover),
 * wave 48"): the Count-30 Impact-20 beam (360 px/s by the law) threw Kit
 * Probe A (top speed 131 px/s) to 94.6 px/s, the same to 0.1 px/s in two
 * runs, and Kit Probe B (262) to 189.4: 0.721 / 0.722. Later beams that
 * reached the Probe added nothing (the cap, not a lost hold). Bolts reach
 * the full top speed (wave 46: 134 on a 131 px/s disc), so the lower cap
 * is the beam's alone.
 */
export const BEAM_KNOCKBACK_TOP_SPEED_FRACTION = 0.72;

/**
 * A TRACTOR's (negative Impact's) brake, in the push law's form: one hit
 * of wëap Impact -I on a hull of Mass M moves its velocity toward the
 * firer's by TRACTOR_BRAKE_PER_IMPACT x I / M px/s (a beam: once per
 * Count unit), never past it (tractoredVelocity), for a target within
 * TRACTOR_PULL_RANGE of the firer and lighter than it (beyond the range
 * it is pulled instead, TRACTOR_PULL_PER_IMPACT).
 *
 * GUESS, fitted to one run (reference "A tractor beam (the KB leftover),
 * wave 48", ktm_a): the Count-30 Impact -20 beam took about 19 px/s off
 * Kit Probe A (50 t) coasting at 30 px/s (30 -> 20.7 -> 10.9 over one
 * shot) and stopped it dead with the next. 1.6 gives 30 x 20 x 1.6 / 50 =
 * 19.2 px/s a shot: 30 -> 10.8, then 0. How the rate scales with Impact
 * and Mass is unmeasured (assumed like the push, which is 30 here, i.e.
 * 360 px/s a shot: far too strong).
 */
export const TRACTOR_BRAKE_PER_IMPACT = 1.6;

/**
 * A velocity after a TRACTOR hit (a negative Impact): moved toward the
 * firer's velocity `toward` by `amount` px/s, never past it. Pure.
 */
export function tractoredVelocity(velocity: Vector, toward: Vector,
    amount: number): Vector {
    const relative = velocity.subtract(toward);
    const remaining = relative.length - amount;
    if (remaining <= 0) {
        return toward;
    }
    return toward.add(relative.shortenToLength(remaining));
}

/**
 * The distance from its firer beyond which a tractor hit PULLS the target
 * toward the firer instead of braking it (tractoredVelocity).
 *
 * GUESS 450 px, between the readings (reference "A tractor beam's rate
 * with Mass and distance (the KB leftover), wave 50", finding 2): a still
 * Kit Probe A 500 px out (diagonal) was pulled at once; at 425, 350 and
 * 250 px (on the axis) it never moved. A range, not a law in the
 * distance, on one far geometry.
 *
 * OPEN (wave 51): NovaJS decides pull or brake per beam UNIT, by where
 * the target is when that unit lands. Wave 51's trb_c pulled Kit Probe B
 * steadily for the whole ~1 s shot from 500 px, about 170 px of travel,
 * so it went on pulling well inside this range; the decision may be the
 * shot's (where the target is when the beam first reaches it), not the
 * unit's. Unchanged here (latching it per shot needs synced per-beam
 * state); NovaJS's shorter beam (Count / 56 s) crosses less of the range.
 */
export const TRACTOR_PULL_RANGE = 450;

/**
 * The tractor's pull beyond TRACTOR_PULL_RANGE, in the push law's form:
 * one hit of wëap Impact -I on a hull of Mass M adds TRACTOR_PULL_PER_IMPACT
 * x I / M px/s toward the firer (a beam: once per Count unit), each
 * velocity axis capped at the hull's top speed (pulledVelocity).
 *
 * MEASURED (reference "A tractor beam's pull frame by frame, its Impact
 * scaling and the brake's Mass gate (the hub's item 3, the KB leftover),
 * wave 51", findings 1-2): the push law's own 30 x |Impact| / Mass a
 * unit. Read frame by frame on Kit Probe B (50 t, a 262 px/s axis cap
 * that a whole Impact-20 shot stays under on y), the Count-30 Impact -20
 * beam built the speed toward the beamer steadily, 33-35 px/s every 0.1 s
 * (about 11.5 a unit: 30 x 20 / 50 = 12), to 330 px/s at the shot's end
 * (x at its cap, y 203; this law: 360 uncapped, x at the cap and y 216);
 * Impact 40 built 1.97 x as fast until both axes held at the cap (372).
 * Was 0.86 x 30 (wave 50), which had been read off a Probe A whose axes
 * met their 131 px/s cap within the shot. Wave 50's 150 t Star Liner
 * reading (about 100 px/s a shot, x at its 87.5 cap) lies under this law's
 * 113 (x at the cap, y 72): its y was not read on its own.
 *
 * The CLOCK the units land on: MEASURED (reference "The beam Count clock
 * (the hub's item 2, E10), wave 52"): an NPC's TURRETED beam (the tractor
 * is Guidance 3) runs its Count at 30 units a second (combat
 * beamCountRateFor, NPC_TURRET_BEAM_COUNT_RATE), so the NPC tractor's
 * Count-30 shot lands its 30 units over about 1 s, as wave 51 read: 12
 * px/s a unit on 50 t at Impact 20 is 360 px/s a second, the measured
 * steady 345 px/s². A player's tractor (fixed or turret) runs Count / 56
 * (GUESS from E10's plain beams, about 0.54 s a Count-30 shot, unflown).
 */
export const TRACTOR_PULL_PER_IMPACT = KNOCKBACK_PER_IMPACT;

/**
 * A velocity after a tractor's PULL `impulse`: the sum, with EACH AXIS
 * held to the hull's top speed (`topSpeed`), or to the speed that axis
 * already had when that was higher (an overspeed is not cut by the pull
 * itself). MEASURED (reference "A tractor beam's rate with Mass and
 * distance (the KB leftover), wave 50", finding 1): the pulled Probe's x
 * and y each stopped at its 131 px/s top speed, 1.4 x it on the diagonal,
 * as the asteroids' per-axis clamp (wave 48). Pure; no trigonometry.
 */
export function pulledVelocity(velocity: Vector, impulse: Vector,
    topSpeed: number): Vector {
    const axis = (now: number, add: number) => {
        const limit = Math.max(Math.abs(now), topSpeed);
        return Math.min(limit, Math.max(-limit, now + add));
    };
    return new Vector(axis(velocity.x, impulse.x),
        axis(velocity.y, impulse.y));
}

const MovementQuery = new Query([MovementStateComponent,
    Optional(BlastDamageComponent), Optional(SourceComponent)] as const);
const FirerQuery = new Query([MovementStateComponent,
    Optional(ShipPhysicsComponent)] as const);
export const KnockbackSystem = new System({
    name: 'KnockbackSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, MovementStateComponent, MovementPhysicsComponent,
        Optional(ShipPhysicsComponent), RunQuery] as const,
    step({ damage, damager, scale = 1, beam }, movementState, movementPhysics,
        shipPhysics, runQuery) {
        if (!damage.knockback) {
            return;
        }
        const val = runQuery(MovementQuery, damager);
        if (!val[0]) {
            return;
        }
        const [otherMovement, isBlast, source] = val[0];

        let targetMass = 1;
        if (shipPhysics) {
            targetMass = shipPhysics.mass || 1;
        }
        if (damage.knockback < 0) {
            // A tractor (negative Impact). Inertialess hulls are exempt
            // (the Bible: "inertialess ships are not affected"; waves 48 /
            // 50: the glide hull and Kit Plain Ring never moved, at 250
            // and 500 px).
            if (movementPhysics.movementType === MovementType.INERTIALESS) {
                return;
            }
            // A beam entity holds no velocity, place or Mass of its own:
            // its firer's (SourceComponent) are the ones that count.
            const [firerMovement, firerPhysics] = (source !== undefined
                ? runQuery(FirerQuery, source)[0] : undefined)
                ?? [otherMovement, undefined];
            // Only hulls LIGHTER than the firer are moved (the Bible's
            // "smaller ships"; wave 50, finding 3: 50 and 150 t were
            // pulled by the 175 t beamer, 255 and 300 t never moved, at
            // rest or coasting). The brake below is gated too, MEASURED
            // (reference "A tractor beam's pull frame by frame, its
            // Impact scaling and the brake's Mass gate", wave 51, finding
            // 4): a 50 t Probe A coasting toward the 175 t beamer inside
            // the range was braked 28.5 -> 9-10 -> 0 px/s (twice), while
            // wave 50's 300 t trm_b coasted 40.8 px/s through a whole shot
            // 357-360 px from it untouched. GUESS: the line is the
            // firer's own Mass, strictly (the 175-300 t gap is unread). A
            // firer with no hull Mass (none in the data fires a tractor)
            // does not gate it.
            if (firerPhysics && !(targetMass < (firerPhysics.mass || 1))) {
                return;
            }
            const scaled = Math.abs(damage.knockback) * scale / targetMass;
            const toFirer = Vector.fromVectorLike(
                firerMovement.position.subtract(movementState.position));
            if (toFirer.lengthSquared
                > TRACTOR_PULL_RANGE * TRACTOR_PULL_RANGE) {
                // Beyond TRACTOR_PULL_RANGE it PULLS toward the firer,
                // each axis held at the top speed (reference "A tractor
                // beam's rate with Mass and distance (the KB leftover)",
                // wave 50: a still 50 t Probe 500 px out went to 181-185
                // px/s toward the beamer in one shot).
                // The cap is the hull's own (outfitted) top speed, not
                // this tick's effective maxVelocity: that one rises to
                // meet an overspeed while it bleeds off, so the pull's own
                // diagonal 1.4 x would lift every later axis cap with it.
                movementState.velocity = pulledVelocity(
                    movementState.velocity,
                    toFirer.normalize(scaled * TRACTOR_PULL_PER_IMPACT),
                    shipPhysics?.speed ?? movementPhysics.maxVelocity);
                return;
            }
            // Within it, it does NOT pull: it brakes the target's
            // velocity toward its FIRER's, never past it (reference "A
            // tractor beam (the KB leftover)", wave 48: Kit Probe A at
            // rest 250 px out never moved under four shots; coasting at
            // 30 px/s 40-60 px from the beamer it was slowed and then
            // stopped dead, and stayed put; wave 50: still at 350 and 425
            // px too). The rate: TRACTOR_BRAKE_PER_IMPACT (GUESS, fitted
            // to about 19 px/s a Count-30 shot of Impact -20 on 50 t).
            // The two never mix: each hit (each beam unit) either pulls or
            // brakes, by where the target is when it lands, so a hull
            // pulled in from afar is braked to the firer's velocity once
            // it comes inside the range, and one that coasts back out is
            // pulled in again (wave 50's tra_a, flung past the beamer and
            // pulled back).
            movementState.velocity = tractoredVelocity(
                movementState.velocity,
                Vector.fromVectorLike(firerMovement.velocity),
                scaled * TRACTOR_BRAKE_PER_IMPACT);
            return;
        }

        const strength = Math.abs(damage.knockback) * scale / targetMass
            * KNOCKBACK_PER_IMPACT;

        const direction = knockbackDirection(
            movementState.position, otherMovement, Boolean(isBlast));
        if (!direction) {
            return;
        }
        // Capped at the hull's top speed (knockedVelocity), a beam's at
        // BEAM_KNOCKBACK_TOP_SPEED_FRACTION of it. maxVelocity is this
        // tick's effective cap (EffectiveMovementPhysicsSystem: the ion /
        // strict / afterburner / jump-burn ceiling, or the speed already
        // held while an overspeed bleeds off).
        movementState.velocity = knockedVelocity(movementState.velocity,
            direction.scale(strength),
            beam ? movementPhysics.maxVelocity
                * BEAM_KNOCKBACK_TOP_SPEED_FRACTION
                : movementPhysics.maxVelocity);
    },
    // #237 pin (shared: *): the DamagedEvent handlers run damage first,
    // knockback second.
    after: [DamageSystem],
});

// Tracker issue: the respawn resets shield, armor and ionization one
// component at a time; a new per-ship status would have to be added
// here by hand. A shared "reset to full" would keep them in step.
export const PlayerDeathSystem = new System({
    name: 'PlayerDeathSystem',
    // Gated on ControlledBy (synced), NOT PlayerShipSelector
    // (peer-local): every world must respawn a dead player ship
    // identically, or the owner's world revives it at the origin
    // while everyone else's leaves a zero-armor wreck re-exploding
    // in place — a guaranteed desync on every player death.
    args: [Optional(ShieldComponent), Optional(ArmorComponent),
           Optional(IonizationComponent), MovementStateComponent,
           ControlledByComponent] as const,
    events: [DeathEvent],
    step(shield, armor, ionization, movement) {
        if (shield) {
            shield.current = shield.max;
        }
        if (armor) {
            armor.current = armor.max;
        }
        if (ionization) {
            ionization.current = 0;
        }
        // Teleport (rather than set position) so the respawn is sent to
        // other players, who otherwise only hear about input changes.
        teleport(movement, new Position(0, 0));
    }
});

export const DeathPlugin: Plugin = {
    name: 'DeathPlugin',
    build(world) {
        world.resources.get(SerializerResource)?.addEvent(DeathEvent, passthroughType<Time>('DeathEventType'));
        world.resources.get(SerializerResource)?.addEvent(ZeroArmorEvent, passthroughType<Time>('ZeroArmorEventType'));
        //const runQuery = world.resources.get(RunQuery)!;
        //const emit = world.resources.get(Emit)!;
        world.addSystem(DamageSystem);
        world.addSystem(KnockbackSystem);
        world.addSystem(PlayerDeathSystem);
        world.addSystem(ShipZeroArmorSystem);
        world.addSystem(ExplodingFinishedSystem);
        world.addSystem(ExplodingClearedSystem);
    },
    remove(world) {
        world.removeSystem(DamageSystem);
        world.removeSystem(KnockbackSystem);
        world.removeSystem(PlayerDeathSystem);
        world.removeSystem(ShipZeroArmorSystem);
        world.removeSystem(ExplodingFinishedSystem);
        world.removeSystem(ExplodingClearedSystem);
    }
}
