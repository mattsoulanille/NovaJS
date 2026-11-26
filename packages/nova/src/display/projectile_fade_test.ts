import 'jasmine';
import { isLeft } from 'fp-ts/lib/Either.js';
import * as PIXI from 'pixi.js';
import { UnknownComponent } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import {
    EncodedEntity, Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import {
    CreateTime, ProjectileComponent, ProjectileDataComponent,
} from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../communication/simulation_test_fixture.js';
import { requireNovaData } from '../test_support/nova_data_gate.js';
import { AnimationGraphic } from './animation_graphic.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import {
    FALLOFF_BASE_FADE_FRAMES,
    FADE_FRAME_MS,
    falloffFadeFrames,
    ProjectileFadeSystem,
    projectileFadeAlpha,
} from './projectile_fade_plugin.js';
import { defaultSimulationTime, SimulationTimeResource } from './simulation_time.js';

// 1 frame = 1/30 sec, the unit the EVN Bible's Falloff field counts in
// and the same factor the sim uses (30/1000) to turn ms into frames.
const FRAME_MS = FADE_FRAME_MS;

// A minimal projectile payload carrying only the fields ProjectileFadeSystem
// reads (falloff, shotDuration), cast to the full interface like the
// entity_data_loader_test mocks do.
function fadeProjectileData(falloff: number, shotDurationMs: number): ProjectileWeaponData {
    return { falloff, shotDuration: shotDurationMs } as ProjectileWeaponData;
}

describe('falloffFadeFrames', () => {
    it('returns 0 (no fade) when falloff is 0', () => {
        expect(falloffFadeFrames(0)).toEqual(0);
    });

    it('returns 0 (no fade) when falloff is negative', () => {
        // The parser clamps negatives to 0, but the helper must be robust
        // to a raw negative too (the Bible's sprite range starts at 1).
        expect(falloffFadeFrames(-1)).toEqual(0);
        expect(falloffFadeFrames(-16)).toEqual(0);
    });

    it('treats a missing/NaN falloff as no fade (deserialization safety)', () => {
        // ProjectileData is a passthrough codec, so a snapshot from before
        // this field existed could carry undefined; a NaN must never reach
        // the alpha math or it would desync the display.
        expect(falloffFadeFrames(undefined as unknown as number)).toEqual(0);
        expect(falloffFadeFrames(NaN)).toEqual(0);
    });

    it('fades over the final 32 frames when falloff is 1', () => {
        // Bible: "setting this field to a value of 1 will cause the sprite
        // to fade out over the final 32 frames of its life."
        expect(falloffFadeFrames(1)).toEqual(32);
    });

    it('fades faster (shorter window) for higher falloff: 32 / falloff', () => {
        // "Higher values will fade out faster" -> the 1..0 sweep completes
        // in fewer frames. Stock data uses 2 and 3.
        expect(falloffFadeFrames(2)).toEqual(16);
        expect(falloffFadeFrames(3)).toBeCloseTo(32 / 3, 10);
        expect(falloffFadeFrames(16)).toEqual(2);
    });
});

