import { ProjectileWeaponData } from 'novadatainterface/WeaponData';
import { Component } from 'nova_ecs/component';
import { Hull } from './collisions_plugin';


export interface ProjectileType {
    id: string,
    source?: string,
}

export const ProjectileComponent = new Component<ProjectileType>('Projectile');
export const ProjectileDataComponent = new Component<ProjectileWeaponData>('ProjectileData');
export const ProjectileBlastHull = new Component<Hull>('ProjectileBlastHull');
