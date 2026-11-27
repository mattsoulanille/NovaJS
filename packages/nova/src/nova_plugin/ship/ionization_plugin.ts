import * as t from 'io-ts';
import { Emit, SetComponent, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { System } from "nova_ecs/system";
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
 * ION_IONIZED_FRACTION (0.16) of IonizeMax, and free again the tick it
 * decays to that line or below — however it got there. While it holds,
 * the wëap IonizeColor tint is painted (ship_animation_plugin reads
 * IsIonizedComponent) and wëap Flags 0x0020 weapons can't fire. The
 * slowdown (ionSlowdown) is a function of the charge alone, in three
 * steps: one with the first point of charge, one at the ionized (tint)
 * line, and the full cut above a second line (ION_NO_TURN_FRACTION).
 *
 * MAINTAINER RULING #153 restored the level test (over #124's full-charge
 * / full-dissipate hysteresis) at HALF of IonizeMax; the line has since
 * been measured lower (reference "Ionization below a full charge (E6
 * leftover), wave 41", and "Ion charge against the turn, in 5-point steps
 * (E6), wave 42": tinted from the 5th 5-point hit, not the 4th, with
 * Deionize 1 draining about 2 points between hits). Everything else #124
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
 * at IonizeMax (ionSlowdown); the extra charge only makes it last.
 *
 * RULING (Bible silent): a hull with IonizeMax <= 0 has no ion capacity
 * and is never ionized. Two plug-in hulls ship that value (arpia:599,
 * Star Wars Mod:451, both with Deionize 0 too); reading it the other way
 * would leave them permanently crippled by a single ion hit. The stat
 * clamps their charge back to [0, 0] on the tick after every hit.
 */

/**
 * How ionization slows a ship, MEASURED at a full charge (reference
 * "Ionization (E6), wave 39"): a player ionized to (or past) IonizeMax
 * does not turn at all (0 deg/s in every hold, the control 87.8 deg/s),
 * accelerates about a third as fast (0 -> top speed in 3-3.4 s against
 * 1.1 s) and keeps its top speed. This replaces ruling #153's 0.6 on all
 * three (the pre-#124 value, never measured). The full cut holds above
 * the second line (ION_NO_TURN_FRACTION), wave 42.
 *
 * The acceleration's full cut was re-read on a pad of moons (reference
 * "Acceleration under ionization (E6 leftover), wave 44"): a hull charged
 * past the no-turn line thrust at 19.6 and 22.3 px/s² against the
 * uncharged control's 52.0 and 49.8 for the same 0.57 s Up pulse, about
 * 0.4 (0.39-0.45). Was 1/3 (wave 39's star-field reading).
 */
export const ION_FULL_TURN_FACTOR = 0;
export const ION_FULL_ACCELERATION_FACTOR = 0.4;

/**
 * The share of IonizeMax above which a ship is IONIZED (tinted, its
 * Flags 0x0020 weapons silent, its turn cut to a third). MEASURED
 * (reference "Ion charge against the turn, in 5-point steps (E6), wave
 * 42"): a Deionize-1 hull of IonizeMax 100 hit for 5 every 3.6 s was
 * tinted from the 5th hit, not the 4th; with Deionize 1 draining 2.0
 * points between hits (0.01 a 1/56 s frame, DEIONIZE_FRAME_RATE) that is
 * a line between 14 and 17, and a 20-point hit tints at once (wave 42's
 * e6b_b). GUESS 0.16, the section's proposal. Was 0.3 (wave 41's
 * bracket, read with the slower 1/30 s drain), and half before that
 * (ruling #153).
 */
export const ION_IONIZED_FRACTION = 0.16;

/**
 * The share of IonizeMax above which an ionized ship does not turn at
 * all (the full cut, ION_FULL_*). MEASURED, the same section: the
 * 5-point hull turned at a third through hits 5-12 and not at all from
 * hit 13 (with the 2.0 drain, charges 38 and 41), and the 20-point hull
 * not at all from its second hit (38). GUESS 0.38, the section's
 * proposal (the two runs meet at about 38).
 */
export const ION_NO_TURN_FRACTION = 0.38;

/**
 * How much of the full cut (ION_FULL_*) each step of the charge applies:
 * MEASURED on the turn (wave 42: about two thirds of the turn, 60 of 87.8
 * deg/s, for any untinted charge; about a third, 30 deg/s, once tinted;
 * none above the second line), two identical runs and wave 41's
 * Deionize-0 dips (58 deg/s just after a 20-point hit). These shares are
 * the TURN's.
 */
export const ION_UNTINTED_SEVERITY = 1 / 3;
export const ION_TINTED_SEVERITY = 2 / 3;

/**
 * The acceleration's multiplier on the two lower steps (untinted, then
 * tinted). NOT measured: the wave-44 pad rig could not read them (the
 * ion bolts push the ship off the pad, reference "Acceleration under
 * ionization (E6 leftover), wave 44"). GUESS: the values main derived
 * before that wave, the turn's shares of the old 1/3 full cut (7/9 and
 * 5/9), kept as they were rather than re-derived from the measured 0.4;
 * they still fall step by step to ION_FULL_ACCELERATION_FACTOR.
 */
export const ION_UNTINTED_ACCELERATION_FACTOR = 7 / 9;
export const ION_TINTED_ACCELERATION_FACTOR = 5 / 9;

/** Multipliers ionization puts on a ship's movement physics. */
export interface IonSlowdown {
    maxVelocity: number;
    acceleration: number;
    turnRate: number;
}

export const NO_ION_SLOWDOWN: Readonly<IonSlowdown> =
    { maxVelocity: 1, acceleration: 1, turnRate: 1 };

/**
 * The slowdown of a ship whose ion charge is `ionization`, in three
 * steps (MEASURED, reference "Ion charge against the turn, in 5-point
 * steps (E6), wave 42"; see ION_*_SEVERITY): none at no charge; a third
 * of the full cut for any charge up to the ionized line; two thirds of it
 * from there to ION_NO_TURN_FRACTION; the measured full cut (no turn, 0.4
 * of the acceleration, wave 44) above. The acceleration's lower steps are
 * ION_UNTINTED/TINTED_ACCELERATION_FACTOR (GUESS). Was a linear ramp to
 * the ionized line (GUESS, wave 41). The top speed is never cut. A pure
 * function of the synced charge.
 */
export function ionSlowdown(
    ionization: { current: number, max: number } | undefined,
): IonSlowdown {
    if (!ionization || ionization.max <= 0 || !(ionization.current > 0)) {
        return NO_ION_SLOWDOWN;
    }
    const { current, max } = ionization;
    if (current > max * ION_NO_TURN_FRACTION) {
        return {
            maxVelocity: 1,
            acceleration: ION_FULL_ACCELERATION_FACTOR,
            turnRate: ION_FULL_TURN_FACTOR,
        };
    }
    const tinted = current > max * ION_IONIZED_FRACTION;
    const severity = tinted ? ION_TINTED_SEVERITY : ION_UNTINTED_SEVERITY;
    return {
        maxVelocity: 1,
        acceleration: tinted ? ION_TINTED_ACCELERATION_FACTOR
            : ION_UNTINTED_ACCELERATION_FACTOR,
        // A blend of the turn's full cut, so its steps are exact thirds.
        turnRate: (1 - severity) + severity * ION_FULL_TURN_FACTOR,
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
