import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import * as t from 'io-ts';
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { System } from "nova_ecs/system";
import { ControlAction, ControlStateEvent, PlayerShipSelector } from "./ship_controller_plugin";
import { ShipComponent } from "./ship_plugin";
import { Query } from "nova_ecs/query";
import { UUID } from "nova_ecs/arg_types";
import { Provide } from "nova_ecs/provider";


export const Target = t.type({
    target: t.union([t.string, t.undefined]),
});

export type Target = t.TypeOf<typeof Target>;

export const TargetComponent = new Component<Target>('TargetComponent');
const TargetIndexComponent = new Component<{ index: number }>('TargetIndexComponent');

const TargetIndexProvider = Provide({
    provided: TargetIndexComponent,
    args: [] as const,
    factory: () => ({ index: -1 }),
});

const CycleTargetSystem = new System({
    name: 'CycleTarget',
    events: [ControlStateEvent],
    args: [ControlStateEvent, TargetComponent, TargetIndexProvider, UUID,
        new Query([UUID, ShipComponent] as const), PlayerShipSelector] as const,
    step(controlState, target, index, uuid, ships) {
        if (controlState.get(ControlAction.cycleTarget) !== 'start') {
            return;
        }

        // index ranges from [-1, ships.length) with -1 being no target.
        index.index = (index.index + 2) % (ships.length + 1) - 1;

        // Don't target yourself
        if (index.index !== -1 && ships[index.index][0] === uuid) {
            index.index = (index.index + 2) % (ships.length + 1) - 1;
        }

        if (index.index === -1) {
            target.target = undefined;
        } else {
            target.target = ships[index.index][0];
        }
        console.log(target.target);
    }
});

export const TargetPlugin: Plugin = {
    name: "TargetPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(TargetComponent, {
            componentType: Target,
        });

        world.addSystem(CycleTargetSystem);
    }
}
