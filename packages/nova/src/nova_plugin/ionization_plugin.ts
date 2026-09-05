import * as t from 'io-ts';
import { Emit, GetEntity, UUID } from "nova_ecs/arg_types";
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
 * So "ionized" is a STATE with hysteresis, not a level:
 *  - it begins when the charge reaches IonizeMax (the stat's max);
 *  - it lasts "until the ionization charge dissipates" — back to the
 *    stat's min (0) — however many hits land in between;
 *  - while it lasts the ship is nearly immobilized (ION_FACTOR), the
 *    wëap IonizeColor tint is painted (ship_animation_plugin reads
 *    IsIonizedComponent), and wëap Flags 0x0020 weapons can't fire.
 *
 * The state lives in IsIonizedComponent, which is serializer-registered
 * and so carried in rollback snapshots and wire baselines like
 * DisabledComponent; every peer derives it from the same charge history.
 *
 * RULING (Bible silent): a hull with IonizeMax <= 0 has no ion capacity
 * and is never ionized. Two plug-in hulls ship that value (arpia:599,
 * Star Wars Mod:451, both with Deionize 0 too); reading it the other way
 * would leave them permanently crippled by a single ion hit. The stat
 * clamps their charge back to [0, 0] on the tick after every hit.
 */

/**
 * How much ionization slows a ship — the multiplier on speed,
 * acceleration and turn rate while IsIonizedComponent is true (applied
 * by EffectiveMovementPhysicsSystem in afterburner_plugin.ts). The
 * Bible gives no number, only "nearly immobilized"; TUNABLE, kept low
 * enough that a fully ionized ship visibly crawls.
 */
export const ION_FACTOR = 0.1;

export const IonizedEvent = new EcsEvent<boolean>('IonizedEvent');
export const IsIonizedComponent = new Component<boolean>('IsIonizedComponent');

/**
 * Whether a ship is ionized this tick, given its charge and whether it
 * was ionized last tick (hysteresis; see the module comment).
 */
export function ionizedNow(ionization: { current: number, max: number, min: number },
    wasIonized: boolean): boolean {
    if (ionization.max <= 0) {
        return false;
    }
    return wasIonized
        ? ionization.current > ionization.min
        : ionization.current >= ionization.max;
}

const IonizedSystem = new System({
    name: 'IonizedSystem',
    args: [IonizationComponent, Optional(IsIonizedComponent), GetEntity, UUID, Emit] as const,
    step(ionization, wasIonized, entity, uuid, emit) {
        const isIonized = ionizedNow(ionization, wasIonized ?? false);
        if (isIonized === wasIonized) {
            return;
        }

        entity.components.set(IsIonizedComponent, isIonized);
        emit(IonizedEvent, isIonized, [uuid]);
    },
    // Judge the raw charge left by last tick's hits (DamageSystem adds
    // after the step, unclamped) before this tick's decay-and-clamp:
    // otherwise a hit that lands exactly on IonizeMax would be decayed
    // below "fully ionized" before anyone looked at it.
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
