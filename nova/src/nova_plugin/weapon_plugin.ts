import * as t from 'io-ts';
import { Animation } from 'novadatainterface/Animation';
import { ShipData } from 'novadatainterface/ShipData';
import { ProjectileWeaponData, WeaponData } from 'novadatainterface/WeaponData';
import { Entities, RunQuery, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { map } from 'nova_ecs/datatypes/map';
import { Position } from 'nova_ecs/datatypes/position';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { Time, TimeResource } from 'nova_ecs/plugins/time_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { v4 } from 'uuid';
import { applyExitPoint } from './exit_point';
import { GameDataResource } from './game_data_resource';
import { firstOrderGuidance, firstOrderWithFallback, zeroOrderGuidance } from './guidance';
import { PlatformResource } from './platform_plugin';
import { PlayerShipSelector } from './player_ship_plugin';
import { makeProjectile } from './projectile_plugin';
import { ControlAction, ControlStateEvent } from './ship_controller_plugin';
import { ShipDataComponent } from './ship_plugin';
import { Target, TargetComponent } from './target_component';


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
    wasFiring: boolean,
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

function getNextExitpoint(sourceMovement: MovementState, sourceAnimation?: Animation,
    weapon?: WeaponData, localState?: WeaponLocalState) {
    let exitPoint = sourceMovement.position;
    if (sourceAnimation && weapon && localState) {
        if (weapon.exitType !== "center") {
            const offset = sourceAnimation.exitPoints[weapon.exitType];
            localState.exitIndex =
                ((localState.exitIndex ?? 0) + 1) % offset.length;

            exitPoint = exitPoint.add(
                applyExitPoint(offset[localState.exitIndex],
                    sourceMovement.rotation,
                    sourceAnimation.exitPoints.upCompress,
                    sourceAnimation.exitPoints.downCompress)
            ) as Position;
        }
    }
    return exitPoint;
}

const WeaponsSystem = new System({
    name: 'WeaponsSystem',
    args: [WeaponsStateComponent, WeaponsComponentProvider, Entities,
        MovementStateComponent, TimeResource, GameDataResource, UUID, RunQuery,
        Optional(TargetComponent), Optional(ShipDataComponent)] as const,
    step(weaponsState, weaponsLocalState, entities, movementState, time,
        gameData, uuid, runQuery, target, shipData) {
        for (const [id, state] of weaponsState) {
            const weapon = gameData.data.Weapon.getCached(id);
            if (!weapon) {
                continue;
            }

            if (!weaponsLocalState.has(id)) {
                weaponsLocalState.set(id, {
                    lastFired: 0,
                    burstCount: 0,
                    wasFiring: false,
                    reloadingBurst: false,
                });
            }
            const localState = weaponsLocalState.get(id)!;

            if (!checkReloaded(weapon, localState, state, time)) {
                continue;
            }

            const stepWeaponArgs: StepWeaponArgs<WeaponData> = {
                entities, localState, movementState,
                sourceAnimation: shipData?.animation,
                state, target, time, uuid, weapon, runQuery
            }

            switch (weapon.type) {
                case 'ProjectileWeaponData':
                    stepProjectileWeapon(stepWeaponArgs as StepWeaponArgs<ProjectileWeaponData>);
                    break;
            }
        }
    }
});

function sampleInaccuracy(accuracy: number) {
    return 2 * (Math.random() - 0.5) * accuracy * (2 * Math.PI / 360);
}

type Quadrant = 'front' | 'sides' | 'rear';
function getQuadrant(source: Position, angle: Angle, target: Position): Quadrant {
    const angleToOther = target.subtract(source).angle;
    const relativeAngle = angle.subtract(angleToOther);
    const absAngle = Math.abs(relativeAngle.angle);
    if (absAngle < Math.PI / 4) {
        return 'front';
    } else if (absAngle > 3 * Math.PI / 4) {
        return 'rear';
    }
    return 'sides';
}

type StepWeaponArgs<W extends WeaponData> = {
    weapon: W,
    state: WeaponState,
    sourceAnimation?: Animation,
    movementState: MovementState,
    localState: WeaponLocalState,
    uuid: string,
    target?: Target,
    entities: EntityMap,
    time: Time,
    runQuery: RunQueryFunction,
}

function stepProjectileWeapon({ weapon, state, sourceAnimation, movementState,
    uuid, target, entities, localState, time }: StepWeaponArgs<ProjectileWeaponData>) {
    const fireCount = weapon.fireSimultaneously ? state.count : 1;

    if (!state.firing) {
        return;
    }

    let targetMovement: MovementState | undefined
    let quadrant: Quadrant | undefined;
    if (target?.target) {
        targetMovement = entities.get(target?.target)
            ?.components.get(MovementStateComponent);
        if (targetMovement) {
            quadrant = getQuadrant(movementState.position,
                movementState.rotation, targetMovement.position);
        }
    }

    for (let i = 0; i < fireCount; i++) {
        const exitPoint = getNextExitpoint(movementState,
            sourceAnimation, weapon, localState);

        const inaccuracy = sampleInaccuracy(weapon.accuracy);
        let rotation = movementState.rotation.add(inaccuracy);
        let hitSolution: Angle | undefined;
        if (targetMovement) {
            hitSolution = firstOrderWithFallback(exitPoint, movementState.velocity,
                targetMovement.position, targetMovement.velocity, weapon.shotSpeed * 3 / 10);
        }

        switch (weapon.guidance) {
            case 'unguided':
                break;
            case 'guided':
                break;
            case 'rocket':
                break;
            case 'turret':
                if (hitSolution) {
                    rotation = hitSolution.add(inaccuracy);
                } else {
                    return;
                }
                break;
            case 'frontQuadrant':
                if (hitSolution && quadrant === 'front') {
                    rotation = hitSolution.add(inaccuracy);
                }
                break;
            case 'rearQuadrant':
                if (hitSolution && quadrant === 'rear') {
                    rotation = hitSolution.add(inaccuracy);
                }
                break;
            case 'pointDefense':
                break;
        }

        if (weapon.guidance === 'turret') {

        }

        const projectile = makeProjectile({
            projectileData: weapon,
            position: exitPoint,
            rotation,
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
