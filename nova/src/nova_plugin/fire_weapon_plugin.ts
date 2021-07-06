import { Animation } from 'novadatainterface/Animation';
import { Gettable } from 'novadatainterface/Gettable';
import { WeaponData } from 'novadatainterface/WeaponData';
import { Emit, EmitFunction, Entities, RunQuery, RunQueryFunction } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { EntityMap } from 'nova_ecs/entity_map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { ProvideAsync } from 'nova_ecs/provider';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { DefaultMap } from 'nova_ecs/utils';
import { SingletonComponent } from 'nova_ecs/world';
import { FirstAnimation } from './animation_plugin';
import { applyExitPoint, ExitPointData, getExitPointData } from './exit_point';
import { GameDataResource } from './game_data_resource';
import { firstOrderWithFallback, zeroOrderGuidance } from './guidance';
import { TargetComponent } from './target_component';


export const WeaponConstructors = new Resource<Map<WeaponData['type'],
    { new(data: WeaponData, runQuery: RunQueryFunction): WeaponEntry }>>('WeaponConstructors');

export const WeaponEntries = new Resource<Gettable<WeaponEntry | undefined>>('WeaponEntries');

type FireWeaponFromEntity = (id: string, source: string)
    => boolean;
export const FireWeaponFromEntity = new Resource<FireWeaponFromEntity>('FireWeaponFromEntity');

type FireWeapon = (id: string, position: Position, angle: Angle, owner?: string,
    target?: string, source?: string, sourceVelocity?: Vector,
    exitPointData?: ExitPointData) => boolean;
export const FireWeapon = new Resource<FireWeapon>('FireWeapon');

type FireSubs = (id: string, source: string, sourceExpired?: boolean) => boolean;
export const FireSubs = new Resource<FireSubs>('FireSubs');

export interface WeaponLocalState {
    lastFired: number,
    burstCount: number,
    reloadingBurst: boolean,
    wasFiring: boolean,
    exitIndex: number,
}
type WeaponsLocalState = DefaultMap<string, WeaponLocalState>;
export const WeaponsComponent = new Component<WeaponsLocalState>('WeaponsComponent')
// TODO: This doesn't update if the set or count of weapons changes.
export const WeaponsComponentProvider = ProvideAsync({
    provided: WeaponsComponent,
    args: [] as const,
    async factory() {
        return new DefaultMap(() => ({
            lastFired: 0,
            burstCount: 0,
            reloadingBurst: false,
            wasFiring: false,
            exitIndex: 0,
        }));
    }
});

function getNextExitpoint(sourceMovement: MovementState, sourceAnimation: Animation,
    weapon: WeaponData, localState: WeaponLocalState) {
    let exitPoint = sourceMovement.position;
    let exitPointData: ExitPointData = {
        position: [0, 0, 0],
        upCompress: [0, 0],
        downCompress: [0, 0],
    }
    if (weapon.exitType !== "center") {
        const offset = sourceAnimation.exitPoints[weapon.exitType];
        localState.exitIndex =
            ((localState.exitIndex ?? 0) + 1) % offset.length;

        exitPointData = getExitPointData(sourceAnimation, weapon, localState);
        exitPoint = exitPoint.add(
            applyExitPoint(exitPointData, sourceMovement.rotation)
        ) as Position;
    }

    return { exitPoint, exitPointData };
}

type Quadrant = 'frontQuadrant' | 'sidesQuadrant' | 'rearQuadrant';
function getQuadrant(source: Position, angle: Angle, target: Position): Quadrant {
    const angleToOther = target.subtract(source).angle;
    const relativeAngle = angle.subtract(angleToOther);
    const absAngle = Math.abs(relativeAngle.angle);
    if (absAngle < Math.PI / 4) {
        return 'frontQuadrant';
    } else if (absAngle > 3 * Math.PI / 4) {
        return 'rearQuadrant';
    }
    return 'sidesQuadrant';
}

export function sampleInaccuracy(accuracy: number) {
    return 2 * (Math.random() - 0.5) * accuracy * (2 * Math.PI / 360);
}

function* getEvenlySpacedAngles(angle: number) {
    let current = new Angle(0);
    yield current;
    while (true) {
        current = current.add(angle);
        yield current;
        yield new Angle(-current.angle);
    }
}

function* getRandomInCone(angle: number) {
    while (true) {
        yield new Angle((2 * Math.random() - 1) * angle);
    }
}

export const SourceComponent = new Component<string>('Source');
export const OwnerComponent = new Component<string>('Owner');

const FireFromEntityQuery = new Query([WeaponsComponentProvider,
    Entities, MovementStateComponent, FirstAnimation,
    Optional(OwnerComponent), Optional(TargetComponent)] as const, 'FireFromEntityQuery');

const SubsQuery = new Query([FireWeapon, MovementStateComponent,
    Optional(OwnerComponent), Optional(TargetComponent)] as const);

