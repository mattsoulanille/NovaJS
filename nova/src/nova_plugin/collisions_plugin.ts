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
import { CollisionEvent, CollisionInteraction, CollisionInteractionComponent } from "./collision_interaction";
import { GameDataResource } from "./game_data_resource";

type Shape = SAT.Polygon | SAT.Circle;
abstract class Hull {
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
        this.pos = this.wrappedPos; // Set pos on shapes
        this.bboxShape = getBoundingBox(shapes);
    }

    set pos(position: SAT.Vector) {
        for (const shape of this.shapes) {
            shape.pos = position;
        }
        this.wrappedPos = position;
    }

    get pos() {
        return this.wrappedPos;
    }

    set angle(angle: number) {
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
    private wrappedPos = new SAT.Vector(0, 0);
    private wrappedAngle = 0;
    constructor(private hulls: Hull[]) {
        super();
        this.pos = this.wrappedPos; // Set pos on shapes
        this.activeHull = hulls[0];
    }
    get shapes() {
        return this.activeHull.shapes;
    }

    set pos(position: SAT.Vector) {
        for (const hull of this.hulls) {
            hull.pos = position;
        }
        this.wrappedPos = position;
    }
    get pos() {
        return this.wrappedPos;
    }

    get angle() {
        return this.wrappedAngle;
    }
    set angle(angle: number) {
        for (const hull of this.hulls) {
            hull.angle = angle;
        }
    }
    set frame(frame: number) {
        const newHull = this.hulls[frame];
        if (!newHull) {
            console.warn(`Tried to set hull to ${frame} but only ${this.hulls.length} are available`);
            return;
        }
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
    args: [AnimationComponent, GameDataResource, CollisionInteractionComponent] as const,
    factory: hullFromAnimation,
});

interface RBushEntry extends BBox {
    uuid: string,
    interaction: CollisionInteraction,
    hull: Hull,
    type: 'hitbox' | 'hurtbox',
};

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

function aHitsB(a: CollisionInteraction, b: CollisionInteraction) {
    if (a.hitTypes && b.vulnerableTo) {
        for (const hitType of a.hitTypes) {
            if (b.vulnerableTo.has(hitType)) {
                return true;
            }
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
});

export const CollisionSystem = new System({
    name: "CollisionSystem",
    after: [UpdateHitboxHullSystem],
    args: [RBushResource,
        new Query([HitboxHullComponent, UUID, CollisionInteractionComponent] as const),
        new Query([HurtboxHullComponent, UUID, CollisionInteractionComponent] as const),
        Emit, SingletonComponent] as const,
    step(rbush, hitboxColliders, hurtboxColliders, emit) {
        rbush.clear();

        function makeRbushEntry(type: 'hitbox' | 'hurtbox', [hull, uuid, interaction]:
            readonly [Hull, string, CollisionInteraction]): RBushEntry {
            const entry = hull.bbox as RBushEntry;
            entry.uuid = uuid;
            entry.interaction = interaction;
            entry.hull = hull;
            entry.type = type;
            return entry;
        }

        const entries = [
            ...hitboxColliders.map(data => makeRbushEntry('hitbox', data)),
            ...hurtboxColliders.map(data => makeRbushEntry('hurtbox', data)),
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
                const entryInitiates = aHitsB(entry.interaction, other.interaction);
                const otherInitiates = aHitsB(other.interaction, entry.interaction);
                const canCollide = entryInitiates || otherInitiates;
                if (canCollide &&
                    !alreadyCollided.has(collisionPair) &&
                    entry.hull.collides(other.hull)) {
                    alreadyCollided.add(collisionPair);
                    emit(CollisionEvent, {
                        other: other.uuid,
                        initiator: entryInitiates
                    }, [entry.uuid]);
                    emit(CollisionEvent, {
                        other: entry.uuid,
                        initiator: otherInitiates
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