describe('projectileFadeAlpha', () => {
    // A 50-frame life (Fusion Pulse Cannon) with falloff 2: the fade
    // starts 32 frames before the end and lasts 32 / 2 = 16 frames.
    const FALLOFF = 2;
    const SHOT_MS = 50 * FRAME_MS;
    const FADE_START = SHOT_MS - 32 * FRAME_MS;
    const FADE_MS = 16 * FRAME_MS; // 32 / falloff frames

    it('is fully opaque (1) for the whole flight when falloff is 0', () => {
        // Weapons without the field render exactly as before (the
        // original's Falloff 0 blinks out at its Count: E10 wave 40).
        expect(projectileFadeAlpha(0, SHOT_MS, 0)).toEqual(1);
        expect(projectileFadeAlpha(0, SHOT_MS, SHOT_MS / 2)).toEqual(1);
        expect(projectileFadeAlpha(0, SHOT_MS, SHOT_MS)).toEqual(1);
    });

    it('is fully opaque when falloff is negative, NaN, or missing', () => {
        expect(projectileFadeAlpha(-1, SHOT_MS, SHOT_MS)).toEqual(1);
        expect(projectileFadeAlpha(NaN, SHOT_MS, SHOT_MS)).toEqual(1);
        expect(projectileFadeAlpha(undefined as unknown as number, SHOT_MS, 0))
            .toEqual(1);
    });

    it('is fully opaque at birth', () => {
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, 0)).toEqual(1);
    });

    it('stays at full alpha until 32 frames before the end', () => {
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, FADE_START - FRAME_MS))
            .toEqual(1);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, FADE_START))
            .toBeCloseTo(1, 6);
    });

    it('fades linearly to 0 over 32 / falloff frames from there', () => {
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, FADE_START + FADE_MS / 2))
            .toBeCloseTo(0.5, 6);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, FADE_START + FADE_MS / 4))
            .toBeCloseTo(0.75, 6);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS,
            FADE_START + 3 * FADE_MS / 4)).toBeCloseTo(0.25, 6);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, FADE_START + FADE_MS))
            .toBeCloseTo(0, 6);
    });

    it('is gone (32 - 32 / falloff) frames before expiry and stays 0', () => {
        // Falloff 2: invisible 16 frames before the shot expires.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS - 15 * FRAME_MS))
            .toEqual(0);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS)).toEqual(0);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS + 1000)).toEqual(0);
    });

    it('reaches 0 exactly at expiry for falloff 1 (the Bible\'s "final 32 '
        + 'frames")', () => {
        expect(projectileFadeAlpha(1, SHOT_MS, FADE_START)).toBeCloseTo(1, 6);
        expect(projectileFadeAlpha(1, SHOT_MS, SHOT_MS - 16 * FRAME_MS))
            .toBeCloseTo(0.5, 6);
        expect(projectileFadeAlpha(1, SHOT_MS, SHOT_MS)).toBeCloseTo(0, 9);
    });

    it('matches the measured Count-90 bolts (reference "Beam decay and '
        + 'projectile fade (E10), wave 40")', () => {
        // Falloff 1 gone by about 80 visible frames and Falloff 4 by
        // about 64 on a pixel threshold: at frame 79 / 63 both are down
        // to about a third (the section's threshold, alpha ~0.35), and
        // Falloff 4 is fully gone 24 frames before its Count.
        const COUNT_MS = 90 * FRAME_MS;
        expect(projectileFadeAlpha(1, COUNT_MS, 79 * FRAME_MS))
            .toBeLessThanOrEqual(0.38);
        expect(projectileFadeAlpha(4, COUNT_MS, 63 * FRAME_MS))
            .toBeLessThanOrEqual(0.38);
        expect(projectileFadeAlpha(4, COUNT_MS, 66 * FRAME_MS)).toEqual(0);
        // Both full brightness until frame 58.
        expect(projectileFadeAlpha(1, COUNT_MS, 57 * FRAME_MS)).toEqual(1);
        expect(projectileFadeAlpha(4, COUNT_MS, 57 * FRAME_MS)).toEqual(1);
    });

    it('never exceeds 1 or drops below 0 (clamping)', () => {
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, -1000)).toEqual(1);
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS + 1e6)).toEqual(0);
    });

    it('is monotonic non-increasing over the whole flight', () => {
        let prev = 2;
        for (let f = 0; f <= 60; f++) {
            const a = projectileFadeAlpha(FALLOFF, SHOT_MS, f * FRAME_MS);
            expect(a).toBeLessThanOrEqual(prev + 1e-9);
            prev = a;
        }
        expect(prev).toEqual(0); // ends transparent.
    });

    it('starts every falloff at the same frame and finishes higher ones '
        + 'sooner', () => {
        const elapsed = FADE_START + 5 * FRAME_MS;
        // Same start: all opaque one frame before it.
        for (const falloff of [1, 2, 3, 4]) {
            expect(projectileFadeAlpha(falloff, SHOT_MS,
                FADE_START - FRAME_MS)).toEqual(1);
        }
        // Five frames in, the higher falloff is further down.
        expect(projectileFadeAlpha(3, SHOT_MS, elapsed))
            .toBeLessThan(projectileFadeAlpha(2, SHOT_MS, elapsed));
        expect(projectileFadeAlpha(2, SHOT_MS, elapsed))
            .toBeLessThan(projectileFadeAlpha(1, SHOT_MS, elapsed));
    });

    it('returns 1 (no fade) for a non-positive shot duration', () => {
        expect(projectileFadeAlpha(2, 0, 0)).toEqual(1);
        expect(projectileFadeAlpha(2, -100, 50)).toEqual(1);
    });
});

