import { Component } from "nova_ecs/component";
import { DeleteEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Provide } from "nova_ecs/provider";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { FirstAnimation } from "../nova_plugin/animation_plugin";
import { HullProvider } from "../nova_plugin/collisions_plugin";
import { getFrameFromMovement } from "../util/get_frame_and_angle";
import { Space } from "./space_resource";
import * as SAT from "sat";


const ConvexHullGraphicsComponent = new Component<PIXI.Graphics>('ConvexHullGraphics');

const GraphicsProvider = Provide({
    provided: ConvexHullGraphicsComponent,
    args: [Space] as const,
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
    args: [ConvexHullGraphicsComponent, Space] as const,
    step: (graphic, space) => {
        space.removeChild(graphic);
    }
});

function drawPoly(poly: SAT.Polygon, graphics: PIXI.Graphics, color = 0xff0000) {
    graphics.lineStyle(0.5, color);
    const { x: x0, y: y0 } = poly.points[0];
    graphics.moveTo(x0, y0);
    for (const { x, y } of poly.points) {
        graphics.lineTo(x, y);
    }
    graphics.lineTo(x0, y0);
}

const COLORS = [
    0xff0000,
    0x00ff00,
    0x0000ff,
    0xffff00,
    0xff00ff,
    0x00ff00,
    0x88ff00,
    0xff8800,
    0x0088ff,
    0x00ff88,
];

const ConvexHullGraphicsSystem = new System({
    name: 'ConvexHullGraphics',
    args: [HullProvider, FirstAnimation, MovementStateComponent, GraphicsProvider] as const,
    step(hull, animation, movement, graphics) {
        const { frame, angle } = getFrameFromMovement(animation, movement);

        const activeHull = hull.hulls[frame];
        graphics.rotation = angle;
        graphics.position.x = movement.position.x;
        graphics.position.y = movement.position.y;

        graphics.clear();
        for (let i = 0; i < activeHull.length; i++) {
            const convexHull = activeHull[i];
            const color = COLORS[i % COLORS.length]
            drawPoly(convexHull, graphics, color);
        }
    }
});

export const ConvexHullDisplayPlugin: Plugin = {
    name: 'ConvexHullDisplayPlugin',
    build(world) {
        world.addComponent(ConvexHullGraphicsComponent);
        world.addSystem(ConvexHullGraphicsSystem);
        world.addSystem(HullGraphicsCleanup);
    },
    remove(world) {
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
