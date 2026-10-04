import 'jasmine';
import * as PIXI from 'pixi.js';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import {
    MovementState, MovementStateComponent,
} from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { AnimationGraphic } from './animation_graphic.js';
import {
    AnimationGraphicComponent, ObjectDrawSystem,
} from './animation_graphic_plugin.js';
import {
    BANK_DELAY_MS, BANK_GAP_HOLD_MS, BankState, FrameSetName, GLOW_FADE_MS,
    GlowState, ShipMotionDisplayState, stepBank, stepGlow,
    stepShipMotionDisplay,
} from './ship_motion_display.js';
import { CameraFocus } from './space_resource.js';

/** One display frame at 60 Hz. */
const FRAME = 1000 / 60;

/**
 * Feeds `turning(t)` to stepBank once per display frame from `from` for
 * `ms`, returning the state and every frame set shown.
 */
function runBank(turning: (t: number) => number, ms: number,
    { from = 0, start }: { from?: number, start?: BankState } = {}) {
    let state = start;
    const shown: { t: number, frames: FrameSetName }[] = [];
    for (let t = from; t <= from + ms + 1e-9; t += FRAME) {
        const r = stepBank(state, turning(t), t);
        state = r.state;
        shown.push({ t, frames: r.frames });
    }
    return { state: state!, shown };
}

describe('stepBank (#357 bank delay)', () => {
    it('stays level for the first BANK_DELAY_MS of a turn, then banks', () => {
        const { shown } = runBank(() => 1, 1000);
        for (const { t, frames } of shown) {
            expect(frames).withContext(`t=${t.toFixed(1)}`)
                .toEqual(t < BANK_DELAY_MS ? 'normal' : 'right');
        }
        const left = runBank(() => -1, 1000).shown;
        expect(left[left.length - 1].frames).toEqual('left');
    });

    it('holds the bank for as long as the turn is held', () => {
        const { shown } = runBank(() => -1, 5000);
        expect(shown.filter(s => s.t >= BANK_DELAY_MS)
            .every(s => s.frames === 'left')).toBeTrue();
    });

    it('never banks during a ±1 wiggle faster than the delay', () => {
        // Every-frame alternation (an NPC overshooting each side of its
        // heading), and a slower 200 ms wiggle: both reverse before the
        // delay can elapse.
        const everyFrame = runBank(t => Math.round(t / FRAME) % 2 ? 1 : -1,
            5000).shown;
        expect(everyFrame.every(s => s.frames === 'normal')).toBeTrue();
        const slow = runBank(t => Math.floor(t / 200) % 2 ? 1 : -1,
            5000).shown;
        expect(slow.every(s => s.frames === 'normal')).toBeTrue();
        // ...and a wiggle through zero (+1, 0, -1, 0, ...).
        const viaZero = runBank(t => [1, 0, -1, 0][Math.floor(t / 120) % 4],
            5000).shown;
        expect(viaZero.every(s => s.frames === 'normal')).toBeTrue();
    });

    it('restarts the delay on a change of direction', () => {
        const banked = runBank(() => 1, 800);
        expect(banked.shown[banked.shown.length - 1].frames).toEqual('right');
        const t0 = 800 + FRAME;
        const { shown } = runBank(() => -1, 800,
            { from: t0, start: banked.state });
        for (const { t, frames } of shown) {
            // Level at once (no lingering right bank), left only after a
            // full delay measured from the reversal.
            expect(frames).withContext(`t=${(t - t0).toFixed(1)}`)
                .toEqual(t - t0 < BANK_DELAY_MS ? 'normal' : 'left');
        }
    });

    it('bridges a zero no longer than BANK_GAP_HOLD_MS: bank and clock kept',
        () => {
            // Banked, then single-frame zeros every 10 frames (an NPC's
            // turnTo snapping onto its goal mid-turn).
            const gappy = (t: number) => Math.round(t / FRAME) % 10 === 5
                ? 0 : 1;
            const { shown } = runBank(gappy, 3000);
            expect(shown.filter(s => s.t >= BANK_DELAY_MS)
                .every(s => s.frames === 'right')).toBeTrue();

            // A gap during the delay does not restart it either.
            const gapEarly = (t: number) =>
                t > 200 && t < 200 + BANK_GAP_HOLD_MS - 2 * FRAME ? 0 : 1;
            const early = runBank(gapEarly, 1000).shown;
            const firstBank = early.find(s => s.frames === 'right')!;
            expect(firstBank.t).toBeGreaterThanOrEqual(BANK_DELAY_MS);
            expect(firstBank.t).toBeLessThan(BANK_DELAY_MS + FRAME);
        });

    it('un-banks once turning has read zero for longer than the hold', () => {
        const banked = runBank(() => 1, 1000).state;
        const t0 = 1000 + FRAME;
        const { shown, state } = runBank(() => 0, 500,
            { from: t0, start: banked });
        for (const { t, frames } of shown) {
            expect(frames).withContext(`t=+${(t - t0).toFixed(1)}`)
                .toEqual(t - t0 <= BANK_GAP_HOLD_MS ? 'right' : 'normal');
        }
        // The next turn waits the whole delay again.
        const t1 = t0 + 500 + FRAME;
        const again = runBank(() => 1, 600, { from: t1, start: state }).shown;
        expect(again.find(s => s.frames === 'right')!.t - t1)
            .toBeGreaterThanOrEqual(BANK_DELAY_MS);
    });

    it('banks a steady turn even when display frames are far apart', () => {
        // A stalled or slow display (frames 200 ms apart, longer than the
        // gap hold) still sees an unbroken turn: the hold measures ZERO
        // readings, not the time between frames.
        let state: BankState | undefined;
        const shown: FrameSetName[] = [];
        for (let t = 0; t <= 1000; t += 200) {
            const r = stepBank(state, -1, t);
            state = r.state;
            shown.push(r.frames);
        }
        expect(shown).toEqual(
            ['normal', 'normal', 'normal', 'left', 'left', 'left']);
    });

    it('treats short bursts separated by long zeros as no turn at all', () => {
        // +1 for 100 ms, then 200 ms of zero, repeated: no sustained turn.
        const bursts = (t: number) => t % 300 < 100 ? 1 : 0;
        expect(runBank(bursts, 5000).shown.every(s => s.frames === 'normal'))
            .toBeTrue();
    });

    it('starts afresh if the display clock runs backwards', () => {
        const banked = runBank(() => 1, 1000).state;
        expect(stepBank(banked, 1, 10).frames).toEqual('normal');
    });
});

