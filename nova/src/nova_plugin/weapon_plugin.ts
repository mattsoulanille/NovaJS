import * as t from 'io-ts';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Position } from 'nova_ecs/datatypes/position';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { applyExitPoint } from './exit_point';
import { GameDataResource } from './game_data_resource';
import { PlatformResource } from './platform_plugin';
import { makeProjectile } from './projectile_plugin';
import { ControlAction, ControlStateEvent, PlayerShipSelector } from './ship_controller_plugin';
import { ShipDataComponent } from './ship_plugin';
import { TargetComponent } from './target_plugin';

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
    exitIndex?: number,
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
        Optional(TargetComponent), Optional(ShipDataComponent)] as const,
    step(weaponsState, weaponsLocalState, entities, movementState, time,
        gameData, uuid, target, shipData) {
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

            let reloadTime = weapon.fireSimultaneously
                ? weapon.reload : weapon.reload / state.count;
            let reloadingBurst = false;
            if (localState.burstCount > weapon.burstCount * state.count) {
                reloadTime = weapon.burstReload;
                reloadingBurst = true;
            }

            if (time.time - lastFired < reloadTime) {
                // Still reloading
                continue;
            }

            if (reloadingBurst) {
                localState.burstCount = 0;
            }

            const getNextExitpoint = () => {
                let exitPoint = movementState.position;
                if (shipData) {
                    if (weapon.exitType !== "center") {
                        const offset = shipData.animation.exitPoints[weapon.exitType];
                        localState.exitIndex =
                            ((localState.exitIndex ?? 0) + 1) % offset.length;

                        exitPoint = exitPoint.add(
                            applyExitPoint(offset[localState.exitIndex],
                                movementState.rotation,
                                shipData.animation.exitPoints.upCompress,
                                shipData.animation.exitPoints.downCompress)
                        ) as Position;
                    }
                }
                return exitPoint;
            }

            if (weapon.type === 'ProjectileWeaponData') {
                const inaccuracy = 2 * (Math.random() - 0.5)
                    * weapon.accuracy
                    * (2 * Math.PI / 360);

                const fireCount = weapon.fireSimultaneously ? state.count : 1;
                for (let i = 0; i < fireCount; i++) {
                    const exitPoint = getNextExitpoint();
                    const projectile = makeProjectile({
                        projectileData: weapon,
                        position: exitPoint,
                        rotation: movementState.rotation.add(inaccuracy),
                        sourceVelocity: movementState.velocity,
                        source: uuid,
                        target: target?.target
                    });
                    entities.set(v4(), projectile);
                    if (weapon.burstCount) {
                        localState.burstCount++;
                    }
                }
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
