import * as t from 'io-ts';
import { ProjectileWeaponData, WeaponData, WeaponDamage } from 'novadatainterface/weapon_data';
import { Emit, EmitNow, Entities, GetEntity, GetWorld, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position, PositionType } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import SAT from "sat";
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { AnimationComponent } from '../core/index.js';
import { AsteroidComponent } from './asteroid_plugin.js';
import { CloakActiveComponent, isCloaked } from '../ship/index.js';
import { IdFactoryResource } from '../core/index.js';
import { ProvideFromCache } from '../core/index.js';
import { BlastDamageComponent, BlastIgnoreComponent } from './blast_plugin.js';
import { CompositeHull, HitboxHullProvider, hullFromAnimation, HurtboxHullComponent } from '../core/index.js';
import { CollisionEvent, CollisionHitterComponent, CollisionVulnerabilityComponent } from '../core/index.js';
import { CreateTime } from '../core/index.js';
import { DamagedEvent, ZeroArmorEvent } from '../ship/index.js';
import { ExitPointData } from './exit_point.js';
import { FireSubs, ShipPointDefenseVulnerabilitySystem, SubCounts, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin.js';
import { ActiveSecondaryProvider } from './weapon_plugin.js';
import { BeamCollisionSystem } from './beam_plugin.js';
import { KillCreditSystem } from '../reputation/index.js';
import { OwnerComponent, SourceComponent, VulnerableToPD } from '../ship/index.js';
import { disabledCancelsImmunity, FiringGroupComponent, firingImmune, victimFiringGroup } from '../ship/index.js';
import { isInFlock, provokeGuidedLock } from './flock.js';
import { SimulationGameDataResource } from '../core/index.js';
import { isHostileTarget } from './hostility.js';
import { ShipComponent } from '../ship/index.js';
import { pointDefenseMayDamage } from './point_defense.js';
import { GovtComponent } from '../core/index.js';
import { DisabledComponent } from '../ship/index.js';
import { guidanceAngle, Guidance, GuidanceComponent, MissileGuidanceResource } from './guidance.js';
import { JamSteerComponent, MissileJammingSystem } from './jamming_plugin.js';
import { ArmorComponent, ShieldComponent, ShipZeroArmorSystem } from '../ship/index.js';
import { ProjectileBlastHull, ProjectileComponent, ProjectileDataComponent } from '../core/index.js';
import { SoundEvent } from '../core/index.js';
import { Stat } from '../core/index.js';
import { TargetComponent } from '../ship/index.js';


/**
 * Apply the wëap "Decay" field to a shot's damage based on how long it
 * has been flying. The EVN Bible (wëap Decay) says: "Remove one point of
 * mass & energy damage every time this number of frames goes by" (1 frame
 * = 1/30 sec), with 0 or negative meaning no decay. Both the mass (armor)
 * and energy (shield) damage drop by the same integer amount, clamped at
 * zero; ionization, knockback and the shield-passthrough factor are
 * unchanged (the Bible names only mass & energy damage).
 *
 * Determinism: a pure function of its arguments. `elapsedMs` comes from
 * the sim clock (time.time - createTime), never wall-clock, and the only
 * math is floor/arithmetic — no randomness, no trig — so every peer
 * computes the identical decayed damage for the same flight time.
 */
export function decayDamage(damage: WeaponDamage, decay: number,
    elapsedMs: number): WeaponDamage {
    // `!(decay > 0)` rather than `decay <= 0` so a missing/NaN decay
    // (e.g. a deserialized snapshot from before this field existed,
    // which the passthrough codec would not catch) falls back to "no
    // decay" instead of propagating NaN into the damage numbers — a
    // NaN would desync the deterministic sim.
    if (!(decay > 0)) {
        return damage;
    }
    // 1 frame = 1/30 sec. Convert ms to frames with the same 30/1000
    // factor BeamDamageSystem uses; clamp a negative (impossible in
    // practice — time.time >= createTime — but defensive) to zero so a
    // timing hiccup can never ADD damage.
    const elapsedFrames = Math.max(0, elapsedMs) * 30 / 1000;
    const lost = Math.floor(elapsedFrames / decay);
    if (lost <= 0) {
        return damage;
    }
    return {
        ...damage,
        shield: Math.max(0, damage.shield - lost),
        armor: Math.max(0, damage.armor - lost),
    };
}


class ProjectileWeaponEntry extends WeaponEntry {
    declare data: ProjectileWeaponData;
    private buildProjectile: () => Entity;
    protected pointDefenseRangeSquared: number;

    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'ProjectileWeaponData') {
            throw new Error('Data must be ProjectileWeaponData');
        }
        super(data, runQuery);

        this.pointDefenseRangeSquared = (data.physics.speed * data.shotDuration / 1000) ** 2;

        let hitTypes = new Set(['normal']);
        if (data.guidance === 'pointDefense') {
            hitTypes = new Set(['pointDefense']);
        }

        // Projectiles are built fresh for every shot. Pooling entity
        // objects would leak state between timelines: the pool is not
        // part of a snapshot, so resimulation would dequeue different
        // objects than the original run did.
        this.buildProjectile = () => {
            const projectile = new Entity(this.data.name)
                .addComponent(ProjectileDataComponent, this.data)
                .addComponent(ProjectileComponent, { id: this.data.id })
                .addComponent(MovementStateComponent, {
                    position: new Position(0, 0),
                    rotation: new Angle(0),
                    velocity: new Vector(0, 0),
                    accelerating: this.data.guidance === 'rocket' ? 1 : 0,
                    turning: 0,
                    turnBack: false,
                }).addComponent(MovementPhysicsComponent, {
                    acceleration: this.data.physics.acceleration || 1200,
                    maxVelocity: this.data.guidance === 'rocket' ?
                        this.data.physics.speed : Infinity,
                    turnRate: this.data.physics.turnRate,
                    movementType: this.data.guidance === 'guided'
                        ? MovementType.INERTIALESS : MovementType.INERTIAL,
                }).addComponent(CollisionHitterComponent, {
                    hitTypes: new Set(hitTypes),
                });

            if (this.data.vulnerableTo.length) {
                projectile.addComponent(CollisionVulnerabilityComponent, {
                    vulnerableTo: new Set(this.data.vulnerableTo),
                });
            }
            if (this.data.guidance === 'guided') {
                projectile.addComponent(GuidanceComponent, {
                    guidance: Guidance.firstOrder,
                });
            }
            if (this.data.vulnerableTo.includes('pointDefense')) {
                projectile.addComponent(VulnerableToPD, undefined);
                projectile.addComponent(ShieldComponent, new Stat({
                    current: this.data.physics.shield,
                    max: this.data.physics.shield,
                    recharge: this.data.physics.shieldRecharge,
                }));
                projectile.addComponent(ArmorComponent, new Stat({
                    current: this.data.physics.armor,
                    max: this.data.physics.armor,
                    recharge: this.data.physics.armorRecharge,
                }));
            }

            if (this.data.proxRadius) {
                const proxHull = new CompositeHull([
                    new SAT.Circle(new SAT.Vector(0, 0), this.data.proxRadius)
                ]);
                projectile.components.set(HurtboxHullComponent, proxHull);
            }

            if (this.data.blastRadius) {
                const blastHull = new CompositeHull([
                    new SAT.Circle(new SAT.Vector(0, 0), this.data.blastRadius)
                ]);
                projectile.components.set(ProjectileBlastHull, blastHull);
            }

            return projectile;
        };
    }

    fire(position: Position, angle: Angle, owner?: string, target?: string,
        source?: string, sourceVelocity?: Vector,
        _exitPointData?: ExitPointData, silent = false): Entity | undefined {

        let velocity = new Vector(0, 0);
        if (this.data.guidance !== 'guided' && sourceVelocity) {
            velocity = velocity.add(sourceVelocity);
        }
        if (this.data.guidance !== 'rocket') {
            velocity = velocity.add(angle.getUnitVector()
                .scale(this.data.physics.speed));
        }

        const projectile = this.buildProjectile();

        const movementState = projectile.components.get(MovementStateComponent)!;
        movementState.position = position;
        movementState.rotation = angle;
        movementState.velocity = velocity;
        movementState.turning = 0;
        movementState.turnTo = null;

        projectile.components.delete(CreateTime);
        projectile.components.delete(SubCounts);

        if (target) {
            projectile.components.set(TargetComponent, { target });
        } else {
            projectile.components.delete(TargetComponent);
        }

        if (source) {
            projectile.components.set(SourceComponent, source);
        } else {
            projectile.components.delete(SourceComponent);
        }

        if (owner) {
            projectile.components.set(OwnerComponent, {owner: owner});
        } else {
            projectile.components.delete(OwnerComponent);
        }

        const armor = projectile.components.get(ArmorComponent);
        if (armor) {
            armor.current = armor.max;
        }

        const shield = projectile.components.get(ShieldComponent);
        if (shield) {
            shield.current = shield.max;
        }

        // Locking a guided missile on is itself the provocation: the
        // target turns hostile to the shooter the moment the missile
        // spawns (see provokeGuidedLock).
        if (this.data.guidance === 'guided' && target) {
            provokeGuidedLock(target, source, owner ?? source ?? target,
                uuid => this.entities.get(uuid), this.time.time);
        }

        this.entities.set(this.ids.next('projectile'), projectile);
        // `silent` is set for every child of a submunition burst after the
        // first, so a dozen-rocket burst is heard once instead of a dozen
        // copies of the same sample on one frame.
        if (this.data.sound && !silent) {
            this.emit(SoundEvent, {
                id: this.data.sound,
                loop: this.data.loopSound,
            });
        }

        return projectile;
    }
}

