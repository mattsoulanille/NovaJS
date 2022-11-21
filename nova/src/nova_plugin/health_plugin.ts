import { Component } from "nova_ecs/component";
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { System } from "nova_ecs/system";
import { stat, Stat } from "./stat";


export const ShieldComponent = new Component<Stat>('Shield');
export const ArmorComponent = new Component<Stat>('Armor');
export const IonizationComponent = new Component<Stat>('Ionization');

const healthStats = [ShieldComponent, ArmorComponent, IonizationComponent]
    .map(statComponent => [statComponent, new System({
        name: `${statComponent.name}Recharge`,
        args: [statComponent, TimeResource] as const,
        step(stat, time) {
            stat.step(time.delta_s);
        }
    })] as const);

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
            });

            world.addSystem(healthRecharge);
        }
    }
}

