import { WeaponDamage } from 'novadatainterface/WeaponData';
import { Emit, EmitFunction, RunQuery, RunQueryFunction } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { Time, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { ArmorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { ProjectileComponent } from './projectile_data';

type ApplyDamage = (damage: WeaponDamage, other: string, scale?: number) => void;

const DamageQuery = new Query([Optional(ShieldComponent), Optional(ArmorComponent),
Optional(IonizationComponent), Optional(ProjectileComponent),
    TimeResource] as const);

export const DeathEvent = new EcsEvent<Time>('DeathEvent');

export const ApplyDamageResource = new Resource<ApplyDamage>('ApplyDamageComponent');

function applyDamage(emit: EmitFunction, runQuery: RunQueryFunction,
    damage: WeaponDamage, other: string, scale = 1) {
    const result = runQuery(DamageQuery, other)[0];
    if (!result) {
        console.warn(`Cannot apply damage to non-existant entity ${other}`);
        return;
    }

    const [shield, armor, ionization, otherIsProjectile, time] = result;
    if (!armor) {
        return;
    }

    const hasShield = shield && shield.max > 0;
    if (otherIsProjectile && !hasShield) {
        // We're colliding with another projectile, so use
        // point defense damage scaling.
        damage = {
            ...damage,
            armor: damage.armor + damage.shield / 2,
        };
    }

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
    if (armor.current === 0) {
        emit(DeathEvent, time, [other]);
    }
}

export const DeathPlugin: Plugin = {
    name: 'DeathPlugin',
    build(world) {
        const runQuery = world.resources.get(RunQuery)!;
        const emit = world.resources.get(Emit)!;
        world.resources.set(ApplyDamageResource, (damage, other, scale = 1) => {
            applyDamage(emit, runQuery, damage, other, scale);
        });
    },
}