export const ProjectileExpireEvent = new EcsEvent<undefined>('ProjectileExpire');

const ProjectileLifespanSystem = new System({
    name: 'ProjectileLifespanSystem',
    args: [CreateTime, TimeResource, ProjectileDataComponent, FireSubs,
        Entities, UUID, Emit, ProjectileComponent] as const,
    step(fireTime, { time }, projectileData, fireSubs, entities, uuid, emit) {
        if (time - fireTime > projectileData.shotDuration) {
            fireSubs(projectileData.id, uuid, true);
            const self = entities.get(uuid);
            if (!self) {
                console.warn(`Missing projectile ${uuid} that is expiring`);
                return;
            }
            entities.delete(uuid);
            emit(ProjectileExpireEvent, undefined, [self]);
        }
    },
    // Determinism rule 4: expiry compares the projectile's fire time
    // against time.time, so this must run after TimeSystem.
    // ShipPointDefenseVulnerabilitySystem is a #237 pin (shared: *):
    // ProjectilePlugin registers after FireWeaponPlugin.
    after: [TimeSystem, ShipPointDefenseVulnerabilitySystem],
});

export const ProjectileGuidanceSystem = new System({
    name: 'ProjectileGuidanceSystem',
    // Runs after MissileJammingSystem so a jammed missile's per-frame steer
    // override / retarget is already in place when we compute the aim.
    after: [MissileJammingSystem],
    args: [MovementStateComponent, TargetComponent,
        Entities, ProjectileDataComponent, MissileGuidanceResource,
        Optional(JamSteerComponent)] as const,
    step(movementState, { target }, entities, projectileData, guidanceMode,
        jamSteer) {
        // Jamming may have told this missile to fly straight this frame (lost
        // lock, no special seeker behaviour): ignore the target entirely.
        if (jamSteer === 'flyStraight') {
            movementState.turnTo = null;
            return;
        }
        if (!target) {
            return;
        }
        const targetEntity = entities.get(target);
        const targetMovement = targetEntity?.components.get(MovementStateComponent);

        if (!targetMovement) {
            return;
        }

        // Missile lock vs cloak (rule from observed original-game
        // behavior): a homing missile LOSES its lock while its target is
        // cloaked — it stops homing and flies straight — but REGAINS the
        // lock if that same target decloaks while the missile is still
        // alive. The lock is suspended, not cleared: TargetComponent
        // keeps the target uuid (DropCloakedTargetSystem is ship-only),
        // so homing resumes here the moment the target decloaks.
        // Notably, a cloak scanner on the missile's PARENT ship does NOT
        // keep its missiles tracking: scanners let the ship target
        // cloaked ships, but missiles still lose lock — "odd behavior,
        // but it's what the original game does".
        if (isCloaked(targetEntity?.components.get(CloakActiveComponent))) {
            movementState.turnTo = null;
            return;
        }

        // 'smart' leads the target (hard to dodge); 'simple' just points at
        // the target's current position (dodgeable by circling). The mode is
        // a room-wide deterministic resource; see guidance.ts.
        let aim = guidanceAngle(guidanceMode.mode,
            movementState.position, movementState.velocity,
            targetMovement.position, targetMovement.velocity,
            projectileData.shotSpeed);

        // A jammed 'turns away if jammed' missile veers off: aim 180 degrees
        // away from where it would otherwise steer, so it peels away from the
        // target this frame.
        if (jamSteer === 'veerAway') {
            aim = aim.add(Math.PI);
        }

        movementState.turnTo = aim;
    },
    // #237 pin (shared: *): before core's HitboxHullProvider, the first
    // system CollisionsPlugin registers.
    before: [HitboxHullProvider],
});

