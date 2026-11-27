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
 * ION_IONIZED_FRACTION (a third) of IonizeMax, and free again the tick it
 * decays to that line or below — however it got there. While it holds,
 * the wëap IonizeColor tint is painted (ship_animation_plugin reads
 * IsIonizedComponent) and wëap Flags 0x0020 weapons can't fire. The
 * turn cut (ionSlowdown) is a function of the charge alone, in three
 * steps: one with the first point of charge, one at the ionized (tint)
 * line, and the full cut above a second line (ION_NO_TURN_FRACTION, two
 * thirds); the acceleration instead slides with the charge from the
 * first point down to its full cut at that second line (waves 47 / 48,
 * re-mapped onto the charge read in wave 50).
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
 * three (the pre-#124 value, never measured). Both full cuts hold from
 * the second line (ION_NO_TURN_FRACTION) up: the turn's at once (wave
 * 42 / 50), the acceleration's at the end of its slide (wave 48 / 50,
 * ION_ACCELERATION_SLOPE).
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
 * (reference "The ion charge read directly (E6, the hub's item 2), wave
 * 50", finding 2): a single 30-point hit on IonizeMax 100 never tinted;
 * two 30-point hits tinted until the drain (0.01 x Deionize a frame,
 * DEIONIZE_FRAME_RATE) took them to 33.0; 5-point ticks tinted at the
 * 9th hit (35.5) and not the 8th (31.4), and a slower feed at its 10th
 * (35.2) and not its 9th (32.0): 33.0 +- 1, a third. Wave 42's
 * recount (finding 4) agrees. Was 0.16 (wave 42, which had missed the
 * take-off's hits), 0.3 (wave 41) and half before that (ruling #153).
 */
export const ION_IONIZED_FRACTION = 1 / 3;

/**
 * The share of IonizeMax above which an ionized ship does not turn at
 * all (the turn's full cut, ION_FULL_TURN_FACTOR), and where the
 * acceleration's slide reaches its own (ION_FULL_ACCELERATION_FACTOR).
 * MEASURED, the same section, findings 3-4: 58.9 still turned at a third;
 * a 5-point rise still turned at a third at 65.4; six 30-point hits never
 * turned; wave 42's recount puts its last turning charge at 64.2 and its
 * first stopped one at 67.2. GUESS two thirds inside that 64-67 bracket
 * (the section's proposal). Was 0.38 (wave 42, missed hits).
 */
export const ION_NO_TURN_FRACTION = 2 / 3;

/**
 * How much of the full cut (ION_FULL_*) each step of the charge applies:
 * MEASURED on the turn (wave 42: about two thirds of the turn, 60 of 87.8
 * deg/s, for any untinted charge; about a third, 30 deg/s, once tinted;
 * none above the second line), two identical runs and wave 41's
 * Deionize-0 dips (58 deg/s just after a 20-point hit); wave 50 again
 * (58.4 deg/s under one 30-point hit, about 30 once tinted, the control
 * 87.6). These shares are the TURN's.
 */
export const ION_UNTINTED_SEVERITY = 1 / 3;
export const ION_TINTED_SEVERITY = 2 / 3;

/**
 * The acceleration multiplier lost per unit of charge fraction q (the
 * charge over IonizeMax): the thrust is max(ION_FULL_ACCELERATION_FACTOR,
 * 1 - ION_ACCELERATION_SLOPE x q), ONE line from full thrust at no charge
 * to the full cut's 0.4 at the no-turn line (two thirds), with no
 * separate untinted level and no step at either line.
 *
 * MEASURED, re-mapped (reference "The ion charge read directly (E6, the
 * hub's item 2), wave 50", finding 5): wave 48's twelve Up pulses under
 * the Ionization-5 tick (0.97 - 0.0103 x t in time, "The ion thrust
 * slide's ends (E6), wave 48"), put on the charge with wave 50's drain
 * (about 1.10 x t + 2.5), fit 1.03 - 1.01 x q, reaching 0.4 at q = 0.62.
 * GUESS 0.9, the section's proposal: the same line pinned to 1 at no
 * charge and to 0.4 at the no-turn line, (1 - 0.4) / (2 / 3). Was 0.96
 * untinted, then 0.85 at the tint line sliding through 0.6 at the
 * no-turn line to 0.4 at 0.556 (waves 47 / 48 on a GUESSED time-to-charge
 * mapping), steps of 0.93 / 0.71 (wave 45) and 7/9 / 5/9 (GUESS) before.
 */
export const ION_ACCELERATION_SLOPE = 0.9;

/**
 * The thrust multiplier at a charge `fraction` of IonizeMax: the slide
 * (ION_ACCELERATION_SLOPE), floored at ION_FULL_ACCELERATION_FACTOR,
 * which it reaches at ION_NO_TURN_FRACTION. Pure.
 */
function accelerationFactor(fraction: number): number {
    return Math.max(ION_FULL_ACCELERATION_FACTOR,
        1 - ION_ACCELERATION_SLOPE * fraction);
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
 * The slowdown of a ship whose ion charge is `ionization`. The turn comes
 * in three steps (MEASURED, references "Ion charge against the turn, in
 * 5-point steps (E6), wave 42" and "The ion charge read directly (E6, the
 * hub's item 2), wave 50"; see ION_*_SEVERITY): none at no charge; a
 * third of the full cut for any charge up to the ionized line (a third
 * of IonizeMax); two thirds of it from there to ION_NO_TURN_FRACTION (two
 * thirds); the measured full cut (no turn) above. The acceleration SLIDES
 * with the charge from the first point, 1 - 0.9 q, down to the full
 * cut's 0.4 at the no-turn line (waves 47 / 48 / 50; see
 * ION_ACCELERATION_SLOPE). The top speed is never cut. A pure function of
 * the synced charge.
 */
export function ionSlowdown(
    ionization: { current: number, max: number } | undefined,
): IonSlowdown {
    if (!ionization || ionization.max <= 0 || !(ionization.current > 0)) {
        return NO_ION_SLOWDOWN;
    }
    const { current, max } = ionization;
    const acceleration = accelerationFactor(current / max);
    if (current > max * ION_NO_TURN_FRACTION) {
        return {
            maxVelocity: 1,
            acceleration,
            turnRate: ION_FULL_TURN_FACTOR,
        };
    }
    const tinted = current > max * ION_IONIZED_FRACTION;
    const severity = tinted ? ION_TINTED_SEVERITY : ION_UNTINTED_SEVERITY;
    return {
        maxVelocity: 1,
        acceleration,
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
