import { Sound } from '@pixi/sound';
import { Plugin } from 'nova_ecs/plugin';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent } from 'nova_ecs/world';
import { DisplayAssetDataResource } from '../nova_plugin/core/game_data_resource.js';
import { PlayerSoundEvent, SoundEvent, SoundEventData } from '../nova_plugin/core/sound_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { PREWARM_UI_SOUNDS, UiSoundEvent } from './ui_sound.js';
import { SoundStartLimiter } from './sound_limiter.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';

const LoopingSounds = new Resource<Map<string, Sound>>('LoopingSounds');
const VolumeResource = new Resource<{volume: number}>('VolumeResource');
/**
 * Caps how many instances of one sound start per frame, shared by all
 * three channels below so a sound played on two of them in the same
 * frame still counts once against the cap. See sound_limiter.ts.
 */
const SoundLimiterResource =
    new Resource<SoundStartLimiter>('SoundLimiterResource');

function playSound({ id, loop, stop }: SoundEventData,
    displayAssets: DisplayAssetDataInterface,
    loopingSounds: Map<string, Sound>, volume: number,
    limiter: SoundStartLimiter, frame: number) {
    if (stop) {
        // Cut the sound off (e.g. the warp-up must not ring out over
        // the system the ship just jumped into). Never limited: silencing
        // must always be allowed to happen.
        displayAssets.data.Sound.getCached(id)?.stop();
        loopingSounds.delete(id);
        return;
    }
    if (loop && loopingSounds.has(id)) {
        return;
    }

    const maybeSound = displayAssets.data.Sound.getCached(id);
    if (maybeSound) {
        // Looping sounds are already deduped by loopingSounds above (one
        // instance per id at a time), so only one-shot starts — the ones
        // that stack — go through the limiter.
        if (!loop && !limiter.allow(id, frame)) {
            return;
        }
        maybeSound.volume = volume;
        if (loop) {
            loopingSounds.set(id, maybeSound);
            // The loop has to be asked for PER PLAY. @pixi/sound's
            // play(callback) overload builds `{ complete }` and merges it
            // over `{ loop: false, ... }` (Sound.play; the Sound's own
            // `loop` is consulted only for the string/sprite overload),
            // so a bare callback started every "loop" as a one-shot: the
            // player's death loop (snd 371, 0.46 s) went silent for the
            // rest of a death sequence up to 8 s long. The option is per
            // instance, so the shared cached Sound is left untouched.
            // A looping instance never completes; `complete` is kept for
            // the day one is stopped by something other than the stop
            // path above, which already clears the map itself.
            maybeSound.play({
                loop: true,
                complete: () => {
                    loopingSounds.delete(id);
                },
            });
        } else {
            maybeSound.play();
        }
    }
}

const SoundSystem = new System({
    name: 'SoundSystem',
    events: [SoundEvent],
    args: [SoundEvent, DisplayAssetDataResource, LoopingSounds, VolumeResource,
           SoundLimiterResource, TimeResource, SingletonComponent] as const,
    step(sound, displayAssets, loopingSounds, {volume}, limiter, time) {
        playSound(sound, displayAssets, loopingSounds, volume, limiter,
            time.time);
    }
});

/**
 * Plays sounds meant only for the local player's own ship (hyperspace
 * warp-up/warp-out). PlayerSoundEvent is emitted targeted at the
 * originating ship, so this system runs only when that ship carries
 * the local PlayerShipSelector marker — other ships' jumps are silent
 * here, the same filter the jump flash overlay uses. Exported for
 * tests.
 */
export const PlayerSoundSystem = new System({
    name: 'PlayerSoundSystem',
    events: [PlayerSoundEvent],
    args: [PlayerSoundEvent, DisplayAssetDataResource, LoopingSounds,
        VolumeResource, SoundLimiterResource, TimeResource,
        PlayerShipSelector] as const,
    step(sound, displayAssets, loopingSounds, {volume}, limiter, time) {
        playSound(sound, displayAssets, loopingSounds, volume, limiter,
            time.time);
    }
});

/**
 * Plays the local UI/space sounds (interface beeps, first-hostile, the
 * explosion loop, boarding). UiSoundEvent is a display-only channel — never
 * bridged to peers — so this is the single place those client-local cues are
 * turned into audio, reusing the same loop/stop/volume machinery as the
 * networked channels. Exported for tests.
 */
export const UiSoundSystem = new System({
    name: 'UiSoundSystem',
    events: [UiSoundEvent],
    args: [UiSoundEvent, DisplayAssetDataResource, LoopingSounds, VolumeResource,
           SoundLimiterResource, TimeResource, SingletonComponent] as const,
    step(sound, displayAssets, loopingSounds, {volume}, limiter, time) {
        playSound(sound, displayAssets, loopingSounds, volume, limiter,
            time.time);
    }
});

export const SoundPlugin: Plugin = {
    name: 'SoundPlugin',
    build(world) {
        world.resources.set(LoopingSounds, new Map());
        world.resources.set(VolumeResource, {volume: 0.045});
        world.resources.set(SoundLimiterResource, new SoundStartLimiter());
        world.addSystem(SoundSystem);
        world.addSystem(PlayerSoundSystem);
        world.addSystem(UiSoundSystem);

        // Pre-warm the static UI/space sounds so the first beep/cue isn't
        // silent while the asset streams in (playSound reads getCached).
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        for (const id of PREWARM_UI_SOUNDS) {
            displayAssets?.data.Sound.get(id);
        }
    },
    remove(world) {
        world.removeSystem(UiSoundSystem);
        world.removeSystem(PlayerSoundSystem);
        world.removeSystem(SoundSystem);
        world.resources.delete(SoundLimiterResource);
        world.resources.delete(VolumeResource);
        // Now that loops really loop, a loop still running when this
        // world is torn down (a system change mid-death, say) would ring
        // forever with nothing left to stop it. The systems that started
        // them are gone with the world, so silence them here.
        const loopingSounds = world.resources.get(LoopingSounds);
        if (loopingSounds) {
            for (const sound of loopingSounds.values()) {
                sound.stop();
            }
            loopingSounds.clear();
        }
        world.resources.delete(LoopingSounds);
    }
}
