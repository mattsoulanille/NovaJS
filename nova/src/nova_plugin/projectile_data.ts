import { ProjectileWeaponData } from 'nova_data_interface/WeaponData';
import { Component } from 'nova_ecs/component';


export interface ProjectileType {
    id: string,
    source?: string,
}

export const ProjectileComponent = new Component<ProjectileType>('Projectile');
export const ProjectileDataComponent = new Component<ProjectileWeaponData>('ProjectileData');
