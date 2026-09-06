import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { Component } from 'nova_ecs/component';
import { Hull } from './collisions_plugin.js';


export interface ProjectileType {
    id: string,
    source?: string,
}

export const ProjectileComponent = new Component<ProjectileType>('Projectile');
export const ProjectileDataComponent = new Component<ProjectileWeaponData>('ProjectileData');
export const ProjectileBlastHull = new Component<Hull>('ProjectileBlastHull');
