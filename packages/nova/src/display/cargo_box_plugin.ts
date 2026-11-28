import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entities, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { Plugin } from 'nova_ecs/plugin';
import { System } from 'nova_ecs/system';
import { Animation, getDefaultExitPoints } from 'novadatainterface/animation';
import { BLEND_MODES } from 'novadatainterface/blend_modes';
import { NovaDataType } from 'novadatainterface/nova_data_interface';
import { v4 } from 'uuid';
import {
    AnimationComponent, TumbleAnimationComponent,
} from '../nova_plugin/core/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { CargoJettisonedEvent } from '../nova_plugin/ship/index.js';
import { CARGO_JETTISONED } from '../spaceport/player_info.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import { MISSION_FAILED_MESSAGE } from './mission_ship_done_plugin.js';
import { StatusLineResource } from './status_line_resource.js';

/**
 * ============================================================================
 * The in-flight jettison's cargo box and status line
 * ============================================================================
 *
 * MEASURED (reference "Jettison cargo, wave 55", runs 3, 4, 6 and 7): ONE
 * box, the stock spïn 500 "Boxes" (rlëD 500, 8x8, 36 tumbling frames),
 * appears 15-20 px from the ship the moment OK is pressed, whatever the
 * load (3 t or 8 t), and drifts away at 10-20 px/s RELATIVE to the ship in
 * a different direction each time (it keeps the ship's own velocity: a
 * ship coasting at 88 px/s left it trailing at 18 px/s). It fades out
 * about 6 s later (run 7: full until 5.8 s, gone by 6.9 s; run 6 still
 * showed one 8 s on, so the life varies). A ship with an Asteroid Scoop
 * did not take its own box beside it.
 *
 * So the box is a DISPLAY effect of the sim's CargoJettisonedEvent, never
 * simulation state: nothing can pick it up, and every client that mirrors
 * the jettisoning ship draws its own (the drift direction is the display's
 * own draw, as the original's differed run to run). The status line,
 * "Cargo jettisoned." or "Mission failed." when a mission failed, is the
 * owner's alone.
 */

/** The stock cargo box sprite: spïn 500 "Boxes" -> rlëD 500. */
export const CARGO_BOX_SPRITE = 'nova:500';
const CARGO_BOX_FRAMES = 36;
/** Where the box appears: this far from the ship's centre (px). */
export const CARGO_BOX_SPAWN_OFFSET = 16;
/** Its drift relative to the ship (px/s). */
export const CARGO_BOX_DRIFT = 15;
/** How long it shows at full strength, then how long it fades (ms). */
export const CARGO_BOX_LIFE_MS = 6000;
export const CARGO_BOX_FADE_MS = 1000;
const CARGO_BOX_TUMBLE_FRAME_RATE = 15;

/** The box's sprite, as an Animation the display draws like any other. */
export const CARGO_BOX_ANIMATION: Animation = {
    id: 'nova:500 cargo box',
    name: 'Boxes',
    prefix: 'nova',
    writerPrefix: 'nova',
    images: {
        baseImage: {
            id: CARGO_BOX_SPRITE,
            dataType: NovaDataType.SpriteSheetImage,
            blendMode: BLEND_MODES.NORMAL,
            frames: { normal: { start: 0, length: CARGO_BOX_FRAMES } },
        },
    },
    exitPoints: getDefaultExitPoints(),
    blink: null,
    animationMode: null,
    weapDecay: 0,
};

/** A drifting box's own clock (display wall clock, ms). */
interface CargoBox {
    born: number;
    velocity: Vector;
}
const CargoBoxComponent = new Component<CargoBox>('CargoBox');

/**
 * The box for a ship at `ship`, kicked off in direction `angle`: its
 * entity, to add to the display world. Pure but for the clock and angle
 * it is handed.
 */
export function makeCargoBox(ship: { position: Position, velocity: Vector },
    angle: number, now: number): Entity {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const velocity = new Vector(ship.velocity.x + dx * CARGO_BOX_DRIFT,
        ship.velocity.y + dy * CARGO_BOX_DRIFT);
    return new Entity('cargo box')
        .addComponent(CargoBoxComponent, { born: now, velocity })
        .addComponent(AnimationComponent, CARGO_BOX_ANIMATION)
        .addComponent(TumbleAnimationComponent, {
            frameRate: CARGO_BOX_TUMBLE_FRAME_RATE, phase: Math.random(),
        })
        .addComponent(MovementStateComponent, {
            position: new Position(
                ship.position.x + dx * CARGO_BOX_SPAWN_OFFSET,
                ship.position.y + dy * CARGO_BOX_SPAWN_OFFSET),
            velocity,
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
}

/** The box's opacity `age` ms after it appeared: 1, then a linear fade;
 * undefined once it is gone. */
export function cargoBoxAlpha(age: number): number | undefined {
    if (age >= CARGO_BOX_LIFE_MS + CARGO_BOX_FADE_MS) {
        return undefined;
    }
    return Math.min(1, (CARGO_BOX_LIFE_MS + CARGO_BOX_FADE_MS - age)
        / CARGO_BOX_FADE_MS);
}

/** Puts out a box beside the jettisoning ship (every client). */
const CargoBoxSpawnSystem = new System({
    name: 'CargoBoxSpawnSystem',
    events: [CargoJettisonedEvent],
    args: [CargoJettisonedEvent, MovementStateComponent, Entities,
        TimeResource] as const,
    step(_jettisoned, movement, entities, time) {
        entities.set(v4(), makeCargoBox(movement,
            Math.random() * 2 * Math.PI, time.time));
    },
});

/** Drifts, fades and removes the boxes (display clock). */
const CargoBoxDriftSystem = new System({
    name: 'CargoBoxDriftSystem',
    args: [CargoBoxComponent, MovementStateComponent, TimeResource,
        Entities, UUID] as const,
    step(box, movement, time, entities, uuid) {
        const alpha = cargoBoxAlpha(time.time - box.born);
        if (alpha === undefined) {
            entities.delete(uuid);
            return;
        }
        const seconds = time.delta_s;
        movement.position = new Position(
            movement.position.x + box.velocity.x * seconds,
            movement.position.y + box.velocity.y * seconds);
        const graphic = entities.get(uuid)?.components
            .get(AnimationGraphicComponent);
        for (const sprite of graphic?.sprites.values() ?? []) {
            sprite.pixiSprite.alpha = alpha;
        }
    },
});

/** "Cargo jettisoned." / "Mission failed." on the owner's status line. */
const CargoJettisonedMessageSystem = new System({
    name: 'CargoJettisonedMessageSystem',
    events: [CargoJettisonedEvent],
    args: [CargoJettisonedEvent, StatusLineResource, TimeResource,
        PlayerShipSelector] as const,
    step({ missionFailed }, statusLine, { time }) {
        statusLine.setMessage(missionFailed
            ? MISSION_FAILED_MESSAGE : CARGO_JETTISONED, time);
    },
});

export const CargoBoxPlugin: Plugin = {
    name: 'CargoBoxPlugin',
    build(world) {
        world.addSystem(CargoBoxSpawnSystem);
        world.addSystem(CargoBoxDriftSystem);
        world.addSystem(CargoJettisonedMessageSystem);
    },
    remove(world) {
        world.removeSystem(CargoBoxSpawnSystem);
        world.removeSystem(CargoBoxDriftSystem);
        world.removeSystem(CargoJettisonedMessageSystem);
    },
};