describe('stepGlow (#357 engine glow fade)', () => {
    function runGlow(accelerating: (t: number) => number, ms: number,
        { from = 0, start }: { from?: number, start?: GlowState } = {}) {
        let state = start;
        const levels: { t: number, level: number }[] = [];
        for (let t = from; t <= from + ms + 1e-9; t += FRAME) {
            state = stepGlow(state, accelerating(t), t);
            levels.push({ t, level: state.level });
        }
        return { state: state!, levels };
    }

    it('starts at the target on first sight (no fade-in on arrival)', () => {
        expect(stepGlow(undefined, 1, 1234).level).toEqual(1);
        expect(stepGlow(undefined, 0, 1234).level).toEqual(0);
    });

    it('fades out linearly over GLOW_FADE_MS when thrust stops', () => {
        const on = stepGlow(undefined, 1, 0);
        const { levels } = runGlow(() => 0, 700, { from: FRAME, start: on });
        for (const { t, level } of levels) {
            expect(level).withContext(`t=${t.toFixed(1)}`)
                .toBeCloseTo(Math.max(0, 1 - t / GLOW_FADE_MS), 6);
        }
    });

    it('fades in linearly over GLOW_FADE_MS when thrust starts', () => {
        const off = stepGlow(undefined, 0, 0);
        const { levels } = runGlow(() => 1, 700, { from: FRAME, start: off });
        for (const { t, level } of levels) {
            expect(level).withContext(`t=${t.toFixed(1)}`)
                .toBeCloseTo(Math.min(1, t / GLOW_FADE_MS), 6);
        }
    });

    it('barely dims for a one-frame thrust dropout', () => {
        const dropout = (t: number) => Math.abs(t - 300) < FRAME / 2 ? 0 : 1;
        const { levels } = runGlow(dropout, 1000,
            { start: stepGlow(undefined, 1, -FRAME) });
        const min = Math.min(...levels.map(l => l.level));
        expect(min).toBeCloseTo(1 - FRAME / GLOW_FADE_MS, 6);
        expect(levels[levels.length - 1].level).toEqual(1);
    });

    it('clamps the target to [0, 1] (braking reads -1)', () => {
        const on = stepGlow(undefined, 1, 0);
        const later = stepGlow(on, -1, 10_000);
        expect(later.level).toEqual(0);
        expect(stepGlow(undefined, -1, 0).level).toEqual(0);
        expect(stepGlow(undefined, 2, 0).level).toEqual(1);
    });
});

