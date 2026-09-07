import { Entities } from "nova_ecs/arg_types";
import { Plugin } from "nova_ecs/plugin";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import { v4 } from "uuid";
import { AsteroidBreakEvent, DebrisComponent } from "../nova_plugin/combat/asteroid_plugin.js";
import { DisplayAssetDataResource } from "../nova_plugin/core/game_data_resource.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { makeExplosion, SecondaryExplosionSystem } from "./explosion_plugin.js";
import { defaultSimulationTime, SimulationTimeResource } from "./simulation_time.js";
import { AsteroidBreakParticlesSystem } from "./particles_plugin.js";

/** How long a fading resource-box takes to disappear, ms (sim clock). */
export const DEBRIS_FADE_MS = 3000;
/**
 * Resource-boxes render at the engine-specified sprites' natural size
 * (cargo box spïn 500, mini-asteroids 501-504; the source art is
 * genuinely 8x8 pixels per frame — the rlëD headers declare 8x8,
 * matching the spïn declarations). Playtest-confirmed at natural size.
 * The debris hurtbox radius in asteroid_plugin.ts (DEBRIS_RADIUS)
 * follows this rendered size.
 */
export const DEBRIS_SCALE = 1;

/** Shows a röid's explosion when an asteroid breaks apart. */
const AsteroidExplosionSystem = new System({
    name: 'AsteroidExplosionSystem',
    events: [AsteroidBreakEvent],
    args: [AsteroidBreakEvent, DisplayAssetDataResource, Entities,
        SingletonComponent] as const,
    step(breakEvent, gameData, entities) {
        if (!breakEvent.explosion) {
            return;
        }
        const explosionData =
            gameData.data.Explosion.getCached(breakEvent.explosion);
        if (!explosionData) {
            // Kicked off a background load; the next breakup shows it.
            return;
        }
        entities.set(v4(),
            makeExplosion(explosionData, breakEvent.position));
    },
    // #156 pin (shared: *): among the AsteroidBreakEvent handlers, after the
    // particles.
    after: [AsteroidBreakParticlesSystem],
});

/**
 * Scales and fades resource-boxes. Their tumble is the generic
 * TumbleDrawSystem (see animation_graphic_plugin.ts).
 *
 * DebrisComponent.expires is a SIM-clock timestamp, so the fade must
 * read the mirrored simulation clock: the display world's own
 * TimeResource is wall-clock epoch milliseconds, and subtracting it
 * makes `remaining` hugely negative — clamping the alpha to 0 from
 * birth (the invisible-debris bug).
 *
 * The fade is written to the graphic's child SPRITE alphas, not the
 * container: MurkFadeSystem owns every graphic's container alpha, and
 * PIXI multiplies alpha down the tree, so the murk and expiry fades
 * compose without the two systems fighting over one property.
 */
export const DebrisDrawSystem = new System({
    name: 'DebrisDrawSystem',
    args: [DebrisComponent, AnimationGraphicComponent,
        SimulationTimeResource] as const,
    step(debris, graphic, simTime) {
        graphic.container.scale.set(DEBRIS_SCALE);
        const remaining = debris.expires - simTime.time;
        const fade = Math.max(0, Math.min(1, remaining / DEBRIS_FADE_MS));
        for (const sprite of graphic.sprites.values()) {
            sprite.pixiSprite.alpha = fade;
        }
    },
    // #156 pin (shared: *): AsteroidDisplayPlugin registers after
    // ExplosionPlugin.
    after: [SecondaryExplosionSystem],
});

export const AsteroidDisplayPlugin: Plugin = {
    name: 'AsteroidDisplayPlugin',
    build(world) {
        // applySimulationFrame replaces this with the sim's clock every
        // frame; until the first frame arrives it reads t=0.
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(AsteroidExplosionSystem);
        world.addSystem(DebrisDrawSystem);
    },
    remove(world) {
        world.removeSystem(AsteroidExplosionSystem);
        world.removeSystem(DebrisDrawSystem);
    },
};
