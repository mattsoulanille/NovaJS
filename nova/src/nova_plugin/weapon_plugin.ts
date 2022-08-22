import { WeaponData } from 'novadatainterface/WeaponData';
import { Emit, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { Time, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provider';
import { System } from 'nova_ecs/system';
import { mod } from '../util/mod';
import { ControlStateEvent } from './control_state_event';
import { WeaponEntries, WeaponLocalState, WeaponsComponent } from './fire_weapon_plugin';
import { GameDataResource } from './game_data_resource';
import { PlatformResource } from './platform_plugin';
import { PlayerShipSelector } from './player_ship_plugin';
import { WeaponsState, WeaponsStateComponent, WeaponState } from './weapons_state';

function checkReloaded(weapon: WeaponData, localState: WeaponLocalState,
    state: WeaponState, time: Time): boolean {
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
        return false;
    }

    if (reloadingBurst) {
        localState.burstCount = 0;
    }

    return true;
}

export const WeaponsSystem = new System({
    name: 'WeaponsSystem',
    args: [WeaponsStateComponent, WeaponsComponent,
        TimeResource, UUID, WeaponEntries] as const,
    step(weaponsState, weaponsLocalState, time, uuid, weaponEntries) {
        for (const [id, state] of weaponsState) {
            const weapon = weaponEntries.getCached(id);
            if (!weapon) {
                continue;
            }

            const localState = weaponsLocalState.get(id);
            if (!checkReloaded(weapon.data, localState, state, time)) {
                continue;
            }

            if (!(state.firing
                || weapon.data.guidance === 'pointDefense'
                || weapon.data.guidance === 'pointDefenseBeam')) {
                continue;
            }

            let fired: Entity | undefined = undefined;
            if (weapon.data.fireSimultaneously) {
                for (let i = 0; i < state.count; i++) {
                    fired = weapon.fireFromEntity(uuid) || fired;
                }
            } else {
                fired = weapon.fireFromEntity(uuid);
            }

            if (fired) {
                if (weapon.data.burstCount) {
                    localState.burstCount++;
                }
                localState.lastFired = time.time;
            }
        }
    }
});

type ActiveSecondary = {
    secondary: string | null /* id */,
};

export const ActiveSecondaryWeapon =
    new Component<ActiveSecondary>('ActiveSecondaryWeapon');

const ActiveSecondaryProvider = Provide({
    name: "ActiveSecondaryProvider",
    provided: ActiveSecondaryWeapon,
    args: [PlayerShipSelector] as const,
    factory: () => ({ secondary: null }),
});

export const ChangeSecondaryEvent = new EcsEvent<ActiveSecondary>('ChangeSecondaryEvent');

const ControlPlayerWeapons = new System({
    name: 'ControlPlayerWeapons',
    events: [ControlStateEvent],
    args: [ControlStateEvent, WeaponsStateComponent, WeaponsComponent,
        ActiveSecondaryWeapon, Emit, GameDataResource, PlayerShipSelector] as const,
    step(controlState, weaponsState, weaponsData, activeSecondary, emit, gameData) {
        for (const [, weaponState] of weaponsState) {
            weaponState.firing = false;
        }

        // TODO: Store this somewhere?
        const secondaryWeapons = [
            undefined, // for when no weapon is selected
            ...[...weaponsData].filter(([id]) => {
                return gameData.data.Weapon.getCached(id)?.fireGroup === 'secondary';
            }).map(([id]) => id)
        ];

        let secondary: WeaponState | undefined;
        let secondaryIndex = 0;
        if (activeSecondary.secondary) {
            secondary = weaponsState.get(activeSecondary.secondary);
            secondaryIndex = secondaryWeapons.indexOf(activeSecondary.secondary);
        }

        let changedSecondary = false;

        if (controlState.get('resetSecondary') === 'start') {
            secondaryIndex = 0;
            changedSecondary = true;
        } else if (controlState.get('previousSecondary') === 'start') {
            secondaryIndex--;
            changedSecondary = true;
        } else if (controlState.get('nextSecondary') === 'start') {
            secondaryIndex++;
            changedSecondary = true;
        }

        secondaryIndex = mod(secondaryIndex, secondaryWeapons.length);
        activeSecondary.secondary = secondaryWeapons[secondaryIndex] ?? null;

        if (changedSecondary) {
            emit(ChangeSecondaryEvent, activeSecondary);
        }

        if (activeSecondary.secondary) {
            secondary = weaponsState.get(activeSecondary.secondary);
        }

        if (secondary) {
            secondary.firing = Boolean(controlState.get('fireSecondary'));
        }

        const firing = Boolean(controlState.get('firePrimary'));
        for (const [id, weaponState] of weaponsState) {
            if (gameData.data.Weapon.getCached(id)?.fireGroup === 'primary') {
                weaponState.firing = firing;
            }
        }
    }
});

export const WeaponPlugin: Plugin = {
    name: 'WeaponPlugin',
    build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('missing gameData');
        }

        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(WeaponsStateComponent);
        world.addSystem(WeaponsSystem);
        const platform = world.resources.get(PlatformResource);
        if (platform === 'browser') {
            world.addSystem(ActiveSecondaryProvider);
            world.addSystem(ControlPlayerWeapons);
        }
        deltaMaker.addComponent(WeaponsStateComponent, {
            componentType: WeaponsState
        });
    }
}