export const ProjectileCollisionEventType = t.type({
    otherUuid: t.string,
    position: PositionType,
    projectileData: passthroughType<ProjectileWeaponData>('ProjectileCollisionProjectileData'),
});
export const ProjectileCollisionEvent = new EcsEvent<{
    otherUuid: string,
    position: Position,
    projectileData: ProjectileWeaponData,
}>('ProjectileCollision');

registerSimulationBridgeEvent({
    event: ProjectileCollisionEvent,
    includeEntityUuids: false,
});

const ProjectileHurtboxProvider = ProvideFromCache({
    name: "ProjectileHurtboxProvider",
    provided: HurtboxHullComponent,
    args: [AnimationComponent, SimulationGameDataResource, CollisionHitterComponent, ProjectileComponent] as const,
    factory: hullFromAnimation,
    // #237 pins (shared: *; entity): ProjectilePlugin registers before
    // WeaponPlugin.
    after: [ProjectileLifespanSystem],
    before: [ActiveSecondaryProvider],
});

export const ProjectileCollisionSystem = new System({
    name: 'ProjectileCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, UUID, ProjectileDataComponent,
        Optional(OwnerComponent), Optional(FiringGroupComponent),
        Optional(TargetComponent), FireSubs, TimeResource, CreateTime,
        EmitNow, GetWorld, Optional(SourceComponent)] as const,
    step(collision, entities, uuid, projectileData, owner, firingGroup,
        target, fireSubs, time, createTime, emitNow, world, source) {
        // Optional: a test world without game data can't judge hostility
        // and keeps the plain collision rules.
        const gameData = world.resources.get(SimulationGameDataResource);
        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        // Friendly-fire immunity: don't collide with anything in our
        // firing group — the firer itself, its fleet (leader+escorts),
        // its carrier/fighters — see firing_group.ts. The owner uuid is
        // the fallback group for weapons that predate group stamping;
        // the predicate never matches when the weapon has neither (an
        // ownerless projectile must not match every group-less entity
        // and pass through e.g. asteroids).
        const victimGroup = victimFiringGroup(
            other.components.get(FiringGroupComponent),
            other.components.get(OwnerComponent)?.owner,
            collision.other);
        if (firingImmune(firingGroup?.group ?? owner?.owner, victimGroup,
            firingGroup?.govt, other.components.get(GovtComponent)?.id,
            disabledCancelsImmunity(collision.other,
                other.components.has(DisabledComponent), source))) {
            return;
        }

        if (projectileData.proxSafety * 1000 + createTime > time.time) {
            // Prox safety is still active. Do not collide.
            return;
        }

        // A guided weapon only hits the ship it is TARGETING (so a
        // homing missile weaves through a furball untouched), unless
        // its wëap sets Flags2 0x0008 "Proximity detonator is triggered
        // by ships other than the target" — parsed as proxHitAll, which
        // is forced true for every non-guided weapon. A decoyed missile
        // whose TargetComponent was retargeted (jamming_plugin) hits
        // its new target through the same rule; a missile whose target
        // cloaked keeps flying with the lock suspended and passes
        // through everything else, which is correct per this rule.
        if (!projectileData.proxHitAll
            && collision.other !== target?.target) {
            // Asteroids are still fair game for guided weapons unless
            // the Seeker 0x0001 'passes over asteroids' flag is set.
            if (!other.components.has(AsteroidComponent)
                || projectileData.seeker.passOverAsteroids) {
                return;
            }
        }

        // A POINT DEFENSE round hurts only what the turret would have
        // aimed at — a missile flying at us, a ship hostile to us
        // (point_defense.ts). A stray PD burst crossing a neutral fighter
        // or someone else's missile passes through rather than starting a
        // war (Matthew's ruling).
        if (projectileData.guidance === 'pointDefense' && gameData) {
            const viewerUuid = owner?.owner ?? source ?? uuid;
            const viewerEntity = entities.get(viewerUuid);
            const isShip = other.components.has(ShipComponent);
            const getEntity = (id: string) => entities.get(id);
            const sourceUuid = source ?? viewerUuid;
            const mayDamage = viewerEntity !== undefined
                && pointDefenseMayDamage({
                    uuid: collision.other,
                    kind: isShip ? 'fighter' : 'missile',
                    owner: other.components.get(OwnerComponent)?.owner
                        ?? collision.other,
                    target: other.components.get(TargetComponent)?.target,
                    hostile: isShip && isHostileTarget(collision.other, other, {
                        viewerUuid, viewerEntity, entities,
                        gameData, now: time.time,
                    }),
                    inFlock: isInFlock(collision.other, viewerUuid, getEntity)
                        || (viewerUuid !== sourceUuid
                            && isInFlock(collision.other, sourceUuid,
                                getEntity)),
                }, { owner: viewerUuid, source: sourceUuid });
            if (!mayDamage) {
                return;
            }
        }

        const self = entities.get(uuid);
        if (!self) {
            console.warn(`Missing projectile ${uuid} that is colliding`);
            return;
        }

        emitNow(DamagedEvent, {
            damage: decayDamage(projectileData.damage, projectileData.decay,
                time.time - createTime),
            damager: uuid,
        }, [collision.other]);

        if (!collision.initiator) {
            // We are hit by point defense
            return;
        }

        fireSubs(projectileData.id, uuid, false);
        entities.delete(uuid);
        emitNow(ProjectileCollisionEvent, {
            otherUuid: other.uuid,
            position: Position.fromVectorLike(
                self.components.get(MovementStateComponent)?.position ?? new Position(0, 0)
            ),
            projectileData,
        }, [self]);
    },
    // #237 pin (shared: *): among the CollisionEvent handlers, before
    // beam's.
    before: [BeamCollisionSystem],
});

