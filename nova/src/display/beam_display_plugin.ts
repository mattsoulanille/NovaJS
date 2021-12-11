import { Graphics } from '@pixi/graphics';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from "nova_ecs/world";
import { BeamDataComponent, BeamSystem } from "../nova_plugin/beam_plugin";
import { Space } from "./space_resource";

const BeamGraphicsResource = new Resource<Graphics>('BeamGraphics');

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
        BeamGraphicsResource] as const,
    step(beamData, movement, beamGraphics) {
        const { width, beamColor, coronaColor, coronaFalloff, length }
            = beamData.beamAnimation;

        const destination = movement.rotation.getUnitVector()
            .scale(length).add(movement.position);

        // Corona width is 1 with no falloff
        // TODO: Corona falloff
        beamGraphics.lineStyle(width + 2, coronaColor);
        beamGraphics.moveTo(movement.position.x, movement.position.y);
        beamGraphics.lineTo(destination.x, destination.y);

        beamGraphics.moveTo(movement.position.x, movement.position.y);
        beamGraphics.lineStyle(width, beamColor);
        beamGraphics.lineTo(destination.x, destination.y);
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
        const beamGraphics = new Graphics();
        //beamGraphics.name = 'BeamGraphics';
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
