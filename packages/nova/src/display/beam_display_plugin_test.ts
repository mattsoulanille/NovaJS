import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { BOUNDARY, Position, WORLD_SIZE } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementPhysicsComponent, MovementStateComponent, MovementSystem,
    MovementType,
} from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { BeamWeaponData } from 'novadatainterface/weapon_data';
import { BeamDataComponent, BeamStateComponent } from '../nova_plugin/combat/index.js';
import { SourceComponent, TargetComponent } from '../nova_plugin/ship/index.js';
import {
    BeamDisplaySystem, BeamGraphicsResource, beamOrigin, ClearBeams, drawnBeamPose,
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

/**
 * Playtest 2026-11-24 (Matthew, novajs.net): "ion cannon rendering is
 * lagging behind the ship as it flies." The display extrapolates ships
 * between simulation snapshots (MovementExtrapolationPlugin runs the real
 * MovementSystem on the display clock); beams have no MovementPhysics, so
 * a beam drawn from its own synced position stayed where the last
 * snapshot left it while its ship flew a frame ahead. The drawn beam is
 * now re-anchored to its firing ship's drawn movement every frame.
 */
describe('BeamDisplaySystem anchoring to the firing ship', () => {
    const FRAME_MS = 1000 / 60;
    const SPEED = 600;
    const EXIT = {
        position: [10, 20, 0] as [number, number, number],
        upCompress: [100, 100] as [number, number],
        downCompress: [100, 100] as [number, number],
    };

    /**
     * A display world one frame after a snapshot: the ship (moving up at
     * SPEED) and its beam were synced together, the beam at the ship's
     * gun point (the simulation's anchor), then a frame with no fresh
     * snapshot is stepped. BeamDisplaySystem is added BEFORE
     * MovementSystem (and sorts first by name), so only its declared
     * edge orders it after the extrapolation.
     */
    function flyingShipWorld(beamState: Record<string, unknown>,
        targetAt?: { x: number, y: number }) {
        const world = new World('beam anchor test');
        const moveTo: [number, number][] = [];
        const lineTo: [number, number][] = [];
        world.resources.set(BeamGraphicsResource, {
            clear() { },
            lineStyle() { },
            moveTo(x: number, y: number) { moveTo.push([x, y]); },
            lineTo(x: number, y: number) { lineTo.push([x, y]); },
        } as unknown as PIXI.Graphics);
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        world.resources.set(SimulationTimeResource, defaultSimulationTime());
        world.resources.set(TimeResource, {
            time: 1000, delta_ms: FRAME_MS, delta_s: FRAME_MS / 1000,
            frame: 60,
        });
        world.addSystem(BeamDisplaySystem);
        world.addSystem(MovementSystem);

        const ship = new Entity('ship')
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                velocity: new Vector(0, -SPEED),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            })
            .addComponent(MovementPhysicsComponent, {
                maxVelocity: SPEED, turnRate: 0, acceleration: 0,
                movementType: MovementType.INERTIAL,
            });
        world.entities.set('ship', ship);
        if (targetAt) {
            world.entities.set('target', new Entity('target')
                .addComponent(MovementStateComponent, {
                    position: new Position(targetAt.x, targetAt.y),
                    velocity: new Vector(0, 0),
                    rotation: new Angle(0),
                    accelerating: 0, turning: 0, turnBack: false,
                }));
        }
        // The gun point at the snapshot: ship (0, 0) + exit (10, -20).
        const beam = new Entity('beam')
            .addComponent(BeamDataComponent, beamData())
            .addComponent(BeamStateComponent,
                { exitPointData: EXIT, ...beamState })
            .addComponent(SourceComponent, 'ship')
            .addComponent(MovementStateComponent, {
                position: new Position(10, -20),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            });
        if (targetAt) {
            beam.addComponent(TargetComponent, { target: 'target' });
        }
        world.entities.set('beam', beam);
        world.step();
        const shipPosition =
            ship.components.get(MovementStateComponent)!.position;
        return { moveTo, lineTo, shipPosition };
    }

    it('draws a forward beam from the extrapolated ship\'s gun point', () => {
        const { moveTo, lineTo, shipPosition } = flyingShipWorld({});
        // The ship flew a frame (10 px) up.
        expect(shipPosition.y).toBeCloseTo(-SPEED * FRAME_MS / 1000, 6);
        const gun = [shipPosition.x + 10, shipPosition.y - 20];
        expect(moveTo.length).toBeGreaterThan(0);
        for (const [x, y] of moveTo) {
            // Before the fix: (10, -20), the gun point a frame ago.
            expect(x).toBeCloseTo(gun[0], 6);
            expect(y).toBeCloseTo(gun[1], 6);
        }
        expect(lineTo.at(-1)![0]).toBeCloseTo(gun[0], 6);
        expect(lineTo.at(-1)![1]).toBeCloseTo(gun[1] - LENGTH, 6);
    });

    it('re-aims a turret beam from the moved gun point at its target', () => {
        const { moveTo, lineTo, shipPosition } = flyingShipWorld(
            { pointToTarget: true }, { x: 210, y: -30 });
        const gun = new Vector(shipPosition.x + 10, shipPosition.y - 20);
        expect(moveTo.length).toBeGreaterThan(0);
        for (const [x, y] of moveTo) {
            expect(x).toBeCloseTo(gun.x, 6);
            expect(y).toBeCloseTo(gun.y, 6);
        }
        const end = new Vector(210, -30).subtract(gun).normalize(LENGTH)
            .add(gun);
        expect(lineTo.at(-1)![0]).toBeCloseTo(end.x, 6);
        expect(lineTo.at(-1)![1]).toBeCloseTo(end.y, 6);
    });

    it('keeps the inaccuracy the beam left the ship with', () => {
        const aimOffset = 0.1;
        const { lineTo, shipPosition } = flyingShipWorld({ aimOffset });
        const gun = new Vector(shipPosition.x + 10, shipPosition.y - 20);
        const end = new Angle(aimOffset).getUnitVector().scale(LENGTH)
            .add(gun);
        expect(lineTo.at(-1)![0]).toBeCloseTo(end.x, 6);
        expect(lineTo.at(-1)![1]).toBeCloseTo(end.y, 6);
    });

    it('draws a beam whose firer is gone where the simulation left it', () => {
        const pose = drawnBeamPose({
            position: new Position(5, 6), rotation: new Angle(1),
            velocity: new Vector(0, 0), accelerating: 0, turning: 0,
            turnBack: false,
        }, { exitPointData: EXIT }, 'gone', undefined,
            new World('empty').entities);
        expect(pose.position.x).toEqual(5);
        expect(pose.position.y).toEqual(6);
        expect(pose.rotation.angle).toEqual(1);
    });

    it('hides beamGraphics and skips clear() on consecutive beamless frames', () => {
        const world = new World('clear beams test');
        let clears = 0;
        const recorder = {
            visible: false,
            clear() { clears++; },
            lineStyle() { },
            moveTo() { },
            lineTo() { },
        } as unknown as PIXI.Graphics;
        world.resources.set(BeamGraphicsResource, recorder);
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        world.resources.set(SimulationTimeResource, defaultSimulationTime());
        world.addSystem(ClearBeams);
        world.addSystem(BeamDisplaySystem);

        // No beams: ClearBeams is a no-op and beamGraphics stays hidden.
        world.step();
        world.step();
        expect(clears).toBe(0);
        expect(recorder.visible).toBeFalse();

        // Add a beam: BeamDisplaySystem draws and unhides beamGraphics.
        const beam = new Entity('beam')
            .addComponent(BeamDataComponent, beamData())
            .addComponent(BeamStateComponent, {} as never)
            .addComponent(MovementStateComponent, {
                position: new Position(0, 0),
                velocity: new Vector(0, 0),
                rotation: new Angle(0),
                accelerating: 0, turning: 0, turnBack: false,
            } as never);
        world.entities.set('beam', beam);
        world.step();
        expect(clears).toBe(0);
        expect(recorder.visible).toBeTrue();

        // Remove the beam: next frame clears once and hides; following empty
        // frames skip clear().
        world.entities.delete('beam');
        world.step();
        expect(clears).toBe(1);
        expect(recorder.visible).toBeFalse();
        world.step();
        expect(clears).toBe(1);
    });
});
