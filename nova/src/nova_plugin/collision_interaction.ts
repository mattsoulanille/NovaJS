import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";


export interface CollisionHitter {
    hitTypes: Set<unknown>;
}

export interface CollisionVulnerability {
    vulnerableTo: Set<unknown>;
}

export const CollisionHitterComponent = new Component<CollisionHitter>('CollisionHitter');
export const CollisionVulnerabilityComponent = new Component<CollisionVulnerability>('CollisionVulnurability');

export const CollisionEvent = new EcsEvent<{ other: string, initiator: boolean }>('CollisionEvent');
