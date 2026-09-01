import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { Query } from "nova_ecs/query";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { OutfitsState, OutfitsStateComponent, sumOutfitField } from "../nova_plugin/outfit_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import { SystemIdResource } from "../nova_plugin/system_id_resource.js";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { PixiAppResource } from "./pixi_app_resource.js";
import { StarfieldResource } from "./starfield_plugin.js";
import { WorldLayer } from "./stage_resource.js";

/**
 * Per-system visual environment: background colour and murk.
 *
 * Both are static per-system data (from the sÿst resource), read here
 * display-side so they never touch the deterministic simulation. See the
 * EVN Bible's sÿst docs for the semantics:
 *  - Background colour renders behind the starfield (black if zero).
 *  - Murk (0-100) is dust obscuring the view. Each space object fades into
 *    the background colour with distance from the player's ship (murk
 *    controls how aggressive that falloff is), the starfield dims with murk
 *    (deeper parallax layers more), and a subtle background-coloured haze
 *    overlays the scene. A negative murk value is treated as zero murk but
 *    also hides the starfield.
 */

/** How murk is currently being applied, and the hook outfits use to modify it. */
export interface MurkState {
    /** The system's base murk (0-100), straight from the sÿst resource. */
    readonly systemMurk: number;
    /**
     * Amount of murk removed by outfits (the "murk modifier" outfit
     * modifier, EVN Bible / ResForge outf case 28: "the amount by which to
     * increase or decrease the current system's murkiness level"). Positive
     * clears murk (extending how far the player can see); negative deepens
     * it. The effective murk is clamped to 0-100. Defaults to 0; an outfit
     * hook can change it.
     */
    murkReduction: number;
}

export const MurkResource = new Resource<MurkState>('Murk');

/** The effective murk after outfit reductions, clamped to 0-100. */
export function effectiveMurk(murk: MurkState): number {
    return Math.max(0, Math.min(100, murk.systemMurk - murk.murkReduction));
}

/**
 * The distance (in Nova pixels) beyond which objects vanish entirely under
 * full (100) murk. Lower murk scales this range up proportionally.
 * (Playtesting judged the original 300 too weak by 2-3x.)
 */
export const FULL_MURK_VANISH_DISTANCE = 120;

/**
 * How much of an object murk leaves visible at a given distance from the
 * player's ship, as an alpha in [0, 1].
 *
 * Objects vanish completely at
 *     vanish = FULL_MURK_VANISH_DISTANCE * (100 / murk)
 * so the vanishing range is inversely proportional to the effective murk
 * (murk 100 -> 120px, murk 50 -> 240px, murk -> 0 -> unbounded). The nearer
 * half of that range renders fully; alpha then falls linearly to zero across
 * the outer half:
 *     alpha = 1                             for d <= vanish / 2
 *     alpha = (vanish - d) / (vanish / 2)   for vanish / 2 < d < vanish
 *     alpha = 0                             for d >= vanish
 *
 * Because the renderer background is already the system's background colour,
 * fading alpha toward zero blends the object into that colour with no
 * per-pixel tint math. Murk-clearing outfits (murkReduction) lower the
 * effective murk, which extends the vanishing range and softens the falloff.
 */
export function murkAlpha(distance: number, murk: MurkState): number {
    const m = effectiveMurk(murk);
    if (m <= 0) {
        return 1;
    }
    const vanish = FULL_MURK_VANISH_DISTANCE * (100 / m);
    const clear = vanish / 2;
    if (distance <= clear) {
        return 1;
    }
    if (distance >= vanish) {
        return 0;
    }
    return (vanish - distance) / (vanish - clear);
}

/**
 * How much dimming murk applies to the shallowest stars (parallax factor 0)
 * at murk 100.
 */
const STAR_DIM_SHALLOW = 0.4;
/** Additional dimming per unit of parallax factor: deeper stars fade more. */
const STAR_DIM_PER_FACTOR = 0.8;