// Pin the fade curve on the real Fusion Pulse Cannon and a real railgun —
// the stock weapons the user reports fading. STAYS ON STOCK DATA: naming
// those weapons and their Falloff values IS the point, and no synthetic
// weapon carries a Falloff at all. Runs against the real Nova game data
// (Nova_Data): wëap -> WeaponParse -> ProjectileWeaponData.falloff, then
// through projectileFadeAlpha. (getIntegrationGameData pends each spec
// from the beforeEach when the data is absent.)
describe('projectile fade (real Nova data)', () => {
    let fpc: ProjectileWeaponData;
    let railgun: ProjectileWeaponData;
    let nonFading: ProjectileWeaponData;

    beforeEach(async () => {
        const gameData = await getIntegrationGameData();
        const f = await gameData.data.Weapon.get('nova:143');
        const r = await gameData.data.Weapon.get('nova:156'); // Fixed Railgun 100mm
        const n = await gameData.data.Weapon.get('nova:128'); // Light Blaster
        expect(f.type).toEqual('ProjectileWeaponData');
        expect(r.type).toEqual('ProjectileWeaponData');
        expect(n.type).toEqual('ProjectileWeaponData');
        fpc = f as ProjectileWeaponData;
        railgun = r as ProjectileWeaponData;
        nonFading = n as ProjectileWeaponData;
    });

    it('grounds the weapons and their falloff values', () => {
        // Guards: if these ids ever stop being the intended weapons, the
        // name checks fail loudly instead of asserting a wrong falloff.
        expect(fpc.name).toEqual('Fusion Pulse Cannon');
        expect(railgun.name).toEqual('Fixed Railgun (100mm)');
        expect(nonFading.name).toEqual('Light Blaster');

        // The user's suspicion is right: graphical fade is NOT damage
        // decay. The FPC and railguns carry a Falloff field that the
        // non-fading Light Blaster does not.
        expect(fpc.falloff).toEqual(2);
        expect(railgun.falloff).toEqual(2);
        expect(nonFading.falloff).toEqual(0);

        // Falloff is distinct from Decay: e.g. Wraithii (nova:145) decays
        // but does not fade. Here the Light Blaster simply has neither.
        expect(fpc.decay).toEqual(25); // damage decay, not opacity.
    });

    it('fades the Fusion Pulse Cannon over 16 frames from 32 before its end',
        () => {
        // falloff 2 -> 32/2 = 16 frames of fade. FPC life is 50 frames.
        const fadeFrames = falloffFadeFrames(fpc.falloff);
        expect(fadeFrames).toEqual(16);
        const lifeFrames = fpc.shotDuration / FRAME_MS;
        expect(lifeFrames).toBeCloseTo(50, 6);

        const fadeMs = fadeFrames * FRAME_MS;
        const fadeStart = fpc.shotDuration - 32 * FRAME_MS;

        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration, 0)).toEqual(1);
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration, fadeStart))
            .toBeCloseTo(1, 6);
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration,
            fadeStart + fadeMs / 2)).toBeCloseTo(0.5, 6);
        // Invisible for the last 16 frames.
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration,
            fpc.shotDuration - 15 * FRAME_MS)).toEqual(0);
    });

    it('fades the railgun the same way (longer life, same window)', () => {
        expect(falloffFadeFrames(railgun.falloff)).toEqual(16);
        const lifeFrames = railgun.shotDuration / FRAME_MS;
        expect(lifeFrames).toBeCloseTo(110, 6);

        const fadeMs = 16 * FRAME_MS;
        const fadeStart = railgun.shotDuration - 32 * FRAME_MS;
        // Opaque for the first 78 frames, then fades.
        expect(projectileFadeAlpha(railgun.falloff, railgun.shotDuration,
            fadeStart - FRAME_MS)).toEqual(1);
        expect(projectileFadeAlpha(railgun.falloff, railgun.shotDuration,
            fadeStart + fadeMs / 2)).toBeCloseTo(0.5, 6);
        expect(projectileFadeAlpha(railgun.falloff, railgun.shotDuration,
            railgun.shotDuration)).toEqual(0);
    });

    it('renders the non-fading Light Blaster at full alpha for its whole life', () => {
        // falloff 0 -> no fade, exactly as before this feature existed.
        expect(projectileFadeAlpha(nonFading.falloff, nonFading.shotDuration, 0))
            .toEqual(1);
        expect(projectileFadeAlpha(nonFading.falloff, nonFading.shotDuration,
            nonFading.shotDuration)).toEqual(1);
    });
});

