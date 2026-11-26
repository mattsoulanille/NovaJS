import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import {
    CreateTime, ProjectileComponent, ProjectileDataComponent,
} from '../nova_plugin/core/index.js';
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { DrawPlanetCornersSystem } from "./planet_corners_plugin.js";


/**
 * 1 frame = 1/30 sec. The EVN Bible's wëap Falloff field counts in frames
 * ("fade out over the final 32 frames of its life"), and the sim uses the
 * same 30/1000 factor (see decayDamage) to turn ms into frames.
 */
export const FADE_FRAME_MS = 1000 / 30;

/**
 * The anchor scale of the wëap Falloff fade: every fading sprite starts
 * to fade this many frames before the end of the shot's life, and a
 * Falloff of 1 takes all of them to fade out. The
 * constant comes straight from the EVN Bible (wëap Falloff, Errata note
 * for sprite-based weapons): "setting this field to a value of 1 will
 * cause the sprite to fade out over the final 32 frames of its life."
 */
export const FALLOFF_BASE_FADE_FRAMES = 32;

/**
 * How many frames a shot's sprite takes to fade out, per the wëap Falloff
 * field: 32 / falloff (1 -> 32, 2 -> 16, 3 -> ~10.7, 16 -> 2). The fade
 * always STARTS FALLOFF_BASE_FADE_FRAMES before the end of the shot's
 * life (projectileFadeAlpha), so a higher falloff finishes earlier. A
 * falloff <= 0 (or NaN/missing) means no fade and returns 0.
 *
 * `!(falloff > 0)` rather than `falloff <= 0` so a missing/NaN falloff
 * — e.g. a deserialized snapshot from before this field existed, which
 * the ProjectileData passthrough codec would not catch — falls back to
 * "no fade" instead of propagating NaN into the alpha math.
 */
export function falloffFadeFrames(falloff: number): number {
    if (!(falloff > 0)) {
        return 0;
    }
    return FALLOFF_BASE_FADE_FRAMES / falloff;
}

/**
 * Projectile sprite alpha in [0, 1] at a given point in a shot's flight,
 * per the wëap Falloff field.
 *
 * MEASURED (reference "Beam decay and projectile fade (E10), wave 40"):
 * the fade STARTS 32 frames before the end of the shot's life whatever
 * the Falloff, and runs Falloff times faster, so it is over 32 / falloff
 * frames after it starts:
 *
 *     alpha = clamp(1 - (elapsedMs - fadeStartMs) / fadeMs, 0, 1)
 *     where fadeStartMs = shotDurationMs - 32 * FADE_FRAME_MS
 *     and   fadeMs      = (32 / falloff) * FADE_FRAME_MS
 *
 * A Count-90 bolt with Falloff 1 faded over its last ~16 visible frames
 * and was gone by ~80; with Falloff 4 it was gone by ~64, about 24 frames
 * before its Count (a fade over the LAST 32 / falloff frames would have
 * kept it bright to about 87). Falloff 1 is the Bible's "fade out over
 * the final 32 frames of its life"; the curve is linear (GUESS; the
 * reading was a pixel threshold). The shot itself still lives to its
 * Count: only its sprite is gone. A shot shorter-lived than 32 frames
 * starts part-faded, the formula's literal result.
 *
 * `falloff <= 0` (or NaN/missing) means NO FADE: always 1 (matches the
 * original's Falloff 0, which blinked out at its Count). A non-positive
 * `shotDurationMs` is degenerate and also returns 1 (no meaningful life
 * to anchor a fade to) rather than divide-by-zero / produce NaN.
 *
 * Determinism: a pure function of its arguments — only arithmetic and
 * clamp, no randomness, no trig, no wall-clock. `elapsedMs` is the shot's
 * sim flight time (`SimulationTimeResource.time - CreateTime`), mirrored
 * into the display world, so every peer's display computes the identical
 * alpha for the same flight time.
 */
export function projectileFadeAlpha(falloff: number, shotDurationMs: number,
    elapsedMs: number): number {
    const fadeFrames = falloffFadeFrames(falloff);
    if (fadeFrames <= 0) {
        return 1; // No fade: full alpha for the whole flight.
    }
    if (!(shotDurationMs > 0)) {
        return 1; // Degenerate life: no meaningful fade.
    }
    const fadeMs = fadeFrames * FADE_FRAME_MS;
    const fadeStartMs = shotDurationMs
        - FALLOFF_BASE_FADE_FRAMES * FADE_FRAME_MS;
    const alpha = 1 - (elapsedMs - fadeStartMs) / fadeMs;
    return Math.max(0, Math.min(1, alpha));
}

/**
 * Fades projectile sprites to transparency from 32 frames before the end
 * of their flight, over `32 / falloff` frames, per the wëap Falloff field
 * (see
 * {@link projectileFadeAlpha}).
 *
 * Determinism / time source: the fade compares the shot's synced
 * `CreateTime` (a sim-clock timestamp) against the display world's
 * MIRRORED sim clock (`SimulationTimeResource`), NOT the display's own
 * `TimeResource` — that one is wall-clock epoch milliseconds for smooth
 * rendering, and subtracting it from a sim timestamp is off by ~50 years
 * (see simulation_time.ts and the DebrisDrawSystem regression). So the
 * fade is a pure function of sim flight time on every peer.
 *
 * Alpha target: the graphic's CHILD sprite alphas, not `container.alpha`.
 * `MurkFadeSystem` owns every graphic's container alpha (the per-system
 * nebula distance fade), and PIXI multiplies alpha down the display tree,
 * so the life-fade and the murk fade compose without the two systems
 * fighting over one property — the same pattern DebrisDrawSystem uses for
 * resource-box expiry. A projectile graphic only carries its `baseImage`
 * sprite, but writing every sprite matches the debris pattern and is
 * future-proof. Runs after `ObjectDrawSystem` for draw-phase ordering
 * (consistent with TumbleDrawSystem / ShipBaseSetAnimationSystem); the
 * `after` edge is a harmless dangling edge in worlds without it.
 */
export const ProjectileFadeSystem = new System({
    name: 'ProjectileFadeSystem',
    args: [ProjectileComponent, ProjectileDataComponent,
        AnimationGraphicComponent, CreateTime,
        SimulationTimeResource] as const,
    step(_projectile, projectileData, graphic, createTime, simTime) {
        const alpha = projectileFadeAlpha(projectileData.falloff,
            projectileData.shotDuration, simTime.time - createTime);
        for (const sprite of graphic.sprites.values()) {
            sprite.pixiSprite.alpha = alpha;
        }
    },
    // DrawPlanetCornersSystem is a #156 pin (shared: *): ProjectileFadePlugin
    // registers after PlanetCornersPlugin.
    after: [ObjectDrawSystem, DrawPlanetCornersSystem],
});

export const ProjectileFadePlugin: Plugin = {
    name: 'ProjectileFadePlugin',
    build(world) {
        // applySimulationFrame overwrites this with the sim's clock every
        // frame; until the first frame arrives the fade reads t=0 (a
        // fresh shot's elapsed is ~0, so alpha is 1 — no visible glitch).
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(ProjectileFadeSystem);
    },
    remove(world) {
        world.removeSystem(ProjectileFadeSystem);
    }
};