/**
 * How much of a star murk leaves visible, as an alpha in [0, 1]. Stars dim
 * with murk — without that, distant ships fading out while the stars stay
 * crisp reads as cloaking rather than as dust — and stars with a higher
 * parallax factor read as deeper in the background, so they fade more:
 *     alpha = 1 - (murk / 100) * (0.4 + 0.8 * factor)
 * Unlike ships, the starfield stays visible PAST the murk (the real engine
 * shows stars through it): even at murk 100 the shallowest stars keep alpha
 * 0.6 and the deepest (factor 0.5) keep 0.2.
 */
export function starfieldMurkAlpha(factor: number, murk: MurkState): number {
    const m = effectiveMurk(murk);
    return Math.max(0,
        1 - (m / 100) * (STAR_DIM_SHALLOW + STAR_DIM_PER_FACTOR * factor));
}

/**
 * The strongest alpha of the ambient haze overlay: a background-coloured
 * sheet over the whole scene whose alpha is murk / 100 * this. It supplies
 * the "there's dust here" atmosphere; the per-object distance fade does the
 * gameplay-relevant hiding.
 */
export const AMBIENT_HAZE_MAX_ALPHA = 0.3;

/**
 * Larger than any realistic viewport, so the ambient haze never needs
 * resizing.
 */
const HAZE_SIZE = 16384;

/** The ambient haze overlay. Module-private: not part of the murk API. */
const MurkHazeResource = new Resource<PIXI.Graphics>('MurkHaze');

const PlayerPositionQuery =
    new Query([MovementStateComponent, PlayerShipSelector] as const);

/**
 * Fades each space object into the background colour based on its distance
 * from the player's ship. The player's own ship is at distance zero, so it
 * always renders fully. Runs every frame after ObjectDrawSystem so pooled
 * graphics reacquired by new entities pick up the right alpha immediately.
 *
 * Alpha ownership: this system owns every graphic's CONTAINER alpha.
 * Systems that fade specific entities further (e.g. DebrisDrawSystem)
 * write the child sprite alphas instead; PIXI multiplies alpha down
 * the tree, so the effects compose without two systems fighting over
 * one property.
 */
export const MurkFadeSystem = new System({
    name: 'MurkFadeSystem',
    args: [MurkResource, AnimationGraphicComponent, MovementStateComponent,
        PlayerPositionQuery] as const,
    step(murk, graphic, movementState, players) {
        const player = players[0];
        if (!player) {
            graphic.container.alpha = 1;
            return;
        }
        const [{ position: playerPosition }] = player;
        const distance = movementState.position
            .subtract(playerPosition).length;
        graphic.container.alpha = murkAlpha(distance, murk);
    },
    after: [ObjectDrawSystem],
});

/** The effective murk each starfield was last dimmed for. */
const appliedStarfieldMurk = new WeakMap<object, number>();

/**
 * Keeps the ambient haze and starfield dimming in sync with the effective
 * murk, so murk-modifier outfits (murkReduction) take effect immediately.
 * The starfield's stars are only re-dimmed when the effective murk actually
 * changes, since that touches every star sprite.
 */
const MurkAmbienceSystem = new System({
    name: 'MurkAmbienceSystem',
    args: [MurkResource, MurkHazeResource, Optional(StarfieldResource),
        PlayerShipSelector] as const,
    step(murk, haze, starfield) {
        const m = effectiveMurk(murk);
        haze.alpha = (m / 100) * AMBIENT_HAZE_MAX_ALPHA;
        if (starfield && starfield.container.visible &&
            appliedStarfieldMurk.get(starfield) !== m) {
            appliedStarfieldMurk.set(starfield, m);
            starfield.dim(factor => starfieldMurkAlpha(factor, murk));
        }
    }
});

/**
 * Feeds the murk-modifier outfits (oütf ModType 28) into the murk display:
 * sums the player ship's owned outfits' murkClear and writes it to
 * MurkResource.murkReduction. Display-only — murk never touches the
 * deterministic simulation, so this reads the player's outfits directly here
 * rather than through a synced component. A stock Sensor Boost (nova:203)
 * clears 3 murk; several stack.
 *
 * Runs every frame (cheap: a handful of outfits) so buying/selling a Sensor
 * Boost updates the murk immediately, and MurkAmbienceSystem picks up the new
 * effective murk on the same tick.
 */