// Just the pieces ProjectileFadeSystem touches.
function fakeGraphic() {
    const container = new PIXI.Container();
    const pixiSprite = new PIXI.Sprite();
    container.addChild(pixiSprite);
    const graphic = {
        container,
        sprites: new Map([['baseImage', { pixiSprite }]]),
    };
    return graphic as unknown as AnimationGraphic;
}

function spriteAlpha(graphic: AnimationGraphic): number {
    return graphic.sprites.get('baseImage')!.pixiSprite.alpha;
}

describe('ProjectileFadeSystem', () => {
    /**
     * A world whose mirrored simulation clock reads `simTimeMs`, with one
     * projectile fired at `createTime` (both sim-clock ms) carrying the
     * given falloff / shotDuration.
     */
    function fadeWorld(simTimeMs: number, createTime: number,
        falloff: number, shotDurationMs: number) {
        const world = new World('projectile-fade-test');
        world.resources.set(SimulationTimeResource,
            { ...defaultSimulationTime(), time: simTimeMs });
        world.addSystem(ProjectileFadeSystem);
        const graphic = fakeGraphic();
        const projectile = new Entity('shot')
            .addComponent(ProjectileComponent, { id: 'nova:143' })
            .addComponent(ProjectileDataComponent,
                fadeProjectileData(falloff, shotDurationMs))
            .addComponent(AnimationGraphicComponent, graphic)
            .addComponent(CreateTime, createTime);
        world.entities.set('shot', projectile);
        return { world, graphic };
    }

    it('renders a fresh projectile at full alpha', () => {
        const FALLOFF = 2;
        const SHOT_MS = 50 * FRAME_MS;
        const { world, graphic } = fadeWorld(0, 0, FALLOFF, SHOT_MS);
        world.step();
        expect(spriteAlpha(graphic)).toEqual(1);
    });

    it('fades across the window from the mirrored sim clock', () => {
        const FALLOFF = 2;
        const SHOT_MS = 50 * FRAME_MS;
        const FADE_MS = 16 * FRAME_MS;
        const fadeStart = SHOT_MS - 32 * FRAME_MS;
        // createTime 1000, sim time 1000 + (fadeStart + FADE_MS/2)
        // -> elapsed = fadeStart + FADE_MS/2 -> alpha 0.5.
        const createTime = 1000;
        const simTime = createTime + fadeStart + FADE_MS / 2;
        const { world, graphic } = fadeWorld(simTime, createTime, FALLOFF, SHOT_MS);
        world.step();
        expect(spriteAlpha(graphic)).toBeCloseTo(0.5, 6);
        // The container alpha belongs to MurkFadeSystem; the life-fade must
        // not touch it.
        expect(graphic.container.alpha).toEqual(1);
    });

    it('is fully transparent at expiry', () => {
        const FALLOFF = 2;
        const SHOT_MS = 50 * FRAME_MS;
        const { world, graphic } = fadeWorld(SHOT_MS, 0, FALLOFF, SHOT_MS);
        world.step();
        expect(spriteAlpha(graphic)).toEqual(0);
        expect(graphic.container.alpha).toEqual(1);
    });

    it('leaves a falloff-0 projectile at full alpha (no fade)', () => {
        const SHOT_MS = 50 * FRAME_MS;
        // Well past the (nonexistent) window: still opaque.
        const { world, graphic } = fadeWorld(SHOT_MS, 0, 0, SHOT_MS);
        world.step();
        expect(spriteAlpha(graphic)).toEqual(1);
    });
});

/**
 * The tests above hand ProjectileFadeSystem an entity that already
 * carries CreateTime. In the real game nothing does that: display
 * entities are MIRRORED from the simulation world, and only
 * serializer-registered components survive that trip
 * (SimulationBridgeHost.snapshot skips the rest, silently). CreateTime
 * was not registered, so live shots reached the display world without a
 * ProjectileFireTime, ProjectileFadeSystem's query matched nothing, and
 * every fading weapon rendered at alpha 1 for its whole flight and
 * popped out at expiry — with all the unit tests above passing.
 *
 * These tests pin that wiring instead of the arithmetic.
 */
