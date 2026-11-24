import * as t from 'io-ts';
import { ProjectileWeaponData, WeaponData, WeaponDamage } from 'novadatainterface/weapon_data';
import { Emit, EmitFunction, EmitNow, Entities, GetEntity, GetWorld, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { EntityMap } from 'nova_ecs/entity_map';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position, PositionType } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { Query } from 'nova_ecs/query';
import { ReadOnly } from 'nova_ecs/read_only';
import { MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import SAT from "sat";
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { AnimationComponent } from '../core/index.js';
import { AsteroidComponent } from './asteroid_plugin.js';
import { CloakActiveComponent, CloakScannerComponent, isTargetable } from '../ship/index.js';
import { IdFactoryResource } from '../core/index.js';
import { ProvideFromCache } from '../core/index.js';
import { BlastDamageComponent, BlastIgnoreComponent } from './blast_plugin.js';
import { CollisionSystem, CompositeHull, HitboxHullComponent, HitboxHullProvider, hullFromAnimation, hullRadius, HurtboxHullComponent } from '../core/index.js';
import { CollisionEvent, CollisionHitterComponent, CollisionVulnerabilityComponent } from '../core/index.js';
import { CreateTime } from '../core/index.js';
import { DamagedEvent, ZeroArmorEvent } from '../ship/index.js';
import { ExitPointData } from './exit_point.js';
import { FireSubs, FireSubsFunction, ShipPointDefenseVulnerabilitySystem, SubCounts, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin.js';
import { ShotEnd } from './submunition_rule.js';
import { ActiveSecondaryProvider } from './weapon_plugin.js';
import { BeamCollisionSystem, BeamDamageSystem } from './beam_plugin.js';
import { KillCreditSystem } from '../reputation/index.js';
import { OwnerComponent, SourceComponent, VulnerableToPD } from '../ship/index.js';
import {
    BLAST_FLOCK_RULE, blastFriendlyFire, disabledCancelsImmunity, FiringGroup,
    FiringGroupComponent, firingImmune, victimFiringGroup,
} from '../ship/index.js';
import { isInFlock, provokeGuidedLock } from './flock.js';
import { SimulationGameDataResource, SystemIdResource } from '../core/index.js';
import { gameDataRefType } from '../core/index.js';
import { isHostileTarget } from './hostility.js';
import { ShipComponent } from '../ship/index.js';
import { pointDefenseMayDamage } from './point_defense.js';
import { GovtComponent } from '../core/index.js';
import { DisabledComponent } from '../ship/index.js';
import { guidanceAngle, Guidance, GuidanceComponent, MissileGuidanceResource, zeroOrderGuidance } from './guidance.js';
import { confusedTurning, JamDecisionComponent, MissileJammingSystem }
    from './jamming_plugin.js';
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

            // A shot with a proximity fuse keeps its SPRITE hurtbox
            // (ProjectileHurtboxProvider) for direct hits: the fuse is a
            // separate test with its own reach
            // (ProjectileProximityFuseSystem), and which of the two fires
            // first decides whether the shot subs (submunition_rule.ts).

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
            fireSubs(projectileData.id, uuid, 'expired');
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
    // Runs after MissileJammingSystem so a newly launched missile's one jam
    // decision (and any retarget) is in place before its first aim.
    after: [MissileJammingSystem],
    args: [MovementStateComponent, TargetComponent,
        Entities, ProjectileDataComponent, MissileGuidanceResource,
        Optional(JamDecisionComponent), Optional(OwnerComponent),
        Optional(SourceComponent)] as const,
    step(movementState, { target }, entities, projectileData, guidanceMode,
        jamDecision, owner, source) {
        const jamSteer = jamDecision?.steer;
        // A jammed plain missile flies dead straight for the rest of its
        // life, along the heading it had at the decision (its launch
        // heading): never steer, and stop any turn in progress.
        if (jamSteer === 'flyStraight') {
            movementState.turnTo = null;
            movementState.turning = 0;
            return;
        }
        // A missile confused by sensor interference (Seeker 0x0008) turns
        // at CONFUSED_TURN_RATE_FACTOR_FITTED (1.8) x its turn rate in one
        // direction for the rest of its life, flying in tight circles,
        // whatever its target does.
        const confused = confusedTurning(jamSteer);
        if (confused !== undefined) {
            movementState.turnTo = null;
            movementState.turning = confused;
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

        // Missile lock vs cloak: a homing missile LOSES its lock while its
        // target is cloaked — it stops homing and flies straight — but
        // REGAINS the lock if that same target decloaks while the missile
        // is still alive. The lock is suspended, not cleared:
        // TargetComponent keeps the target uuid (DropCloakedTargetSystem is
        // ship-only), so homing resumes here the moment the target
        // decloaks.
        //
        // UNLESS the missile's parent can target cloaked ships: a cloak
        // scanner with ModVal 0x0008 ("allow targeting of cloaked ships",
        // isTargetable) on the parent keeps its missiles homing on a
        // cloaked target. Measured on the original
        // (docs/reference_experiments.md, "J wave 6: Seeker 0x0020 under
        // ion fire, and missiles at cloaked targets"): with a 0x000C
        // scanner keeping the Wraith-cloaked target selected, 49 of about
        // 49 missiles homed and hit in two geometries; without one the
        // target dropped to "No Target" and later missiles flew straight.
        // The parent is the ship whose side the missile is on (its
        // OwnerComponent, which fire() sets to the firer when it has no
        // owner of its own), else the entity it was fired from.
        const parentUuid = owner?.owner ?? source;
        const parentScanner = parentUuid === undefined ? undefined
            : entities.get(parentUuid)?.components.get(CloakScannerComponent);
        if (!isTargetable(targetEntity?.components.get(CloakActiveComponent),
            parentScanner)) {
            movementState.turnTo = null;
            return;
        }

        // A jammed 'turns away if jammed' missile steers directly away from
        // its target for the rest of its life: the reverse of the straight
        // line to it, whatever the guidance mode.
        if (jamSteer === 'veerAway') {
            movementState.turnTo = zeroOrderGuidance(movementState.position,
                targetMovement.position).add(Math.PI);
            return;
        }

        // 'smart' leads the target (hard to dodge); 'simple' just points at
        // the target's current position (dodgeable by circling). The mode is
        // a room-wide deterministic resource; see guidance.ts.
        movementState.turnTo = guidanceAngle(guidanceMode.mode,
            movementState.position, movementState.velocity,
            targetMovement.position, targetMovement.velocity,
            projectileData.shotSpeed);
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
    // #237 pins: after ProjectileLifespanSystem (shared: *); before
    // ActiveSecondaryProvider — that pair no longer shares state (the
    // providers declare their writes with SetComponent now), but the
    // edge carries the transitive order. ProjectilePlugin registers
    // before WeaponPlugin.
    after: [ProjectileLifespanSystem],
    before: [ActiveSecondaryProvider],
});

/**
 * Everything a projectile strike needs to know about the shot, for
 * projectileMayStrike and strike below.
 */
interface ShotContext {
    uuid: string,
    projectileData: ProjectileWeaponData,
    owner: { owner: string } | undefined,
    firingGroup: FiringGroup | undefined,
    target: { target?: string } | undefined,
    source: string | undefined,
    createTime: number,
    time: { time: number },
    entities: EntityMap,
    world: World,
}

/**
 * Whether the shot may strike `other` at all, by a direct hit or its
 * proximity fuse: the rules every projectile hit passes, in one place so
 * the body (ProjectileCollisionSystem) and the fuse
 * (ProjectileProximityFuseSystem) never disagree.
 */
function projectileMayStrike(shot: ShotContext, otherUuid: string,
    other: Entity): boolean {
    const { uuid, projectileData, owner, firingGroup, target, source,
        createTime, time, entities, world } = shot;
    // Optional: a test world without game data can't judge hostility
    // and keeps the plain collision rules.
    const gameData = world.resources.get(SimulationGameDataResource);
    // Friendly-fire immunity: don't collide with anything in our
    // firing group — the firer itself, its fleet (leader+escorts),
    // its carrier/fighters — nor, for a projectile, any ship of the
    // firer's own government (SAME_GOVT_FIRING_IMMUNITY) — see
    // firing_group.ts. The owner uuid is the fallback group for weapons
    // that predate group stamping; the predicate never matches when the
    // weapon has neither (an ownerless projectile must not match every
    // group-less entity and pass through e.g. asteroids).
    const victimGroup = victimFiringGroup(
        other.components.get(FiringGroupComponent),
        other.components.get(OwnerComponent)?.owner,
        otherUuid);
    if (firingImmune(firingGroup?.group ?? owner?.owner, victimGroup,
        firingGroup?.govt, other.components.get(GovtComponent)?.id,
        disabledCancelsImmunity(otherUuid,
            other.components.has(DisabledComponent), source),
        'projectile')) {
        return false;
    }

    if (projectileData.proxSafety * 1000 + createTime > time.time) {
        // Prox safety is still active: the shot passes through
        // everything, body included, until it runs out (measured on the
        // original: a prox 60 / ProxSafety 30 shot flew through its
        // target untouched; "Submunitions wave 10").
        return false;
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
        && otherUuid !== target?.target) {
        // Asteroids are still fair game for guided weapons unless
        // the Seeker 0x0001 'passes over asteroids' flag is set.
        if (!other.components.has(AsteroidComponent)
            || projectileData.seeker.passOverAsteroids) {
            return false;
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
                uuid: otherUuid,
                kind: isShip ? 'fighter' : 'missile',
                owner: other.components.get(OwnerComponent)?.owner
                    ?? otherUuid,
                target: other.components.get(TargetComponent)?.target,
                hostile: isShip && isHostileTarget(otherUuid, other, {
                    viewerUuid, viewerEntity, entities,
                    gameData, now: time.time,
                    systemId: world.resources.get(SystemIdResource),
                }),
                inFlock: isInFlock(otherUuid, viewerUuid, getEntity)
                    || (viewerUuid !== sourceUuid
                        && isInFlock(otherUuid, sourceUuid,
                            getEntity)),
            }, { owner: viewerUuid, source: sourceUuid });
        if (!mayDamage) {
            return false;
        }
    }
    return true;
}

/** The shot's damage lands on `otherUuid`, decayed for its flight time. */
function strikeDamage(shot: ShotContext, otherUuid: string, emitNow: EmitFunction) {
    emitNow(DamagedEvent, {
        damage: decayDamage(shot.projectileData.damage,
            shot.projectileData.decay, shot.time.time - shot.createTime),
        damager: shot.uuid,
    }, [otherUuid]);
}

/**
 * The shot detonates on `otherUuid` (already damaged by strikeDamage):
 * submunitions as `end` and submunitionFires allow, then the shot is gone
 * and its ProjectileCollisionEvent drives the explosion and blast
 * (ProjectileExplodeSystem; the blast spares `otherUuid`, which took the
 * direct damage).
 */
function detonate(shot: ShotContext, self: Entity, otherUuid: string,
    end: ShotEnd, fireSubs: FireSubsFunction, emitNow: EmitFunction) {
    fireSubs(shot.projectileData.id, shot.uuid, end);
    shot.entities.delete(shot.uuid);
    emitNow(ProjectileCollisionEvent, {
        otherUuid,
        position: Position.fromVectorLike(
            self.components.get(MovementStateComponent)?.position ?? new Position(0, 0)
        ),
        projectileData: shot.projectileData,
    }, [self]);
}

export const ProjectileCollisionSystem = new System({
    name: 'ProjectileCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, UUID, ProjectileDataComponent,
        Optional(OwnerComponent), Optional(FiringGroupComponent),
        Optional(TargetComponent), FireSubs, TimeResource, CreateTime,
        EmitNow, GetWorld, Optional(SourceComponent)] as const,
    step(collision, entities, uuid, projectileData, owner, firingGroup,
        target, fireSubs, time, createTime, emitNow, world, source) {
        const other = entities.get(collision.other);
        if (!other) {
            return;
        }
        const shot: ShotContext = {
            uuid, projectileData, owner, firingGroup, target, source,
            createTime, time, entities, world,
        };
        if (!projectileMayStrike(shot, collision.other, other)) {
            return;
        }

        const self = entities.get(uuid);
        if (!self) {
            console.warn(`Missing projectile ${uuid} that is colliding`);
            return;
        }

        strikeDamage(shot, collision.other, emitNow);

        if (!collision.initiator) {
            // We are hit by point defense
            return;
        }

        // The shot's sprite touched the body: a DIRECT HIT, which never
        // subs (submunition_rule.ts) however wide its proximity fuse.
        // CollisionSystem runs before ProjectileProximityFuseSystem, so
        // when the body and the fuse connect on the same tick the body
        // wins: on the original a prox 12 shot fused at the 24 px disc's
        // body distance (19-20 px) hit it without subbing.
        detonate(shot, self, collision.other, 'directHit', fireSubs,
            emitNow);
    },
    // #237 pin (shared: *): among the CollisionEvent handlers, before
    // beam's.
    before: [BeamCollisionSystem],
});

