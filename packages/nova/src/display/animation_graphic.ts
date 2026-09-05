import * as PIXI from "pixi.js";
import { Animation, BlinkPattern } from "novadatainterface/animation";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SpriteSheetSprite } from "./sprite_sheet_sprite.js";

/**
 * An AnimationGraphic is responsible for managing all the PIXI Sprites
 * needed to draw a single animation, be it a ship, explosion, asteroid,
 * or planet.
 */
export class AnimationGraphic {
    // AnimationGraphic is not a Drawable since it doesn't draw a state.
    readonly container = new PIXI.Container();
    protected readonly displayAssets: DisplayAssetDataInterface;
    readonly sprites = new Map<string, SpriteSheetSprite>();
    private wrappedProgress = 0;
    private wrappedRotation = 0;
    /**
     * Display-only fold animation progress in [0, 1] (0 = folded/rest, 1 =
     * fully unfolded), advanced by ShipBaseSetAnimationSystem for
     * jump-folding ships (the Argosy's nacelles). Miner claws use the SIM-side
     * FoldStateComponent instead, since their fold gates weapon fire.
     *
     * Note this is the FOLD's semantics, not the art's: the stock fold
     * sprite sets run deployed (set 0) -> folded (last set), so
     * foldSetIndex maps this in reverse.
     */
    foldProgress = 0;
    /**
     * Display-only alpha of the shän `weapImage` weapon-effect overlay, in
     * [0, 1]. Snapped to 1 while the ship is firing and decayed back toward
     * 0 at the shän's WeapDecay rate afterwards (ShipAnimationSystem).
     */
    weaponFlashAlpha = 0;
    /**
     * The `WeaponState.lastFired` this graphic saw on its previous frame —
     * the simulation time of the last shot its ship actually emitted from
     * a glow-flagged weapon. ShipAnimationSystem pulses the overlay
     * whenever this changes, which is what makes a projectile weapon flash
     * once per real shot instead of glowing for as long as the trigger is
     * held.
     *
     * `weaponFireSeen` separates "this ship has never fired" from "this
     * graphic has not looked yet": on the first frame the system adopts
     * whatever the ship has already done as the baseline, so a ship that
     * fired before it came on screen (or before a pooled graphic was
     * handed to it) does not flash on arrival.
     */
    lastWeaponFired?: number;
    weaponFireSeen = false;
    private animation: Animation | Promise<Animation>;
    /**
     * The animation this graphic's sprites were actually BUILT from,
     * resolved once `build()` gets past awaiting `animation`.
     *
     * This is the only trustworthy identity of what the graphic draws. The
     * sprite sheets, blend modes and frame ranges in `sprites` are captured
     * from this animation at construction and are never re-read afterwards,
     * so an entity whose `AnimationComponent` is later reassigned (a
     * `Provide` with an `update:` list replaces it; AnimationGraphicLoader
     * has no `update:` and so never rebuilds) keeps drawing THIS animation.
     * The pool therefore keys graphics by this, never by whatever animation
     * the entity happens to carry at release time.
     */
    builtAnimation?: Animation;
    readonly buildPromise: Promise<AnimationGraphic>;
    built = false;
    size = { x: 0, y: 0 }
    /**
     * The running-lights blink pattern for this animation, or null for a
     * steady light / no lights. Resolved once the graphic is built.
     */
    blink: BlinkPattern | null = null;
    /**
     * The shän's WeapDecay (percent of the weapon overlay's alpha burned
     * per 30th-of-a-second frame once firing stops). Static per animation,
     * so it is resolved once at build time like `blink`, and survives
     * pooling (the pool keys graphics by animation).
     */
    weapDecay = 0;

    constructor({ displayAssets, animation }: { displayAssets: DisplayAssetDataInterface, animation: Animation | Promise<Animation> }) {
        this.animation = animation;
        this.displayAssets = displayAssets;
        this.rotation = 0;
        this.buildPromise = this.build();
    }

