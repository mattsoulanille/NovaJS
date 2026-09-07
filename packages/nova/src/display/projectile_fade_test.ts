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
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { novaDataInstalled, requireNovaData } from '../test_support/nova_data_gate.js';
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
    // A 50-frame life (Fusion Pulse Cannon) with falloff 2 -> 16-frame fade
    // window. fadeMs = 16 * (1000/30); shotDuration = 50 * (1000/30).
    const FALLOFF = 2;
    const SHOT_MS = 50 * FRAME_MS;
    const FADE_MS = 16 * FRAME_MS; // 32 / falloff frames

    it('is fully opaque (1) for the whole flight when falloff is 0', () => {
        // Weapons without the field render exactly as before.
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

    it('stays at full alpha until the final fade window begins', () => {
        // One frame before the window: still opaque.
        const fadeStart = SHOT_MS - FADE_MS;
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, fadeStart - FRAME_MS))
            .toEqual(1);
        // Exactly at the window start: opaque (remaining == fadeMs). The
        // value is 1 up to float round-off from the two subtractions, so
        // compare with tolerance — the difference is ~1e-16, invisible.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, fadeStart))
            .toBeCloseTo(1, 6);
    });

    it('fades linearly to 0 across the final window', () => {
        const fadeStart = SHOT_MS - FADE_MS;
        // Halfway through the window: alpha 0.5.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, fadeStart + FADE_MS / 2))
            .toBeCloseTo(0.5, 6);
        // A quarter through: alpha 0.75.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, fadeStart + FADE_MS / 4))
            .toBeCloseTo(0.75, 6);
        // Three quarters through: alpha 0.25.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, fadeStart + 3 * FADE_MS / 4))
            .toBeCloseTo(0.25, 6);
    });

    it('reaches 0 exactly at expiry and stays 0 past it', () => {
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS)).toEqual(0);
        // A display frame lagging past expiry clamps to 0 (never negative).
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS + 1000)).toEqual(0);
    });

    it('never exceeds 1 or drops below 0 (clamping)', () => {
        // Before birth (defensive): clamps to 1.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, -1000)).toEqual(1);
        // Well past expiry: clamps to 0.
        expect(projectileFadeAlpha(FALLOFF, SHOT_MS, SHOT_MS + 1e6)).toEqual(0);
    });

    it('is monotonic non-increasing over the whole flight', () => {
        // Sample every frame and assert the alpha never increases.
        let prev = 2;
        for (let f = 0; f <= 60; f++) {
            const a = projectileFadeAlpha(FALLOFF, SHOT_MS, f * FRAME_MS);
            expect(a).toBeLessThanOrEqual(prev + 1e-9);
            prev = a;
        }
        expect(prev).toEqual(0); // ends transparent.
    });

    it('fades faster (steeper drop) for higher falloff, same expiry', () => {
        // "Higher values fade out faster" = the 1->0 sweep is steeper
        // (completes in fewer frames), NOT "more faded at a fixed time
        // before expiry": both windows anchor at expiry, so a higher
        // falloff starts its (shorter) window LATER. Assert the per-frame
        // alpha drop inside the window is larger for falloff 3 than 2,
        // and that both reach 0 at the same expiry.
        const dropPerFrame = (falloff: number) => {
            const fadeMs = falloffFadeFrames(falloff) * FRAME_MS;
            const mid = SHOT_MS - fadeMs / 2; // middle of this window
            return projectileFadeAlpha(falloff, SHOT_MS, mid)
                - projectileFadeAlpha(falloff, SHOT_MS, mid + FRAME_MS);
        };
        expect(dropPerFrame(3)).toBeGreaterThan(dropPerFrame(2));
        // Both are opaque at birth and transparent at the same expiry.
        expect(projectileFadeAlpha(2, SHOT_MS, 0)).toEqual(1);
        expect(projectileFadeAlpha(3, SHOT_MS, 0)).toEqual(1);
        expect(projectileFadeAlpha(2, SHOT_MS, SHOT_MS)).toEqual(0);
        expect(projectileFadeAlpha(3, SHOT_MS, SHOT_MS)).toEqual(0);
        // Higher falloff starts fading later: at 13 frames before expiry,
        // falloff 2 (16-frame window) is already fading, falloff 3
        // (10.67-frame window) is still opaque.
        const elapsed = SHOT_MS - 13 * FRAME_MS;
        expect(projectileFadeAlpha(2, SHOT_MS, elapsed)).toBeLessThan(1);
        expect(projectileFadeAlpha(3, SHOT_MS, elapsed)).toEqual(1);
    });

    it('returns 1 (no fade) for a non-positive shot duration', () => {
        // A degenerate life can't anchor a tail fade; avoid divide-by-zero
        // / NaN.
        expect(projectileFadeAlpha(2, 0, 0)).toEqual(1);
        expect(projectileFadeAlpha(2, -100, 50)).toEqual(1);
    });
});

