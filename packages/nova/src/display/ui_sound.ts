import { EcsEvent } from 'nova_ecs/events';
import { World } from 'nova_ecs/world';
import { SoundEventData } from '../nova_plugin/sound_plugin.js';

/**
 * The shared local-UI-sound channel.
 *
 * Every sound emitted here is CLIENT-LOCAL and keyed to the local player's
 * perspective (their target, their map, their own ship's state, hostiles
 * toward them). Unlike SoundEvent / PlayerSoundEvent (nova_plugin/
 * sound_plugin.ts) this event is deliberately NOT registered with the
 * simulation bridge, so it never crosses to peers or the server — it is a
 * pure display-world event handled only by UiSoundSystem (display/
 * sound_plugin.ts), which resolves the snd id through the display audio
 * loader and plays it. Emit it from any display-world system (with `Emit`)
 * or, from a non-system display context that holds the world, via
 * {@link playUiSound}.
 *
 * The payload reuses SoundEventData so one-shot (`{ id }`), looping
 * (`{ id, loop: true }`) and stop (`{ id, stop: true }`) all work exactly
 * as they do on the other sound channels.
 */
export const UiSoundEvent = new EcsEvent<SoundEventData>('UiSoundEvent');

/**
 * Fire-and-forget helper for display code that isn't an ECS system (rxjs
 * control subscriptions, Promise continuations) but holds the display
 * world. Queues a UiSoundEvent; UiSoundSystem plays it on the next step.
 */
export function playUiSound(world: World, sound: SoundEventData) {
    world.emit(UiSoundEvent, sound);
}

// The stock Nova interface "beeps" (snd 150-154, "beeps 1-5"). All are
// local per-player UI cues. Several triggers intentionally share a beep —
// these are the exact assignments Matthew specified, no invented extras.
/** snd 150 "beep 1": a planet/stellar was targeted; the map was closed. */
export const BEEP_TARGET_PLANET = 'nova:150';
/** snd 151 "beep 2": your ship became disabled; the mission-info dialog opened. */
export const BEEP_DISABLED = 'nova:151';
/** snd 152 "beep 3": a ship was targeted; the map was opened; mission-info closed. */
export const BEEP_TARGET_SHIP = 'nova:152';
/** snd 153 "beep 4": "can't do that" (blocked landing/boarding, no secondary
 * weapon, and hyperjump pressed when the jump gate refuses — too close to
 * the system center, out of fuel, or disabled. NOT for an unselected
 * destination: Matthew, 2026-08-15, "doesn't include when you haven't
 * selected a destination"). */
export const BEEP_CANT_DO = 'nova:153';
/** snd 154 "beep 5": a jump became possible (jump route + far enough out). */
export const BEEP_JUMP_READY = 'nova:154';

// Map open/close reuse the ship/planet target beeps (Matthew's assignment).
export const BEEP_MAP_OPEN = BEEP_TARGET_SHIP;   // snd 152
export const BEEP_MAP_CLOSE = BEEP_TARGET_PLANET; // snd 150
// Mission-info dialog open/close.
export const BEEP_MISSION_OPEN = BEEP_DISABLED;      // snd 151
export const BEEP_MISSION_CLOSE = BEEP_TARGET_SHIP;  // snd 152

// Space sounds (non-beep). Also client-local, local-player perspective.
/** snd 370: a ship turned hostile to you while none was hostile before. */
export const SOUND_FIRST_HOSTILE = 'nova:370';
/** snd 371: looped for the duration of your ship's explosion/death sequence. */
export const SOUND_EXPLOSION_LOOP = 'nova:371';
/**
 * snd 390: boarding a (disabled) ship. Playback lives in the boarding
 * plugin (added by the ship-interaction work); kept here only to pre-warm
 * the asset so the first board isn't silent.
 */
export const SOUND_BOARDING = 'nova:390';

/**
 * The static UI/space sounds worth pre-warming at build so the first
 * trigger isn't silent while the asset loads (the spaceport ambient is
 * per-spöb and prewarmed on landing instead). Excludes 372 (escape-pod
 * eject — feature not implemented) and the cloak sounds (owned by the
 * cloak plugin).
 */
export const PREWARM_UI_SOUNDS: readonly string[] = [
    BEEP_TARGET_PLANET, BEEP_DISABLED, BEEP_TARGET_SHIP, BEEP_CANT_DO,
    BEEP_JUMP_READY, SOUND_FIRST_HOSTILE, SOUND_EXPLOSION_LOOP, SOUND_BOARDING,
];
