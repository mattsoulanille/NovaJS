import { GetEntity } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { DeleteEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { FactoryQueue } from '../common/factory_queue';


export const ReturnToQueueComponent = new Component<{
    queue: FactoryQueue<Entity>
}>('ReturnToQueueComponent');

const ReturnToQueueSystem = new System({
    name: 'ReturnToQueue',
    events: [DeleteEvent],
    args: [GetEntity, ReturnToQueueComponent] as const,
    step(entity, { queue }) {
        queue.enqueue(entity);
    }
});

export const ReturnToQueuePlugin: Plugin = {
    name: 'ReturnToQueue',
    build(world) {
        world.addSystem(ReturnToQueueSystem);
    }
}
