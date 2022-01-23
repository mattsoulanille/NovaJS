import { Animation } from "novadatainterface/Animation";
import { GameDataInterface } from "novadatainterface/GameDataInterface";
import { Emit, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent, MovementSystem } from "nova_ecs/plugins/movement_plugin";
import { ProvideAsync } from "nova_ecs/provider";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import RBush, { BBox } from "rbush";
import * as SAT from "sat";
import { getFrameFromMovement } from "../util/get_frame_and_angle";
import { AnimationComponent } from "./animation_plugin";
import { CollisionEvent, CollisionHitter, CollisionHitterComponent, CollisionVulnerability, CollisionVulnerabilityComponent } from "./collision_interaction";
import { GameDataResource } from "./game_data_resource";

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
        const rotated = rotateAabb(this.bboxShape, this.angle);
        return translateAabb(rotated, this.pos);
    }
}

class MultiFrameHull extends Hull {
    private activeHull: Hull;
    public pos = new SAT.Vector(0, 0);
    private wrappedAngle = 0;
    constructor(private hulls: Hull[]) {
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

    get bbox() {
        return this.activeHull.bbox;
    }
}

export const HitboxHullComponent = new Component<Hull>('HitboxHullComponent');
export const HurtboxHullComponent = new Component<Hull>('HurtboxHullComponent');

export async function hullFromAnimation(animation: Animation, gameData: GameDataInterface) {
    const spriteSheet = await gameData.data.SpriteSheet
        .get(animation.images.baseImage.id);

    const hulls = spriteSheet.hulls.map(hull =>
        hull.map(convexHull => new SAT.Polygon(new SAT.Vector(),
            convexHull.slice().reverse().map(([x, y]) => new SAT.Vector(x, -y)))))
        .map(convexPolys => new CompositeHull(convexPolys));

    return new MultiFrameHull(hulls);
}

const HitboxHullProvider = ProvideAsync({
    name: "HitboxProvider",
    provided: HitboxHullComponent,
    args: [AnimationComponent, GameDataResource, CollisionVulnerabilityComponent] as const,
    factory: hullFromAnimation,
});

enum RBushEntryType {
    hurtbox,
    hitbox,
}

type RBushEntry = BBox & {
    uuid: string,
    hull: Hull,
} & ({
    type: RBushEntryType.hurtbox,
    hitter: CollisionHitter,
} | {
    type: RBushEntryType.hitbox,
    vulnerability: CollisionVulnerability,
});

export const RBushResource = new Resource<RBush<RBushEntry>>("RBushResource");

export function getBoundingBox(shapes: Shape[]): BBox {
    return shapes.map(
        p => (p as unknown as { getAABBAsBox(): SAT.Box }).getAABBAsBox())
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
    const points = [
        new Vector(bbox.minX, bbox.minY).rotate(angle),
        new Vector(bbox.minX, bbox.maxY).rotate(angle),
        new Vector(bbox.maxX, bbox.minY).rotate(angle),
        new Vector(bbox.maxX, bbox.maxY).rotate(angle),
    ];

    const x = points.map(v => v.x);
    const y = points.map(v => v.y);

    return {
        maxX: Math.max(...x),
        maxY: Math.max(...y),
        minX: Math.min(...x),
        minY: Math.min(...y),
    };
}

export const UpdateHitboxHullSystem = new System({
    name: "UpdateHitboxHullSystem",
    args: [MovementStateComponent, HitboxHullComponent, Optional(AnimationComponent)] as const,
    step(movement, hull, animation) {
        let angle = movement.rotation.angle;
        if (hull instanceof MultiFrameHull) {
            let frame = 0;
            if (animation) {
                ({ frame, angle } = getFrameFromMovement(animation, movement));
            }
            hull.frame = frame;
        }

        hull.pos.x = movement.position.x;
        hull.pos.y = movement.position.y;
        hull.angle = angle;
    },
    after: [MovementSystem],
});

export const UpdateHurtboxHullSystem = new System({
    name: "UpdateHurtboxHullSystem",
    args: [MovementStateComponent, HurtboxHullComponent, Optional(AnimationComponent)] as const,
    step: UpdateHitboxHullSystem.step,
    after: [MovementSystem],
});

export const CollisionSystem = new System({
    name: "CollisionSystem",
    after: [UpdateHitboxHullSystem],
    args: [RBushResource,
        new Query([HitboxHullComponent, UUID, CollisionVulnerabilityComponent] as const),
        new Query([HurtboxHullComponent, UUID, CollisionHitterComponent] as const),
        Emit, SingletonComponent] as const,
    step(rbush, hitboxColliders, hurtboxColliders, emit) {
        rbush.clear();

        function makeRbushEntry(type: RBushEntryType, [hull, uuid, interaction]:
            readonly [Hull, string, CollisionHitter | CollisionVulnerability]): RBushEntry {
            const entry = hull.bbox as RBushEntry;
            entry.uuid = uuid;
            if ('vulnerableTo' in interaction) {
                (entry as { vulnerability: CollisionVulnerability })
                    .vulnerability = interaction;
            } else {
                (entry as { hitter: CollisionHitter }).hitter = interaction;
            }
            entry.hull = hull;
            entry.type = type;
            return entry;
        }

        const entries = [
            ...hitboxColliders.map(data => makeRbushEntry(RBushEntryType.hitbox, data)),
            ...hurtboxColliders.map(data => makeRbushEntry(RBushEntryType.hurtbox, data)),
        ];

        rbush.load(entries);

        // Check for collisions
        const alreadyCollided = new Set<string>();

        for (const entry of entries) {
            const maybeCollisions = rbush.search(entry)
                .filter(found => found !== entry);

            for (const other of maybeCollisions) {
                if (entry.type === other.type) {
                    continue; // Hurtboxes can only hit hitboxes.
                }
                const collisionPair = [entry.uuid, other.uuid].sort().join();
                // The initiator of a collision must have its hurtbox overlap the other
                // collier's hitbox. If the inverse is allowed, then a missile's prox radius
                // overlapping a point defense weapon can be considered a collision initiated
                // by the point defense weapon, meaning the point defense weapon can hit the
                // missile by hitting its prox radius (bad).
                let entryInitiates: boolean;
                let hitter: CollisionHitter;
                let vulnerability: CollisionVulnerability;
                if (entry.type === RBushEntryType.hurtbox) {
                    entryInitiates = true;
                    hitter = entry.hitter;
                    vulnerability = (other as
                        { vulnerability: CollisionVulnerability }).vulnerability;
                } else {
                    entryInitiates = false;
                    vulnerability = entry.vulnerability;
                    hitter = (other as { hitter: CollisionHitter }).hitter;
                }
                const canCollide = aHitsB(hitter, vulnerability);
                if (canCollide &&
                    !alreadyCollided.has(collisionPair) &&
                    entry.hull.collides(other.hull)) {
                    alreadyCollided.add(collisionPair);
                    emit(CollisionEvent, {
                        other: other.uuid,
                        initiator: entryInitiates,
                    }, [entry.uuid]);
                    emit(CollisionEvent, {
                        other: entry.uuid,
                        initiator: !entryInitiates,
                    }, [other.uuid]);
                }
            }
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
