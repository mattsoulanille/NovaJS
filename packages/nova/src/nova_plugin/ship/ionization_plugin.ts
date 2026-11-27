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
 * ION_IONIZED_FRACTION (0.3) of IonizeMax, and free again the tick it
 * decays to that line or below — however it got there. While it holds,
 * the wëap IonizeColor tint is painted (ship_animation_plugin reads
 * IsIonizedComponent) and wëap Flags 0x0020 weapons can't fire. The
 * slowdown (ionSlowdown) is a function of the charge alone: it starts
 * with the first point of charge and is complete at the ionized line.
 *
 * MAINTAINER RULING #153 restored the level test (over #124's full-charge
 * / full-dissipate hysteresis) at HALF of IonizeMax; the line has since
 * been measured lower (reference "Ionization below a full charge (E6
 * leftover), wave 41": a Deionize-1 hull was tinted from its SECOND
 * 20-point hit, about 39 of IonizeMax 100 after the drain between hits,
 * and not after the first). Everything else #124 fixed stays: the
 * IonizeMax-0 guard below, the stat's percent guard (health_plugin), the
 * IonizeColor tint, and the ordering before the decay.
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
 * three (the pre-#124 value, never measured). Wave 41 found the turn
 * already gone at the tint (about 40 of 100 and up), so the full cut
 * holds from the ionized line (ION_IONIZED_FRACTION) up.
 */
export const ION_FULL_TURN_FACTOR = 0;
export const ION_FULL_ACCELERATION_FACTOR = 1 / 3;

/**
 * The share of IonizeMax above which a ship is IONIZED (tinted, its
 * Flags 0x0020 weapons silent, its turn and acceleration fully cut).
 * MEASURED to lie between 20 and about 39 of IonizeMax 100 (reference
 * "Ionization below a full charge (E6 leftover), wave 41": not tinted
 * after one 20-point hit, tinted after the second, which with Deionize
 * 1's 0.3 a second drained over the 3.6 s between hits is about 39);
 * GUESS 0.3, the middle of that bracket (the section's own 0.4 would miss
 * the second hit's 39). Was half (ruling #153).
 */
export const ION_IONIZED_FRACTION = 0.3;

/** Multipliers ionization puts on a ship's movement physics. */
export interface IonSlowdown {
    maxVelocity: number;
    acceleration: number;
    turnRate: number;
}

export const NO_ION_SLOWDOWN: Readonly<IonSlowdown> =
    { maxVelocity: 1, acceleration: 1, turnRate: 1 };

/**
 * The slowdown of a ship whose ion charge is `ionization`: none at no
 * charge; the measured full cut (no turn, a third of the acceleration)
 * from the ionized line (ION_IONIZED_FRACTION of IonizeMax) up; and below
 * it, GUESS, linear in the charge from nothing at zero to the full cut at
 * the line. MEASURED that a charge well below the line already slows the
 * turn (reference "Ionization below a full charge (E6 leftover), wave
 * 41": a 20-point hit on a Deionize-0 hull of IonizeMax 100, never
 * tinted, cut the turn to about 58 deg/s in the next 10 frames and 68 in
 * the 10 after, the control 87.8, as the charge drained at about 1 a
 * frame); the linear ramp to the line fits those two dips about as well
 * as the section's 1 - 1.5 x charge / IonizeMax and leaves no jump at the
 * tint. The top speed is never cut. A pure function of the synced charge.
 */
export function ionSlowdown(
    ionization: { current: number, max: number } | undefined,
): IonSlowdown {
    if (!ionization || ionization.max <= 0 || !(ionization.current > 0)) {
        return NO_ION_SLOWDOWN;
    }
    const line = ionization.max * ION_IONIZED_FRACTION;
    const severity = Math.min(1, ionization.current / line);
    // Written as a blend so a full charge gives the constants exactly.
    return {
        maxVelocity: 1,
        acceleration: (1 - severity)
            + severity * ION_FULL_ACCELERATION_FACTOR,
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
