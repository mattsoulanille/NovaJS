import { Component } from "nova_ecs/component";
import { Plugin } from 'nova_ecs/plugin';
import * as t from 'io-ts';
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { applyObjectDelta, getObjectDelta } from "nova_ecs/plugins/delta";
import { System } from "nova_ecs/system";
import { TimeResource } from "nova_ecs/plugins/time_plugin";


const StatContents = {
    current: t.number,
    recharge: t.number,
    max: t.number,
    changed: t.boolean,
};
const Stat = t.type(StatContents);
type Stat = t.TypeOf<typeof Stat>;
const PartialStat = t.partial(StatContents);
type PartialStat = t.TypeOf<typeof PartialStat>;

export const Health = t.type({
    shield: Stat,
    armor: Stat,
    ionization: Stat,
});

const PartialHealth = t.partial({
    shield: PartialStat,
    armor: PartialStat,
    ionization: PartialStat,
});

export type Health = t.TypeOf<typeof Health>;
type PartialHealth = t.TypeOf<typeof PartialHealth>;

function getStatDelta(a: Stat, b: Stat): PartialStat | undefined {
    if (b.changed) {
        b.changed = false;
        return getObjectDelta(a, b);
    }
    return undefined;
}

function getHealthDelta(a: Health, b: Health): PartialHealth | undefined {
    const result: PartialHealth = {};
    let changed = false;
    for (const [untypedKey, bStat] of Object.entries(b)) {
        const key = untypedKey as keyof Health;
        const aStat = a[key];
        const delta = getStatDelta(aStat, bStat);
        if (delta) {
            result[key as keyof Health] = delta;
            changed = true;
        }
    }
    if (changed) {
        return result;
    }
    return undefined;
}

function applyHealthDelta(state: Health, delta: PartialHealth) {
    for (const [untypedKey, statDelta] of Object.entries(delta)) {
        const key = untypedKey as keyof Health;
        const statState = state[key];
        if (statDelta) {
            applyObjectDelta(statState, statDelta);
        }
    }
}

export const HealthComponent = new Component<Health>('Health');

const HealthRecharge = new System({
    name: "HealthRecharge",
    args: [HealthComponent, TimeResource] as const,
    step(health, time) {
        for (const val of Object.values(health)) {
            val.current = Math.min(val.max,
                val.current + val.recharge * time.delta_s);
        }
    }
});

export const HealthPlugin: Plugin = {
    name: "HealthPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(HealthComponent, {
            componentType: Health,
            deltaType: PartialHealth,
            getDelta: getHealthDelta,
            applyDelta: applyHealthDelta,
        });

        world.addSystem(HealthRecharge);
    }
}

