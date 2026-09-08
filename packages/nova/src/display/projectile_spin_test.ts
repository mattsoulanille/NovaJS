import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import * as PIXI from 'pixi.js';
import { Entity } from 'nova_ecs/entity';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import {
    CreateTime, ProjectileComponent, ProjectileDataComponent,
} from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
import { AnimationGraphic } from './animation_graphic.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import {
    ProjectileSpinSystem,
    SPIN_FRAME_MS,
    spinningShotFrame,
} from './projectile_spin_plugin.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';

// 1 frame = 1/30 sec, the unit the EVN Bible's BeamWidth spin period
// counts in.
const FRAME_MS = SPIN_FRAME_MS;

describe('spinningShotFrame', () => {
    // The stock Fusion Pulse Cannon's shape: a frame every 1/30 s over a
    // 36-frame sheet (pinned against real data further down).
    const INTERVAL = 1;
    const FRAMES = 36;

    it('returns null when the shot does not spin', () => {
        // spinFrameInterval 0 is the "no spin" sentinel: the caller must
        // leave ObjectDrawSystem's heading-derived frame in place, so the
        // function must not offer a frame at all.
        expect(spinningShotFrame(0, FRAMES, 0)).toBeNull();
        expect(spinningShotFrame(0, FRAMES, 12345)).toBeNull();
    });

    it('returns null for a negative interval', () => {
        // The parser never emits one (it clamps to >= 1), but the helper
        // must not invent a backwards spin from bad data.
        expect(spinningShotFrame(-1, FRAMES, 100)).toBeNull();
    });

    it('treats a missing/NaN interval as no spin (deserialization safety)', () => {
        // ProjectileData rides the wire under a passthrough codec, so a
        // snapshot predating this field carries undefined. A NaN must
        // never reach the frame index.
        expect(spinningShotFrame(undefined as unknown as number, FRAMES, 100))
            .toBeNull();
        expect(spinningShotFrame(NaN, FRAMES, 100)).toBeNull();
    });

    it('returns null while the sprite sheet is still loading', () => {
        // SpriteSheetSprite.frames is 0 until its textures resolve.
        expect(spinningShotFrame(INTERVAL, 0, 100)).toBeNull();
        expect(spinningShotFrame(INTERVAL, -1, 100)).toBeNull();
    });

    it('returns null for a non-finite elapsed time', () => {
        expect(spinningShotFrame(INTERVAL, FRAMES, NaN)).toBeNull();
        expect(spinningShotFrame(INTERVAL, FRAMES, Infinity)).toBeNull();
    });

    it('starts a fresh shot on frame 0', () => {
        expect(spinningShotFrame(INTERVAL, FRAMES, 0)).toEqual(0);
    });

    it('advances one frame per interval * 1/30 s', () => {
        // Bible (wëap BeamWidth): "this field controls the time between
        // frames, in 30ths of a second." Interval 1 -> a frame every
        // 1/30 s.
        expect(spinningShotFrame(INTERVAL, FRAMES, FRAME_MS)).toEqual(1);
        expect(spinningShotFrame(INTERVAL, FRAMES, 2 * FRAME_MS)).toEqual(2);
        expect(spinningShotFrame(INTERVAL, FRAMES, 17 * FRAME_MS)).toEqual(17);
    });

    it('holds a frame for the whole of its period', () => {
        // Just before the boundary it is still the previous frame; the
        // frame is floor()ed, not rounded.
        expect(spinningShotFrame(INTERVAL, FRAMES, FRAME_MS * 0.99)).toEqual(0);
        expect(spinningShotFrame(INTERVAL, FRAMES, FRAME_MS * 1.99)).toEqual(1);
    });

    it('spins slower for a larger interval', () => {
        // Stock nova:140 "Stellar Grnd." uses interval 8: one frame every
        // 8/30 s.
        const SLOW = 8;
        expect(spinningShotFrame(SLOW, FRAMES, 0)).toEqual(0);
        expect(spinningShotFrame(SLOW, FRAMES, 7 * FRAME_MS)).toEqual(0);
        expect(spinningShotFrame(SLOW, FRAMES, 8 * FRAME_MS)).toEqual(1);
        expect(spinningShotFrame(SLOW, FRAMES, 16 * FRAME_MS)).toEqual(2);
    });

    it('wraps at the end of the sheet and keeps cycling', () => {
        // "Spin the weapon's graphic CONTINUOUSLY": the cycle repeats for
        // as long as the shot lives.
        expect(spinningShotFrame(INTERVAL, FRAMES, 35 * FRAME_MS)).toEqual(35);
        expect(spinningShotFrame(INTERVAL, FRAMES, 36 * FRAME_MS)).toEqual(0);
        expect(spinningShotFrame(INTERVAL, FRAMES, 37 * FRAME_MS)).toEqual(1);
        expect(spinningShotFrame(INTERVAL, FRAMES, 100 * FRAME_MS)).toEqual(100 % 36);
    });

    it('always returns an in-range frame index', () => {
        for (let f = 0; f < 400; f++) {
            const frame = spinningShotFrame(INTERVAL, FRAMES, f * FRAME_MS)!;
            expect(frame).not.toBeNull();
            expect(Number.isInteger(frame)).toBeTrue();
            expect(frame).toBeGreaterThanOrEqual(0);
            expect(frame).toBeLessThan(FRAMES);
        }
    });

    it('wraps a negative elapsed time into range instead of going negative', () => {
        // A display frame racing slightly ahead of the mirrored sim clock
        // can produce a negative flight time; the positive modulo keeps
        // the index valid rather than passing -1 to the frame setter.
        const frame = spinningShotFrame(INTERVAL, FRAMES, -FRAME_MS)!;
        expect(frame).toEqual(FRAMES - 1);
        expect(spinningShotFrame(INTERVAL, FRAMES, -100 * FRAME_MS)!)
            .toBeGreaterThanOrEqual(0);
    });

    it('completes one full cycle per frames * interval / 30 seconds', () => {
        // 36 frames at 1/30 s each -> a tumble every 1.2 s. This is the
        // "spins quite fast" rate of the original, and it comes from the
        // Bible's rule, not from a tuned constant.
        const cycleMs = FRAMES * INTERVAL * FRAME_MS;
        expect(cycleMs).toBeCloseTo(1200, 6);
        expect(spinningShotFrame(INTERVAL, FRAMES, cycleMs)).toEqual(0);
        expect(spinningShotFrame(INTERVAL, FRAMES, cycleMs / 2)).toEqual(FRAMES / 2);
    });

    it('is a pure function of its arguments (determinism)', () => {
        // Same inputs -> same frame, no hidden clock or randomness. A
        // desync here would be a display divergence between peers.
        for (const elapsed of [0, 37.5, 1234.56, -99]) {
            const a = spinningShotFrame(INTERVAL, FRAMES, elapsed);
            const b = spinningShotFrame(INTERVAL, FRAMES, elapsed);
            expect(a).toEqual(b);
        }
    });

    it('is independent of heading', () => {
        // The behavioural heart of the flag: a spinning shot's frames are
        // an animation cycle, so the frame depends ONLY on flight time.
        // The function takes no heading argument at all, which is the
        // structural guarantee; assert the system-level consequence in
        // ProjectileSpinSystem below.
        expect(spinningShotFrame.length).toEqual(3);
    });
});

