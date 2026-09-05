import { BeamWeaponData, WeaponData } from 'novadatainterface/weapon_data';
import { EmitNow, Entities, GetWorld, RunQueryFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { MovementState, MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import SAT from "sat";
import { CollisionSystem, CompositeHull, HitboxHullComponent, HurtboxHullComponent, UpdateHitboxHullSystem, UpdateHurtboxHullSystem } from './collisions_plugin.js';
import { CollisionEvent, CollisionHitterComponent } from './collision_interaction.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { ShipComponent } from './ship_plugin.js';
import { isInFlock } from './flock.js';
import { pointDefenseMayDamage } from './point_defense.js';
import { isHostileTarget } from './hostility.js';
import { CreateTime, CreateTimeArgProvider } from './create_time.js';
import { DamagedEvent } from './death_plugin.js';
import { applyExitPoint, ExitPointData } from './exit_point.js';
import { FireSubs, liveTargetMovement, WeaponConstructors, WeaponEntry } from './fire_weapon_plugin.js';
import { OwnerComponent, SourceComponent } from './weapon_components.js';
import { disabledCancelsImmunity, FiringGroupComponent, firingImmune, victimFiringGroup } from './firing_group.js';
import { GovtComponent } from './govt_component.js';
import { DisabledComponent } from './disabled_component.js';
import { zeroOrderGuidance } from './guidance.js';
import { SoundEvent } from './sound_plugin.js';
import { TargetComponent } from './target_component.js';
import { intervalElapsed, WeaponsSystem } from './weapon_plugin.js';


interface BeamState {
    pointToTarget?: boolean,
    exitPointData?: ExitPointData,
    hitDist?: number;
    targetHit?: string;
    /**
     * The inaccuracy this beam left the ship with, in radians (wëap
     * Inaccuracy: the error "as it leaves the ship"). A beam is rebuilt
     * from its firing ship every tick — position, heading, and for a
     * turret the aim at its target — and this is re-applied on top so
     * the ray keeps ONE error for its whole life rather than a fresh
     * random one per tick (which fanned a 5° Solar Lance over a 10°
     * arc at 60 Hz and cost a PRNG draw per beam per tick). Sampled
     * once in fireFromEntity; 0 for point defense beams, which the
     * Bible exempts. Optional: beams from older snapshots have none.
     */
    aimOffset?: number;
}

export const BeamStateComponent = new Component<BeamState>('BeamState');
export const BeamDataComponent = new Component<BeamWeaponData>('BeamData');

const BeamSubsQuery = new Query([MovementStateComponent] as const);

class BeamWeaponEntry extends WeaponEntry {
    declare data: BeamWeaponData;
    protected pointDefenseRangeSquared: number;

    private hitTypes: Set<string>;
    constructor(data: WeaponData, runQuery: RunQueryFunction) {
        if (data.type !== 'BeamWeaponData') {
            throw new Error('Data must be BeamWeaponData');
        }
        super(data, runQuery);
        this.pointDefenseRangeSquared = data.beamAnimation.length ** 2;

        this.hitTypes = new Set(['normal']);
        if (data.guidance === 'pointDefenseBeam') {
            this.hitTypes = new Set(['pointDefense']);
        }
    }

    protected override guidance(exitPoint: Position, _movement: MovementState,
        targetMovement: MovementState) {
        return zeroOrderGuidance(exitPoint, targetMovement.position);
    }

    fire(position: Position, angle: Angle, owner?: string, target?: string,
        source?: string, _sourceVelocity?: Vector,
        exitPointData?: ExitPointData, silent = false,
        aimOffset = 0): Entity {
        const { width, length } = this.data.beamAnimation;
        const beamPoly = new SAT.Polygon(new SAT.Vector(0, 0), [
            new SAT.Vector(-width / 2, 0),
            new SAT.Vector(-width / 2, -length),
            new SAT.Vector(width / 2, -length),
            new SAT.Vector(width / 2, 0),
        ]);

        const beam = new Entity()
            .setName(this.data.name)
            .addComponent(MovementStateComponent, {
                position,
                rotation: angle,
                velocity: new Vector(0, 0),
                accelerating: 0,
                turnBack: false,
                turning: 0,
            }).addComponent(CollisionHitterComponent, {
                hitTypes: this.hitTypes,
            }).addComponent(HurtboxHullComponent, new CompositeHull([beamPoly])
            ).addComponent(BeamStateComponent, {
                exitPointData,
                pointToTarget: this.data.guidance === "beamTurret" ||
                    this.data.guidance === "pointDefenseBeam",
                aimOffset,
            }).addComponent(BeamDataComponent, this.data);

        if (target) {
            beam.addComponent(TargetComponent, { target });
        }

        if (owner) {
            beam.addComponent(OwnerComponent, { owner });
        }
        if (source) {
            beam.addComponent(SourceComponent, source);
        }

        // See the projectile path: a submunition burst plays its firing
        // sound once, not once per child.
        if (this.data.sound && !silent) {
            this.emit(SoundEvent, {
                id: this.data.sound,
                loop: this.data.loopSound,
            });
        }
        this.entities.set(this.ids.next('beam'), beam);
        return beam;
    }

    override fireSubs(source: string, sourceExpired = false) {
        const [{ position, rotation }] = this.runQuery(BeamSubsQuery, source)[0];
        const endOfBeam = position.add(rotation.getUnitVector()
            .scale(this.data.beamAnimation.length)) as Position;
        return super.fireSubs(source, sourceExpired, endOfBeam);
    }
}

export const BeamSystem = new System({
    name: 'BeamSystem',
    // Before BOTH hull updaters: a beam is a hitter, so its hull is a
    // HurtboxHullComponent (see makeBeam), and it must be recomputed
    // from the movement this system writes in the same tick. The
    // hurtbox edge held only by addSystem insertion order (#113/#43).
    before: [UpdateHitboxHullSystem, UpdateHurtboxHullSystem],
    // TimeSystem listed explicitly (determinism rule 4): reads time.time
    // for beam aging. after: [MovementSystem] already pins it after
    // TimeSystem transitively, but the explicit edge keeps it robust.
    after: [TimeSystem, MovementSystem, WeaponsSystem],
    args: [BeamDataComponent, BeamStateComponent, MovementStateComponent, FireSubs,
        CreateTimeArgProvider, TimeResource, UUID, Entities, Optional(SourceComponent),
        Optional(TargetComponent)] as const,
    step(beamData, beamState, movement, fireSubs, fireTime, { time, delta_ms },
        uuid, entities, source, target) {
        // A beam of Count frames lives for exactly Count frames of ticks
        // (two 60 Hz ticks per frame), judged to the nearest tick like a
        // reload (intervalElapsed): a strict `>` here let a 1-frame beam
        // straddle a THIRD tick when 2 x 16.67 ms came out a hair under
        // 33.33 ms, and that tick landed damage. A beam with a Decay
        // outlives its Count on screen (onScreenDuration); the damage
        // window below still closes at Count.
        const timeSinceFire = time - fireTime;
        if (intervalElapsed(timeSinceFire,
            beamData.onScreenDuration ?? beamData.shotDuration, delta_ms)) {
            fireSubs(beamData.id, uuid, true);
            entities.delete(uuid);
            return;
        }

        if (source) {
            const parent = entities.get(source);
            const parentMovement = parent?.components
                .get(MovementStateComponent);
            if (parentMovement) {
                movement.position =
                    Position.fromVectorLike(parentMovement.position);
                movement.rotation =
                    Angle.fromAngleLike(parentMovement.rotation);

                if (beamState.exitPointData) {
                    const exitPoint = applyExitPoint(beamState.exitPointData,
                        parentMovement.rotation)

                    movement.position = movement.position.add(exitPoint) as Position;
                }
            }
        }

        // A turret beam is a ray held on its target: every tick it is
        // rebuilt from the firing ship's position/rotation above and then
        // swung back onto the target here. So when the target stops
        // existing, the swing does not happen and the beam is left
        // pointing straight out of the ship's nose — a full-strength beam
        // firing forward, dealing damage to whatever is ahead, for the
        // rest of its shot duration. That is the tick after the beam's
        // own victim dies: the target entity is gone (its uuid outlives
        // it, see liveTargetMovement) or is exploding, and
        // DropExplodingTargetSystem/TargetRemovedSystem clear the lock
        // between one BeamSystem run and the next.
        //
        // The ray ends instead. A beam aimed at nothing is not a beam
        // that fires forward, it is a beam that is over: no entity, so no
        // collision, no damage, and nothing drawn. Submunitions
        // deliberately do NOT fire — this is the beam being cut off, not
        // running its course, and the `sourceExpired` subs above are for
        // a beam that reached the end of its duration.
        //
        // Deleting here (before UpdateHitboxHullSystem and CollisionSystem,
        // which this system is ordered ahead of) is what keeps the
        // stray frame from landing damage.
        if (beamState.pointToTarget) {
            const targetMovement = liveTargetMovement(entities, target?.target);
            if (!targetMovement) {
                entities.delete(uuid);
                return;
            }
            movement.rotation = zeroOrderGuidance(movement.position,
                targetMovement.position);
        }
        // The error the beam left the ship with, re-applied after the
        // rebuild above so it is the same ray every tick (BeamState.aimOffset).
        if (beamState.aimOffset) {
            movement.rotation = movement.rotation.add(beamState.aimOffset);
        }
    }
});

export const BeamResetSystem = new System({
    name: "BeamResetSystem",
    args: [BeamStateComponent] as const,
    step: (state) => {
        state.hitDist = undefined;
        state.targetHit = undefined;
    },
    before: [CollisionSystem], // Before collisions so we clear previous frame's hits
});

// Based on: https://stackoverflow.com/questions/563198/how-do-you-detect-where-two-line-segments-intersect
function getIntersection(r0: Vector, r1: Vector, a0: Vector, a1: Vector): number {
    const s1 = r1.subtract(r0);
    const s2 = a1.subtract(a0);

    const s = (-s1.y * (r0.x - a0.x) + s1.x * (r0.y - a0.y)) / (-s2.x * s1.y + s1.x * s2.y);
    const t = (s2.x * (r0.y - a0.y) - s2.y * (r0.x - a0.x)) / (-s2.x * s1.y + s1.x * s2.y);

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        // Collision detected
        return t; // t is the distance along the ray (fraction of beam length if ray is beam segment)
    }

    return Infinity; // No collision
}

// Point-in-convex-polygon test using the sign of the cross products between
// each edge and the vector from the edge start to the point. For a convex
// polygon whose vertices are given in a consistent winding order, the point is
// inside iff all cross products share the same sign (points on an edge count as
// inside). Deterministic and cheap - no trig, just multiplies and adds.
// `points` must already be in world space (rotation + position applied).
function pointInConvexPolygon(point: Vector, points: Vector[]): boolean {
    if (points.length < 3) {
        return false;
    }
    let hasPositive = false;
    let hasNegative = false;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        const edge = p2.subtract(p1);
        const toPoint = point.subtract(p1);
        const cross = edge.x * toPoint.y - edge.y * toPoint.x;
        if (cross > 0) {
            hasPositive = true;
        } else if (cross < 0) {
            hasNegative = true;
        }
        if (hasPositive && hasNegative) {
            // Point is on the outer side of at least one edge.
            return false;
        }
    }
    return true;
}

