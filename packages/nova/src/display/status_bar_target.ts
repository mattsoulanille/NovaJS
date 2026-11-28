import { StatusBarData } from "novadatainterface/status_bar_data";
import { RunQuery, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import {
    DisabledComponent, ArmorComponent, ShieldComponent, ShipDataComponent, TargetComponent,
} from '../nova_plugin/ship/index.js';
import {
    displayName, govtTargetName, SimulationGameDataResource, GovtComponent,
} from '../nova_plugin/core/index.js';
import {
    MissionShipComponent, PlayerEscortComponent, PlayerShipSelector,
} from '../nova_plugin/player/index.js';
import { PersComponent } from "../nova_plugin/spawn/index.js";
import { SystemHoldComponent } from "../nova_plugin/npc/index.js";
import type { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { enhancementEnabled } from "../enhancements.js";
import { AnimationGraphic } from "./animation_graphic.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { targetGovtLabel } from "./status_bar_content.js";
import {
    NO_TARGET_CENTER_BELOW_MIDDLE, StatusBarFonts, TARGET_NAME_Y,
    TARGET_SPRITE_TINT, TARGET_SUBTITLE_Y,
} from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { targetIdentity } from "./target_identity.js";
import {
    TARGET_DISABLED_TEXT, TARGET_WAITING_TEXT, targetReadout,
} from "./target_readout.js";
import { DrawStatusBarSecondaryWeapon } from "./status_bar_weapon.js";

/**
 * What the target pane draws for the locked ship:
 *  - 'live': the ship's own sprite, rendered as it flies (NovaJS; the
 *    "Live target view" enhancement, ON by default);
 *  - 'pict': the ship class's fixed HUD target render, PICT 3000 + id - 128
 *    (ShipData.targetPict), as the original does — the enhancement OFF;
 *  - 'none': nothing to draw yet.
 * With the enhancement off, a ship with no target PICT (plug-in ships
 * routinely have none) still gets the live render rather than a blank.
 */
export type TargetImageMode = 'live' | 'pict' | 'none';

export function targetImageMode(liveView: boolean, hasGraphic: boolean,
    targetPict: string | null | undefined): TargetImageMode {
    if (!liveView && targetPict) {
        return 'pict';
    }
    return hasGraphic ? 'live' : 'none';
}

/**
 * The colour matrix that turns a HUD target PICT into the original's red
 * target image: red = the PICT's BLUE channel, green = blue = 0.
 *
 * Why blue: the stock target PICTs are colour renders over a yellow
 * scan-line wedge (R = G, B = 0), and the original's pane shows the ship
 * in red with no wedge at all (space/in_space.png, the Leviathan: PICT
 * 3003, the same picture at the same heading whatever the ship's real
 * one). Of R, G, B, min, max and luminance, the blue channel correlates
 * best with that capture's red (0.55 against 0.45 for red or luminance),
 * and it is the one channel the wedge has none of. The capture also draws
 * the picture about 1.5x wider than tall relative to the PICT, which is
 * not reproduced: it is drawn 1:1.
 */
export const TARGET_PICT_MATRIX: readonly number[] = [
    0, 0, 1, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
];

/**
 * The target pane: the locked ship's name, class subtitle and government,
 * its shield / armor / Disabled readout, and its sprite rendered red —
 * or a dim "No Target".
 */
export class TargetPane {
    /**
     * Class-owned containers that build() re-parents (StatusBar.reload keeps
     * them); their children are per-build text objects.
     */
    readonly container = new PIXI.Container();
    readonly noTargetContainer = new PIXI.Container();
    private sprite = new PIXI.Sprite();

    /**
     * A single RenderTexture reused across frames to draw the locked
     * target's ship graphic. Reallocated (destroying the old one and its
     * base texture) only when the required size changes, so a locked
     * target no longer leaks a fresh GPU texture every display frame.
     */
    private renderTexture?: PIXI.RenderTexture;

    /**
     * Snapshot of the last live ship graphic rendered into `renderTexture`,
     * used to skip redundant offscreen FBO render passes when the target's
     * visible sprites have not changed since the previous frame.
     */
    private lastRenderGraphic?: AnimationGraphic;
    private lastRenderWidth = 0;
    private lastRenderHeight = 0;
    private lastRenderContainerAlpha = -1;
    private lastRenderLayers: {
        name: string,
        visible: boolean,
        texture: PIXI.Texture,
        rotationQ: number,
        tint: PIXI.ColorSource,
        alpha: number,
    }[] = [];
    private lastPercent?: number;

    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private texts?: {
        shield: PIXI.Text, armor: PIXI.Text, percent: PIXI.Text,
        disabled: PIXI.Text, noTarget: PIXI.Text, name: PIXI.Text,
        subtitle: PIXI.Text, govt: PIXI.Text, imagePlaceholder: PIXI.Text,
    };

    /** Lazily made: the 'pict' mode's red-from-blue filter. */
    private pictFilter?: PIXI.ColorMatrixFilter;

    constructor(private renderer: PIXI.Renderer | PIXI.IRenderer,
        private displayAssets?: Pick<DisplayAssetDataInterface,
            'textureFromPict'>) { }

    build(parent: PIXI.Container, data: StatusBarData, fonts: StatusBarFonts) {
        this.container.addChild(this.sprite);
        this.sprite.anchor.set(0.5, 0.5);
        this.sprite.tint = TARGET_SPRITE_TINT;
        this.sprite.position.x = data.dataAreas.targeting.size[0] / 2;
        this.sprite.position.y = data.dataAreas.targeting.size[1] / 2;

        this.container.visible = false;
        parent.addChild(this.container);
        parent.addChild(this.noTargetContainer);

        this.container.position.x = data.dataAreas.targeting.position[0];
        this.container.position.y = data.dataAreas.targeting.position[1];
        this.noTargetContainer.position.x = data.dataAreas.targeting.position[0];
        this.noTargetContainer.position.y = data.dataAreas.targeting.position[1];

        var size = [data.dataAreas.targeting.size[0],
        data.dataAreas.targeting.size[1]];

        const shield = new PIXI.Text('Shield:', fonts.dim);
        shield.anchor.y = 1;
        shield.position.x = 6;
        shield.position.y = size[1] - 3;

        this.container.addChild(shield);

        const armor = new PIXI.Text('Armor:', fonts.dim);
        armor.anchor.y = 1;
        armor.position.x = 6;
        armor.position.y = size[1] - 3;
        armor.visible = false;
        this.container.addChild(armor);


        const percent = new PIXI.Text("100%", fonts.bright);
        percent.anchor.y = 1;
        percent.position.x = 49;
        percent.position.y = size[1] - 3;

        this.container.addChild(percent);

        // Replaces the whole shield/armor readout while the target is
        // disabled (bright text, per the original game's target pane).
        const disabled = new PIXI.Text(TARGET_DISABLED_TEXT, fonts.bright);
        disabled.anchor.y = 1;
        disabled.position.x = 6;
        disabled.position.y = size[1] - 3;
        disabled.visible = false;
        this.container.addChild(disabled);

        const middle = [data.dataAreas.targeting.size[0] / 2,
        data.dataAreas.targeting.size[1] / 2];

        const noTarget = new PIXI.Text("No Target", fonts.dim);
        noTarget.anchor.x = 0.5;
        noTarget.anchor.y = 0.5;
        noTarget.position.x = middle[0];
        noTarget.position.y = middle[1] - NO_TARGET_CENTER_BELOW_MIDDLE;

        this.noTargetContainer.addChild(noTarget);

        const name = new PIXI.Text("Name Placeholder", fonts.bright);
        name.anchor.x = 0.5;
        name.anchor.y = 0;
        name.position.x = middle[0];
        name.position.y = TARGET_NAME_Y;

        this.container.addChild(name);

        // The ship class subtitle (shïp SubTitle), smaller and dim, sits just
        // beneath the target name — "Heavy Fighter Class" under "Pirate Viper".
        const subtitle = new PIXI.Text("", fonts.subtitle);
        subtitle.anchor.x = 0.5;
        subtitle.anchor.y = 0;
        subtitle.position.x = middle[0];
        subtitle.position.y = TARGET_SUBTITLE_Y;
        this.container.addChild(subtitle);

        // The target's government, dim, in the lower-right of the pane
        // ("Sigma" / "Trader" / "Pirate" in the reference screenshots).
        const govt = new PIXI.Text("", fonts.dim);
        govt.anchor.x = 1;
        govt.anchor.y = 1;
        govt.position.x = size[0] - 6;
        govt.position.y = size[1] - 3;
        this.container.addChild(govt);

        const imagePlaceholder = new PIXI.Text("No target image", fonts.dim);
        imagePlaceholder.anchor.x = 0.5;
        imagePlaceholder.anchor.y = 0.5;

        this.texts = {
            shield, armor, percent, disabled, noTarget, name, subtitle, govt,
            imagePlaceholder,
        };
    }

    /**
     * Empties the two class-owned containers (build() re-parents them and
     * fills them again) and destroys this build's texts, each of which
     * owns a canvas texture.
     */
    reset() {
        this.container.removeChildren();
        this.noTargetContainer.removeChildren();
        for (const text of Object.values(this.texts ?? {})) {
            text.destroy();
        }
        this.texts = undefined;
        this.invalidateRenderCache();
    }

    /**
     * Releases the cached RenderTexture (and its base texture) and any
     * text the bar's tree teardown could not reach: imagePlaceholder is
     * owned but never parented, so it has to be destroyed by name.
     */
    destroy() {
        for (const text of Object.values(this.texts ?? {})) {
            if (!text.destroyed) {
                text.destroy();
            }
        }
        this.texts = undefined;
        this.renderTexture?.destroy(true);
        this.renderTexture = undefined;
        this.pictFilter?.destroy();
        this.pictFilter = undefined;
        this.invalidateRenderCache();
    }

    private invalidateRenderCache() {
        this.lastRenderGraphic = undefined;
        this.lastRenderWidth = 0;
        this.lastRenderHeight = 0;
        this.lastRenderContainerAlpha = -1;
        this.lastRenderLayers.length = 0;
        this.lastPercent = undefined;
    }

    /**
     * Returns true if the target's rendered appearance differs from the last
     * frame rendered into `renderTexture` (updating the cached fingerprint).
     * Small engine-glow shimmer fluctuations (glowImage alpha jitter while
     * thrusting) are tolerated so a steady-flying target does not force an
     * offscreen FBO pass on every display frame.
     */
    private needsLiveRender(shipGraphic: AnimationGraphic,
        width: number, height: number): boolean {
        const containerAlpha = Math.round(shipGraphic.container.alpha * 20) / 20;
        let dirty = this.lastRenderGraphic !== shipGraphic
            || this.lastRenderWidth !== width
            || this.lastRenderHeight !== height
            || this.lastRenderContainerAlpha !== containerAlpha
            || this.lastRenderLayers.length !== shipGraphic.sprites.size;

        let idx = 0;
        if (!dirty) {
            for (const [layerName, sprite] of shipGraphic.sprites) {
                const ps = sprite.pixiSprite;
                const prev = this.lastRenderLayers[idx++];
                const rotQ = Math.round(ps.rotation * 1000);
                if (prev.name !== layerName
                    || prev.visible !== ps.visible
                    || prev.texture !== ps.texture
                    || prev.rotationQ !== rotQ
                    || prev.tint !== ps.tint) {
                    dirty = true;
                    break;
                }
                if (layerName === 'glowImage') {
                    const prevLit = prev.alpha > 0.02;
                    const curLit = ps.alpha > 0.02;
                    if (prevLit !== curLit || Math.abs(prev.alpha - ps.alpha) >= 0.25) {
                        dirty = true;
                        break;
                    }
                } else if (Math.abs(prev.alpha - ps.alpha) >= 0.05) {
                    dirty = true;
                    break;
                }
            }
        }

        if (!dirty) {
            return false;
        }

        this.lastRenderGraphic = shipGraphic;
        this.lastRenderWidth = width;
        this.lastRenderHeight = height;
        this.lastRenderContainerAlpha = containerAlpha;
        this.lastRenderLayers.length = 0;
        for (const [layerName, sprite] of shipGraphic.sprites) {
            const ps = sprite.pixiSprite;
            this.lastRenderLayers.push({
                name: layerName,
                visible: ps.visible,
                texture: ps.texture,
                rotationQ: Math.round(ps.rotation * 1000),
                tint: ps.tint,
                alpha: ps.alpha,
            });
        }
        return true;
    }

    drawTarget(name: string, shield?: number, armor?: number,
        shipGraphic?: AnimationGraphic,
        disabled: boolean | 'waiting' = false,
        subtitle = "", government = "", targetPict: string | null = null,
        liveView = true) {
        // Mid-reload (an ïntf swap) the texts are destroyed and `texts`
        // is unset until build() has awaited the new PICT. The other
        // draw methods already wait it out; this one dereferenced
        // the name text and threw, and the ECS flush has no per-system
        // try/catch, so every draw system after it was skipped for the
        // frame. DrawStatusBarTarget calls this every frame, so the
        // first built frame redraws the target.
        if (!this.texts) {
            return;
        }
        const texts = this.texts;
        this.container.visible = true;
        this.noTargetContainer.visible = false;
        texts.name.text = name;
        texts.subtitle.text = subtitle;
        texts.subtitle.visible = subtitle.length > 0;
        texts.govt.text = government;
        texts.govt.visible = government.length > 0;

        const readout = targetReadout(disabled, shield, armor);
        // "Disabled" and a waiting rescue ship's "Waiting" share the slot
        // (target_readout.ts).
        texts.disabled.visible = readout.kind === 'disabled'
            || readout.kind === 'waiting';
        const status = readout.kind === 'waiting'
            ? TARGET_WAITING_TEXT : TARGET_DISABLED_TEXT;
        if (texts.disabled.text !== status) {
            texts.disabled.text = status;
        }
        texts.shield.visible = readout.kind === 'shield';
        texts.armor.visible = readout.kind === 'armor';
        texts.percent.visible = readout.kind === 'shield'
            || readout.kind === 'armor';
        if (readout.kind === 'shield' || readout.kind === 'armor') {
            if (this.lastPercent !== readout.percent) {
                this.lastPercent = readout.percent;
                texts.percent.text = `${String(readout.percent)}%`;
            }
        }

        const mode = targetImageMode(liveView, shipGraphic !== undefined,
            this.displayAssets ? targetPict : null);
        if (mode === 'pict' && targetPict && this.displayAssets) {
            // The original's fixed picture, drawn red from its blue
            // channel (TARGET_PICT_MATRIX). Textures are cached by PIXI,
            // so asking every frame costs a map lookup.
            this.invalidateRenderCache();
            this.sprite.texture = this.displayAssets.textureFromPict(
                targetPict);
            this.sprite.tint = 0xFFFFFF;
            this.sprite.filters = [this.redFromBlue()];
            this.sprite.scale.set(1, 1);
            this.sprite.visible = true;
        } else if (mode === 'live' && shipGraphic) {
            this.sprite.tint = TARGET_SPRITE_TINT;
            this.sprite.filters = null;
            const shipContainer = shipGraphic?.container;
            const width = shipGraphic.size.x;
            const height = shipGraphic.size.y;

            // Reuse the cached RenderTexture across frames; only reallocate
            // (destroying the old one and its base texture) when the target's
            // size changes. Without this a fresh texture would leak every
            // display frame while a target is locked.
            let renderTexture = this.renderTexture;
            let textureRecreated = false;
            if (!renderTexture ||
                renderTexture.width !== width ||
                renderTexture.height !== height) {
                renderTexture?.destroy(true);
                const baseRenderTexture = new PIXI.BaseRenderTexture({
                    width, height,
                });
                renderTexture = new PIXI.RenderTexture(baseRenderTexture);
                this.renderTexture = renderTexture;
                textureRecreated = true;
            }

            const dirty = this.needsLiveRender(shipGraphic, width, height);
            if (textureRecreated || dirty) {
                const prevX = shipContainer.position.x;
                const prevY = shipContainer.position.y;
                const prevScaleX = shipContainer.scale.x;
                const prevScaleY = shipContainer.scale.y;
                const prevRot = shipContainer.rotation;
                const prevSkewX = shipContainer.skew.x;
                const prevSkewY = shipContainer.skew.y;
                const prevPivotX = shipContainer.pivot.x;
                const prevPivotY = shipContainer.pivot.y;
                const prevVisible = shipContainer.visible;
                // The live container is borrowed for the thumbnail (and
                // may be culled offscreen: ObjectDrawSystem hides what is
                // out of view), so everything setTransform resets, and its
                // visibility, is put back afterwards.
                shipContainer.setTransform();
                shipContainer.position.x = shipGraphic.size.x / 2;
                shipContainer.position.y = shipGraphic.size.y / 2;
                shipContainer.visible = true;
                try {
                    this.renderer.render(shipContainer, { renderTexture });
                } finally {
                    shipContainer.position.set(prevX, prevY);
                    shipContainer.scale.set(prevScaleX, prevScaleY);
                    shipContainer.rotation = prevRot;
                    shipContainer.skew.set(prevSkewX, prevSkewY);
                    shipContainer.pivot.set(prevPivotX, prevPivotY);
                    shipContainer.visible = prevVisible;
                }
            }
            this.sprite.texture = renderTexture;
            let scale = 1;
            const maxSize = 110;
            const targetMaxDim = Math.max(shipGraphic.size.x, shipGraphic.size.y);
            if (targetMaxDim > maxSize) {
                scale = maxSize / targetMaxDim;
            }
            this.sprite.scale.set(scale, scale);
            this.sprite.visible = true;
        } else {
            this.invalidateRenderCache();
            this.sprite.visible = false;
        }

    }
    private redFromBlue(): PIXI.ColorMatrixFilter {
        if (!this.pictFilter) {
            this.pictFilter = new PIXI.ColorMatrixFilter();
            this.pictFilter.matrix =
                [...TARGET_PICT_MATRIX] as PIXI.ColorMatrix;
        }
        return this.pictFilter;
    }

    clearTarget() {
        if (!this.texts) {
            return;
        }
        this.invalidateRenderCache();
        this.container.visible = false;
        this.noTargetContainer.visible = true;
        this.sprite.visible = false;
    }
}

const TargetQuery = new Query([ShipDataComponent, Optional(ShieldComponent),
    Optional(ArmorComponent), Optional(AnimationGraphicComponent),
    Optional(PersComponent), Optional(DisabledComponent),
    Optional(GovtComponent), Optional(PlayerEscortComponent),
    Optional(MissionShipComponent), Optional(SystemHoldComponent)] as const);
export const DrawStatusBarTarget = new System({
    name: 'DrawStatusBarTarget',
    args: [StatusBarResource, TargetComponent, RunQuery,
        SimulationGameDataResource, UUID, PlayerShipSelector] as const,
    step(statusBar, { target }, runQuery, gameData, playerUuid) {
        if (!target) {
            statusBar.target.clearTarget();
            return;
        }
        const result = runQuery(TargetQuery, target)[0];
        if (result) {
            const [shipData, shield, armor, shipGraphic, pers, disabled, govt,
                playerEscort, missionShip, hold] = result;
            // The government shown lower-right of the target pane. The original
            // shows the gövt's short Target Code (gövt TMPL offset 68) — "Pyro"
            // for "Pyrogenesis Skymining", " Fed." for "Federation" — rather
            // than the overflow-prone full name. displayName trims the code's
            // leading padding and strips any "; note" author suffix; a govt
            // with no target code falls back to its (also cleaned) full name.
            // Cached lookup: undefined until the govt data loads, then appears.
            const govtData = govt
                ? gameData.data.Govt.getCached(govt.id) : undefined;
            // ...except for the local player's OWN escorts, which read
            // "Escort" instead of their government. Per-player and
            // display-only: `playerUuid` is this client's ship, so a peer
            // targeting the same ship still sees its real government
            // (targetGovtLabel).
            const government = targetGovtLabel(
                govtData ? govtTargetName(govtData) : "",
                playerEscort?.player, playerUuid);
            // Përs name/subtitle, then a mission special ship's, then the
            // ship class's own — see target_identity.ts for the Bible
            // citations behind that order.
            const identity = targetIdentity({
                persName: pers?.name,
                persSubtitle: pers?.subtitle,
                missionName: missionShip?.name,
                missionSubtitle: missionShip?.subtitle,
                shipClass: shipData.name,
                shipSubtitle: shipData.subtitle,
            });
            // Hide the "; developer note" suffix authors append to ship
            // (and përs) names — the original never shows it in the target box.
            statusBar.target.drawTarget(displayName(identity.name),
                shield?.percent, armor?.percent, shipGraphic,
                // A rescue ship held for its pilot but not adrift is
                // WAITING (npc/system_hold.ts's waitingForRescue).
                disabled !== undefined ? true
                    : hold?.reason === 'rescue' ? 'waiting' : false,
                identity.subtitle, government,
                shipData.targetPict ?? null,
                enhancementEnabled('enhLiveTargetView'));
        } else {
            // The target exists but the query missed — e.g. a just-replicated
            // ship whose ShipDataComponent isn't in the display world yet. Clear
            // the panel so it doesn't keep showing the previous target's data.
            statusBar.target.clearTarget();
        }
    },
    // #156 pin (shared: *): StatusBarPlugin's registration order.
    after: [DrawStatusBarSecondaryWeapon],
})
