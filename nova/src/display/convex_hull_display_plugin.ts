import { GetEntity } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Vector } from "nova_ecs/datatypes/vector";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { Provide } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import * as SAT from "sat";
import { HullComponent, UpdateHullSystem } from "../nova_plugin/collisions_plugin";
import { Space } from "./space_resource";


const ConvexHullGraphicsComponent = new Component<PIXI.Graphics>('ConvexHullGraphics');

const GraphicsProvider = Provide({
    name: "ConvexHullGraphicsProvider",
    provided: ConvexHullGraphicsComponent,
    args: [Space, HullComponent] as const,
    factory: (space) => {
        const graphics = new PIXI.Graphics();
        graphics.zIndex = 1000;
        space.addChild(graphics);
        return graphics;
    }
});

const HullGraphicsCleanup = new System({
    name: 'HullGraphicCleanup',
    events: [DeleteEvent],
    args: [ConvexHullGraphicsComponent, Space, GetEntity] as const,
    step: (graphics, space, entity) => {
        space.removeChild(graphics);
        entity.components.delete(ConvexHullGraphicsComponent);
    }
});

function drawPoly(poly: SAT.Polygon, graphics: PIXI.Graphics, color = 0xff0000, drawNormals = true) {
    graphics.lineStyle(0.5, color);
    const points = poly.points.map(v => Vector.fromVectorLike(v)
        .rotate(poly.angle).add(poly.pos));
    const { x: x0, y: y0 } = points[0];
    graphics.moveTo(x0, y0);
    for (const { x, y } of points) {
        graphics.lineTo(x, y);
    }
    graphics.lineTo(x0, y0);

    // Draw normals to the polygon edges pointing inwards toward the center
    if (drawNormals) {
        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i + 1];
            const middle = new Vector((start.x + end.x) / 2, (start.y + end.y) / 2);
            const normal = end.subtract(start).normalize().rotate(Math.PI / 2);
            const normalEnd = middle.add(normal.scale(10));
            graphics.moveTo(middle.x, middle.y);
            graphics.lineTo(normalEnd.x, normalEnd.y);
        }
    }
}

function drawCircle(circle: SAT.Circle, graphics: PIXI.Graphics, color = 0xff0000) {
    graphics.lineStyle(0.5, color);
    graphics.drawCircle(circle.pos.x, circle.pos.y, circle.r);
}

const COLORS = [
    0xff0000,
    0x00ff00,
    0x0000ff,
    0xffff00,
    0xff00ff,
    0x00ffff,
    0x88ff00,
    0xff8800,
    0x0088ff,
    0x00ff88,
];

const ConvexHullGraphicsSystem = new System({
    name: 'ConvexHullGraphics',
    args: [HullComponent, ConvexHullGraphicsComponent] as const,
    after: [UpdateHullSystem],
    step(hull, graphics) {
        graphics.clear();

        const activeHull = hull.activeHull;
        const bbox = hull.computedBbox;
        if (!activeHull || !bbox) {
            return;
        }

        for (let i = 0; i < activeHull.shapes.length; i++) {
            const shape = activeHull.shapes[i];
            const color = COLORS[i % COLORS.length]
            if (shape instanceof SAT.Polygon) {
                drawPoly(shape, graphics, color);
            } else {
                drawCircle(shape, graphics, color);
            }
        }

        // Draw bounding box
        graphics.lineStyle(0.5, 0x4488ff);
        graphics.drawRect(bbox.minX, bbox.minY,
            bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    }
});

export const ConvexHullDisplayPlugin: Plugin = {
    name: 'ConvexHullDisplayPlugin',
    build(world) {
        world.addComponent(ConvexHullGraphicsComponent);
        world.addSystem(GraphicsProvider);
        world.addSystem(ConvexHullGraphicsSystem);
        world.addSystem(HullGraphicsCleanup);
    },
    remove(world) {
        world.removeSystem(GraphicsProvider);
        world.removeSystem(ConvexHullGraphicsSystem);
        world.removeSystem(HullGraphicsCleanup);
        const space = world.resources.get(Space);
        for (const entity of world.entities.values()) {
            const graphics = entity.components.get(ConvexHullGraphicsComponent);
            if (graphics && space) {
                space.removeChild(graphics);
            }
            entity.components.delete(ConvexHullGraphicsComponent);
        }
    }
}
