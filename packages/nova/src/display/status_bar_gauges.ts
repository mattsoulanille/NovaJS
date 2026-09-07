import { StatusBarData, StatusBarDataArea } from "novadatainterface/status_bar_data";
import { Optional } from "nova_ecs/optional";
import { System } from "nova_ecs/system";
import * as PIXI from "pixi.js";
import { ArmorComponent, FuelComponent, FUEL_PER_JUMP, ShieldComponent } from "../nova_plugin/ship/index.js";
import { PlayerShipSelector } from "../nova_plugin/player/index.js";
import { Stat } from "../nova_plugin/core/index.js";
import { StatusBarResource } from "./status_bar_resource.js";

/**
 * How full a stat bar is, in [0, 1]. A stat whose max is 0 — the stock
 * Escape Pod (shïp nova:895) has both shield and armor at 0 — has
 * nothing to be full OF: its bar is empty rather than NaN (0/0), which
 * used to reach PIXI's lineTo through Math.max(0, NaN).
 */
export function statFullness({ current, max }: { current: number, max: number }): number {
    if (!(max > 0)) {
        return 0;
    }
    return Math.max(0, current / max);
}

/**
 * The shield / armor / fuel bars: one Graphics, redrawn every frame from
 * the ïntf's three data areas and bar colours.
 */
export class GaugesPane {
    /** Class-owned, so it survives an ïntf reload (StatusBar.reload keeps it). */
    readonly graphics = new PIXI.Graphics();

    constructor(private data: StatusBarData) { }

    /** A different ïntf: new data areas and colours from the next draw on. */
    reset(data: StatusBarData) {
        this.data = data;
    }

    build(parent: PIXI.Container) {
        parent.addChild(this.graphics);
    }

    private drawLine(dataArea: StatusBarDataArea, color: number, fullness: number) {
        var pos = [dataArea.position[0], dataArea.position[1]];
        var size = [dataArea.size[0], dataArea.size[1]];
        pos[1] += size[1] / 2;

        this.graphics.lineStyle(size[1], color);
        this.graphics.moveTo(pos[0], pos[1]);
        this.graphics.lineTo(pos[0] + size[0] * fullness, pos[1]);
    }

    drawStats(shield: Stat, armor: Stat,
        fuel?: { current: number, max: number }) {
        this.graphics.clear();

        this.drawLine(this.data.dataAreas.shield,
            this.data.colors.shield, statFullness(shield));

        this.drawLine(this.data.dataAreas.armor,
            this.data.colors.armor, statFullness(armor));

        if (fuel && fuel.max > 0) {
            // Partial-jump fuel in the dim color, with the whole jumps'
            // worth (100 units each) drawn over it in the full color.
            const fuelFullness = statFullness(fuel);
            this.drawLine(this.data.dataAreas.fuel,
                this.data.colors.fuelPartial, fuelFullness);
            const fullJumps = Math.max(0, Math.floor(
                fuel.current / FUEL_PER_JUMP) * FUEL_PER_JUMP / fuel.max);
            this.drawLine(this.data.dataAreas.fuel,
                this.data.colors.fuelFull, fullJumps);
        }
    }
}

export const DrawStatusBarStats = new System({
    name: 'DrawStatusBarStats',
    args: [StatusBarResource, ShieldComponent, ArmorComponent,
        Optional(FuelComponent), PlayerShipSelector] as const,
    step(statusBar, shield, armor, fuel) {
        statusBar.gauges.drawStats(shield, armor, fuel);
    }
})
