import * as t from 'io-ts';
import { Emit, SetComponent, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { System } from "nova_ecs/system";
import { FPS } from "novaparse/parsers/constants";
import { IonizationComponent, IonizationRechargeSystem } from "./health_plugin.js";


/**
 * ============================================================================
 * Ionization (EVN Bible)
 * ============================================================================
 *
 * shïp IonizeMax: "The amount of ion charge at which a ship of this type
 * will be considered 'fully ionized'." wëap Ionization: "When a ship is
 * ionized it becomes nearly immobilized until the ionization charge
 * dissipates." shïp Deionize is the dissipation rate (the stat's
 * negative recharge, ship_plugin ShipIonizationProvider); oütf ModTypes
 * 39/40 add dissipation and capacity.
 *
 * "Ionized" is a LEVEL test: a ship is ionized while its charge is above
 * ION_IONIZED_FRACTION (a third) of IonizeMax, and free again the tick it
 * decays to that line or below — however it got there. While it holds,
 * the wëap IonizeColor tint is painted (ship_animation_plugin reads
 * IsIonizedComponent) and wëap Flags 0x0020 weapons can't fire. The
 * movement cuts (ionSlowdown) do not look at that line: they are
 * functions of the charge share q, held at ION_CHARGE_HOLD, from the
 * first point of charge (wave 51): the turn to whole degrees a frame,
 * floor(Turn / 10 x (1 - q)), so it is cut per hull (a slow hull stops at
 * the first hit, a fast one still turns when saturated); the thrust
 * 1 - q.
 *
 * MAINTAINER RULING #153 restored the level test (over #124's full-charge
 * / full-dissipate hysteresis) at HALF of IonizeMax; the line has since
 * been measured lower (reference "The ion charge read directly (E6, the
 * hub's item 2), wave 50": a third, the charge read directly; waves 41 /
 * 42's lower readings had missed hits). Everything else #124
 * fixed stays: the IonizeMax-0 guard below, the stat's percent guard
 * (health_plugin), the IonizeColor tint, and the ordering before the
 * decay.
 *
 * The state lives in IsIonizedComponent, which is serializer-registered
 * and so carried in rollback snapshots and wire baselines like
 * DisabledComponent; every peer derives it from the same charge history.
 *
 * The charge is NOT capped at IonizeMax: each hit adds its whole wëap
 * Ionization and Deionize drains the pile (health_plugin's
 * IonizationRechargeSystem). MEASURED (reference "Ionization's cap and
 * the afterburner (E6 leftovers), wave 40"): a Deionize-50 hull hit for
 * about 14 s was still fully ionized 150 s later. The slowdown saturates
 * at ION_CHARGE_HOLD (ionSlowdown); the extra charge only makes it last.
 *
 * RULING (Bible silent): a hull with IonizeMax <= 0 has no ion capacity
 * and is never ionized. Two plug-in hulls ship that value (arpia:599,
 * Star Wars Mod:451, both with Deionize 0 too); reading it the other way
 * would leave them permanently crippled by a single ion hit. The stat
 * clamps their charge back to [0, 0] on the tick after every hit.
 */

/**
 * The share of IonizeMax past which the charge's cut stops growing: the
 * charge share q = charge / IonizeMax counts only up to this (both cuts
 * below are in min(q, ION_CHARGE_HOLD)), however far past it the pile
 * goes. MEASURED (reference "The ion turn cut on every hull (Matthew's
 * question, E6), wave 51", finding 1 / 4, and "The saturated thrust cut
 * on two Accels (Matthew's question, E6), wave 51", finding 2): six
 * 30-point hits (q up to 1.75) turned exactly as three on Turn 60 / 100 /
 * 200, and the saturated thrust (0.28 / 0.32) puts the hold on wave 50's
 * slide at 0.68-0.72. Wave 52 (E6B finding 4) decided floor() with a hold
 * at 0.7 over "strictly below" at 2/3: a saturated Turn-95 hull turned 2
 * degrees a frame (floor(9.5 x 0.3)), not 3; with wave 51's Turn 200 (6
 * a frame) the hold sits in (0.684, 0.70]. Replaces wave 50's no-turn line (two thirds, a line
 * for every hull) and its 0.9 acceleration slope.
 */
export const ION_CHARGE_HOLD = 0.7;

/**
 * The thrust multiplier at the hold: 1 - ION_CHARGE_HOLD, about 0.3.
 * MEASURED (wave 51, the saturated thrust section): 14.6 of 51.7 px/s²
 * on Accel 300 (0.28) and 47.6 of 146.8 on Accel 900 (0.32) at q about
 * 1.7, a FRACTION of the hull's thrust, not a fixed subtraction. Was 0.4
 * (wave 44's hull, only just past two thirds), a third before that (wave
 * 39's star-field reading). The top speed is never cut ("Ionization
 * (E6), wave 39").
 */
export const ION_FULL_ACCELERATION_FACTOR = 1 - ION_CHARGE_HOLD;

/**
 * The share of IonizeMax above which a ship is IONIZED (tinted, its
 * Flags 0x0020 weapons silent). A VISUAL line only, not a turn line
 * (wave 51 finding 3: Turn 200 changed its turn at q 0.35 and 0.30,
 * nothing at 1/3 itself). MEASURED (reference "The ion charge read
 * directly (E6, the hub's item 2), wave 50", finding 2): a single
 * 30-point hit on IonizeMax 100 never tinted; two 30-point hits tinted
 * until the drain (0.01 x Deionize a frame, DEIONIZE_FRAME_RATE) took
 * them to 33.0; 5-point ticks tinted at the 9th hit (35.5) and not the
 * 8th (31.4), and a slower feed at its 10th (35.2) and not its 9th
 * (32.0): 33.0 +- 1, a third. Wave 42's recount (finding 4) agrees. Was
 * 0.16 (wave 42, which had missed the take-off's hits), 0.3 (wave 41) and
 * half before that (ruling #153).
 */
export const ION_IONIZED_FRACTION = 1 / 3;

/**
 * One whole degree a 1/30 s game frame, in the rad/s MovementPhysics
 * turn rates are kept in: Turn 10 (ShipTurnRateConversionFactor's 30
 * deg/s). The original turns a ship in whole degrees a frame, charged
 * or not (29.15 deg/s a step at the reference machine's 29.15 Hz tick,
 * every wave-51 / 52 reading a whole multiple of it); NovaJS's frame is
 * the nominal 30 fps (FPS, the #316 ruling), so a step here is 30 deg/s.
 */
export const ION_TURN_STEP = FPS * Math.PI / 180;

/**
 * A rad/s turn rate in degrees a 1/30 s frame (Turn / 10), snapped to a
 * 1e-9 grid so the rad/s round trip does not leave a Turn-20 hull at
 * 1.9999999999999998 (and floor it a whole degree low). Pure.
 */
function turnDegreesPerFrame(turnRate: number): number {
    return Math.round(turnRate / ION_TURN_STEP * 1e9) / 1e9;
}

/**
 * The UNCHARGED turn of a ship whose raw turn (shïp Turn plus its
 * outfits' ModType 6: ShipPhysics.turnRate) is `rawTurnRate` rad/s:
 * whole degrees a frame, max(1, floor(Turn / 10)). MEASURED (reference
 * "The UNCHARGED base turn on every hull (the hub's item 1, E6), wave
 * 52", findings 1-2): Turn 7 / 9 / 15 turn 1 a frame, 25 two, 35 three,
 * 55 five, 95 nine, so Turn 7 turns 45 % FASTER than its Turn says and
 * Turn 35 15 % slower. GUESS: the outfits' turn is added to Turn BEFORE
 * the floor (no turn outfit was flown), and Turn 1-6 turn 1 a frame too
 * (unread; the stock minimum is 7). A hull with no (or a negative) turn
 * keeps it: no minimum step for a hull that cannot turn. The ion cut
 * works on the RAW Turn, not on this (ionSlowdown). Every consumer of a
 * ship's effective turn reads it through getShipMovementPhysics / the
 * MovementPhysicsComponent; the raw value stays in ShipPhysics for the
 * ion cut, the wëap Flags 0x0008 "fast ship" test (in Turn units) and the
 * spaceport's stat lines. Pure.
 */
export function unchargedTurnRate(rawTurnRate: number): number {
    const degreesPerFrame = turnDegreesPerFrame(rawTurnRate);
    if (!(degreesPerFrame > 0)) {
        return rawTurnRate;
    }
    return Math.max(1, Math.floor(degreesPerFrame)) * ION_TURN_STEP;
}

/**
 * The thrust multiplier at a charge share `q` of IonizeMax: 1 - min(q,
 * ION_CHARGE_HOLD), from the first point of charge. MEASURED (wave 50,
 * finding 5: wave 48's twelve pulses on the measured charge fit 1.03 -
 * 1.01 q, i.e. a slope of 1; wave 51: about 0.3 at saturation on two
 * Accels). Was max(0.4, 1 - 0.9 q). Pure.
 */
function accelerationFactor(q: number): number {
    return 1 - Math.min(q, ION_CHARGE_HOLD);
}

/**
 * The turn multiplier, on the UNCHARGED turn (unchargedTurnRate), at a
 * charge share `q` on a ship whose RAW turn is `rawTurnRate` rad/s.
 * MEASURED (reference "The ion turn cut on every hull (Matthew's
 * question, E6), wave 51", findings 1-2; "A Turn that is not a multiple
 * of 10 (the E6 follow-up), wave 51", finding 2; "The UNCHARGED base
 * turn on every hull (the hub's item 1, E6), wave 52", findings 3-4): an
 * ionized ship turns floor(d x (1 - min(q, ION_CHARGE_HOLD))) WHOLE
 * degrees a frame, d its RAW Turn / 10: the charge cuts the raw value,
 * not the already-truncated uncharged turn, and with no minimum of 1.
 * So the turn is cut per hull, not in thirds: Turn 10 never turns from
 * the first point of charge; Turn 20 turns 1 a frame while q <= 1/2;
 * Turn 25 (2 a frame uncharged) keeps 2 below q 0.2 and turns 1 to q
 * 0.6 (k2_t25); Turn 30 steps 2 -> 1 -> 0 at 1/3 and 2/3 (the old
 * "thirds" were this staircase's Turn-30 case); at the hold Turn 60 / 95
 * / 100 / 200 still turn 1 / 2 / 3 / 6 a frame (29.2 / 58 / 87.5 / 174.5
 * deg/s read), Turn 30 and below none. Turn 200 under a draining two-hit
 * charge climbs 8 -> 15 a frame one step at a time, each where this puts
 * it. GUESS (wave 52 finding 3, unread): a charged Turn-7 / 9 hull stops
 * dead (the floor of less than one degree), though uncharged it turns 1
 * a frame.
 *
 * The degrees a frame are snapped first (turnDegreesPerFrame); a nudge on
 * the product instead would hand a hull its whole turn back at a charge
 * of a trillionth. A ship with no turn keeps its (zero) turn. Pure.
 */
function turnFactor(q: number, rawTurnRate: number): number {
    const degreesPerFrame = turnDegreesPerFrame(rawTurnRate);
    if (!(degreesPerFrame > 0)) {
        return 1;
    }
    const kept = Math.floor(
        degreesPerFrame * (1 - Math.min(q, ION_CHARGE_HOLD)));
    return Math.max(0, kept) / Math.max(1, Math.floor(degreesPerFrame));
}

/** Multipliers ionization puts on a ship's movement physics. */
export interface IonSlowdown {
    maxVelocity: number;
    acceleration: number;
    turnRate: number;
}

export const NO_ION_SLOWDOWN: Readonly<IonSlowdown> =
    { maxVelocity: 1, acceleration: 1, turnRate: 1 };

/**
 * The slowdown of a ship whose ion charge is `ionization` and whose RAW
 * turn (ShipPhysics.turnRate, before unchargedTurnRate's whole degrees)
 * is `rawTurnRate` rad/s (the turn's cut depends on the hull:
 * turnFactor); the turn multiplier applies to the UNCHARGED turn,
 * unchargedTurnRate(rawTurnRate). Both cuts are in the charge share q = charge /
 * IonizeMax held at ION_CHARGE_HOLD (wave 51): the turn to whole degrees
 * a frame, floor(Turn / 10 x (1 - q)); the thrust 1 - q, about 0.3 at
 * the hold. The top speed is never cut. Nothing at no charge. A pure
 * function of the synced charge and the ship's physics.
 */
export function ionSlowdown(
    ionization: { current: number, max: number } | undefined,
    rawTurnRate: number,
): IonSlowdown {
    if (!ionization || ionization.max <= 0 || !(ionization.current > 0)) {
        return NO_ION_SLOWDOWN;
    }
    const q = ionization.current / ionization.max;
    return {
        maxVelocity: 1,
        acceleration: accelerationFactor(q),
        turnRate: turnFactor(q, rawTurnRate),
    };
}

export const IonizedEvent = new EcsEvent<boolean>('IonizedEvent');
export const IsIonizedComponent = new Component<boolean>('IsIonizedComponent');

/**
 * Whether a ship is ionized this tick, from its charge alone: above
 * ION_IONIZED_FRACTION of IonizeMax (see the module comment). A hull with
 * no ion capacity is never ionized.
 */
export function ionizedNow(
    ionization: { current: number, max: number, min: number }): boolean {
    if (ionization.max <= 0) {
        return false;
    }
    return ionization.current > ionization.max * ION_IONIZED_FRACTION;
}

export const IonizedSystem = new System({
    name: 'IonizedSystem',
    args: [IonizationComponent, Optional(IsIonizedComponent), SetComponent(IsIonizedComponent), UUID, Emit] as const,
    step(ionization, wasIonized, setComponent, uuid, emit) {
        const isIonized = ionizedNow(ionization);
        if (isIonized === wasIonized) {
            return;
        }

        setComponent(isIonized);
        emit(IonizedEvent, isIonized, [uuid]);
    },
    // Judge the raw charge left by last tick's hits (DamageSystem adds
    // after the step) before this tick's decay: otherwise a hit that
    // lands exactly on the ionized line would be decayed below it before
    // anyone looked at it.
    before: [IonizationRechargeSystem],
});

export const IonizedPlugin: Plugin = {
    name: 'IonizedPlugin',
    build(world) {
        world.resources.get(SerializerResource)?.addComponent(IsIonizedComponent, t.boolean);
        world.addSystem(IonizedSystem);
    },
    remove(world) {
        world.removeSystem(IonizedSystem);
    },
}