export const ProjectileExplodeEventType = t.intersection([
    t.type({
        position: PositionType,
        projectileData: passthroughType<ProjectileWeaponData>('ProjectileExplodeProjectileData'),
    }),
    t.partial({
        otherUuid: t.string,
    }),
]);
export const ProjectileExplodeEvent = new EcsEvent<{
    otherUuid?: string,
    position: Position,
    projectileData: ProjectileWeaponData,
}>('ProjectileExplodeEvent');

registerSimulationBridgeEvent({
    event: ProjectileExplodeEvent,
    includeEntityUuids: false,
});

const ProjectileExplodeSystem = new System({
    name: 'ProjectileExplodeSystem',
    events: [ProjectileExpireEvent, ProjectileCollisionEvent],
    args: [ProjectileDataComponent, MovementStateComponent, Optional(ProjectileCollisionEvent),
        GetEntity, Emit] as const,
    step(projectileData, movement, collision, self, emit) {
        const position = Position.fromVectorLike(movement.position);
        if (collision) {
            emit(ProjectileExplodeEvent, {
                otherUuid: collision.otherUuid,
                position,
                projectileData,
            }, [self]);
            return;
        }
        if (projectileData.detonateWhenShotExpires) {
            emit(ProjectileExplodeEvent, {
                position,
                projectileData,
            }, [self]);
        }
    }
});