/**
 * How much of the target's radius (hullRadius: its sprite mask's reach
 * from its centre) a proximity fuse adds to wëap ProxRadius: the fuse
 * fires when the shot's centre comes within
 * `ProxRadius + factor * targetRadius` of the target's centre.
 *
 * FITTED to the original (docs/reference_experiments.md, "Submunitions
 * wave 10"): on a 24 px disc (radius 12) the fuse fired about ProxRadius
 * + 7 px out (prox 16 / 20 / 30 / 60 detonated 24 / 27 / 36.5 / ~66 px
 * from the centre), on a 96 px disc (radius 48) about ProxRadius + 30
 * (prox 30 / 60 at 61.7 / 89.5): about two thirds of the extra radius.
 * 2/3 puts the fuse at ProxRadius + 8 and + 32, which every measured
 * detonation sits at or inside (the shots moved 2-6 px a frame, so a
 * detonation reads at or a little inside the true reach), and keeps the
 * body-first outcomes: prox 12 on the small disc (fuse 20, body 19-20:
 * the body won the tie) and prox 20 on the big one (fuse 52, body 54-56).
 * Unmeasured: other target shapes (non-disc ships), so the radius term
 * for an elongated hull is an extrapolation.
 */
export const PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED = 2 / 3;

/** The centre-to-centre distance at which a proximity fuse fires. */
export function proximityFuseReach(proxRadius: number,
    targetRadius: number): number {
    return proxRadius + PROX_FUSE_TARGET_RADIUS_FACTOR_FITTED * targetRadius;
}

