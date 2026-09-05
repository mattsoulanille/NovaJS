import { GetEntity, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { ShipAnimationMode } from "novadatainterface/animation";
import { AnimationComponent } from "../nova_plugin/animation_plugin.js";
import { BeamDataComponent } from "../nova_plugin/beam_plugin.js";
import { SourceComponent } from "../nova_plugin/weapon_components.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { CloakActiveComponent, CloakScannerComponent } from "../nova_plugin/cloak_plugin.js";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { FoldStateComponent } from "../nova_plugin/fold_state.js";
import { foldRatePerSecond, moveToward } from "../nova_plugin/fold_state.js";
import { IonizationColorComponent } from "../nova_plugin/health_plugin.js";
import { IsIonizedComponent } from "../nova_plugin/ionization_plugin.js";
import { JumpComponent } from "../nova_plugin/jump_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ShipComponent } from "../nova_plugin/ship_plugin.js";
import { WeaponsStateComponent } from "../nova_plugin/weapons_state.js";
import { AnimationGraphic } from "./animation_graphic.js";
import { AnimationGraphicComponent, ObjectDrawSystem } from "./animation_graphic_plugin.js";
import { blinkPhaseFromUuid, runningLightState } from "./running_light_blink.js";

// How visible a ship is while cloaked. Other ships fade to nearly
// invisible; your own ship stays faintly visible so you can still fly it
// (matching EV Nova, where the player's cloaked ship is a faint ghost).
const CLOAKED_ALPHA_OTHER = 0.0;
const CLOAKED_ALPHA_SELF = 0.25;
// A cloaked ship revealed on screen by the player's cloak scanner shows
// as a faint ghost rather than fully solid.
const CLOAKED_ALPHA_REVEALED = 0.4;
const UNCLOAKED_ALPHA = 1.0;

/**
 * The shän layers that take the ionization colour — the ship's own
 * structure, as opposed to the effects drawn over it.
 *
 * "IonizeColor: the color that a ship hit by this weapon will appear
 * after being sufficiently ionized" (EVN Bible, wëap) — the SHIP, so
 * every layer the hull is actually made of. That is baseImage plus
 * altImage, the always-drawn extra sprite set: the Aurora Thunderforge
 * (shän nova:380) keeps its fore and aft sections in the base image and
 * the entire spinning drum between them in the alt image, and tinting
 * only the base left the middle of an ionized ship its normal colour.
 *
 * The remaining layers are deliberately left alone. glowImage,
 * lightImage and weapImage are ADDITIVE overlays (shan_parse.ts gives
 * them BLEND_MODES.ADD) for the engine flare, running lights and muzzle
 * flash — light emitted by the ship rather than a surface of it, and
 * tinting an additive sprite darkens the light it adds rather than
 * colouring anything. shieldImage is a separate hit effect that is
 * currently never shown at all.
 */
export const IONIZATION_TINTED_LAYERS: readonly string[] =
    ['baseImage', 'altImage'];

const NO_TINT = 0xffffff;

/**
 * The tint for an ionized ship whose IonizationColorComponent never
 * arrived — a wire snapshot or save from before the colour was synced.
 * The grey NovaJS used to paint every ionized ship, kept so legacy state
 * still reads as "ionized" rather than as an untinted ship.
 */
export const LEGACY_IONIZATION_COLOR = 0x888888;

/**
 * Paints the ionization colour over every structural layer of a ship's
 * graphic (or clears it). Takes the sprite map rather than the graphic so
 * it stays testable without a PIXI renderer.
 *
 * The colour is applied as a PIXI multiply TINT, which is what "the ship
 * will appear that color" means for a sprite: each hull pixel keeps its
 * own shading and is multiplied toward the ion colour, so a hull lit by
 * an Ion Cannon goes blue and one lit by a Polaron Torpedo goes magenta
 * while both keep their panel detail. It is also why the Bible warns to
 * use bright colours — a dark IonizeColor multiplies the hull toward
 * black instead of colouring it, and a zero field would black it out
 * entirely (see resolveIonizeColor, which never lets one through).
 *
 * The tint is BINARY, not a ramp. This is a choice, not a limitation:
 * IonizationComponent is delta-registered and so its raw charge does
 * reach the display world, and white->IonizeColor interpolated by
 * charge/threshold would have been available. But the Bible ties the
 * colour to the ship "being sufficiently ionized" — a threshold, which
 * is exactly what IsIonizedComponent already is — and says nothing about
 * fading the hull in as the charge builds. So the hull snaps to colour
 * when the ship crosses into ionization and snaps back when it drops
 * out. Revisit if a capture of the original ever shows a ramp.
 */
export function applyIonizationTint<
    T extends { pixiSprite: { tint: unknown } }>(
        sprites: ReadonlyMap<string, T>, ionized: boolean, color: number) {
    const tint = ionized ? color & 0xFFFFFF : NO_TINT;
    for (const layer of IONIZATION_TINTED_LAYERS) {
        const sprite = sprites.get(layer);
        if (sprite) {
            sprite.pixiSprite.tint = tint;
        }
    }
}

// The local player's cloak scanner, if any. Used to reveal other ships'
// cloaks on screen (scanner ModVal 0x0002).
const PlayerScannerQuery = new Query(
    [PlayerShipSelector, CloakScannerComponent] as const);


// All beams currently being emitted, along with the uuid of the ship that
// fired each one. Used to keep a ship's firing animation on for as long as
// the beam is actually firing, not just while the fire key is held.
//
// This runs in the DISPLAY world, whose entities are mirrored from the
// simulation by SimulationBridgeHost.snapshot() — which carries only
// serializer-registered components. BOTH halves of this query must
// therefore stay serializer-registered (SourceComponent in
// fire_weapon_plugin's build, BeamDataComponent in beam_plugin's), or
// the query silently matches nothing and beam-sustained firing
// animations stop working with no error anywhere. Exported so
// source_component_bridge_test can run it against mirrored entities.
export const ActiveBeamsQuery = new Query(
    [SourceComponent, BeamDataComponent] as const, 'ActiveBeamsQuery');

/**
 * Whether any beam fired by this ship is still being emitted.
 *
 * Beams keep firing (for their shot duration) after the fire key is
 * released, and conversely a beam turret with the trigger held but no
 * target emits NOTHING, so beam glow keys off the beam entities that
 * actually exist rather than off the fire input.
 */
export function beamActiveFor(
    uuid: string,
    activeBeams: Iterable<readonly [string, unknown]>,
): boolean {
    for (const [source] of activeBeams) {
        if (source === uuid) {
            return true;
        }
    }
    return false;
}

/**
 * The simulation time of the most recent shot this ship ACTUALLY emitted
 * from a weapon that drives the glow overlay (wëap Flags2 0x200,
 * `useFiringAnimation`), or undefined if no such weapon has ever fired.
 *
 * Reads WeaponState.lastFired, which WeaponsSystem stamps only on the
 * branch where a shot really spawned — never on held intent. Weapons
 * without the flag are skipped here exactly as they were when this was
 * keyed off `firing`, so a ship whose glow-flagged weapons are all silent
 * stays dark while its other guns fire.
 */
export function latestRealFire(
    weaponStates: Iterable<[string, { lastFired?: number }]>,
    useFiringAnimation: (weaponId: string) => boolean | undefined,
): number | undefined {
    let latest: number | undefined;
    for (const [id, weaponState] of weaponStates) {
        const lastFired = weaponState.lastFired;
        if (lastFired === undefined || !useFiringAnimation(id)) {
            continue;
        }
        if (latest === undefined || lastFired > latest) {
            latest = lastFired;
        }
    }
    return latest;
}

/**
 * Whether the given ship should show its firing animation (weapon image)
 * on THIS display frame.
 *
 * The glow tracks real emission, never the held trigger: a ship shows it
 * while a beam it fired still exists, and for one frame each time a
 * glow-flagged weapon actually emits a shot (`latestRealFire` moved since
 * `lastSeenFire`, the value this graphic observed last frame). Everything
 * in between is the WeapDecay fade, so a projectile weapon PULSES per
 * shot and a held trigger that produces nothing — targetless turret or
 * beam turret, empty point-defense sweep, dry ammo, mid-reload — produces
 * no glow at all.
 *
 * `lastSeenFire` compares with `!==` rather than `>` so a rollback that
 * rewinds the simulation clock still re-arms rather than latching the
 * glow off; the cost is at most one extra frame of glow after a rewind.
 */
export function shouldShowFiringAnimation(
    uuid: string,
    weaponStates: Iterable<[string, { lastFired?: number }]>,
    useFiringAnimation: (weaponId: string) => boolean | undefined,
    activeBeams: Iterable<readonly [string, unknown]>,
    lastSeenFire?: number,
): boolean {
    if (beamActiveFor(uuid, activeBeams)) {
        return true;
    }
    const realFire = latestRealFire(weaponStates, useFiringAnimation);
    return realFire !== undefined && realFire !== lastSeenFire;
}

/** shän animation timings are in 30ths of a second (Bible: AnimDelay "in
 * 30ths of a second"); WeapDecay shares that frame unit. */
const SHAN_FRAMES_PER_SECOND = 30;

/**
 * How much weapon-overlay alpha the shän's WeapDecay burns per second.
 *
 * Bible (shän WeapDecay): "The rate at which the weapon glow sprite fades
 * out to transparency, if applicable. 50 is a good median number - lower
 * numbers yield slower decays." It says nothing about units, but stock
 * values span exactly 0..100 (histogram over all 111 stock shäns with a
 * weapImage: 0x3 3x3 5x35 10x19 25x1 30x9 50x17 75x18 100x6), so it reads
 * as percent of full alpha per animation frame: 100 fades in one frame
 * (~33 ms), the Bible's median 50 in two (~67 ms), and the most common
 * stock value 5 — the Fed Destroyer family, shäns nova:141 and nova:214
 * ("Fed Destroyer; Carrier") — in twenty (~0.67 s). WeapDecay 0 means no
 * fade at all; the overlay snaps off when firing stops (the behaviour
 * before decay existed).
 *
 * NOT the Fed Carrier: shäns nova:143 and nova:218-222 ("Fed Carrier",
 * base rlëD nova:1030) define no WeapImage at all and carry WeapDecay 0,
 * so that ship has no weapon-effect overlay to fade — see
 * shouldShowFiringAnimation's caller, which is gated on the sprite
 * existing, and the ShanParse regression spec that pins it.
 */
export function weapDecayAlphaPerSecond(weapDecay: number): number {
    return Math.max(0, weapDecay) / 100 * SHAN_FRAMES_PER_SECOND;
}

/**
 * Advances the weapon-effect overlay's alpha one display frame: firing
 * snaps it to fully opaque, and otherwise it decays linearly toward
 * transparent at `alphaPerSecond`. An alphaPerSecond of 0 (WeapDecay 0)
 * means "no fade", i.e. straight to 0.
 */
export function advanceWeaponFlash(alpha: number, firing: boolean,
    alphaPerSecond: number, deltaS: number): number {
    if (firing) {
        return 1;
    }
    if (alphaPerSecond <= 0) {
        return 0;
    }
    return Math.max(0, alpha - alphaPerSecond * deltaS);
}

export const ShipAnimationSystem = new System({
    name: "ShipAnimationSystem",
    args: [ShipComponent, WeaponsStateComponent, SimulationGameDataResource,
        AnimationGraphicComponent, TimeResource, IsIonizedComponent,
        Optional(IonizationColorComponent), Optional(CloakActiveComponent),
        Optional(DisabledComponent), PlayerScannerQuery, GetEntity, UUID,
        ActiveBeamsQuery] as const,
    step(ship, weaponStates, gameData, animation, time, ionized, ionizationColor,
        cloakActive, disabled, playerScanners, entity, uuid, activeBeams) {
        // For now, always hide the ship's shield.
        // TODO: Blink this when hit.
        const shield = animation.sprites.get('shieldImage');
        if (shield) {
            shield.pixiSprite.visible = false;
        }

        // Draw the ship's weapon-effect overlay (shän WeapImage: the Fed
        // Destroyer's muzzle flashes) on top of the hull each time it
        // ACTUALLY emits a shot, then fade it back out at the shän's
        // WeapDecay rate. Real emission, never the held trigger: see
        // shouldShowFiringAnimation. The overlay
        // is an additive sprite in the same graphic as the base image, so
        // ObjectDrawSystem's rotation write and (for multi-set ships like
        // the Manticore) ShipBaseSetAnimationSystem's selectBaseSet keep
        // it frame-aligned with the hull for free.
        if (animation.sprites.has('weapImage')) {
            const useFiringAnimation = (id: string) =>
                gameData.data.Weapon.getCached(id)?.useFiringAnimation;
            const realFire = latestRealFire(weaponStates, useFiringAnimation);
            // First frame for this graphic: adopt the ship's current shot
            // clock as the baseline instead of treating it as a new shot,
            // so a ship that fired before it came on screen arrives dark.
            const lastSeenFire = animation.weaponFireSeen
                ? animation.lastWeaponFired : realFire;
            const firing = shouldShowFiringAnimation(
                uuid, weaponStates, useFiringAnimation, activeBeams,
                lastSeenFire);
            animation.lastWeaponFired = realFire;
            animation.weaponFireSeen = true;
            animation.weaponFlashAlpha = advanceWeaponFlash(
                animation.weaponFlashAlpha, firing,
                weapDecayAlphaPerSecond(animation.weapDecay), time.delta_s);
            animation.weapAlpha = animation.weaponFlashAlpha;
        }

        // Flash the running lights per the ship's shän blink pattern (steady,
        // square strobe, triangle pulse, or random). A per-ship phase offset
        // from the uuid keeps a fleet of identical ships from blinking in
        // unison. A disabled ship's lights go dark entirely (dead in space;
        // EVN Bible ship disabling). Display-only; no sim state involved.
        const runningLights = animation.sprites.get('lightImage');
        if (runningLights) {
            const light = runningLightState(
                animation.blink, time.time, blinkPhaseFromUuid(uuid));
            runningLights.pixiSprite.visible = !disabled && light.visible;
            runningLights.pixiSprite.alpha = light.alpha;
        }

        // The tint is whatever the SIM recorded — shared, serialized
        // state, so every peer sees the same colour on the same hull.
        // Optional because the component may be missing from an old wire
        // snapshot or save; that falls back to the historical grey
        // rather than dropping the ship out of this system entirely.
        applyIonizationTint(animation.sprites, ionized,
            ionizationColor?.color ?? LEGACY_IONIZATION_COLOR);

        // Cloak transparency (display-only). A cloaked ship fades toward
        // invisible; your own ship stays a faint ghost so you can fly it.
        // If the local player has a cloak scanner that reveals cloaked
        // ships on screen (ModVal 0x0002), other cloaked ships show as a
        // faint ghost instead of vanishing.
        //
        // PlayerScannerQuery reads CloakScannerComponent, which the sim
        // never sends (snapshot policy `skip`); the display derives it
        // from the player's synced outfits itself — see
        // cloak_display_plugin.ts — or this query matched nothing and the
        // reveal was dead.
        let cloakAlpha = UNCLOAKED_ALPHA;
        if (cloakActive?.active) {
            const isPlayerShip = entity.components.has(PlayerShipSelector);
            const playerRevealsOnScreen =
                playerScanners[0]?.[1]?.revealsOnScreen === true;
            if (isPlayerShip) {
                cloakAlpha = CLOAKED_ALPHA_SELF;
            } else if (playerRevealsOnScreen) {
                cloakAlpha = CLOAKED_ALPHA_REVEALED;
            } else {
                cloakAlpha = CLOAKED_ALPHA_OTHER;
            }
        }
        // The container alpha is MurkFadeSystem's (it composes murk with
        // this factor, and runs after this system); assigning it here
        // used to overwrite the murk fade every frame, so ships never
        // faded with distance in a murky system. The direct write below
        // covers worlds without murk at all (no SystemEnvironmentPlugin).
        animation.cloakAlpha = cloakAlpha;
        animation.container.alpha = cloakAlpha;
    },
});

/**
 * Which base sprite set a continuously-animating ship (shän 0x0008) shows
 * at time `timeMs`: the sets advance `setsPerSecond` per second and wrap.
 * Returned UNwrapped (a monotonically increasing raw index); the caller
 * mods it by each sprite sheet's own set count, so the base image and the
 * alt-image overlay each cycle through however many sets they hold.
 */
export function continuousRawSet(timeMs: number, setsPerSecond: number): number {
    return Math.floor((timeMs / 1000) * setsPerSecond);
}

/**
 * Which base sprite set a folding ship (shän 0x0002) shows at fold
 * `progress` in [0, 1], mapped linearly and clamped.
 *
 * The stock fold art runs UNFOLDED -> FOLDED, i.e. **set 0 is the fully
 * DEPLOYED pose and the LAST set is the folded rest pose**, so progress
 * (0 = folded, 1 = unfolded — the FoldStateComponent's meaning, which the
 * WeaponsSystem fire gate depends on) maps to the sets in REVERSE. The
 * Bible never states which end of the sequence is which (see 0x0002: the
 * extra frames "are used for animated ship parts such as for
 * folding/unfolding wings", and "will be cycled" on landing/takeoff and
 * hyperspace, with no start/end frame specified), so this is pinned to the
 * actual rlëD art instead:
 *
 * - Argosy (nova:138, shän base rlëD nova:1020, 6 sets of 36): set 0 has
 *   the side nacelles splayed OUT away from the hull; set 5 has them
 *   tucked flush IN against it. The Argosy sits with its nacelles in and
 *   spreads them for hyperspace, so rest = set 5.
 * - Asteroid Miner (extra-outfits:807, base rlëD nova:1128, 6 sets of 36):
 *   set 0 has the claws swept wide OPEN, set 5 has them wrapped tight
 *   against the body. The miner rests wrapped and unwraps to fire, so
 *   rest = set 5 and the fire gate's "fully unfolded" = set 0.
 *
 * See ship_animation_test.ts, which pins both of these.
 */
export function foldSetIndex(progress: number, baseSetCount: number): number {
    const lastSet = Math.max(0, baseSetCount - 1);
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const index = Math.round((1 - clampedProgress) * lastSet);
    return Math.min(lastSet, Math.max(0, index));
}

/**
 * Advances an Argosy-style jump-folding ship's DISPLAY fold progress toward
 * unfolded while it is in a hyperspace jump and back toward folded
 * otherwise, at the shän AnimDelay rate. Display-only (jump folding gates
 * nothing); miner claws use the sim FoldStateComponent instead.
 */
export function advanceJumpFold(graphic: AnimationGraphic,
    mode: ShipAnimationMode, jumping: boolean, deltaS: number): number {
    const target = jumping ? 1 : 0;
    graphic.foldProgress = moveToward(graphic.foldProgress, target,
        foldRatePerSecond(mode) * deltaS);
    return graphic.foldProgress;
}

/**
 * Drives the ship base-set animation — the third and last write to a ship
 * graphic's frames each display tick, after ObjectDrawSystem has set the
 * heading (rotation) and normal/left/right set. It composes the animation
 * SET with that heading: every base set is a full FramesPer-frame rotation
 * set, so selectBaseSet() picks the set and re-derives the frame within it.
 *
 *  - continuous (0x0008): the sets (and the alt-image overlay) cycle on
 *    logical time — spinning rings (Leviathan, Manticore, Thunderforge).
 *  - folding (0x0002): the sets are a fold sequence, running DEPLOYED
 *    (set 0) -> FOLDED (last set) in the stock art; see foldSetIndex.
 *    Miner claws (unfoldWhenFiring) read the synced sim
 *    FoldStateComponent so the graphic matches the fire gate exactly;
 *    every other folding ship (the Argosy) folds display-side off its
 *    jump state.
 *
 * Disabled honoring: stopWhenDisabled freezes a continuous animation at
 * its rest set; hideAltWhenDisabled hides the alt overlay.
 *
 * Documented seams (checked against ALL stock shäns):
 * - Landing/takeoff folding: the Bible also cycles the fold on landing
 *   and takeoff, but NovaJS's landing is instant (no takeoff sequence),
 *   so the fold keys only off the hyperspace jump state. N/A until a
 *   takeoff sequence exists.
 * - Inherent alt-overlay cycling WITHOUT 0x0008: the Bible says the alt
 *   image always cycles at AnimDelay. The only stock ship with an alt
 *   image (Aurora Thunderforge, shän 380) is ALSO 0x0008, which this
 *   system's continuous path covers (it cycles every multi-set sprite,
 *   the alt overlay included), so no stock content exercises a
 *   non-0x0008 overlay and that path is deliberately not built.
 * - keyCarried (0x0004): no stock shän sets it; the parse emits the
 *   mode but no display consumer exists. Wiring it up means reading the
 *   synced outfit/bay state for the shïp's KeyCarried type and calling
 *   selectBaseSet(1) here.
 */
export const ShipBaseSetAnimationSystem = new System({
    name: "ShipBaseSetAnimationSystem",
    args: [ShipComponent, AnimationComponent, AnimationGraphicComponent,
        TimeResource, Optional(JumpComponent), Optional(FoldStateComponent),
        Optional(DisabledComponent)] as const,
    step(_ship, animation, graphic, time, jump, foldState, disabled) {
        const mode = animation.animationMode;
        if (!mode) {
            return; // Plain rotation-only or banking ship: nothing to do.
        }

        if (mode.purpose === 'continuous') {
            const frozen = !!disabled && mode.stopWhenDisabled;
            const rawSet = frozen
                ? 0 : continuousRawSet(time.time, mode.setsPerSecond);
            for (const sprite of graphic.sprites.values()) {
                const sets = sprite.setCountForFramesPer(mode.framesPer);
                if (sets <= 1) {
                    continue; // Single-set sprite: leave rotation as-is.
                }
                sprite.selectBaseSet(rawSet % sets, mode.framesPer);
            }
        } else if (mode.purpose === 'folding') {
            // Miner claws are sim-gated; other folding ships fold on jump.
            const progress = mode.unfoldWhenFiring
                ? (foldState?.progress ?? 0)
                : advanceJumpFold(graphic, mode, jump !== undefined,
                    time.delta_s);
            const setIndex = foldSetIndex(progress, mode.baseSetCount);
            for (const sprite of graphic.sprites.values()) {
                if (sprite.setCountForFramesPer(mode.framesPer) <= 1) {
                    continue;
                }
                sprite.selectBaseSet(setIndex, mode.framesPer);
            }
        }
        // keyCarried (0x0004) is a documented seam (see plugin docs).

        // Hide the alt-image overlay while disabled, if the ship asks for it.
        if (mode.hideAltWhenDisabled) {
            const alt = graphic.sprites.get('altImage');
            if (alt) {
                alt.pixiSprite.visible = !disabled;
            }
        }
    },
    after: [ObjectDrawSystem],
});

export const ShipAnimationPlugin: Plugin = {
    name: "ShipAnimationPlugin",
    build(world) {
        world.addSystem(ShipAnimationSystem);
        world.addSystem(ShipBaseSetAnimationSystem);
    },
    remove(world) {
        world.removeSystem(ShipAnimationSystem);
        world.removeSystem(ShipBaseSetAnimationSystem);
    }
}
