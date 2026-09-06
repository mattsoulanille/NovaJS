import { PlanetData } from "novadatainterface/planet_data";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TumbleAnimationComponent } from "../core/index.js";
import { PlanetComponent } from "./planet_plugin.js";

/** Frames/s for a wormhole swirl when the spöb AnimDelay is unset (0). */
const DEFAULT_WORMHOLE_FRAME_RATE = 15;

export function makePlanet(planetData: PlanetData): Entity {
    const planet = new Entity(planetData.name);

    planet.components.set(PlanetComponent, {
        id: planetData.id,
    });

    planet.components.set(MovementStateComponent, {
        accelerating: 0,
        position: new Position(planetData.position[0],
            planetData.position[1]),
        rotation: new Angle(0),
        turnBack: false,
        turning: 0,
        velocity: new Vector(0, 0),
    });

    // Wormholes render as a continuously-swirling sprite (rlëD 2300, 32
    // frames), NOT the angle-interpolated ship path. Reuse the asteroid
    // tumble mode: the display's TumbleDrawSystem advances the frames on
    // logical time and ignores the (zero) sim rotation. Deterministic genesis
    // state — fixed frame rate and phase, no Random — so every peer agrees.
    // Hypergates are excluded here: their open/close/flicker sequence is
    // driven separately by GateAnimationSystem.
    if (planetData.gate?.kind === "wormhole") {
        const frameRate = planetData.animationDelay > 0
            ? 30 / planetData.animationDelay
            : DEFAULT_WORMHOLE_FRAME_RATE;
        planet.components.set(TumbleAnimationComponent, { frameRate, phase: 0 });
    }

    return planet;
}
