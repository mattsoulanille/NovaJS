import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import { BeamDataComponent, BeamSystem } from "../nova_plugin/beam_plugin";
import { Space } from "./space_resource";


const BeamGraphicsResource = new Resource<PIXI.Graphics>('BeamGraphics');

const ClearBeams = new System({
    name: 'ClearBeams',
    args: [BeamGraphicsResource, SingletonComponent] as const,
    step(beamGraphics) {
        beamGraphics.clear();
    }
});

const BeamDisplaySystem = new System({
    name: 'BeamDisplay',
    args: [BeamDataComponent, MovementStateComponent,
        BeamGraphicsResource, /*UUID*/] as const,
    step(beamData, movement, beamGraphics, /*uuid*/) {
        const { width, beamColor, coronaColor, coronaFalloff, length, lightningAmplitude, lightningDensity }
            = beamData.beamAnimation;
        const destination = movement.rotation.getUnitVector()
            .scale(length).add(movement.position);
        //const rng = seedrandom.alea(uuid);  //for if not randomized every frame
        const rng = Math.random;
        const lightningAmplitudeScale = 2;
        if (lightningDensity > 0) {
            beamGraphics.moveTo(movement.position.x, movement.position.y);
            beamGraphics.lineStyle(width, beamColor);
            const direction = destination.subtract(movement.position);
            for (let i = 1; i <= lightningDensity; i++) {
                const center = movement.position.add(direction.scale(i / (lightningDensity + 2)));
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
                    beamGraphics.lineStyle(width + 2 + i * coronaWidth / coronaSteps, coronaColor, 1 / coronaSteps);
                    beamGraphics.moveTo(movement.position.x, movement.position.y);
                    beamGraphics.lineTo(destination.x, destination.y);
                }
            } else {
                beamGraphics.lineStyle(width + 2, coronaColor);
                beamGraphics.moveTo(movement.position.x, movement.position.y);
                beamGraphics.lineTo(destination.x, destination.y);
            }
            beamGraphics.moveTo(movement.position.x, movement.position.y);
            beamGraphics.lineStyle(width, beamColor);
            beamGraphics.lineTo(destination.x, destination.y);
        }
    },
    after: [ClearBeams, BeamSystem],
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
        world.resources.set(BeamGraphicsResource, beamGraphics);
        space.addChild(beamGraphics);
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
