import { StatusBarData } from "novadatainterface/status_bar_data";
import { RunQuery, UUID } from "nova_ecs/arg_types";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { DisabledComponent } from "../nova_plugin/disabled_component.js";
import { displayName, govtTargetName } from "../nova_plugin/display_name.js";
import { SimulationGameDataResource } from "../nova_plugin/game_data_resource.js";
import { GovtComponent } from "../nova_plugin/govt_component.js";
import { ArmorComponent, ShieldComponent } from "../nova_plugin/health_plugin.js";
import { MissionShipComponent } from "../nova_plugin/mission_ship_component.js";
import { PersComponent } from "../nova_plugin/pers_plugin.js";
import { PlayerEscortComponent } from "../nova_plugin/player_escort.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { ShipDataComponent } from "../nova_plugin/ship_plugin.js";
import { TargetComponent } from "../nova_plugin/target_component.js";
import { AnimationGraphic } from "./animation_graphic.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import { targetGovtLabel } from "./status_bar_content.js";
import {
    NO_TARGET_CENTER_BELOW_MIDDLE, StatusBarFonts, TARGET_NAME_Y,
    TARGET_SPRITE_TINT, TARGET_SUBTITLE_Y,
} from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";
import { targetIdentity } from "./target_identity.js";
import { targetReadout } from "./target_readout.js";

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

    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private texts?: {
        shield: PIXI.Text, armor: PIXI.Text, percent: PIXI.Text,
        disabled: PIXI.Text, noTarget: PIXI.Text, name: PIXI.Text,
        subtitle: PIXI.Text, govt: PIXI.Text, imagePlaceholder: PIXI.Text,
    };

    constructor(private renderer: PIXI.Renderer | PIXI.IRenderer) { }

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
        const disabled = new PIXI.Text('Disabled', fonts.bright);
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
    }

    drawTarget(name: string, shield?: number, armor?: number,
        shipGraphic?: AnimationGraphic, disabled = false,
        subtitle = "", government = "") {
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
        texts.disabled.visible = readout.kind === 'disabled';
        texts.shield.visible = readout.kind === 'shield';
        texts.armor.visible = readout.kind === 'armor';
        texts.percent.visible = readout.kind === 'shield'
            || readout.kind === 'armor';
        if (readout.kind === 'shield' || readout.kind === 'armor') {
            texts.percent.text = `${String(readout.percent)}%`;
        }

        if (shipGraphic) {
            const shipContainer = shipGraphic?.container;
            const width = shipGraphic.size.x;
            const height = shipGraphic.size.y;

            // Reuse the cached RenderTexture across frames; only reallocate
            // (destroying the old one and its base texture) when the target's
            // size changes. Without this a fresh texture would leak every
            // display frame while a target is locked.
            let renderTexture = this.renderTexture;
            if (!renderTexture ||
                renderTexture.width !== width ||
                renderTexture.height !== height) {
                renderTexture?.destroy(true);
                const baseRenderTexture = new PIXI.BaseRenderTexture({
                    width, height,
                });
                renderTexture = new PIXI.RenderTexture(baseRenderTexture);
                this.renderTexture = renderTexture;
            }

            shipContainer.setTransform();
            shipContainer.position.x = shipGraphic.size.x / 2;
            shipContainer.position.y = shipGraphic.size.y / 2;
            this.renderer.render(shipContainer, { renderTexture });
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
            this.sprite.visible = false;
        }

    }
    clearTarget() {
        if (!this.texts) {
            return;
        }
        this.container.visible = false;
        this.noTargetContainer.visible = true;
        this.sprite.visible = false;
    }
}

const TargetQuery = new Query([ShipDataComponent, Optional(ShieldComponent),
    Optional(ArmorComponent), Optional(AnimationGraphicComponent),
    Optional(PersComponent), Optional(DisabledComponent),
    Optional(GovtComponent), Optional(PlayerEscortComponent),
    Optional(MissionShipComponent)] as const);
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
                playerEscort, missionShip] = result;
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
                disabled !== undefined, identity.subtitle, government);
        } else {
            // The target exists but the query missed — e.g. a just-replicated
            // ship whose ShipDataComponent isn't in the display world yet. Clear
            // the panel so it doesn't keep showing the previous target's data.
            statusBar.target.clearTarget();
        }
    }
})