const ProjectileBlastSystem = new System({
    name: 'ProjectileBlastSystem',
    events: [ProjectileExplodeEvent],
    args: [ProjectileDataComponent, ProjectileBlastHull, CollisionHitterComponent,
        MovementStateComponent, Optional(OwnerComponent),
        Optional(FiringGroupComponent), Entities,
        IdFactoryResource, ProjectileExplodeEvent, CreateTime, TimeResource,
        Optional(SourceComponent)] as const,
    step(projectileData, blastHull, hitter, movement, owner, firingGroup,
        entities, ids, explosion, createTime, time, source) {
        const blastIgnore = new Set<string>();
        if (explosion.otherUuid) {
            // The projectile already damaged this entity, so
            // the blast should ignore it.
            blastIgnore.add(explosion.otherUuid);
        }

        // A blast carries the shot's remaining power at the moment it
        // detonates, so the wëap Decay that erodes the shot in flight
        // erodes the blast too. This runs in the same step (and thus at
        // the same time.time) as the direct ProjectileCollisionSystem
        // hit, so the directly-struck ship and its neighbours in the
        // blast radius take consistently-decayed damage.
        const damage = decayDamage(projectileData.damage, projectileData.decay,
            time.time - createTime);
        const blast = new Entity(`${projectileData.name} Blast`)
            .addComponent(BlastDamageComponent, damage)
            .addComponent(BlastIgnoreComponent, blastIgnore)
            .addComponent(HurtboxHullComponent, blastHull)
            .addComponent(CollisionHitterComponent, hitter)
            .addComponent(MovementStateComponent, {
                position: movement.position,
                accelerating: 0,
                rotation: new Angle(0),
                turning: 0,
                turnBack: false,
                velocity: new Vector(0, 0),
            });
        if (!projectileData.blastHurtsFiringShip) {
            // The blast inherits the projectile's firing group so it
            // spares the firer AND its fleet/carrier group (see
            // firing_group.ts); a blastHurtsFiringShip weapon carries
            // no group and hurts everyone, firer included — matching
            // the old owner-only ignore, generalized to the group.
            const group = firingGroup ?? (owner && { group: owner.owner });
            if (group) {
                blast.components.set(FiringGroupComponent, group);
            }
        }
        if (source !== undefined) {
            // For BlastCollisionSystem's disabled-firer carve-out.
            blast.components.set(SourceComponent, source);
        }
        entities.set(ids.next('blast'), blast);
    }
});

