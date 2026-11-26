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
 * HALF of IonizeMax, and free again the tick it decays to half or below
 * — however it got there. While it holds, the ship is slowed
 * (ionSlowdown), the wëap IonizeColor tint is painted
 * (ship_animation_plugin reads IsIonizedComponent), and wëap Flags
 * 0x0020 weapons can't fire.
 *
 * MAINTAINER RULING #153: this is the reading the game shipped with
 * before PR #124, restored. #124 had replaced it with a full-charge /
 * full-dissipate hysteresis ("ionized at IonizeMax, until the charge is
 * gone") and a 0.1 slowdown, from the Bible's "nearly immobilized until
 * the ionization charge dissipates"; the maintainer reverted both to the
 * half-capacity level and the 0.6 factor, and will playtest from there.
 * Everything else #124 fixed stays: the IonizeMax-0 guard below, the
 * stat's percent guard (health_plugin), the IonizeColor tint, and the
 * ordering before the decay.
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
 * three (the pre-#124 value, never measured).
 */
export const ION_FULL_TURN_FACTOR = 0;
export const ION_FULL_ACCELERATION_FACTOR = 1 / 3;

/** Multipliers ionization puts on a ship's movement physics. */
export interface IonSlowdown {
    maxVelocity: number;
    acceleration: number;
    turnRate: number;
}

export const NO_ION_SLOWDOWN: Readonly<IonSlowdown> =
    { maxVelocity: 1, acceleration: 1, turnRate: 1 };

/**
 * The slowdown of a ship whose IsIonizedComponent is `isIonized` and whose
 * charge is `ionization`: none unless ionized; the measured full-charge
 * cut at IonizeMax or above; and in between, GUESS, linear in the charge
 * from the half line (where the ship becomes ionized, so the cut starts
 * from nothing) to IonizeMax (wave 6's "a fraction of its normal turn" was
 * a ship at a lower charge; the scaling itself was not measured). The top
 * speed is never cut.
 */
export function ionSlowdown(
    ionization: { current: number, max: number } | undefined,
    isIonized: boolean | undefined): IonSlowdown {
    if (!isIonized || !ionization || ionization.max <= 0) {
        return NO_ION_SLOWDOWN;
    }
    const half = ionization.max / 2;
    const severity = Math.min(1, Math.max(0,
        (ionization.current - half) / half));
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
 * Whether a ship is ionized this tick, from its charge alone: above half
 * of IonizeMax (see the module comment; ruling #153). A hull with no ion
 * capacity is never ionized.
 */
export function ionizedNow(
    ionization: { current: number, max: number, min: number }): boolean {
    if (ionization.max <= 0) {
        return false;
    }
    return ionization.current > ionization.max / 2;
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
    // lands exactly on the half line would be decayed below it before
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
