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


export class Hull {
    readonly bbox: BBox;
    constructor(readonly convexPolys: SAT.Polygon[]) {
        this.bbox = getBoundingBox(convexPolys);
    }
}

export const HullComponent = new Component<{
    hulls: Hull[],
    activeHull?: Hull,
    computedBbox?: BBox,
}>('HullComponent');

const HullProvider = ProvideAsync({
    name: "HullProvider",
    provided: HullComponent,
    args: [AnimationComponent, GameDataResource, CollisionInteractionComponent] as const,
    async factory(animation, gameData) {
        const spriteSheet = await gameData.data.SpriteSheet
            .get(animation.images.baseImage.id);

        const hulls = spriteSheet.hulls.map(hull =>
            hull.map(convexHull => new SAT.Polygon(new SAT.Vector(),
                convexHull.map(([x, y]) => new SAT.Vector(x, -y)))))
            .map(convexPolys => new Hull(convexPolys));

        return { hulls };
    }
});

interface RBushEntry extends BBox {
    uuid: string,
    interaction: CollisionInteraction,
    hull: Hull,
};

export const RBushResource = new Resource<RBush<RBushEntry>>("RBushResource");

export function getBoundingBox(polys: SAT.Polygon[]): BBox {
    return polys.map(
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

function convexPolysCollide(a: SAT.Polygon[], b: SAT.Polygon[]) {
    for (const polyA of a) {
        for (const polyB of b) {
            if (SAT.testPolygonPolygon(polyA, polyB)) {
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
    //const center = new Vector(bbox.maxX + bbox.minX,
    //bbox.maxY + bbox.minY).scale(0.5);

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

export const UpdateHullSystem = new System({
    name: "ActiveHullSystem",
    args: [MovementStateComponent, HullComponent, Optional(AnimationComponent)] as const,
    step(movement, hull, animation) {
        let frame = 0;
        let angle: number;
        if (animation) {
            ({ frame, angle } = getFrameFromMovement(animation, movement));
        } else {
            angle = movement.rotation.angle;
        }
        hull.activeHull = hull.hulls[frame];
        for (const convexPoly of hull.activeHull.convexPolys) {
            convexPoly.setAngle(angle);
            convexPoly.pos = new SAT.Vector(
                movement.position.x, movement.position.y);
        }
    },
    after: [MovementSystem]
});

export const CollisionSystem = new System({
    name: "CollisionSystem",
    after: [UpdateHullSystem],
    args: [RBushResource, new Query([HullComponent, MovementStateComponent,
        UUID, CollisionInteractionComponent] as const),
        Emit, SingletonComponent] as const,
    step(rbush, colliders, emit) {
        rbush.clear();

        const entries: RBushEntry[] =
            colliders.map(([hull, movement, uuid, interaction]) => {
                if (!hull.activeHull) {
                    hull.activeHull = hull.hulls[0];
                }
                const entry = translateAabb(rotateAabb(hull.activeHull.bbox,
                    hull.activeHull.convexPolys[0].angle), movement.position) as RBushEntry;
                entry.uuid = uuid;
                entry.interaction = interaction;
                entry.hull = hull.activeHull;

                hull.activeHull = hull.activeHull;
                hull.computedBbox = entry;
                return entry;
            });

        rbush.load(entries);

        // Check for collisions
        const alreadyCollided = new Set<string>();

        for (const entry of entries) {
            const maybeCollisions = rbush.search(entry)
                .filter(found => found !== entry);

            for (const other of maybeCollisions) {
                const collisionPair = [entry.uuid, other.uuid].sort().join();
                const entryInitiates = aHitsB(entry.interaction, other.interaction);
                const otherInitiates = aHitsB(other.interaction, entry.interaction);
                const canCollide = entryInitiates || otherInitiates;
                if (canCollide &&
                    !alreadyCollided.has(collisionPair) &&
                    convexPolysCollide(entry.hull.convexPolys,
                        other.hull.convexPolys)) {
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
        world.addComponent(HullComponent);
        world.resources.set(RBushResource, new RBush());

        world.addSystem(HullProvider);

        world.addSystem(UpdateHullSystem);
        world.addSystem(CollisionSystem);
        //world.addSystem(LogCollisionSystem);
    }
};
