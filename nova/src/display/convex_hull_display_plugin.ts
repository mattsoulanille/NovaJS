import { GetEntity } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Vector } from "nova_ecs/datatypes/vector";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { Provide } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import * as SAT from "sat";
import { HitboxHullComponent, HurtboxHullComponent, UpdateHitboxHullSystem, UpdateHurtboxHullSystem } from "../nova_plugin/collisions_plugin";
import { Space } from "./space_resource";


const HitboxHullGraphicsComponent = new Component<PIXI.Graphics>('HitboxHullGraphics');
const HurtboxHullGraphicsComponent = new Component<PIXI.Graphics>('HurtboxHullGraphics');

const HitboxGraphicsProvider = Provide({
    name: "HitboxHullGraphicsProvider",
    provided: HitboxHullGraphicsComponent,
    args: [Space, HitboxHullComponent] as const,
    factory: (space) => {
        const graphics = new PIXI.Graphics();
        graphics.zIndex = 1000;
        space.addChild(graphics);
        return graphics;
    }
});

const HitboxGraphicsCleanup = new System({
    name: 'HitboxHullGraphicCleanup',
    events: [DeleteEvent],
    args: [HitboxHullGraphicsComponent, Space, GetEntity] as const,
    step: (graphics, space, entity) => {
        space.removeChild(graphics);
        entity.components.delete(HitboxHullGraphicsComponent);
    }
});

const HurtboxGraphicsProvider = Provide({
    name: "HurtboxHullGraphicsProvider",
    provided: HurtboxHullGraphicsComponent,
    args: [Space, HurtboxHullComponent] as const,
    factory: (space) => {
        const graphics = new PIXI.Graphics();
        graphics.zIndex = 1000;
        space.addChild(graphics);
        return graphics;
    }
});

const HurtboxGraphicsCleanup = new System({
    name: 'HurtboxHullGraphicCleanup',
    events: [DeleteEvent],
    args: [HurtboxHullGraphicsComponent, Space, GetEntity] as const,
    step: (graphics, space, entity) => {
        space.removeChild(graphics);
        entity.components.delete(HurtboxHullGraphicsComponent);
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

const HitboxHullGraphicsSystem = new System({
    name: 'HitboxHullGraphics',
    args: [HitboxHullComponent, HitboxHullGraphicsComponent] as const,
    after: [UpdateHitboxHullSystem],
    step(hull, graphics) {
        graphics.clear();
        for (let i = 0; i < hull.shapes.length; i++) {
            const shape = hull.shapes[i];
            const color = COLORS[i % COLORS.length]
            if (shape instanceof SAT.Polygon) {
                drawPoly(shape, graphics, color);
            } else {
                drawCircle(shape, graphics, color);
            }
        }

        // Draw bounding box
        const bbox = hull.bbox;
        graphics.lineStyle(0.5, 0x4488ff);
        graphics.drawRect(bbox.minX, bbox.minY,
            bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    }
});

const HurtboxHullGraphicsSystem = new System({
    name: 'HurtboxHullGraphics',
    args: [HurtboxHullComponent, HurtboxHullGraphicsComponent] as const,
    after: [UpdateHurtboxHullSystem],
    step: HitboxHullGraphicsSystem.step,
});

export const ConvexHullDisplayPlugin: Plugin = {
    name: 'ConvexHullDisplayPlugin',
    build(world) {
        world.addComponent(HitboxHullGraphicsComponent);
        world.addSystem(HitboxGraphicsProvider);
        world.addSystem(HurtboxGraphicsProvider);
        world.addSystem(HitboxHullGraphicsSystem);
        world.addSystem(HurtboxHullGraphicsSystem);
        world.addSystem(HitboxGraphicsCleanup);
        world.addSystem(HurtboxGraphicsCleanup);
    },
    remove(world) {
        world.removeSystem(HitboxGraphicsProvider);
        world.removeSystem(HurtboxGraphicsProvider);
        world.removeSystem(HitboxHullGraphicsSystem);
        world.removeSystem(HurtboxHullGraphicsSystem);
        world.removeSystem(HitboxGraphicsCleanup);
        world.removeSystem(HurtboxGraphicsCleanup);
        const space = world.resources.get(Space);
        for (const entity of world.entities.values()) {
            const graphics = entity.components.get(HitboxHullGraphicsComponent);
            if (graphics && space) {
                space.removeChild(graphics);
            }
            entity.components.delete(HitboxHullGraphicsComponent);
        }
    }
}
