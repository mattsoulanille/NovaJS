import * as t from 'io-ts';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { ControlAction, ControlStateEvent, PlayerShipSelector } from './ship_controller_plugin';
import { GameDataResource } from './game_data_resource';
import { makeProjectile, TargetComponent } from './projectile_plugin';
import { PlatformResource } from './platform_plugin';


const WeaponState = t.intersection([t.type({
    count: t.number,
    firing: t.boolean,
}), t.partial({
    target: t.string,
})]);
export type WeaponState = t.TypeOf<typeof WeaponState>;

const WeaponsState = map(t.string /* weapon id */, WeaponState);
export type WeaponsState = t.TypeOf<typeof WeaponsState>;
export const WeaponsStateComponent = new Component<WeaponsState>('WeaponsStateComponent');


interface WeaponLocalState {
    lastFired: number,
    burstCount: number,
    reloadingBurst: boolean,
}
type WeaponsLocalState = Map<string, WeaponLocalState>;
const WeaponsComponent = new Component<WeaponsLocalState>('WeaponsComponent')
// TODO: This doesn't update if the set or count of weapons changes.
const WeaponsComponentProvider = ProvideAsync({
    provided: WeaponsComponent,
    args: [] as const,
    async factory() {
        return new Map();
    }
});


const WeaponsSystem = new System({
    name: 'WeaponsSystem',
    args: [WeaponsStateComponent, WeaponsComponentProvider, Entities,
        MovementStateComponent, TimeResource, GameDataResource, UUID,
        Optional(TargetComponent)] as const,
    step(weaponsState, weaponsLocalState, entities, movementState, time,
        gameData, uuid, target) {
        for (const [id, state] of weaponsState) {
            const weapon = gameData.data.Weapon.getCached(id);
            if (!(weapon && state.firing)) {
                continue;
            }

            if (!weaponsLocalState.has(id)) {
                weaponsLocalState.set(id, {
                    lastFired: 0,
                    burstCount: 0,
                    reloadingBurst: false,
                });
            }
            const localState = weaponsLocalState.get(id)!;
            const lastFired = localState.lastFired;

            const reloadTime = ((1 / weapon.fireRate) / state.count) * 1000;
            if (time.time - lastFired < reloadTime) {
                // Still reloading
                continue;
            }

            if (weapon.type === 'ProjectileWeaponData') {
                // TODO: ExitPoints

                const projectile = makeProjectile({
                    projectileData: weapon,
                    position: movementState.position,
                    rotation: movementState.rotation,
                    sourceVelocity: movementState.velocity,
                    source: uuid,
                    target: target?.target
                });
                entities.set(v4(), projectile);
                localState.lastFired = time.time;
            }
        }
    }
});

const ControlPlayerWeapons = new System({
    name: 'ControlPlayerWeapons',
    events: [ControlStateEvent],
    args: [ControlStateEvent, WeaponsStateComponent, PlayerShipSelector] as const,
    step(controlState, weaponsState) {
        // TODO: Primary and secondary
        const firing = Boolean(controlState.get(ControlAction.firePrimary));
        for (const [id, weaponState] of weaponsState) {
            weaponState.firing = firing;
        }
    }
});


export const WeaponPlugin: Plugin = {
    name: 'WeaponPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(WeaponsStateComponent);
        world.addComponent(WeaponsComponent);
        world.addSystem(WeaponsSystem);
        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            world.addSystem(ControlPlayerWeapons);
        }
        deltaMaker.addComponent(WeaponsStateComponent, {
            componentType: WeaponsState
        });
    }
}