// Pin the parsed flag on the real stock data, so a template/offset
// regression in the wëap parser fails loudly rather than silently
// switching the spin off. Runs wëap -> WeaponParse ->
// ProjectileWeaponData.spinFrameInterval. STAYS ON STOCK DATA: the
// named weapons, their BeamWidth periods and the count of spinning
// weapons in the set ARE the assertions.
describe('shot spin (real Nova data)', () => {
    let fpc: ProjectileWeaponData;
    let nonSpinning: ProjectileWeaponData;
    let slowSpinning: ProjectileWeaponData;

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
        const f = await gameData.data.Weapon.get('nova:143');
        const n = await gameData.data.Weapon.get('nova:128'); // Light Blaster
        const s = await gameData.data.Weapon.get('nova:140'); // Stellar Grnd.
        expect(f.type).toEqual('ProjectileWeaponData');
        expect(n.type).toEqual('ProjectileWeaponData');
        expect(s.type).toEqual('ProjectileWeaponData');
        fpc = f as ProjectileWeaponData;
        nonSpinning = n as ProjectileWeaponData;
        slowSpinning = s as ProjectileWeaponData;
    });

    it('grounds the weapons by name', () => {
        // If these ids ever stop being the intended weapons, fail here
        // rather than asserting a spin rate against the wrong weapon.
        expect(fpc.name).toEqual('Fusion Pulse Cannon');
        expect(nonSpinning.name).toEqual('Light Blaster');
        expect(slowSpinning.name).toEqual('Stellar Grnd.');
    });

    it('sets the spin flag on the stock Fusion Pulse Cannon', () => {
        // nova:143 has wëap Flags 0x0001 ("Spin the weapon's graphic
        // continuously") with BeamWidth 1, so one frame per 1/30 s.
        expect(fpc.spinFrameInterval).toEqual(1);
    });

    it('leaves the non-spinning Light Blaster at 0', () => {
        // Flags 0x0001 clear -> the sentinel, so its heading still picks
        // the frame exactly as before this feature existed.
        expect(nonSpinning.spinFrameInterval).toEqual(0);
    });

    it('reads the spin period from BeamWidth, not a constant', () => {
        // nova:140 shares the flag but carries BeamWidth 8, so the period
        // must come from the field. This is what proves the rate rule is
        // data-driven.
        expect(slowSpinning.spinFrameInterval).toEqual(8);
    });

    it('spins the Fusion Pulse Cannon once per 1.2 s over its 36-frame sheet', () => {
        // The shot graphic is spïn 3009 -> sprite sheet nova:218, whose
        // single 'normal' set spans all 36 frames.
        const set = fpc.animation.images.baseImage!.frames.normal;
        expect(set.start).toEqual(0);
        expect(set.length).toEqual(36);

        const frames = set.length;
        expect(spinningShotFrame(fpc.spinFrameInterval, frames, 0)).toEqual(0);
        expect(spinningShotFrame(fpc.spinFrameInterval, frames, FRAME_MS))
            .toEqual(1);
        // A full tumble in 36 frames = 1.2 s, well within its ~50-frame
        // (1.67 s) life, so a shot visibly completes about one turn.
        const cycleMs = frames * fpc.spinFrameInterval * FRAME_MS;
        expect(cycleMs).toBeCloseTo(1200, 6);
        expect(fpc.shotDuration).toBeGreaterThan(cycleMs);
        expect(spinningShotFrame(fpc.spinFrameInterval, frames, cycleMs))
            .toEqual(0);
    });

    it('offers no frame for the non-spinning weapon at any flight time', () => {
        const set = nonSpinning.animation.images.baseImage!.frames.normal;
        for (const t of [0, 100, 1000, nonSpinning.shotDuration]) {
            expect(spinningShotFrame(nonSpinning.spinFrameInterval,
                set.length, t)).toBeNull();
        }
    });

    it('spins exactly the stock weapons whose flag is set, and no others', () => {
        // A blast-radius check: only these 7 of the 42 stock projectile
        // weapons carry wëap Flags 0x0001, so nothing else can change
        // appearance. Verified against the parsed data below.
        const expected = new Map<string, number>([
            ['nova:140', 8], // Stellar Grnd.
            ['nova:143', 1], // Fusion Pulse Cannon
            ['nova:144', 1], // Fusion Pulse Turret
            ['nova:162', 1], // Fusion Pulse Battery
            ['nova:163', 1], // Nanites
            ['nova:229', 1], // Nanites
            ['nova:233', 1], // Fusion Pulse Turret
        ]);
        return (async () => {
            const gameData = await getIntegrationGameData();
            const ids = await gameData.ids;
            const spinning = new Map<string, number>();
            let projectiles = 0;
            for (const id of ids.Weapon) {
                const w = await gameData.data.Weapon.get(id);
                if (w.type !== 'ProjectileWeaponData') {
                    continue;
                }
                projectiles++;
                const interval = (w as ProjectileWeaponData).spinFrameInterval;
                if (interval > 0) {
                    spinning.set(id, interval);
                }
            }
            expect(projectiles).toEqual(42);
            expect([...spinning.entries()].sort())
                .toEqual([...expected.entries()].sort());
        })();
    });
});

