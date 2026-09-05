import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { wrapNearestDelta } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { BeamDataComponent, BeamStateComponent, BeamSystem } from "../nova_plugin/beam_plugin.js";
import { CollisionSystem } from "../nova_plugin/collisions_plugin.js";
import { CreateTime } from "../nova_plugin/create_time.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { CameraFocus, Space } from "./space_resource.js";
import { ZIndex } from "./z_index.js";


/**
 * The one Graphics every beam is drawn into. Exported for the spec,
 * which substitutes a recorder (PIXI.Graphics needs a DOM canvas).
 */
export const BeamGraphicsResource = new Resource<PIXI.Graphics>('BeamGraphics');

/**
 * The fraction of a beam's full length to draw at `elapsedMs` into its
 * life, per the wëap Decay rule for beams (EVN Bible ~:3437): "If Decay
 * is greater than zero, the beam will 'shrink' before it disappears
 * from the screen. The actual time the beam spends on screen will be
 * Count + 16 - CoronaFalloff".
 *
 * RULE (the Bible gives no curve): full length for the beam's Count
 * (`shotDurationMs`, its damage window), then a LINEAR shrink to
 * nothing over the tail that ends at `onScreenDurationMs` — the beam
 * is drawn vanishing rather than blinking out. Without a positive
 * decay, or with no tail (onScreen <= Count), the beam is full length
 * for its whole life, exactly as before. DISPLAY-ONLY: the sim's damage
 * window already closes at Count. Pure arithmetic on sim flight time
 * (see ProjectileFadeSystem for why the display's mirrored sim clock,
 * not its wall clock, is the time source), so every peer draws the same.
 */
export function beamShrinkFraction(decay: number, shotDurationMs: number,
    onScreenDurationMs: number, elapsedMs: number): number {
    const tailMs = onScreenDurationMs - shotDurationMs;
    if (!(decay > 0) || !(tailMs > 0)) {
        return 1;
    }
    const fraction = 1 - (elapsedMs - shotDurationMs) / tailMs;
    return Math.max(0, Math.min(1, fraction));
}

const ClearBeams = new System({
    name: 'ClearBeams',
    args: [BeamGraphicsResource, SingletonComponent] as const,
    step(beamGraphics) {
        beamGraphics.clear();
    }
});

function setLineStyle(graphics: PIXI.Graphics, width: number, color: number, alpha: number = 1) {
    if (color > 0xFFFFFF) {
        const alphaComponent = ((color >> 24) & 0xFF) / 255;
        color = color & 0xFFFFFF;
        alpha = alpha * alphaComponent;
    }
    graphics.lineStyle(width, color, alpha);
}

/**
 * Where a beam is drawn from: the toroidal copy of its origin nearest
 * the camera, exactly as ObjectDrawSystem places every sprite. The
 * world wraps at ±BOUNDARY, and a ship just across the seam is drawn on
 * the near side — its beam has to start there too, or it is rendered a
 * whole WORLD_SIZE away (invisible) while the ship, its shots and its
 * target corners sit right next to the player. Exported for the spec.
 *
 * A plain Vector, not a Position: the nearest copy lies OUTSIDE
 * [-BOUNDARY, BOUNDARY) by construction, and Position's constructor
 * would wrap it straight back to the far side. (Building the far end
 * with Position.add had the same problem for a beam crossing the seam.)
 */
export function beamOrigin(position: { x: number, y: number },
    cameraFocus: { x: number, y: number }): Vector {
    return new Vector(
        cameraFocus.x + wrapNearestDelta(position.x - cameraFocus.x),
        cameraFocus.y + wrapNearestDelta(position.y - cameraFocus.y));
}

/**
 * Exported for the spec; the plugin adds it. Reads only the synced beam
 * state plus this client's camera, so peers see the same beam.
 */
