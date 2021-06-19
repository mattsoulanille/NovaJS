import { WeaponDamage } from "novadatainterface/WeaponData";
import { Component } from "nova_ecs/component";
import { EcsEvent } from "nova_ecs/events";
import { Stat } from "./stat";


export interface CollisionInteraction {
    vulnerableTo?: Set<unknown>;
    hitTypes?: Set<unknown>;
}

export const CollisionInteractionComponent =
    new Component<CollisionInteraction>('CollisionTypes');

export const CollisionEvent = new EcsEvent<{ other: string }>('CollisionEvent');

export function applyDamage(damage: WeaponDamage, armor: Stat,
    shield?: Stat, ionization?: Stat, scale = 1) {

    if (damage.ionization !== 0 && ionization) {
        ionization.current += damage.ionization * scale;
    }

    if (shield) {
        const minShield = -shield.max * 0.05;
        shield.current = Math.max(minShield,
            shield.current - damage.shield * scale);
        if (shield.current > 0) {
            return;
        }
    }

    armor.current = Math.max(0, armor.current - damage.armor * scale)
}
