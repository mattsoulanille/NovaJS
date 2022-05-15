import { WeaponDamage } from 'novadatainterface/WeaponData';
import { Emit, RunQuery, UUID } from 'nova_ecs/arg_types';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { Time, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { ArmorComponent, IonizationColorComponent, IonizationComponent, ShieldComponent } from './health_plugin';
import { ProjectileComponent } from './projectile_data';

// const DamageQuery = new Query([Optional(ShieldComponent), Optional(ArmorComponent),
// Optional(IonizationComponent), Optional(IonizationColorComponent),
// Optional(ProjectileComponent), TimeResource] as const);

export const DeathEvent = new EcsEvent<Time>('DeathEvent');

export const DamagedEvent = new EcsEvent<{ damage: WeaponDamage, damager: string, scale?: number }>('DamagedEvent');

const DamageSystem = new System({
    name: 'DamageSystem',
    events: [DamagedEvent],
    args: [Emit, DamagedEvent, Optional(ShieldComponent), Optional(ArmorComponent),
        Optional(IonizationComponent), Optional(IonizationColorComponent),
        Optional(ProjectileComponent), TimeResource, UUID] as const,
    step(emit, { damage, scale = 1 }, shield, armor, ionization, ionizationColor, isProjectile, time, uuid) {

        const hasShield = shield && shield.max > 0;
        if (isProjectile && !hasShield) {
            // This is a projectile, so use point defense damage scaling.
            damage = {
                ...damage,
                armor: damage.armor + damage.shield / 2,
            };
        }

        if (damage.ionization !== 0 && ionization) {
            ionization.current += damage.ionization * scale;
            if (ionizationColor) {
                ionizationColor.color = damage.ionizationColor;
            }
        }

        if (shield && !damage.passThroughShield) {
            shield.current -= damage.shield * scale;
            if (shield.current > 0) {
                return;
            }
        }
        if (armor) {
            armor.current = Math.max(0, armor.current - damage.armor * scale)
            if (armor.current === 0) {
                emit(DeathEvent, time, [uuid]);
            }
        }
    }
});

export const DeathPlugin: Plugin = {
    name: 'DeathPlugin',
    build(world) {
        //const runQuery = world.resources.get(RunQuery)!;
        //const emit = world.resources.get(Emit)!;
        world.addSystem(DamageSystem);
    },
    remove(world) {
        world.removeSystem(DamageSystem);
    }
}
