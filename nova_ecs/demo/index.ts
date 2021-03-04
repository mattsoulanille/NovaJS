import { Query } from "nova_ecs/query";
import { Entities, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { EntityBuilder } from "nova_ecs/entity";
import { DeleteEvent, EcsEvent } from "nova_ecs/events";
import { Plugin } from "nova_ecs/plugin";
import { TimePlugin, TimeResource } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provider";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { v4 } from "uuid";


export const Stage = new Resource<PIXI.Container>({
    name: 'Stage',
    multiplayer: false,
});

const SquareGraphics = new Component<PIXI.Graphics>({
    name: 'SquareGraphics',
});

const SquareGraphicsCleanup = new System({
    name: 'SquareGraphicsCleanup',
    events: [DeleteEvent],
    args: [SquareGraphics, Stage] as const,
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
    args: [Stage, SquarePhysics] as const,
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
    max: number,
}>({ name: 'AddSquaresComponent' });

const AddSquares = new System({
    name: 'AddSquares',
    args: [AddSquaresComponent, Entities, TimeResource,
        new Query([SquarePhysics])] as const,
    step: (addSquares, entities, time, squares) => {
        if (squares.length >= addSquares.max) {
            return;
        }
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
                        life: 20_000
                    }).build());
            }
        }
    }
});

const TextComponent = new Component<PIXI.Text>({ name: 'Text' });

const CountSquares = new System({
    name: 'CountSquares',
    args: [TextComponent, new Query([SquareGraphics]),
        new Query([AddSquaresComponent])] as const,
    step: (text, query, addSquaresQuery) => {
        const addSquaresData = addSquaresQuery[0];
        if (!addSquaresData) {
            return;
        }
        const addSquares = addSquaresData[0];
        text.text = `Entities: ${query.length}, Max: ${addSquares.max}`;
        text.position.y = window.innerHeight;
    }
});

const ChangeMaxEvent = new EcsEvent<number>();

const ChangeMax = new System({
    name: 'ChangeMax',
    events: [ChangeMaxEvent],
    args: [ChangeMaxEvent, AddSquaresComponent] as const,
    step: (changeBy, addSquares) => {
        addSquares.max += changeBy;
    }
});

export const Demo: Plugin = {
    name: 'Demo',
    build: (world) => {
        const container = new PIXI.Container();
        world.resources.set(Stage, container);

        world.addPlugin(TimePlugin);
        world.addSystem(SquareSystem);
        world.addSystem(SquareGraphicsCleanup);
        world.addSystem(AddSquares);
        world.addSystem(CountSquares);
        world.addSystem(ChangeMax);
        world.entities.set('squareEmitter', new EntityBuilder()
            .addComponent(AddSquaresComponent, {
                count: 3,
                period: 0,
                lastTime: new Date().getTime(),
                radius: 160,
                speed: 4,
                max: 200
            }).build());


        const entityCountText = new PIXI.Text('asdfasdfasdf', new PIXI.TextStyle({
            fill: 0xffffff
        }));

        entityCountText.anchor.y = 1;

        container.addChild(entityCountText);
        world.entities.set('entityCount', new EntityBuilder()
            .addComponent(TextComponent, entityCountText)
            .build())

        document.addEventListener('keydown', (evt) => {
            if (evt.code === 'Equal') {
                world.emit(ChangeMaxEvent, 50);
            } else if (evt.code === 'Minus') {
                world.emit(ChangeMaxEvent, -50);
            }
        });

    }
}

