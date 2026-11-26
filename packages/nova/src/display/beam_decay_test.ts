import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { BeamWeaponData } from 'novadatainterface/weapon_data';
import { BeamDataComponent, BeamStateComponent } from '../nova_plugin/combat/index.js';
import { CreateTime } from '../nova_plugin/core/index.js';
import {
    beamCoronaFraction, BeamDisplaySystem, BeamGraphicsResource,
} from './beam_display_plugin.js';
import { SimulationTimeResource } from './simulation_time.js';
import { CameraFocus } from './space_resource.js';

const FRAME = 1000 / 30;

/**
 * wëap Decay for beams: over the Count + 16 - CoronaFalloff tail the beam
 * keeps its full LENGTH and only its corona thins (reference "Beam decay
 * and projectile fade (E10), wave 40": a Count-30 Decay beam stayed 300 px
 * long to its last frame, its pixel count down 20%).
 */
describe('beamCoronaFraction', () => {
    // Pulse Laser: Count 15 (damage window), 31 frames on screen.
    const COUNT = 15 * FRAME;
    const ON_SCREEN = 31 * FRAME;

    it('is the full corona for the whole Count', () => {
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, 0)).toEqual(1);
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, COUNT - 1)).toEqual(1);
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, COUNT)).toEqual(1);
    });

    it('thins linearly to nothing over the tail', () => {
        const tail = ON_SCREEN - COUNT;
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, COUNT + tail / 4))
            .toBeCloseTo(0.75, 9);
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, COUNT + tail / 2))
            .toBeCloseTo(0.5, 9);
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, ON_SCREEN)).toEqual(0);
        expect(beamCoronaFraction(100, COUNT, ON_SCREEN, ON_SCREEN + 5)).toEqual(0);
    });

    it('never thins a beam without Decay', () => {
        expect(beamCoronaFraction(0, COUNT, COUNT, COUNT * 2)).toEqual(1);
        // A missing decay (older data) reads as none.
        expect(beamCoronaFraction(undefined as unknown as number, COUNT, ON_SCREEN, ON_SCREEN))
            .toEqual(1);
    });

    it('never thins a beam with no tail', () => {
        // Mining Laser: falloff past 16 leaves onScreen == Count.
        expect(beamCoronaFraction(20, COUNT, COUNT, COUNT)).toEqual(1);
    });
});

describe('BeamDisplaySystem over a Decay beam\'s tail', () => {
    const LENGTH = 300;
    const WIDTH = 2;
    // The kit's Decay Beam: Count 30, Decay 5, a 12-frame tail.
    const COUNT = 30 * FRAME;
    const ON_SCREEN = 42 * FRAME;

    /** The line widths and far ends drawn at `elapsedMs` into the beam. */
    function drawAt(elapsedMs: number) {
        const world = new World('beam decay test');
        const widths: number[] = [];
        const lineTo: [number, number][] = [];
        const recorder = {
            clear() { },
            lineStyle(width: number) { widths.push(width); },
            moveTo() { },
            lineTo(x: number, y: number) { lineTo.push([x, y]); },
        } as unknown as PIXI.Graphics;
        world.resources.set(BeamGraphicsResource, recorder);
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        world.resources.set(SimulationTimeResource,
            { time: 1000 + elapsedMs, delta_s: 0, delta_ms: 0, frame: 0 });
        world.addSystem(BeamDisplaySystem);
        const data = {
            decay: 5,
            shotDuration: COUNT,
            onScreenDuration: ON_SCREEN,
            beamAnimation: {
                length: LENGTH, width: WIDTH, beamColor: 0x00ff00,
                coronaColor: 0x00ff00, coronaFalloff: 0,
                lightningDensity: 0, lightningAmplitude: 0,
            },
        } as unknown as BeamWeaponData;
        world.entities.set('beam', new Entity('beam')
            .addComponent(BeamDataComponent, data)
            .addComponent(BeamStateComponent, {} as never)
            .addComponent(CreateTime, 1000)
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            } as never));
        world.step();
        const far = Math.max(...lineTo.map(([x, y]) => Math.hypot(x, y)));
        return { widths, far };
    }

    it('keeps the beam at its full length to the end of the tail', () => {
        for (const elapsed of [0, COUNT, (COUNT + ON_SCREEN) / 2,
            ON_SCREEN - 1]) {
            expect(drawAt(elapsed).far).withContext(`at ${elapsed} ms`)
                .toBeCloseTo(LENGTH, 6);
        }
    });

    it('thins only the corona: the core keeps its width', () => {
        const full = drawAt(0).widths;
        const half = drawAt((COUNT + ON_SCREEN) / 2).widths;
        const end = drawAt(ON_SCREEN).widths;
        // Corona, then core, while there is a corona.
        expect(full).toEqual([WIDTH + 2, WIDTH]);
        expect(half[0]).toBeCloseTo(WIDTH + 1, 9);
        expect(half[1]).toEqual(WIDTH);
        // Fully thinned: the core alone.
        expect(end).toEqual([WIDTH]);
    });
});
