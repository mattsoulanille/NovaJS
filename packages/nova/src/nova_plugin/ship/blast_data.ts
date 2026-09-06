import { WeaponDamage } from 'novadatainterface/weapon_data';
import { Component } from 'nova_ecs/component';

// Damage done by a blast.
export const BlastDamageComponent = new Component<WeaponDamage>('BlastComponent');

// A set of entities not to interact with. Usually just the entity that
// the projectile already hit so damage is not applied twice.
export const BlastIgnoreComponent = new Component<Set<string>>('BlastIgnoreComponent');
