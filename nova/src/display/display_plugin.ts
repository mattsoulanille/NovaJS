import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { Plugin } from "nova_ecs/plugin";
import * as PIXI from "pixi.js";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Component, ComponentData } from "nova_ecs/component";
import { EntityBuilder } from "nova_ecs/entity";
import { Provide } from "nova_ecs/provider";
import { v4 } from "uuid";
import { UUID } from "nova_ecs/arg_types";
import { Entities } from "nova_ecs/arg_types";
import { DeleteEvent } from "nova_ecs/events";


export const PixiContainer = new Resource<PIXI.Container>({
    name: 'PixiContainer',
    multiplayer: false,
    mutable: true,
});

const SquareGraphics = new Component<PIXI.Graphics>({
    name: 'SquareGraphics',
});

const SquareGraphicsCleanup = new System({
    name: 'SquareGraphicsCleanup',
    event: DeleteEvent,
    args: [SquareGraphics, PixiContainer] as const,
    step: (graphics, container) => {
        container.removeChild(graphics as PIXI.Graphics);
    }
});

const SquarePhysics = new Component<{
    color: number,
    position: { x: number, y: number },
    velocity: { x: number, y: number },
    rotationRate: number,
    life: number,
    createTime: number,
}>({ name: 'SquarePhysics' })

const SquareProvider = Provide({
    provided: SquareGraphics,
    args: [PixiContainer, SquarePhysics] as const,
    factory: (container, physics) => {
        const graphics = new PIXI.Graphics();
        graphics.beginFill(0xFFFFFF);
        if (Math.random() < 0.5) {
            graphics.drawRect(-3, -3, 6, 6);
        } else {
            graphics.drawCircle(0, 0, 3);
        }
        graphics.tint = physics.color;
        graphics.endFill();
        container.addChild(graphics);
        return graphics;
    }
});

const SquareSystem = new System({
    name: 'SquareSystem',
    args: [SquareProvider, TimeResource, SquarePhysics, UUID, Entities] as const,
    step: (graphics, time, physics, uuid, entities) => {
        graphics.rotation += time.delta_s * physics.rotationRate;

        if (physics.life + physics.createTime < time.time) {
            entities.delete(uuid);
            return;
        }

        //physics.velocity.x += physics.velocity.x * time.delta_s;
        //physics.velocity.y += physics.velocity.y * time.delta_s;

        physics.position.x += time.delta_s * physics.velocity.x;
        physics.position.y += time.delta_s * physics.velocity.y;

        graphics.position.x = physics.position.x;
        graphics.position.y = physics.position.y;

        if (graphics.position.x < 0 ||
            graphics.position.x > window.innerWidth ||
            graphics.position.y < 0 ||
            graphics.position.y > window.innerHeight) {
            entities.delete(uuid);
            return;
        }

        let cx = (graphics.position.x / window.innerWidth) * 4 - 2;
        let cy = (graphics.position.y / window.innerHeight) * 4 - 2;
        let i: number;
        let zx = cx;
        let zy = cy;
        for (i = 0; i < 64; i++) {
            if (zx * zx + zy * zy > 4) { break; }
            let tmp = zx * zx - zy * zy + cx;
            zy = 2 * zx * zy + cy;
            zx = tmp;
        }
        if (i === 64) {
            i = -18;
        } else {
            physics.velocity.x -= zx * time.delta_s * 8 * (i + 1);
            physics.velocity.y -= zy * time.delta_s * 8 * (i + 1);
        }

        let color = 0;
        const gamma = 0.6 / (1.1 + Math.sin(time.time / 2000));
        for (let j = 0; j < 3; j++) {
            color <<= 8;
            let c = (Math.sin(Math.sqrt([2, 3, 5][j]) * (3 + i / 6)) + 1) / 2;
            color |= (Math.pow(c, gamma) * 255) & 0xff;
        }
        graphics.tint = color;

    }
});

const AddSquaresComponent = new Component<{
    period: number,
    lastTime: number,
    count: number,
    speed: number,
    radius: number,
}>({ name: 'AddSquaresComponent' });

const AddSquares = new System({
    name: 'AddSquares',
    args: [AddSquaresComponent, Entities, TimeResource] as const,
    step: (addSquares, entities, time) => {
        if (addSquares.lastTime + addSquares.period < time.time) {
            addSquares.lastTime = time.time;
            // Get position of emitter
            const angle = (time.time / 1000) * addSquares.speed;
            const position = {
                x: Math.cos(angle) * addSquares.radius + window.innerWidth / 2,
                y: Math.sin(angle) * addSquares.radius + window.innerHeight / 2,
            }

            for (let i = 0; i < addSquares.count; i++) {
                let color = 0;
                const gamma = 0.6 / (1.1 + Math.sin(time.time / 2000));
                for (let j = 0; j < 3; j++) {
                    color <<= 8;
                    let c = (Math.sin(Math.sqrt(2 + j * 2) * (time.time / 400)) + 1) / 2;
                    color |= (Math.pow(c, gamma) * 255) & 0xff;
                }

                entities.set(v4(), new EntityBuilder()
                    .addComponent(SquarePhysics, {
                        color,
                        position,
                        rotationRate: (Math.random() - 0.5) * 3,
                        velocity: {
                            x: (Math.random() - 0.5) * 60,
                            y: (Math.random() - 0.5) * 60,
                        },
                        createTime: time.time,
                        life: 30_000
                    }).build());
            }
        }
    }
});

export const Display: Plugin = {
    name: 'Display',
    build: (world) => {
        const container = new PIXI.Container();
        world.resources.set(PixiContainer, container);

        world.addSystem(SquareSystem);
        world.addSystem(SquareGraphicsCleanup);
        world.addSystem(AddSquares);
        world.entities.set('squareEmitter', new EntityBuilder()
            .addComponent(AddSquaresComponent, {
                count: 3,
                period: 10,
                lastTime: new Date().getTime(),
                radius: 160,
                speed: 4,
            }).build());
    }
}