export const BeamDisplaySystem: System = new System({
    name: 'BeamDisplay',
    args: [BeamDataComponent, BeamStateComponent, MovementStateComponent,
        BeamGraphicsResource, CameraFocus, Optional(CreateTime),
        SimulationTimeResource] as const,
    step(beamData, beamState, movement, beamGraphics, cameraFocus, createTime,
        simTime) {
        const { width, beamColor, coronaColor, coronaFalloff, length: dataLength, lightningAmplitude, lightningDensity }
            = beamData.beamAnimation;
        // A decaying beam shrinks over its tail (beamShrinkFraction);
        // a beam with no CreateTime (never expected) draws full length.
        const shrink = createTime === undefined ? 1 : beamShrinkFraction(
            beamData.decay, beamData.shotDuration,
            beamData.onScreenDuration ?? beamData.shotDuration,
            simTime.time - createTime);
        const length = Math.min(dataLength * shrink,
            beamState.hitDist ?? Infinity);
        const origin = beamOrigin(movement.position, cameraFocus);
        const destination = movement.rotation.getUnitVector()
            .scale(length).add(origin);
        //const rng = seedrandom.alea(uuid);  //for if not randomized every frame
        const rng = Math.random;
        const lightningAmplitudeScale = 2;
        if (lightningDensity > 0) {
            beamGraphics.moveTo(origin.x, origin.y);
            setLineStyle(beamGraphics, width, beamColor);
            const direction = destination.subtract(origin);
            for (let i = 1; i <= lightningDensity; i++) {
                const center = origin.add(direction.scale(i / (lightningDensity + 2)));
                const offset = {
                    x: (rng() * 2 - 1) * lightningAmplitude * lightningAmplitudeScale,
                    y: (rng() * 2 - 1) * lightningAmplitude * lightningAmplitudeScale
                };
                const point = center.add(offset);
                beamGraphics.lineTo(point.x, point.y);
            }
            beamGraphics.lineTo(destination.x, destination.y);
        } else {

            // Corona width is 1 with no falloff
            // higher falloff is faster
            const coronaScale = 2 * 16;
            const coronaWidth = coronaScale / coronaFalloff;
            const coronaSteps = coronaWidth / 2;
            if (coronaFalloff >= 2) {
                for (let i = 0; i < coronaSteps; i++) {
                    setLineStyle(beamGraphics, width + 2 + i * coronaWidth / coronaSteps, coronaColor, 1 / coronaSteps);
                    beamGraphics.moveTo(origin.x, origin.y);
                    beamGraphics.lineTo(destination.x, destination.y);
                }
            } else {
                setLineStyle(beamGraphics, width + 2, coronaColor);
                beamGraphics.moveTo(origin.x, origin.y);
                beamGraphics.lineTo(destination.x, destination.y);
            }
            beamGraphics.moveTo(origin.x, origin.y);
            setLineStyle(beamGraphics, width, beamColor);
            beamGraphics.lineTo(destination.x, destination.y);
        }
    },
    after: [ClearBeams, BeamSystem, CollisionSystem],
    before: []
});


export const BeamDisplayPlugin: Plugin = {
    name: 'BeamDisplayPlugin',
    build(world) {
        const space = world.resources.get(Space);
        if (!space) {
            throw new Error('Expected space resource');
        }
        const beamGraphics = new PIXI.Graphics();
        beamGraphics.name = 'BeamGraphics';
        // Above every ship: a beam's origin is an exit point ON the
        // firing hull, so at the default zIndex of 0 the whole first
        // stretch of the beam was hidden under the ship that fired it
        // (very visible on the Fed Carrier's ion cannons).
        beamGraphics.zIndex = ZIndex.BEAM;
        world.resources.set(BeamGraphicsResource, beamGraphics);
        space.addChild(beamGraphics);
        // The mirrored sim clock the shrink reads; applySimulationFrame
        // overwrites it every frame (same arrangement as ProjectileFadePlugin).
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(ClearBeams);
        world.addSystem(BeamDisplaySystem);
    },
    remove(world) {
        const space = world.resources.get(Space);
        const beamGraphics = world.resources.get(BeamGraphicsResource);
        if (space && beamGraphics) {
            space.removeChild(beamGraphics);
        }
        world.removeSystem(BeamDisplaySystem);
        world.removeSystem(ClearBeams);
        world.resources.delete(BeamGraphicsResource);
    }
}