const ConstructorQuery = new Query([Entities, Emit, SingletonComponent] as const);
export abstract class WeaponEntry {
    protected entities: EntityMap;
    protected emit: EmitFunction;
    constructor(protected data: WeaponData, protected runQuery: RunQueryFunction) {
        [this.entities, this.emit] = runQuery(ConstructorQuery)[0]
    }

    abstract fire(position: Position, angle: Angle, owner?: string,
        target?: string, source?: string, sourceVelocity?: Vector,
        exitPointData?: ExitPointData): boolean;

    fireFromEntity(source: string, inaccuracy = true): boolean {
        const results = this.runQuery(FireFromEntityQuery, source);
        if (!results[0]) {
            return false;
        }
        const [weapons, entities, movement, animation, owner, target] = results[0];

        const weapon = weapons.get(this.data.id);
        const { exitPoint, exitPointData } = getNextExitpoint(
            movement, animation, this.data, weapon);

        let targetMovement: MovementState | undefined;
        if (target?.target) {
            targetMovement = entities.get(target.target)?.components
                .get(MovementStateComponent);
        }

        let angle = movement.rotation;
        if ('guidance' in this.data) {
            if (!target?.target && (this.data.guidance === 'beamTurret'
                || this.data.guidance === 'turret')) {
                return false;
            }
            if (this.data.guidance === 'beamTurret' && targetMovement) {
                angle = zeroOrderGuidance(exitPoint, targetMovement.position);
            }

            if (this.data.guidance === 'rearQuadrant') {
                angle = angle.add(Math.PI);
            }

            const quadrant = targetMovement
                ? getQuadrant(movement.position, movement.rotation,
                    targetMovement.position)
                : undefined;

            if ((this.data.guidance === quadrant
                || this.data.guidance === 'turret')
                && targetMovement) {
                angle = firstOrderWithFallback(exitPoint,
                    movement.velocity, targetMovement.position,
                    targetMovement.velocity, this.data.shotSpeed);
            }
            // TODO: Blindspots
        }

        if (inaccuracy) {
            angle = angle.add(sampleInaccuracy(this.data.accuracy));
        }
        return this.fire(exitPoint, angle, owner ?? source, target?.target,
            source, movement.velocity, exitPointData);
    }

    fireSubs(source: string, sourceExpired = false): boolean {
        const [fireWeapon, movement, owner, target] = this.runQuery(SubsQuery, source)[0];
        if (!('submunitions' in this.data)) {
            return false;
        }
        let success = true;
        for (const sub of this.data.submunitions) {
            const angles = sub.theta < 0
                ? getEvenlySpacedAngles(Math.abs(sub.theta))
                : getRandomInCone(sub.theta);

            for (let i = 0; i < sub.count; i++) {
                if (!sub.subIfExpire && sourceExpired) {
                    continue;
                }
                const angle = angles.next().value || new Angle(0);
                success = success && fireWeapon(sub.id, movement.position,
                    movement.rotation.add(angle), owner,
                    target?.target, source, movement.velocity);
            }
        }
        return success;
    }
}

export const FireWeaponPlugin: Plugin = {
    name: 'FireWeaponPlugin',
    build(world) {
        const gameData = world.resources.get(GameDataResource);
        if (!gameData) {
            throw new Error('Expected GameDataResource to exist');
        }

        const runQuery = world.resources.get(RunQuery);
        if (!runQuery) {
            throw new Error('Expected RunQuery to exist');
        }

        world.addComponent(WeaponsComponent);
        world.addComponent(OwnerComponent);
        world.addComponent(SourceComponent);
        world.resources.set(WeaponConstructors, new Map());
        const weaponConstructors = world.resources.get(WeaponConstructors)!;

        const weaponEntries = new Gettable<WeaponEntry | undefined>(async id => {
            const data = await gameData.data.Weapon.get(id);
            const construct = weaponConstructors.get(data.type);
            if (!construct) {
                return undefined;
            }
            return new construct(data, runQuery);
        });
        world.resources.set(WeaponEntries, weaponEntries);

        world.resources.set(FireWeaponFromEntity, (id: string, source: string) => {
            const weaponEntry = weaponEntries.getCached(id);
            if (!weaponEntry) {
                return false;
            }
            return weaponEntry.fireFromEntity(source);
        });

        world.resources.set(FireWeapon, (id: string, position: Position,
            angle: Angle, owner?: string, target?: string, source?: string,
            sourceVelocity?: Vector, exitPointData?: ExitPointData) => {
            const weaponEntry = weaponEntries.getCached(id);
            if (!weaponEntry) {
                return false;
            }
            return weaponEntry.fire(position, angle, owner, target, source,
                sourceVelocity, exitPointData);
        });

        world.resources.set(FireSubs, (id: string, source: string,
            sourceExpired?: boolean) => {
            const weaponEntry = weaponEntries.getCached(id);
            if (!weaponEntry) {
                return false;
            }
            return weaponEntry.fireSubs(source, sourceExpired);
        });
    }
}