// Just the pieces ProjectileSpinSystem touches. `frames` and `frameRange`
// stand in for a loaded sprite sheet; `frame` records what the system
// wrote, and its setter mimics SpriteSheetSprite's range check.
function fakeGraphic(frames = 36, start = 0, length = frames) {
    const container = new PIXI.Container();
    const pixiSprite = new PIXI.Sprite();
    container.addChild(pixiSprite);
    const sprite = {
        pixiSprite,
        frames,
        frameRange: { start, length },
        frame: -1,
    };
    const graphic = {
        container,
        sprites: new Map([['baseImage', sprite]]),
    };
    return graphic as unknown as AnimationGraphic;
}

function spriteFrame(graphic: AnimationGraphic): number {
    return (graphic.sprites.get('baseImage') as unknown as { frame: number })
        .frame;
}

function spriteRotation(graphic: AnimationGraphic): number {
    return graphic.sprites.get('baseImage')!.pixiSprite.rotation;
}

describe('ProjectileSpinSystem', () => {
    /**
     * A world whose mirrored simulation clock reads `simTimeMs`, with one
     * projectile fired at `createTime` (both sim-clock ms) whose weapon
     * has the given spin interval. `headingFrame`/`headingRotation` stand
     * in for what ObjectDrawSystem would already have written from the
     * shot's heading.
     */
    function spinWorld(simTimeMs: number, createTime: number,
        spinFrameInterval: number,
        opts: {
            headingFrame?: number, headingRotation?: number,
            frames?: number, start?: number, length?: number,
        } = {}) {
        const { headingFrame = 7, headingRotation = 0.5, frames = 36,
            start = 0, length = frames } = opts;
        const world = new World('projectile-spin-test');
        world.resources.set(SimulationTimeResource,
            { ...defaultSimulationTime(), time: simTimeMs });
        world.addSystem(ProjectileSpinSystem);
        const graphic = fakeGraphic(frames, start, length);
        // Pre-seed the heading-derived state ObjectDrawSystem writes.
        const sprite = graphic.sprites.get('baseImage') as unknown as
            { frame: number, pixiSprite: PIXI.Sprite };
        sprite.frame = headingFrame;
        sprite.pixiSprite.rotation = headingRotation;
        const projectile = new Entity('shot')
            .addComponent(ProjectileComponent, { id: 'nova:143' })
            .addComponent(ProjectileDataComponent,
                { spinFrameInterval } as ProjectileWeaponData)
            .addComponent(AnimationGraphicComponent, graphic)
            .addComponent(CreateTime, createTime);
        world.entities.set('shot', projectile);
        return { world, graphic };
    }

    it('starts a fresh spinning shot on frame 0', () => {
        const { world, graphic } = spinWorld(0, 0, 1);
        world.step();
        expect(spriteFrame(graphic)).toEqual(0);
    });

    it('advances the frame with the mirrored sim clock', () => {
        // createTime 1000, sim clock 1000 + 5 frames -> frame 5.
        const { world, graphic } = spinWorld(1000 + 5 * FRAME_MS, 1000, 1);
        world.step();
        expect(spriteFrame(graphic)).toEqual(5);
    });

    it('keeps cycling past the end of the sheet', () => {
        const { world, graphic } = spinWorld(40 * FRAME_MS, 0, 1);
        world.step();
        expect(spriteFrame(graphic)).toEqual(40 % 36);
    });

    it('uses the BeamWidth period, so a larger interval spins slower', () => {
        const { world, graphic } = spinWorld(16 * FRAME_MS, 0, 8);
        world.step();
        expect(spriteFrame(graphic)).toEqual(2);
    });

    it('zeroes the residual screen-space sprite rotation', () => {
        // The tumble is pre-rendered into the frames; leaving
        // ObjectDrawSystem's heading twist on top would compose two
        // unrelated rotations (the same reason TumbleDrawSystem zeroes
        // it).
        const { world, graphic } = spinWorld(3 * FRAME_MS, 0, 1,
            { headingRotation: 1.23 });
        expect(spriteRotation(graphic)).toEqual(1.23);
        world.step();
        expect(spriteRotation(graphic)).toEqual(0);
    });

    it('picks the same frame regardless of the heading frame ObjectDrawSystem wrote', () => {
        // Heading independence at the system level: the shot's flight time
        // alone decides the frame, so two shots at the same age but
        // different headings show the same frame.
        const a = spinWorld(9 * FRAME_MS, 0, 1, { headingFrame: 0 });
        const b = spinWorld(9 * FRAME_MS, 0, 1, { headingFrame: 31 });
        a.world.step();
        b.world.step();
        expect(spriteFrame(a.graphic)).toEqual(9);
        expect(spriteFrame(b.graphic)).toEqual(9);
    });

    it('leaves a non-spinning projectile completely untouched', () => {
        // Regression guard for the other 35 stock projectile weapons,
        // guided missiles and rockets included: their heading frame and
        // their residual rotation must both survive.
        const { world, graphic } = spinWorld(50 * FRAME_MS, 0, 0,
            { headingFrame: 7, headingRotation: 0.5 });
        world.step();
        expect(spriteFrame(graphic)).toEqual(7);
        expect(spriteRotation(graphic)).toEqual(0.5);
    });

    it('does not disturb the container alpha owned by the fade/murk systems', () => {
        const { world, graphic } = spinWorld(5 * FRAME_MS, 0, 1);
        world.step();
        expect(graphic.container.alpha).toEqual(1);
    });

    it('stays inside the active texture set on a multi-set sheet', () => {
        // A plug-in shot sheet with several sets: the cycle must run
        // within the active set, never spilling into a neighbouring one.
        const { world, graphic } = spinWorld(5 * FRAME_MS, 0, 1,
            { frames: 72, start: 36, length: 36 });
        world.step();
        expect(spriteFrame(graphic)).toEqual(36 + 5);
        // And it wraps back to the set's own start, not to 0.
        const wrapped = spinWorld(36 * FRAME_MS, 0, 1,
            { frames: 72, start: 36, length: 36 });
        wrapped.world.step();
        expect(spriteFrame(wrapped.graphic)).toEqual(36);
    });

    it('leaves the frame alone while the sheet is still loading', () => {
        // frames 0 -> textures unresolved; must not write a frame.
        const { world, graphic } = spinWorld(5 * FRAME_MS, 0, 1,
            { headingFrame: 4, frames: 0, length: 36 });
        world.step();
        expect(spriteFrame(graphic)).toEqual(4);
    });
});