describe('projectile fade sim -> display wiring', () => {
    let simWorld: World;
    let serializer: Serializer;

    beforeAll(async () => {
        const gameData = await getSyntheticGameData();
        const ids = await gameData.ids;
        const systemId = [...ids.System].sort()[0]!;
        // A real simulation world, built the way every simulating
        // context builds one (browser worker, server archive, tests).
        simWorld = await makeSystem(systemId, gameData, undefined,
            { npcs: false });
        serializer = simWorld.resources.get(SerializerResource)!;
    });

    it('registers CreateTime with the simulation serializer', () => {
        // Without this, the component never enters a simulation frame.
        expect(serializer).toBeDefined();
        expect(serializer.hasComponent(CreateTime as UnknownComponent))
            .toBeTrue();
    });

    it('encodes ProjectileFireTime into a mirrored projectile', () => {
        const shot = new Entity('projectile')
            .addComponent(ProjectileComponent,
                { id: SYNTHETIC.weapons.blaster })
            .addComponent(CreateTime, 1234);
        const encoded = serializer.encode(shot) as EncodedEntity;
        const names = encoded.components.map(([name]) => name);
        // 'ProjectileFireTime' is CreateTime's wire name.
        expect(names).toContain('ProjectileFireTime');
    });

    // STAYS ON REAL DATA: the fade needs a weapon with a NON-ZERO wëap
    // Falloff, and the synthetic scenario has none (its only falloff
    // values are the beams' corona falloff, a different field). The
    // serializer above is the synthetic world's, which is what makes
    // this an `it`-level gate rather than a suite-level one — and why
    // the decode below needs a STOCK world's serializer: ProjectileData
    // crosses the wire as a reference resolved against the receiving
    // world's own Weapon data (#225), which for the synthetic world
    // holds no nova:156.
    it('fades a projectile rebuilt from the wire, as the mirror builds it',
        async () => {
            requireNovaData();
            const gameData = await getIntegrationGameData();
            const railgun = await gameData.data.Weapon.get('nova:156');
            expect(railgun.type).toEqual('ProjectileWeaponData');
            const data = railgun as ProjectileWeaponData;
            const stockWorld = await makeSystem(
                [...(await gameData.ids).System].sort()[0]!, gameData, undefined,
                { npcs: false });
            const stockSerializer = stockWorld.resources.get(SerializerResource)!;

            // Encode a projectile in the simulation world, then decode it
            // exactly as browser.ts's syncEntityToDisplay does (the
            // Weapon.get above is the staging step). Anything the
            // serializer drops is simply absent here, so a regression
            // that unregisters CreateTime fails this test.
            const simShot = new Entity('projectile')
                .addComponent(ProjectileComponent, { id: 'nova:156' })
                .addComponent(ProjectileDataComponent, data)
                .addComponent(CreateTime, 1000);
            const decoded = stockSerializer.decode(stockSerializer.encode(simShot));
            expect(isLeft(decoded)).toBeFalse();
            if (isLeft(decoded)) {
                return;
            }
            const displayShot = decoded.right;

            // AnimationGraphic is display-local: the graphic provider adds
            // it on top of the mirrored components.
            const graphic = fakeGraphic();
            displayShot.components.set(AnimationGraphicComponent, graphic);

            const fadeMs = falloffFadeFrames(data.falloff) * FRAME_MS;
            // Halfway through the fade, which starts 32 frames before
            // the end -> alpha 0.5.
            const simTime = 1000 + data.shotDuration
                - FALLOFF_BASE_FADE_FRAMES * FRAME_MS + fadeMs / 2;
            const displayWorld = new World('mirror-fade-test');
            displayWorld.resources.set(SimulationTimeResource,
                { ...defaultSimulationTime(), time: simTime });
            displayWorld.addSystem(ProjectileFadeSystem);
            displayWorld.entities.set('shot', displayShot);
            displayWorld.step();

            expect(spriteAlpha(graphic)).toBeCloseTo(0.5, 6);
        });
});
