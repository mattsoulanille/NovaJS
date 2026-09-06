import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import { CreateTime } from "../nova_plugin/core/create_time.js";
import { ProjectileComponent, ProjectileDataComponent } from "../nova_plugin/core/projectile_data.js";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";


/**
 * 1 frame = 1/30 sec. The EVN Bible's wëap Falloff field counts in frames
 * ("fade out over the final 32 frames of its life"), and the sim uses the
 * same 30/1000 factor (see decayDamage) to turn ms into frames.
 */
export const FADE_FRAME_MS = 1000 / 30;

/**
 * The anchor scale of the wëap Falloff fade: a Falloff of 1 fades the
 * sprite out over the final this-many frames of the shot's life. The
 * constant comes straight from the EVN Bible (wëap Falloff, Errata note
 * for sprite-based weapons): "setting this field to a value of 1 will
 * cause the sprite to fade out over the final 32 frames of its life."
 */
export const FALLOFF_BASE_FADE_FRAMES = 32;

/**
 * How many frames at the end of a shot's life its sprite fades over, per
 * the wëap Falloff field. Falloff 1 -> 32 frames; "higher values will
 * fade out faster", read as a shorter window: 32 / falloff frames
 * (2 -> 16, 3 -> ~10.7, 16 -> 2). A falloff <= 0 (or NaN/missing) means
 * no fade and returns 0.
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
 * RULE (engine-plausible reading, documented): the shot is fully opaque
 * (alpha 1) until the final `32 / falloff` frames of its life, then fades
 * LINEARLY to 0 right as the shot expires. Equivalently:
 *
 *     alpha = clamp((shotDurationMs - elapsedMs) / fadeMs, 0, 1)
 *     where fadeMs = (32 / falloff) * FADE_FRAME_MS
 *
 * This is the simplest reading of the Bible's wording ("fade out over the
 * final 32 frames of its life. Higher values will fade out faster"): the
 * fade window is `32 / falloff` frames anchored at the END of life, and
 * the alpha is the fraction of that window remaining. The Bible does not
 * state the alpha CURVE (linear vs eased), so linear is the defensible
 * default. If the fade window is longer than the shot's whole life (a
 * very short-lived shot with a small falloff), the clamp leaves the shot
 * starting part-faded and reaching 0 at expiry — the literal result of
 * the formula, and the behaviour of the simplest engine implementation
 * (no special-cased window start). All stock fading weapons have a window
 * far shorter than their life (Fusion Pulse Cannon: falloff 2, 50-frame
 * life -> 16-frame window; railguns: falloff 2, 100-180-frame life), so
 * this edge case does not arise in practice.
 *
 * `falloff <= 0` (or NaN/missing) means NO FADE: always 1, so weapons
 * without the field render exactly as before. A non-positive
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
    const remainingMs = shotDurationMs - elapsedMs;
    const alpha = remainingMs / fadeMs;
    return Math.max(0, Math.min(1, alpha));
}

/**
 * Fades projectile sprites to transparency over the final `32 / falloff`
 * frames of their flight, per the wëap Falloff field (see
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
    after: [ObjectDrawSystem],
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
