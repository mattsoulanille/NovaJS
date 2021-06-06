import { Emit, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { FirstAvailable } from "nova_ecs/first_available";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Provide, ProvideAsync } from "nova_ecs/provider";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import RBush, { BBox } from "rbush";
import * as SAT from "sat";
import { getFrameFromMovement } from "../util/get_frame_and_angle";
import { FirstAnimation } from "./animation_plugin";
import { CollisionEvent, CollisionInteraction, CollisionInteractionComponent } from "./collision_interaction";
import { GameDataResource } from "./game_data_resource";
import { ShipComponent } from "./ship_plugin";


type Hull = {
    convexPolys: SAT.Polygon[],
    bbox: BBox, // Axis-aligned bounding box
};
export const HullComponent = new Component<{
    hulls: Hull[],
    activeHull?: Hull,
    computedBbox?: BBox,
}>('HullComponent');

export const HullProvider = ProvideAsync({
    provided: HullComponent,
    args: [FirstAnimation, GameDataResource] as const,
    async factory(animation, gameData) {
        const spriteSheet = await gameData.data.SpriteSheet
            .get(animation.images.baseImage.id);

        const hulls = spriteSheet.hulls.map(hull =>
            hull.map(convexHull => new SAT.Polygon(new SAT.Vector(),
                convexHull.map(([x, y]) => new SAT.Vector(x, -y)))))
            .map(convexPolys => ({
                convexPolys,
                bbox: getBoundingBox(convexPolys),
            }));

        return { hulls };
    }
});

interface RBushEntry extends BBox {
    uuid: string,
    interaction: CollisionInteraction,
    hull: Hull,
};

export const RBushResource = new Resource<RBush<RBushEntry>>("RBushResource");

function getBoundingBox(polys: SAT.Polygon[]): BBox {
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

function canCollide(a: CollisionInteraction, b: CollisionInteraction) {
    return aHitsB(a, b) || aHitsB(b, a);
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

// TODO: This might not be the best way of setting this.
const ShipCollisionInteraction = Provide({
    provided: CollisionInteractionComponent,
    args: [ShipComponent] as const,
    factory: () => ({
        vulnerableTo: new Set(['normal']),
    }),
});

const CollisionInteractionFirst = FirstAvailable([
    CollisionInteractionComponent,
    ShipCollisionInteraction,
]);

export function translateAabb(bbox: BBox, { x, y }: { x: number, y: number }): BBox {
    return {
        minX: bbox.minX + x,
        minY: bbox.minY + y,
        maxX: bbox.maxX + x,
        maxY: bbox.maxY + y,
    };
}

export function rotateAabb(bbox: BBox, angle: Angle): BBox {
    const center = new Vector(bbox.maxX + bbox.minX,
        bbox.maxY + bbox.minY).scale(0.5);

    const a = new Vector(bbox.minX, bbox.minY).subtract(center).rotate(angle);
    const b = new Vector(bbox.minX, bbox.maxY).subtract(center).rotate(angle);

    const maxX = Math.max(Math.abs(a.x), Math.abs(b.x));
    const maxY = Math.max(Math.abs(a.y), Math.abs(b.y));

    return {
        maxX: center.x + maxX,
        maxY: center.y + maxY,
        minX: center.x - maxX,
        minY: center.y - maxY,
    };
}

const CollisionSystem = new System({
    name: "CollisionSystem",
    args: [RBushResource, new Query([HullProvider, MovementStateComponent,
        FirstAnimation, UUID, CollisionInteractionFirst] as const),
        Emit, SingletonComponent] as const,
    step(rbush, colliders, emit) {
        rbush.clear();

        const entries: RBushEntry[] =
            colliders.map(([hull, movement, animation, uuid, interaction]) => {
                const { frame, angle } = getFrameFromMovement(animation, movement);
                const activeHull = hull.hulls[frame];
                for (const convexPoly of activeHull.convexPolys) {
                    convexPoly.setAngle(angle);
                    convexPoly.pos = new SAT.Vector(
                        movement.position.x, movement.position.y);
                }

                const entry = rotateAabb(translateAabb(activeHull.bbox,
                    movement.position), movement.rotation) as RBushEntry;
                entry.uuid = uuid;
                entry.interaction = interaction;
                entry.hull = activeHull;

                hull.activeHull = activeHull;
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
                if (canCollide(entry.interaction, other.interaction) &&
                    !alreadyCollided.has(collisionPair) &&
                    convexPolysCollide(entry.hull.convexPolys,
                        other.hull.convexPolys)) {
                    alreadyCollided.add(collisionPair);
                    emit(CollisionEvent, { other: other.uuid }, [entry.uuid]);
                    emit(CollisionEvent, { other: entry.uuid }, [other.uuid]);
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
        world.addSystem(CollisionSystem);
        //world.addSystem(LogCollisionSystem);
    }
};
