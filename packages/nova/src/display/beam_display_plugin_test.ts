import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { BOUNDARY, Position, WORLD_SIZE } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { BeamWeaponData } from 'novadatainterface/weapon_data';
import { BeamDataComponent, BeamStateComponent } from '../nova_plugin/beam_plugin.js';
import {
    BeamDisplaySystem, BeamGraphicsResource, beamOrigin,
} from './beam_display_plugin.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';
import { CameraFocus } from './space_resource.js';

/**
 * Beams are drawn at the toroidal copy of their origin nearest the
 * camera, the way ObjectDrawSystem places every sprite. The world wraps
 * at ±BOUNDARY; a ship just across the seam (the Sol wormhole side is
 * the documented case) is drawn beside the player, and its beam used to
 * be drawn at the ship's LITERAL position, a whole WORLD_SIZE away.
 *
 * Headless: PIXI.Graphics needs a canvas, so the beam graphics resource
 * is a recorder of the moveTo/lineTo calls the system makes.
 */

const LENGTH = 200;

function beamData(): BeamWeaponData {
    return {
        beamAnimation: {
            length: LENGTH, width: 2, beamColor: 0xff0000,
            coronaColor: 0xff0000, coronaFalloff: 0,
            lightningDensity: 0, lightningAmplitude: 0,
        },
    } as unknown as BeamWeaponData;
}

function beamWorld(camera: { x: number, y: number },
    beamAt: { x: number, y: number }) {
    const world = new World('beam display test');
    const moveTo: [number, number][] = [];
    const lineTo: [number, number][] = [];
    const recorder = {
        clear() { },
        lineStyle() { },
        moveTo(x: number, y: number) { moveTo.push([x, y]); },
        lineTo(x: number, y: number) { lineTo.push([x, y]); },
    } as unknown as PIXI.Graphics;
    world.resources.set(BeamGraphicsResource, recorder);
    world.resources.set(CameraFocus, camera);
    // The shrink's clock (BeamDisplaySystem reads it even for a beam
    // with no CreateTime, which draws full length).
    world.resources.set(SimulationTimeResource, defaultSimulationTime());
    world.addSystem(BeamDisplaySystem);

    const rotation = new Angle(0);
    const beam = new Entity('beam')
        .addComponent(BeamDataComponent, beamData())
        .addComponent(BeamStateComponent, {} as never)
        .addComponent(MovementStateComponent, {
            position: new Position(beamAt.x, beamAt.y),
            velocity: new Vector(0, 0),
            rotation,
            accelerating: 0, turning: 0, turnBack: false,
        } as never);
    world.entities.set('beam', beam);
    world.step();
    const heading = rotation.getUnitVector().scale(LENGTH);
    return { moveTo, lineTo, heading };
}

describe('beamOrigin', () => {
    it('is the literal position when no wrap is nearer', () => {
        expect(beamOrigin({ x: 100, y: 50 }, { x: 0, y: 0 }))
            .toEqual(new Vector(100, 50));
    });

    it('is the copy across the seam when that is nearer the camera', () => {
        // Camera 100 short of +BOUNDARY, beam 100 past -BOUNDARY: they are
        // 200 px apart through the seam, WORLD_SIZE - 200 the long way.
        const origin = beamOrigin(
            { x: -BOUNDARY + 100, y: 0 }, { x: BOUNDARY - 100, y: 0 });
        expect(origin.x).toEqual(BOUNDARY + 100);
        expect(origin.y).toEqual(0);
        expect(origin.x - (-BOUNDARY + 100)).toEqual(WORLD_SIZE);
    });
});

describe('BeamDisplaySystem', () => {
    it('draws a beam beside the camera at its literal position', () => {
        const { moveTo, lineTo, heading } =
            beamWorld({ x: 0, y: 0 }, { x: 100, y: 50 });
        expect(moveTo).toContain([100, 50]);
        expect(lineTo).toContain([100 + heading.x, 50 + heading.y]);
    });

    it('draws a beam from across the loop seam on the near side', () => {
        // THE BUG: moveTo was called with the literal -9900.
        const { moveTo, lineTo, heading } = beamWorld(
            { x: BOUNDARY - 100, y: 0 }, { x: -BOUNDARY + 100, y: 0 });
        const originX = BOUNDARY + 100;
        expect(moveTo).toContain([originX, 0]);
        expect(moveTo).not.toContain([-BOUNDARY + 100, 0]);
        // The far end is offset from the WRAPPED origin, so the whole
        // beam sits next to the player.
        expect(lineTo).toContain([originX + heading.x, heading.y]);
    });
});
