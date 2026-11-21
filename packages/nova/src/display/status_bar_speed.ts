import { StatusBarData } from "novadatainterface/status_bar_data";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import type { RoomSpeedStatus } from "../communication/simulation_frame.js";
import { speedReadout, SpeedReadout } from "./status_bar_content.js";
import { DrawDockedStatus } from "./status_bar_docked.js";
import { StatusBarFonts } from "./status_bar_layout.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * Latest room speed status delivered by the simulation bridge
 * (`SimulationFrame.roomSpeed`, #371). Display-only; written by the frame
 * pump and read by {@link DrawStatusBarSpeed}.
 */
export const RoomSpeedResource =
    new Resource<{ status?: RoomSpeedStatus }>('RoomSpeed');

/**
 * The room-speed indicator on the status bar: sits centred near the bottom
 * of the radar pane (inside the 176px radar width so it never widens the
 * bar or collides with other panels), hidden during normal 1x play.
 */
export class SpeedPane {
    /** Per-build; undefined between an ïntf reload's teardown and rebuild. */
    private text?: PIXI.Text;
    private styles?: { bright: PIXI.TextStyle, dim: PIXI.TextStyle };
    private lastKey?: string;

    build(parent: PIXI.Container, data: StatusBarData, fonts: StatusBarFonts) {
        const radar = data.dataAreas.radar;
        const subtitleSize = data.subtitleSize || 10;
        const dim = new PIXI.TextStyle({
            fontFamily: 'Geneva',
            fontSize: subtitleSize,
            align: 'center',
            fill: data.colors.dimText,
        });
        const text = new PIXI.Text('', fonts.bright);
        text.name = 'SpeedIndicator';
        text.anchor.set(0.5, 1);
        text.position.set(
            radar.position[0] + radar.size[0] / 2,
            radar.position[1] + radar.size[1] - 4,
        );
        text.visible = false;
        parent.addChild(text);

        this.text = text;
        this.styles = { bright: fonts.bright, dim };
    }

    /** Destroys this build's text ahead of an ïntf reload rebuild. */
    reset() {
        this.text?.destroy();
        this.text = undefined;
        this.styles = undefined;
        this.lastKey = undefined;
    }

    destroy() {
        if (this.text && !this.text.destroyed) {
            this.text.destroy();
        }
        this.text = undefined;
        this.styles = undefined;
    }

    drawSpeed(readout: SpeedReadout | null) {
        if (!this.text || !this.styles) {
            return;
        }
        const key = readout ? `${readout.text}|${readout.dim}` : '';
        if (key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        if (!readout) {
            this.text.visible = false;
            this.text.text = '';
            return;
        }
        this.text.text = readout.text;
        this.text.style = readout.dim ? this.styles.dim : this.styles.bright;
        this.text.visible = true;
    }
}

/**
 * Updates the status bar's 2x speed indicator every display step. Runs on
 * the singleton (not gated on PlayerShipSelector) so the indicator stays
 * accurate both in space and while docked.
 */
export const DrawStatusBarSpeed = new System({
    name: 'DrawStatusBarSpeed',
    args: [StatusBarResource, RoomSpeedResource, SingletonComponent] as const,
    step(statusBar, speedHolder) {
        statusBar.speed.drawSpeed(speedReadout(speedHolder.status));
    },
    after: [DrawDockedStatus],
});