export const MurkOutfitSystem = new System({
    name: 'MurkOutfitSystem',
    args: [MurkResource, OutfitsStateComponent, SimulationGameDataResource,
        PlayerShipSelector] as const,
    step(murk, outfits, gameData) {
        const cleared = playerMurkClear(outfits, gameData);
        if (cleared !== undefined) {
            (murk as { murkReduction: number }).murkReduction = cleared;
        }
    },
});

/** Sums murkClear over the player's outfits (undefined until data caches). */
function playerMurkClear(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): number | undefined {
    return sumOutfitField(outfits, gameData, o => o.murkClear);
}

export const SystemEnvironmentPlugin: Plugin = {
    name: 'SystemEnvironment',
    async build(world) {
        const gameData = world.resources.get(SimulationGameDataResource);
        if (!gameData) {
            throw new Error('Expected SimulationGameData resource to exist');
        }
        const systemId = world.resources.get(SystemIdResource);
        if (!systemId) {
            throw new Error('Expected SystemId resource to exist');
        }
        const app = world.resources.get(PixiAppResource);
        if (!app) {
            throw new Error('Expected PIXI App resource to exist');
        }

        const systemData = await gameData.data.System.get(systemId);

        // Background colour: renders behind everything, and is what murk
        // fades objects into. Zero is pure black, which is also PIXI's
        // default, so a normal system looks unchanged.
        app.renderer.background.color = systemData.backgroundColor;

        const murkState: MurkState = {
            systemMurk: Math.max(0, systemData.murk),
            murkReduction: 0,
        };
        world.resources.set(MurkResource, murkState);

        // A negative murk value hides the starfield (Bible: "less than zero
        // is equivalent to zero murk but also hides the starfield").
        // Positive murk dims it: dust obscures the stars too.
        const starfield = world.resources.get(StarfieldResource);
        if (starfield) {
            if (systemData.murk < 0) {
                starfield.container.visible = false;
            } else {
                appliedStarfieldMurk.set(starfield, effectiveMurk(murkState));
                starfield.dim(factor => starfieldMurkAlpha(factor, murkState));
            }
        }

        // The ambient haze: a subtle background-coloured sheet over the whole
        // scene. It goes in the WORLD layer, above the starfield and the
        // ships and below every UI element (the UI layer draws after this
        // one), so the status bar and the dialogs stay unhazed. It sells
        // the dust without hiding anything by itself.
        const worldLayer = world.resources.get(WorldLayer);
        if (worldLayer) {
            const haze = new PIXI.Graphics();
            haze.name = 'MurkHaze';
            haze.beginFill(systemData.backgroundColor, 1);
            haze.drawRect(0, 0, HAZE_SIZE, HAZE_SIZE);
            haze.endFill();
            haze.alpha = (effectiveMurk(murkState) / 100) * AMBIENT_HAZE_MAX_ALPHA;
            worldLayer.addChild(haze);
            world.resources.set(MurkHazeResource, haze);
            world.addSystem(MurkAmbienceSystem);
        }

        world.addSystem(MurkFadeSystem);
        world.addSystem(MurkOutfitSystem);
    },
    remove(world) {
        world.removeSystem(MurkFadeSystem);
        world.removeSystem(MurkOutfitSystem);
        world.removeSystem(MurkAmbienceSystem);

        const app = world.resources.get(PixiAppResource);
        if (app) {
            app.renderer.background.color = 0x000000;
        }

        const starfield = world.resources.get(StarfieldResource);
        if (starfield) {
            starfield.dim(() => 1);
        }

        const worldLayer = world.resources.get(WorldLayer);
        const haze = world.resources.get(MurkHazeResource);
        if (worldLayer && haze) {
            worldLayer.removeChild(haze);
        }
        world.resources.delete(MurkHazeResource);
        world.resources.delete(MurkResource);
    }
};
