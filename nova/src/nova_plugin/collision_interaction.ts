import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";


export interface CollisionInteraction {
    vulnerableTo?: Set<unknown>;
    hitTypes?: Set<unknown>;
}

export const CollisionInteractionComponent =
    new Component<CollisionInteraction>('CollisionTypes');

export const CollisionEvent = new EcsEvent<{ other: string, initiator: boolean }>('CollisionEvent');