// Pin the fade curve on the real Fusion Pulse Cannon and a real railgun —
// the stock weapons the user reports fading. Runs against the real Nova
// game data (Nova_Data): wëap -> WeaponParse -> ProjectileWeaponData.falloff,
// then through projectileFadeAlpha.
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

    it('fades the Fusion Pulse Cannon over its final 16 frames', () => {
        // falloff 2 -> 32/2 = 16-frame window. FPC life is 50 frames.
        const fadeFrames = falloffFadeFrames(fpc.falloff);
        expect(fadeFrames).toEqual(16);
        const lifeFrames = fpc.shotDuration / FRAME_MS;
        expect(lifeFrames).toBeCloseTo(50, 6);

        const fadeMs = fadeFrames * FRAME_MS;
        const fadeStart = fpc.shotDuration - fadeMs;

        // Opaque at birth and right up to the window.
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration, 0)).toEqual(1);
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration, fadeStart))
            .toBeCloseTo(1, 6);
        // Half-faded at the window midpoint.
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration,
            fadeStart + fadeMs / 2)).toBeCloseTo(0.5, 6);
        // Transparent at expiry.
        expect(projectileFadeAlpha(fpc.falloff, fpc.shotDuration,
            fpc.shotDuration)).toEqual(0);
    });

    it('fades the railgun over its final 16 frames too (longer life, same window)', () => {
        // falloff 2 -> same 16-frame window as the FPC, but the railgun
        // lives 110 frames, so it stays opaque much longer.
        expect(falloffFadeFrames(railgun.falloff)).toEqual(16);
        const lifeFrames = railgun.shotDuration / FRAME_MS;
        expect(lifeFrames).toBeCloseTo(110, 6);

        const fadeMs = 16 * FRAME_MS;
        const fadeStart = railgun.shotDuration - fadeMs;
        // Opaque for the first ~94 frames, then fades.
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

    it('fades across the final window from the mirrored sim clock', () => {
        const FALLOFF = 2;
        const SHOT_MS = 50 * FRAME_MS;
        const FADE_MS = 16 * FRAME_MS;
        const fadeStart = SHOT_MS - FADE_MS;
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

    beforeEach(requireNovaData);
    beforeAll(async () => {
        if (!novaDataInstalled()) return; // each spec pends instead
        const gameData = await getIntegrationGameData();
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
            .addComponent(ProjectileComponent, { id: 'nova:156' })
            .addComponent(CreateTime, 1234);
        const encoded = serializer.encode(shot) as EncodedEntity;
        const names = encoded.components.map(([name]) => name);
        // 'ProjectileFireTime' is CreateTime's wire name.
        expect(names).toContain('ProjectileFireTime');
    });

    it('fades a projectile rebuilt from the wire, as the mirror builds it',
        async () => {
            const gameData = await getIntegrationGameData();
            const railgun = await gameData.data.Weapon.get('nova:156');
            expect(railgun.type).toEqual('ProjectileWeaponData');
            const data = railgun as ProjectileWeaponData;

            // Encode a projectile in the simulation world, then decode it
            // exactly as browser.ts's syncEntityToDisplay does. Anything
            // the serializer drops is simply absent here, so a
            // regression that unregisters CreateTime fails this test.
            const simShot = new Entity('projectile')
                .addComponent(ProjectileComponent, { id: 'nova:156' })
                .addComponent(ProjectileDataComponent, data)
                .addComponent(CreateTime, 1000);
            const decoded = serializer.decode(serializer.encode(simShot));
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
            // Halfway through the fade window -> alpha 0.5.
            const simTime = 1000 + data.shotDuration - fadeMs / 2;
            const displayWorld = new World('mirror-fade-test');
            displayWorld.resources.set(SimulationTimeResource,
                { ...defaultSimulationTime(), time: simTime });
            displayWorld.addSystem(ProjectileFadeSystem);
            displayWorld.entities.set('shot', displayShot);
            displayWorld.step();

            expect(spriteAlpha(graphic)).toBeCloseTo(0.5, 6);
        });
});
