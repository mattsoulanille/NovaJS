import { Resource } from "nova_ecs/resource";
import type { StatusBar } from "./status_bar.js";

/**
 * The bar every DrawStatusBar* system writes to. Lives in its own module,
 * with a TYPE-ONLY import of the class, so the per-pane system modules
 * (status_bar_radar.ts, status_bar_cargo.ts, ...) can name it at module
 * top level without a runtime import cycle back through status_bar.ts —
 * which imports THEM to assemble the plugin.
 */
export const StatusBarResource = new Resource<StatusBar>('StatusBar');