/**
 * ProjectileFadeSystem shipped broken once because CreateTime was not
 * registered with the simulation serializer, so the component never
 * survived the sim -> display mirror and the query matched nothing while
 * every unit test passed (see projectile_fade_test.ts). ProjectileSpinSystem
 * reads the same components, plus the new spinFrameInterval field inside
 * ProjectileData, so pin that wiring here too.
 */
describe('shot spin sim -> display wiring', () => {
    let simWorld: World;
    let serializer: Serializer;

    // The world here exists only to produce a real simulation
    // serializer, which registers the same components whichever set it
    // parsed — so it is built from the synthetic scenario. The spec
    // below still needs a STOCK spinning shot and gates itself; and
    // because ProjectileData crosses the wire as a reference resolved
    // against the receiving world's own Weapon data (#225), it decodes
    // with a stock world's serializer rather than this one.
    beforeAll(async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        simWorld = await makeSystem(systemId, gameData, undefined,
            { npcs: false });
        serializer = simWorld.resources.get(SerializerResource)!;
    });

    // STAYS ON REAL DATA: a spinning shot needs wëap Flags 0x0001 and a
    // 36-frame shot sheet, and no synthetic weapon sets that flag.
    it('spins a Fusion Pulse Cannon shot rebuilt from the wire', async () => {
        requireNovaData();
        const gameData = await getIntegrationGameData();
        const fpc = await gameData.data.Weapon.get('nova:143');
        expect(fpc.type).toEqual('ProjectileWeaponData');
        const data = fpc as ProjectileWeaponData;
        const stockWorld = await makeSystem(
            [...(await gameData.ids).System].sort()[0]!, gameData, undefined,
            { npcs: false });
        const stockSerializer = stockWorld.resources.get(SerializerResource)!;

        // Encode in the simulation world and decode exactly as
        // browser.ts's syncEntityToDisplay does (the Weapon.get above is
        // the staging step), so anything the serializer drops is simply
        // absent here.
        const simShot = new Entity('projectile')
            .addComponent(ProjectileComponent, { id: 'nova:143' })
            .addComponent(ProjectileDataComponent, data)
            .addComponent(CreateTime, 1000);
        const decoded = stockSerializer.decode(stockSerializer.encode(simShot));
        expect(isLeft(decoded)).toBeFalse();
        if (isLeft(decoded)) {
            return;
        }
        const displayShot = decoded.right;

        // spinFrameInterval must survive the passthrough codec.
        expect(displayShot.components.get(ProjectileDataComponent)
            ?.spinFrameInterval).toEqual(1);

        const graphic = fakeGraphic(36);
        displayShot.components.set(AnimationGraphicComponent, graphic);

        const displayWorld = new World('mirror-spin-test');
        displayWorld.resources.set(SimulationTimeResource,
            { ...defaultSimulationTime(), time: 1000 + 11 * FRAME_MS });
        displayWorld.addSystem(ProjectileSpinSystem);
        displayWorld.entities.set('shot', displayShot);
        displayWorld.step();

        expect(spriteFrame(graphic)).toEqual(11);
    });
});