// Computes the fraction along the beam (0..1) at which the beam first hits the
// given hull, or Infinity if it does not. `shapes` are the hull's component SAT
// shapes (a hull may be decomposed into several convex polygons and/or circles).
// A beam whose origin (`start`) lies inside ANY component shape hits immediately
// at the origin (fraction 0); otherwise the beam segment `start`->`end` is
// raycast against every component and the nearest crossing is returned.
export function beamHullHitFraction(start: Vector, end: Vector,
    shapes: readonly (SAT.Polygon | SAT.Circle)[]): number {
    const beamVector = end.subtract(start);
    let minT = Infinity;
    for (const shape of shapes) {
        // Check each edge of the polygon
        if (shape instanceof SAT.Polygon) {
            const points = shape.points.map(
                v => Vector.fromVectorLike(v)
                    .rotate(shape.angle)
                    .add(shape.pos));

            // If the beam originates inside this convex component, the beam
            // hits immediately at its origin. A ray starting inside a convex
            // polygon only crosses the exit edge, so the edge raycast below
            // would otherwise report the (wrong) exit point instead.
            if (pointInConvexPolygon(start, points)) {
                return 0;
            }

            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                const t = getIntersection(start, end, p1, p2);
                if (t < minT) {
                    minT = t;
                }
            }
        } else if (shape instanceof SAT.Circle) {
            // Ray circle intersection
            // Math based on: https://math.stackexchange.com/questions/311921/get-location-of-vector-circle-intersection
            const r = shape.r;
            const c = new Vector(shape.pos.x, shape.pos.y);
            const d = beamVector; // Direction vector (full length)
            const f = start.subtract(c);

            // Beam origin inside the circle => immediate hit at the origin.
            if (f.dot(f) <= r * r) {
                return 0;
            }

            const a = d.dot(d);
            const b = 2 * f.dot(d);
            const q = f.dot(f) - r * r;

            const discriminant = b * b - 4 * a * q;
            if (discriminant >= 0) {
                const sqrtDisc = Math.sqrt(discriminant);
                const t1 = (-b - sqrtDisc) / (2 * a);
                const t2 = (-b + sqrtDisc) / (2 * a);

                if (t1 >= 0 && t1 <= 1) {
                    if (t1 < minT) minT = t1;
                }
                if (t2 >= 0 && t2 <= 1) {
                    if (t2 < minT) minT = t2;
                }
            }
        }
    }
    return minT;
}