describe('stepShipMotionDisplay (pooled graphics)', () => {
    it('discards state built for another entity', () => {
        let state: ShipMotionDisplayState | undefined;
        for (let t = 0; t < 1000; t += FRAME) {
            state = stepShipMotionDisplay(state, 'ship-a', 1, 0, t).state;
        }
        expect(stepShipMotionDisplay(state, 'ship-a', 1, 0, 1000).frames)
            .toEqual('right');
        // The same graphic handed to ship-b, which is turning and
        // thrusting: it must not inherit a's bank, nor a's dark glow.
        const b = stepShipMotionDisplay(state, 'ship-b', 1, 1, 1000);
        expect(b.frames).toEqual('normal');
        expect(b.glow).toEqual(1);
        expect(b.state.owner).toEqual('ship-b');
    });

    it('is cleared by AnimationGraphic.reset() (the pool acquire path)', () => {
        // reset() without building PIXI sprite sheets: a graphic with no
        // layers exercises exactly the fields reset() owns.
        const graphic = Object.create(AnimationGraphic.prototype) as
            AnimationGraphic;
        Object.assign(graphic, {
            sprites: new Map(), container: new PIXI.Container(),
        });
        graphic.motionDisplay =
            stepShipMotionDisplay(undefined, 'ship-a', 1, 1, 0).state;
        graphic.reset();
        expect(graphic.motionDisplay).toBeUndefined();
    });
});

describe('ObjectDrawSystem bank and glow (#357)', () => {
    // A graphic with one hull layer and one glow layer that records the
    // frame set it was told to use, like SpriteSheetSprite does.
    function fakeLayer() {
        return {
            pixiSprite: new PIXI.Sprite(),
            set: 'normal' as string,
            rotation: 0,
            setFramesToUse(frames: string) { this.set = frames; },
        };
    }

    function drawWorld() {
        const world = new World('object-draw-bank-test');
        world.resources.set(CameraFocus, { x: 0, y: 0 });
        const time = { time: 0, delta_ms: FRAME, delta_s: FRAME / 1000, frame: 0 };
        world.resources.set(TimeResource, time);
        world.addSystem(ObjectDrawSystem);
        const hull = fakeLayer();
        const glow = fakeLayer();
        const graphic = Object.create(AnimationGraphic.prototype) as
            AnimationGraphic;
        Object.assign(graphic, {
            container: new PIXI.Container(),
            sprites: new Map([['baseImage', hull], ['glowImage', glow]]),
        });
        const movement: MovementState = {
            accelerating: 1, position: new Position(0, 0),
            rotation: new Angle(0), turnBack: false, turning: 0,
            velocity: new Vector(0, 0),
        };
        world.entities.set('npc', new Entity('npc')
            .addComponent(MovementStateComponent, movement)
            .addComponent(AnimationGraphicComponent, graphic));
        const step = (turning: number, accelerating: number) => {
            const m = world.entities.get('npc')!.components
                .get(MovementStateComponent)!;
            m.turning = turning;
            m.accelerating = accelerating;
            time.time += FRAME;
            time.frame++;
            world.step();
        };
        return { step, hull, glow };
    }

    it('does not flip the sprite set while the steering wiggles', () => {
        const { step, hull, glow } = drawWorld();
        const sets = new Set<string>();
        for (let i = 0; i < 120; i++) {
            step(i % 3 === 0 ? 0 : i % 2 ? 1 : -1, 1);
            sets.add(hull.set);
            expect(glow.set).toEqual(hull.set);
        }
        expect([...sets]).toEqual(['normal']);
    });

    it('banks every layer after a sustained turn', () => {
        const { step, hull, glow } = drawWorld();
        for (let i = 0; i < 60; i++) {
            step(-1, 1);
        }
        expect(hull.set).toEqual('left');
        expect(glow.set).toEqual('left');
    });

    it('keeps the engine glow through a one-frame thrust dropout', () => {
        const { step, glow } = drawWorld();
        for (let i = 0; i < 30; i++) {
            step(0, 1);
        }
        step(1, 0); // The NPC's one-tick retrograde blip: turn, no thrust.
        // Smoothed level (1 - 1/30) times the ±20% shimmer.
        expect(glow.pixiSprite.alpha).toBeGreaterThan(0.75);
        for (let i = 0; i < 60; i++) {
            step(0, 0);
        }
        expect(glow.pixiSprite.alpha).toEqual(0);
    });
});
