import { Resource } from "nova_ecs/resource";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import type { StatusLine } from "./status_message_plugin.js";

// The status line's resource and its non-system setter, split out of
// status_message_plugin.ts so display modules that status_message_plugin
// itself (transitively) imports can post a line without an import cycle
// (ui_sound_triggers_plugin's refused-jump lines: status_message_plugin ->
// status_bar_docked -> ... -> ship_animation_plugin -> ui_sound_triggers).
// The StatusLine import is type-only, so it is erased at runtime.
// status_message_plugin re-exports both.

export const StatusLineResource = new Resource<StatusLine>('StatusLine');

/**
 * Posts a transient line on the bottom-left status line from display code
 * that isn't an ECS system (rxjs control subscriptions, promise
 * continuations) but holds the display world — the StatusLine twin of
 * ui_sound's playUiSound. A no-op when the plugin isn't built (headless
 * specs), and it never touches the simulation. The systems in
 * status_message_plugin set the line directly with their own
 * `Emit`/TimeResource args; this exists only for the callers that have
 * neither.
 */
export function showStatusMessage(world: World, message: string) {
    world.resources.get(StatusLineResource)?.setMessage(message,
        world.resources.get(TimeResource)?.time ?? 0);
}