const ProjectileDeathSystem = new System({
    name: 'ProjectileDeathSystem',
    events: [ZeroArmorEvent],
    args: [Entities, UUID, ZeroArmorEvent, ProjectileComponent] as const,
    step(entities, uuid) {
        entities.delete(uuid);
    },
    // #237 pins (shared: *): among the ZeroArmorEvent handlers, after
    // ship's and before reputation's.
    after: [ShipZeroArmorSystem],
    before: [KillCreditSystem],
});

export const ProjectilePlugin: Plugin = {
    name: 'ProjectilePlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        world.resources.get(SerializerResource)?.addComponent(
            ProjectileDataComponent, passthroughType<ProjectileWeaponData>('ProjectileDataComponentType'));
        world.resources.get(SerializerResource)?.addComponent(ProjectileComponent, t.intersection([
            t.type({ id: t.string }),
            t.partial({ source: t.string }),
        ]));
        world.resources.get(SerializerResource)?.addEvent(ProjectileCollisionEvent, ProjectileCollisionEventType);
        world.resources.get(SerializerResource)?.addEvent(ProjectileExplodeEvent, ProjectileExplodeEventType);
        weaponConstructors.set('ProjectileWeaponData', ProjectileWeaponEntry);

        world.addSystem(ProjectileGuidanceSystem);
        world.addSystem(ProjectileLifespanSystem);
        world.addSystem(ProjectileCollisionSystem);
        world.addSystem(ProjectileDeathSystem);
        world.addSystem(ProjectileHurtboxProvider);
        world.addSystem(ProjectileExplodeSystem);
        world.addSystem(ProjectileBlastSystem);
    }
}
