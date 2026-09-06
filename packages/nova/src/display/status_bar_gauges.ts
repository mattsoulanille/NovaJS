import { Optional } from "nova_ecs/optional";
import { System } from "nova_ecs/system";
import { ArmorComponent, FuelComponent, ShieldComponent } from "../nova_plugin/health_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
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

export const DrawStatusBarStats = new System({
    name: 'DrawStatusBarStats',
    args: [StatusBarResource, ShieldComponent, ArmorComponent,
        Optional(FuelComponent), PlayerShipSelector] as const,
    step(statusBar, shield, armor, fuel) {
        statusBar.drawStats(shield, armor, fuel);
    }
})
