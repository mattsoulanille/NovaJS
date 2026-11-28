import { Animation } from "novadatainterface/animation";
import { Emit, EmitNow, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { ReadOnly } from "nova_ecs/read_only";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { ProvideFromCache } from './provide_from_cache.js';
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import RBush, { BBox } from "rbush";
import SAT from "sat";
import { SimulationGameDataInterface } from "../../client/gamedata/simulation_game_data.js";
import { getFrameFromMovement } from "../../util/get_frame_and_angle.js";
import { AnimationComponent } from "./animation_plugin.js";
import { CollisionEvent, CollisionHitter, CollisionHitterComponent, CollisionVulnerability, CollisionVulnerabilityComponent } from "./collision_interaction.js";
import { SimulationGameDataResource } from "./game_data_resource.js";

// @types/sat (0.0.35) predates SAT 0.9's getAABBAsBox, which every shape
// has at runtime (SAT.js: Circle.prototype.getAABBAsBox and
// Polygon.prototype.getAABBAsBox); getBoundingBox below reads it.
declare module "sat" {
    interface Polygon {
        getAABBAsBox(): SAT.Box;
    }
    interface Circle {
        getAABBAsBox(): SAT.Box;
    }
}

type Shape = SAT.Polygon | SAT.Circle;
export abstract class Hull {
    abstract shapes: Shape[];
    abstract pos: SAT.Vector;
    abstract angle: number;
    abstract readonly bbox: BBox;

    collides(other: Hull) {
        for (const shape of this.shapes) {
            for (const otherShape of other.shapes) {
                if (shape instanceof SAT.Polygon) {
                    if (otherShape instanceof SAT.Polygon &&
                        SAT.testPolygonPolygon(shape, otherShape)) {
                        return true;
                    } else if (otherShape instanceof SAT.Circle &&
                        SAT.testPolygonCircle(shape, otherShape)) {
                        return true;
                    }
                } else {
                    if (otherShape instanceof SAT.Polygon &&
                        SAT.testCirclePolygon(shape, otherShape)) {
                        return true;
                    } else if (otherShape instanceof SAT.Circle &&
                        SAT.testCircleCircle(shape, otherShape)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
}

export class CompositeHull extends Hull {
    private bboxShape: BBox;
    private wrappedAngle = 0;
    private wrappedPos = new SAT.Vector(0, 0);
    constructor(readonly shapes: Shape[]) {
        super();
        this.pos = new SAT.Vector(0, 0); // Set position on shapes
        this.bboxShape = getBoundingBox(shapes);
    }

    set pos(position: SAT.Vector) {
        if (this.pos === position) {
            return;
        }
        for (const shape of this.shapes) {
            shape.pos = position;
        }
        this.wrappedPos = position;
    }

    get pos() {
        return this.wrappedPos;
    }

    set angle(angle: number) {
        if (angle === this.wrappedAngle) {
            return;
        }
        for (const shape of this.shapes) {
            if ('setAngle' in shape) {
                shape.setAngle(angle);
            }
        }
        this.wrappedAngle = angle;
    }
    get angle() {
        return this.wrappedAngle
    }

    get bbox() {
        // rotateAabb is a pure function of the (fixed) resting box and
        // the angle, so it is memoized on the angle: most hulls keep
        // theirs from tick to tick. A FRESH box is still returned every
        // call (CollisionSystem turns it into its rbush entry).
        if (this.rotatedBboxAngle !== this.angle) {
            this.rotatedBbox = rotateAabb(this.bboxShape, this.angle);
            this.rotatedBboxAngle = this.angle;
        }
        return translateAabb(this.rotatedBbox!, this.pos);
    }
    private rotatedBbox: BBox | undefined;
    private rotatedBboxAngle: number | undefined;
}

export class MultiFrameHull extends Hull {
    private activeHull: Hull;
    public pos = new SAT.Vector(0, 0);
    private wrappedAngle = 0;
    /** One hull per animation frame (readable for encodeHull). */
    constructor(readonly hulls: readonly Hull[]) {
        super();
        this.activeHull = hulls[0];
        this.activeHull.pos = this.pos;
    }
    get shapes() {
        return this.activeHull.shapes;
    }
    get angle() {
        return this.wrappedAngle;
    }
    set angle(angle: number) {
        this.activeHull.angle = angle;
        this.wrappedAngle = angle;
    }
    set frame(frame: number) {
        const newHull = this.hulls[frame];
        if (newHull === this.activeHull) {
            return;
        }
        if (!newHull) {
            console.warn(`Tried to set hull to ${frame} but only ${this.hulls.length} are available`);
            return;
        }
        newHull.angle = this.wrappedAngle;
        newHull.pos = this.pos;
        this.activeHull = newHull;
    }

    /**
     * `frame = frame` then `angle = angle`, without first turning a newly
     * active frame's hull to the OLD angle: each turn recomputes every
     * polygon (SAT's _recalc), and the end state is the same.
     */
    setFrameAndAngle(frame: number, angle: number) {
        const newHull = this.hulls[frame];
        if (newHull !== this.activeHull) {
            if (newHull) {
                newHull.pos = this.pos;
                this.activeHull = newHull;
            } else {
                console.warn(`Tried to set hull to ${frame} but only ${this.hulls.length} are available`);
            }
        }
        this.angle = angle;
    }

    get bbox() {
        return this.activeHull.bbox;
    }
}

const hullRadii = new WeakMap<Hull, number>();

/**
 * The hull's reach from its centre: the farthest any of its shapes
 * extends from the hull's origin, over EVERY animation frame of a
 * MultiFrameHull, so it does not change as a ship turns. A sprite-mask
 * disc of radius 12 reads 12; an elongated ship reads half its length.
 * The target-size term of a proximity fuse (projectile_plugin.ts).
 *
 * Pure geometry (base polygon points are unrotated and relative to the
 * hull's origin; a hull's circles are centred on it), so every peer
 * computes the same value; memoized per hull object, which no snapshot
 * sees.
 */
export function hullRadius(hull: Hull): number {
    const cached = hullRadii.get(hull);
    if (cached !== undefined) {
        return cached;
    }
    const frames: readonly Hull[] = hull instanceof MultiFrameHull
        ? hull.hulls : [hull];
    let radiusSquared = 0;
    let circleRadius = 0;
    for (const frame of frames) {
        for (const shape of frame.shapes) {
            if (shape instanceof SAT.Circle) {
                circleRadius = Math.max(circleRadius, shape.r);
                continue;
            }
            for (const point of shape.points) {
                radiusSquared = Math.max(radiusSquared,
                    point.x * point.x + point.y * point.y);
            }
        }
    }
    const radius = Math.max(Math.sqrt(radiusSquared), circleRadius);
    hullRadii.set(hull, radius);
    return radius;
}

export const HitboxHullComponent = new Component<Hull>('HitboxHullComponent');
export const HurtboxHullComponent = new Component<Hull>('HurtboxHullComponent');

/**
 * Wire form of a hull: its resting geometry only. Position, angle, and
 * the active animation frame are per-step scratch, recomputed from
 * movement and animation state before every collision check.
 *
 * Hulls need a wire codec (rather than rebuilding on restore) because
 * they are created along four different paths — sprite-sheet hulls via
 * providers, proximity/blast circles at fire time, beam polygons,
 * escort hurtbox aliasing — and the wire snapshot must not care which.
 */
type WireShape =
    | { circle: { r: number } }
    | { polygon: { points: [number, number][] } };
export type WireHull = { frames: WireShape[][] } | { shapes: WireShape[] };

function encodeShape(shape: Shape): WireShape {
    if (shape instanceof SAT.Circle) {
        return { circle: { r: shape.r } };
    }
    // Base points: SAT rotates calcPoints, leaving these unmodified.
    return { polygon: { points: shape.points.map(p => [p.x, p.y]) } };
}

function decodeShape(wire: WireShape): Shape {
    if ('circle' in wire) {
        return new SAT.Circle(new SAT.Vector(0, 0), wire.circle.r);
    }
    return new SAT.Polygon(new SAT.Vector(),
        wire.polygon.points.map(([x, y]) => new SAT.Vector(x, y)));
}

export function encodeHull(hull: Hull): WireHull {
    if (hull instanceof MultiFrameHull) {
        return { frames: hull.hulls.map(frame => frame.shapes.map(encodeShape)) };
    }
    return { shapes: hull.shapes.map(encodeShape) };
}

export function decodeHull(wire: WireHull): Hull {
    if ('frames' in wire) {
        return new MultiFrameHull(wire.frames.map(
            frame => new CompositeHull(frame.map(decodeShape))));
    }
    return new CompositeHull(wire.shapes.map(decodeShape));
}

export function hullFromAnimation(animation: Animation, gameData: SimulationGameDataInterface) {
    // Reads the pre-warmed cache (see entity_data_loader.ts). Returns
    // undefined when the sprite sheet has not loaded yet, in which case
    // getCached kicks off a background load and the provider retries.
    const spriteSheet = gameData.data.SpriteSheet
        .getCached(animation.images.baseImage.id);
    if (!spriteSheet) {
        return undefined;
    }

    const hulls = spriteSheet.hulls.map(hull =>
        hull.map(convexHull => new SAT.Polygon(new SAT.Vector(),
            convexHull.slice().reverse().map(([x, y]) => new SAT.Vector(x, -y)))))
        .map(convexPolys => new CompositeHull(convexPolys));

    return new MultiFrameHull(hulls);
}

export const HitboxHullProvider = ProvideFromCache({
    name: "HitboxProvider",
    provided: HitboxHullComponent,
    args: [AnimationComponent, SimulationGameDataResource, CollisionVulnerabilityComponent] as const,
    factory: hullFromAnimation,
});

export type RBushEntry = BBox & {
    uuid: string,
    hull: Hull,
    vulnerability: CollisionVulnerability,
};

export const RBushResource = new Resource<RBush<RBushEntry>>("RBushResource");

export function getBoundingBox(shapes: Shape[]): BBox {
    return shapes.map(p => p.getAABBAsBox())
        .map(box => ({
            minX: box.pos.x,
            minY: box.pos.y,
            maxX: box.pos.x + box.w,
            maxY: box.pos.y + box.h,
        }))
        .reduce((a, b) => ({
            minX: Math.min(a.minX, b.minX),
            minY: Math.min(a.minY, b.minY),
            maxX: Math.max(a.maxX, b.maxX),
            maxY: Math.max(a.maxY, b.maxY),
        }));
}

function aHitsB(a: CollisionHitter, b: CollisionVulnerability) {
    for (const hitType of a.hitTypes) {
        if (b.vulnerableTo.has(hitType)) {
            return true;
        }
    }
    return false;
}

function translateAabb(bbox: BBox, { x, y }: { x: number, y: number }): BBox {
    return {
        minX: bbox.minX + x,
        minY: bbox.minY + y,
        maxX: bbox.maxX + x,
        maxY: bbox.maxY + y,
    };
}

function rotateAabb(bbox: BBox, angle: number | Angle): BBox {
    const radians = angle instanceof Angle ? angle.angle : angle;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const { minX, minY, maxX, maxY } = bbox;
    const x0 = cos * minX - sin * minY;
    const y0 = sin * minX + cos * minY;
    const x1 = cos * minX - sin * maxY;
    const y1 = sin * minX + cos * maxY;
    const x2 = cos * maxX - sin * minY;
    const y2 = sin * maxX + cos * minY;
    const x3 = cos * maxX - sin * maxY;
    const y3 = sin * maxX + cos * maxY;

    return {
        maxX: Math.max(x0, x1, x2, x3),
        maxY: Math.max(y0, y1, y2, y3),
        minX: Math.min(x0, x1, x2, x3),
        minY: Math.min(y0, y1, y2, y3),
    };
}

export const UpdateHitboxHullSystem = new System({
    name: "UpdateHitboxHullSystem",
    // MovementStateComponent and AnimationComponent are read-only here:
    // the step writes only the hull it owns (HitboxHullComponent). The
    // annotation lets the ambiguity report ignore a pair that shares
    // only those reads (see UpdateHurtboxHullSystem).
    args: [ReadOnly(MovementStateComponent), HitboxHullComponent, ReadOnly(Optional(AnimationComponent))] as const,
    step(movement, hull, animation) {
        let angle = movement.rotation.angle;
        if (hull instanceof MultiFrameHull) {
            let frame = 0;
            if (animation) {
                ({ frame, angle } = getFrameFromMovement(animation, movement));
            }
            hull.setFrameAndAngle(frame, angle);
        } else {
            hull.angle = angle;
        }

        hull.pos.x = movement.position.x;
        hull.pos.y = movement.position.y;
    },
    after: [MovementSystem],
});

export const UpdateHurtboxHullSystem = new System({
    name: "UpdateHurtboxHullSystem",
    // Same read-only args as UpdateHitboxHullSystem; the step writes
    // only HurtboxHullComponent.
    args: [ReadOnly(MovementStateComponent), HurtboxHullComponent, ReadOnly(Optional(AnimationComponent))] as const,
    step: UpdateHitboxHullSystem.step,
    // The two hull updaters share only read-only state (MovementState,
    // AnimationComponent) and write disjoint hulls, so their relative
    // order is unobservable: no pin needed (see #263). They still run
    // after MovementSystem, which writes the movement they read.
    after: [MovementSystem],
});

/**
 * The tick's collisions, one per unordered pair, in canonical order
 * (initiator, then receiver, by uuid).
 *
 * Only hitboxes go into the R-tree and only hurtboxes query it: a hurtbox
 * can only hit a hitbox, so this is the same candidate set the old
 * both-kinds-in-one-tree sweep found (it discovered every hurtbox->hitbox
 * overlap from both ends), with half the tree and half the searches.
 *
 * Pairs are COLLECTED first and returned in canonical (uuid-sorted)
 * order: discovery order follows query-cache/rbush iteration order, which
 * differs between a live world and a wire-restored one (rebuilt caches
 * iterate in entity-map order). Without canonicalization, two missiles
 * striking the same ship on the same tick have their collision events —
 * and thus their blasts' allocated ids — ordered differently on the two
 * worlds, a lockstep divergence the wire-snapshot test caught.
 *
 * An entity never collides with itself. The old sweep could pair an
 * entity's own hurtbox with its own hitbox (a returning nested-bay
 * fighter: its hurtbox aliases its hitbox, and its 'return_escorts'
 * hitter meets the 'return_escorts' vulnerability its own docking
 * fighters give it), but every CollisionEvent handler ignored such an
 * event (the collector docks only with its home, the scoop only with
 * debris), so dropping it changes nothing observable.
 */
export function findCollisions(rbush: RBush<RBushEntry>,
    hitboxColliders: readonly (readonly [Hull, string, CollisionVulnerability])[],
    hurtboxColliders: readonly (readonly [Hull, string, CollisionHitter])[]):
    { initiator: string, receiver: string }[] {
    rbush.clear();
    if (hitboxColliders.length === 0 || hurtboxColliders.length === 0) {
        return [];
    }
    const hitboxEntries = new Array<RBushEntry>(hitboxColliders.length);
    for (let i = 0; i < hitboxColliders.length; i++) {
        const [hull, uuid, vulnerability] = hitboxColliders[i];
        const bbox = hull.bbox;
        hitboxEntries[i] = {
            minX: bbox.minX,
            minY: bbox.minY,
            maxX: bbox.maxX,
            maxY: bbox.maxY,
            uuid,
            hull,
            vulnerability,
        };
    }
    rbush.load(hitboxEntries);

    const chosen = new Map<string, { initiator: string, receiver: string }>();
    for (let i = 0; i < hurtboxColliders.length; i++) {
        const [hurtHull, initiator, hitter] = hurtboxColliders[i];
        const maybeCollisions = rbush.search(hurtHull.bbox);
        for (let j = 0; j < maybeCollisions.length; j++) {
            const other = maybeCollisions[j];
            const receiver = other.uuid;
            if (receiver === initiator) {
                continue;
            }
            const collisionPair = initiator < receiver
                ? `${initiator},${receiver}` : `${receiver},${initiator}`;
            const existing = chosen.get(collisionPair);
            // One collision per unordered pair per tick. When both
            // orientations overlap (mutual hurtbox/hitbox pairs), prefer
            // the lexicographically smaller initiator — a canonical
            // stand-in for the old first-discovered-wins rule.
            //
            // The initiator of a collision must have its hurtbox overlap
            // the other collider's hitbox. If the inverse were allowed, a
            // missile's prox radius overlapping a point defense weapon
            // could be a collision initiated by the point defense weapon,
            // meaning point defense could hit the missile by hitting its
            // prox radius (bad).
            if (existing && existing.initiator <= initiator) {
                continue;
            }
            if (aHitsB(hitter, other.vulnerability)
                && hurtHull.collides(other.hull)) {
                chosen.set(collisionPair, { initiator, receiver });
            }
        }
    }
    if (chosen.size === 0) {
        return [];
    }
    return [...chosen.values()].sort((p, q) =>
        p.initiator < q.initiator ? -1 : p.initiator > q.initiator ? 1 :
            p.receiver < q.receiver ? -1 : p.receiver > q.receiver ? 1 : 0);
}

export const CollisionSystem = new System({
    name: "CollisionSystem",
    // After BOTH hull updaters (#113): the hurtbox edge used to hold
    // only by addSystem insertion order. Sorted before
    // UpdateHurtboxHullSystem, projectiles would collide with one-tick-
    // stale hurtboxes (deterministic, but wrong).
    after: [UpdateHitboxHullSystem, UpdateHurtboxHullSystem],
    args: [RBushResource,
        new Query([HitboxHullComponent, UUID, CollisionVulnerabilityComponent] as const),
        new Query([HurtboxHullComponent, UUID, CollisionHitterComponent] as const),
        EmitNow, SingletonComponent] as const,
    step(rbush, hitboxColliders, hurtboxColliders, emit) {
        const collisions = findCollisions(rbush, hitboxColliders,
            hurtboxColliders);
        for (const { initiator, receiver } of collisions) {
            emit(CollisionEvent, {
                other: receiver,
                initiator: true,
            }, [initiator]);
            emit(CollisionEvent, {
                other: initiator,
                initiator: false,
            }, [receiver]);
        }
    }
});

const LogCollisionSystem = new System({
    name: "LogCollisionSystem",
    events: [CollisionEvent],
    args: [CollisionEvent, UUID] as const,
    step({ other }, uuid) {
        console.log(`${uuid} hit by ${other}`);
    }
});

export const CollisionsPlugin: Plugin = {
    name: 'CollisionsPlugin',
    build(world) {
        //world.addComponent(HullComponent);
        world.resources.set(RBushResource, new RBush());

        world.addSystem(HitboxHullProvider);

        world.addSystem(UpdateHitboxHullSystem);
        world.addSystem(UpdateHurtboxHullSystem);
        world.addSystem(CollisionSystem);
        //world.addSystem(LogCollisionSystem);
    }
};