export const BeamCollisionSystem = new System({
    name: 'BeamCollisionSystem',
    events: [CollisionEvent],
    args: [CollisionEvent, Entities, Optional(OwnerComponent),
        Optional(FiringGroupComponent), BeamDataComponent,
        BeamStateComponent, MovementStateComponent,
        Optional(SourceComponent), UUID, TimeResource, GetWorld] as const,
    step(collision, entities, owner, firingGroup, beamData, beamState,
        movement, source, uuid, time, world) {
        // Optional: a test world without game data can't judge hostility
        // and keeps the plain collision rules.
        const gameData = world.resources.get(SimulationGameDataResource);

        const other = entities.get(collision.other);
        if (!other) {
            return;
        }

        // Friendly-fire immunity: the beam passes through its firer's
        // whole firing group (fleet, carrier+fighters); see
        // firing_group.ts. Owner uuid is the group fallback.
        if (firingImmune(
            firingGroup?.group ?? owner?.owner,
            victimFiringGroup(other.components.get(FiringGroupComponent),
                other.components.get(OwnerComponent)?.owner,
                collision.other),
            firingGroup?.govt,
            other.components.get(GovtComponent)?.id,
            disabledCancelsImmunity(collision.other,
                other.components.has(DisabledComponent), source))) {
            return;
        }

        // A POINT DEFENSE beam hurts only what the turret would have
        // aimed at — a missile flying at us, a ship hostile to us
        // (point_defense.ts); a bystander it sweeps across is not a hit.
        if (beamData.guidance === 'pointDefenseBeam' && gameData) {
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

        const otherHull = other.components.get(HitboxHullComponent);
        if (!otherHull) {
            return;
        }

        // Raycast against the hull
        const start = movement.position;
        const beamVector = movement.rotation.getUnitVector().scale(beamData.beamAnimation.length);
        const end = start.add(beamVector);

        const minT = beamHullHitFraction(start, end, otherHull.shapes);

        if (minT !== Infinity) {
            // We found a hit.
            const distance = minT * beamData.beamAnimation.length;
            if (beamState.hitDist === undefined || distance < beamState.hitDist) {
                beamState.hitDist = distance;
                beamState.targetHit = collision.other;
            }
        }
    }
});

const BeamDamageSystem = new System({
    name: 'BeamDamageSystem',
    args: [BeamDataComponent, BeamStateComponent, CreateTimeArgProvider, EmitNow, TimeResource, UUID] as const,
    step(beamData, beamState, fireTime, emitNow, { time, delta_ms }, uuid) {
        if (!beamState.targetHit) {
            return;
        }

        // This tick credits the slice [timeSinceFire, timeSinceFire +
        // delta_ms) of the beam's Count-frame damage window, clipped to
        // the window's end, so a Count-N beam deals exactly N frames of
        // its per-frame damage over its life: 1.0 for a 1-frame Polaron
        // shot (two half-frame ticks), 15.0 for a Pulse Laser. The
        // window is `shotDuration` (Count) even when a Decay keeps the
        // beam on screen longer — the shrinking tail does no damage (see
        // BeamWeaponData.onScreenDuration). `remaining` is judged to
        // the nearest tick like the beam's own expiry (intervalElapsed),
        // so float noise in the accumulated clock can neither add a
        // sliver of a tick nor drop one.
        const remaining = beamData.shotDuration - (time - fireTime);
        if (remaining < delta_ms / 2) {
            return;
        }
        const damageTime = Math.min(delta_ms, remaining);
        const scale = damageTime * 30 / 1000;

        emitNow(DamagedEvent, { damage: beamData.damage, damager: uuid, scale }, [beamState.targetHit]);
    },
    // TimeSystem listed explicitly (determinism rule 4): computes damage
    // from time and delta_ms. after: [CollisionSystem] already pins it
    // after TimeSystem transitively; the explicit edge keeps it robust.
    after: [TimeSystem, CollisionSystem],
});

export const BeamPlugin: Plugin = {
    name: 'BeamPlugin',
    build(world) {
        const weaponConstructors = world.resources.get(WeaponConstructors);
        if (!weaponConstructors) {
            throw new Error('Expected WeaponConstructors to exist');
        }
        world.resources.get(SerializerResource)?.addComponent(
            BeamDataComponent, passthroughType<BeamWeaponData>('BeamDataComponentType'));
        world.resources.get(SerializerResource)?.addComponent(
            BeamStateComponent, passthroughType<BeamState>('BeamStateComponentType'));
        weaponConstructors.set('BeamWeaponData', BeamWeaponEntry);

        world.addSystem(BeamResetSystem);
        world.addSystem(BeamSystem);
        world.addSystem(BeamCollisionSystem);
        world.addSystem(BeamDamageSystem);
    }
};
