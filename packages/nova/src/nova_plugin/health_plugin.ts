import * as t from 'io-ts';
import { Component } from "nova_ecs/component";
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { TimeResource, TimeSystem } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { DisabledComponent } from './disabled_component.js';
import { applyStatDelta, getStatDelta, PartialStat, stat, Stat } from "./stat.js";


export const ShieldComponent = new Component<Stat>('Shield');
export const ArmorComponent = new Component<Stat>('Armor');
export const IonizationComponent = new Component<Stat>('Ionization');
// Fuel isn't health, but it recharges and is serialized exactly like
// the health stats (100 units = 1 hyperspace jump).
export const FuelComponent = new Component<Stat>('Fuel');
export const FUEL_PER_JUMP = 100;
/**
 * Fuel regenerated per second by an "auto-refueller" outfit (oütf ModType 19).
 * The EVN Bible does not give a rate, so this is a tuned constant: 2.5
 * units/second regenerates one jump's fuel (100 units) in 40 seconds — slow
 * enough to feel like a trickle, fast enough to matter over a trip. Folded
 * into the fuel Stat's recharge in ShipFuelProvider when the ship has the
 * capability (physics.autoRefuel).
 */
export const AUTO_REFUEL_PER_SECOND = 2.5;

// Shield, armor, and fuel ("energy") recharges are suspended while the
// ship is disabled — a disabled ship regains nothing on its own (EVN
// Bible; see disabled_component.ts). That covers inherent, outfit-driven
// (solar panels etc. fold into the Stat's recharge rate), and
// auto-refuel regeneration alike. Ionization is NOT suspended: its
// "recharge" is the deionization decay, which keeps draining.
const disableSuspendedStats = new Set<Component<Stat>>(
    [ShieldComponent, ArmorComponent, FuelComponent]);

const healthStats = [ShieldComponent, ArmorComponent, IonizationComponent,
    FuelComponent]
    .map(statComponent => [statComponent, new System({
        name: `${statComponent.name}Recharge`,
        args: [statComponent, TimeResource,
            Optional(DisabledComponent)] as const,
        step(stat, time, disabled) {
            if (disabled && disableSuspendedStats.has(statComponent)) {
                // No recharge, but still clamp to [min, max]: damage
                // subtraction (DamageSystem) is unbounded and normally
                // relies on this step's clamping.
                stat.step(0);
                return;
            }
            stat.step(time.delta_s);
        },
        // Determinism rule 4: this recharge reads time.delta_s, so it must
        // run after TimeSystem has produced this tick's delta. Without the
        // edge the toposort could place it before TimeSystem after a
        // wire-baseline restore, applying the previous tick's delta and
        // diverging late joiners by one tick's worth of recharge.
        after: [TimeSystem],
    })] as const);

/**
 * The ionization stat's per-tick decay-and-clamp, exported so
 * IonizedSystem (ionization_plugin) can order itself BEFORE it and judge
 * "fully ionized" on the raw post-hit charge, before the clamp to
 * IonizeMax and the tick's Deionize erase the overshoot.
 */
export const IonizationRechargeSystem = healthStats
    .find(([component]) => component === IonizationComponent)![1];

export const IonizationColorComponent =
    new Component<{ color: number }>('IonizationColorComponent');

export const HealthPlugin: Plugin = {
    name: "HealthPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        for (const [healthComponent, healthRecharge] of healthStats) {
            deltaMaker.addComponent(healthComponent, {
                componentType: stat,
                deltaType: PartialStat,
                getDelta: getStatDelta,
                applyDelta: applyStatDelta,
            });

            world.addSystem(healthRecharge);
        }
        world.resources.get(SerializerResource)?.addComponent(IonizationColorComponent, t.type({
            color: t.number,
        }));
    }
}