const ProximityFuseCandidates = new Query([UUID, MovementStateComponent,
    HitboxHullComponent, CollisionVulnerabilityComponent] as const,
    'ProximityFuseCandidates');

/**
 * A shot's PROXIMITY FUSE (wëap ProxRadius > 0), separate from its body:
 * the shot detonates — damaging the ship that tripped it and firing its
 * submunitions, the one way besides expiry that a shot subs — once its
 * centre comes within proximityFuseReach of something it may strike
 * (projectileMayStrike: the same firing-group / same-govt / guided /
 * point defense / ProxSafety rules as a direct hit). The body
 * (ProjectileCollisionSystem, inside CollisionSystem) is judged first
 * each tick, so this fires only when the fuse beats the body.
 *
 * Several candidates in reach on one tick: the one deepest inside its
 * reach, then the smallest uuid — a total order, so the pick does not
 * depend on query iteration order (determinism).
 */
export const ProjectileProximityFuseSystem = new System({
    name: 'ProjectileProximityFuseSystem',
    args: [ProjectileDataComponent, MovementStateComponent,
        CollisionHitterComponent, CreateTime, TimeResource, UUID, Entities,
        FireSubs, EmitNow, GetWorld, Optional(OwnerComponent),
        Optional(FiringGroupComponent), Optional(TargetComponent),
        Optional(SourceComponent), ReadOnly(ProximityFuseCandidates)] as const,
    step(projectileData, movement, hitter, createTime, time, uuid, entities,
        fireSubs, emitNow, world, owner, firingGroup, target, source,
        candidates) {
        if (!(projectileData.proxRadius > 0)) {
            return;
        }
        if (projectileData.proxSafety * 1000 + createTime > time.time) {
            return; // Cheap early out; projectileMayStrike says the same.
        }
        const shot: ShotContext = {
            uuid, projectileData, owner, firingGroup, target, source,
            createTime, time, entities, world,
        };
        const { x, y } = movement.position;
        let best: { uuid: string, margin: number } | undefined;
        for (const [otherUuid, otherMovement, hull, vulnerability] of candidates) {
            if (otherUuid === uuid) {
                continue;
            }
            let vulnerable = false;
            for (const hitType of hitter.hitTypes) {
                if (vulnerability.vulnerableTo.has(hitType)) {
                    vulnerable = true;
                    break;
                }
            }
            if (!vulnerable) {
                continue;
            }
            const dx = otherMovement.position.x - x;
            const dy = otherMovement.position.y - y;
            const distanceSquared = dx * dx + dy * dy;
            const reach = proximityFuseReach(projectileData.proxRadius,
                hullRadius(hull));
            if (distanceSquared > reach * reach) {
                continue;
            }
            const margin = Math.sqrt(distanceSquared) - reach;
            if (best && (margin > best.margin
                || (margin === best.margin && otherUuid > best.uuid))) {
                continue;
            }
            const other = entities.get(otherUuid);
            if (!other || !projectileMayStrike(shot, otherUuid, other)) {
                continue;
            }
            best = { uuid: otherUuid, margin };
        }
        if (!best) {
            return;
        }
        const self = entities.get(uuid);
        if (!self) {
            return;
        }
        strikeDamage(shot, best.uuid, emitNow);
        detonate(shot, self, best.uuid, 'proximity', fireSubs, emitNow);
    },
    // After CollisionSystem, whose CollisionEvent handlers judge the body
    // first (a tie goes to the direct hit). #237 pin (shared: *): before
    // BeamDamageSystem, as the projectile collision handler runs before
    // the beam's.
    after: [CollisionSystem],
    before: [BeamDamageSystem],
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
        // Who the blast spares is BLAST_FLOCK_RULE's call (firing_group.ts):
        // under the current rule it inherits the projectile's firing group
        // — sparing the firer AND its fleet/carrier group — unless the
        // weapon's blast hurts the firing ship, in which case it carries
        // no group and hurts everyone, firer included.
        const spared = blastFriendlyFire(BLAST_FLOCK_RULE,
            projectileData.blastHurtsFiringShip,
            firingGroup ?? (owner && { group: owner.owner }), source);
        if (spared.group) {
            blast.components.set(FiringGroupComponent, spared.group);
        }
        if (spared.ignoreFirer !== undefined) {
            blastIgnore.add(spared.ignoreFirer);
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
        // On the wire as `{id}`, resolved in this world's Weapon data and
        // checked to be a projectile weapon (core/game_data_ref.ts).
        world.resources.get(SerializerResource)?.addComponent(
            ProjectileDataComponent, gameDataRefType<ProjectileWeaponData>(world, 'Weapon',
                'ProjectileData', (data): data is ProjectileWeaponData =>
                    (data as WeaponData).type === 'ProjectileWeaponData'));
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
        world.addSystem(ProjectileProximityFuseSystem);
        world.addSystem(ProjectileDeathSystem);
        world.addSystem(ProjectileHurtboxProvider);
        world.addSystem(ProjectileExplodeSystem);
        world.addSystem(ProjectileBlastSystem);
    }
}