    private async build(): Promise<AnimationGraphic> {
        var promises: Promise<unknown>[] = [];
        // Record what we are building from BEFORE any sprite is made, so the
        // graphic's identity always matches the sheets it actually holds.
        this.builtAnimation = await this.animation;
        this.blink = (await this.animation).blink;
        this.weapDecay = (await this.animation).weapDecay;
        for (const imageName in (await this.animation).images) {
            const image = (await this.animation).images[imageName];
            if (!image) {
                // A sprite layer the shän does not define (most ships
                // have no weapImage / altImage / shieldImage). Draw
                // NOTHING for it — never fall back to a default sheet.
                continue;
            }
            const sprite = new SpriteSheetSprite({
                image,
                displayAssets: this.displayAssets
            });

            this.sprites.set(imageName, sprite);
            this.container.addChild(sprite.pixiSprite);
            promises.push(sprite.buildPromise);
        }
        await Promise.all(promises);
        this.size.x = Math.max(0, ...[...this.sprites.values()].map(s => s.size.x));
        this.size.y = Math.max(0, ...[...this.sprites.values()].map(s => s.size.y));
        this.rotation = this.rotation;
        // The weapon-effect overlay only shows while firing, so a freshly
        // built graphic starts transparent rather than flashing for the
        // frame before ShipAnimationSystem first runs.
        this.weapAlpha = 0;
        this.built = true;
        return this;
    }

    /**
     * Resets mutable display state so a pooled graphic looks like a freshly
     * built one when it is reused for a new entity. Visibility of the
     * container itself is managed by whoever attaches the graphic.
     */
    reset() {
        this.setFramesToUse('normal');
        for (const sprite of this.sprites.values()) {
            sprite.pixiSprite.visible = true;
            sprite.pixiSprite.tint = 0xFFFFFF;
            sprite.pixiSprite.alpha = 1;
        }
        // The container's alpha (murk fade) and scale (debris chunk
        // scale) may have been changed.
        this.container.alpha = 1;
        this.cloakAlpha = 1;
        this.container.scale.set(1);
        this.wrappedProgress = 0;
        this.foldProgress = 0;
        this.weaponFlashAlpha = 0;
        this.weapAlpha = 0;
        // A pooled graphic must not inherit the previous ship's shot
        // clock, or the new ship flashes on its first frame (or, worse,
        // misses its first real shot because the stale value happens to
        // match).
        this.lastWeaponFired = undefined;
        this.weaponFireSeen = false;
        this.rotation = 0;
    }

    /**
     * How visible the ship's cloak leaves it, in [0, 1]; 1 when not
     * cloaked. Written by ShipAnimationSystem and COMPOSED into the
     * container alpha by MurkFadeSystem (murk * cloak), which owns that
     * property: two systems assigning it in turn meant whichever ran
     * last won, and ships never faded into the murk. Kept here rather
     * than on the child sprites because every layer of a cloaked ship
     * fades together.
     */
    cloakAlpha = 1;

    set glowAlpha(alpha: number) {
        const glowImage = this.sprites.get('glowImage');
        if (glowImage) {
            glowImage.pixiSprite.alpha = alpha;
        }
    }

    /**
     * Alpha of the weapon-effect overlay (shän WeapImage), the same
     * per-sprite-alpha composition the engine glow uses. Fully transparent
     * hides the sprite outright so a ship that never fires costs nothing.
     */
    set weapAlpha(alpha: number) {
        const weapImage = this.sprites.get('weapImage');
        if (weapImage) {
            weapImage.pixiSprite.alpha = alpha;
            weapImage.pixiSprite.visible = alpha > 0;
        }
    }

    setFramesToUse(frames: string) {
        for (const sprite of this.sprites.values()) {
            sprite.setFramesToUse(frames);
        }
    }

    get rotation() {
        return this.wrappedRotation;
    }

    set rotation(angle: number) {
        this.wrappedRotation = angle;
        for (const sprite of this.sprites.values()) {
            sprite.rotation = angle;
        }
    }

    get progress() {
        return this.wrappedProgress;
    }

    set progress(progress: number) {
        progress = Math.min(1, Math.max(0, progress));
        for (const sprite of this.sprites.values()) {
            sprite.rotation = 0;
            sprite.frame = Math.min(sprite.frames - 1,
                Math.floor(progress * sprite.frames));
        }
    }
}
