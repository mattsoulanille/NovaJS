import type { IMediaInstance, Sound } from '@pixi/sound';
import { RunQuery } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import {
    DisplayAssetDataResource, PlayerSoundEvent, SimulationGameDataResource,
    SoundEvent, SoundEventData,
} from '../nova_plugin/core/index.js';
import { BeamDataComponent } from '../nova_plugin/combat/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { WeaponsStateComponent } from '../nova_plugin/ship/index.js';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { PREWARM_UI_SOUNDS, UiSoundEvent } from './ui_sound.js';
import { SoundStartLimiter } from './sound_limiter.js';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import {
    defaultSimulationTime, SimulationTimeResource,
} from './simulation_time.js';
import {
    LoopDemandResource, loopDemand, LoopPlayback, LoopVoice, wantedWeaponLoops,
} from './looping_sounds.js';

/**
 * The loops this display world is playing, one per sound id, reconciled
 * every frame against the loops that should be playing (see
 * looping_sounds.ts). Exported for tests and the headless harness.
 */
export const LoopingSounds = new Resource<LoopPlayback>('LoopingSounds');
const VolumeResource = new Resource<{volume: number}>('VolumeResource');
/**
 * Caps how many instances of one sound start per frame, shared by all
 * three channels below so a sound played on two of them in the same
 * frame still counts once against the cap. See sound_limiter.ts.
 */
const SoundLimiterResource =
    new Resource<SoundStartLimiter>('SoundLimiterResource');
/**
 * Sound ids that arrived this frame as a bridged `{ loop: true }` event.
 * Weapon loops are derived from state, so the event itself starts
 * nothing — but a loop-flagged sound the state does not cover (a
 * submunition's: it is fired by a projectile, which has no WeaponsState)
 * is still heard, as a one-shot per shot ("played repeatedly"), never as
 * a loop nothing could stop. Settled by LoopReconcileSystem.
 */
const LoopEventsResource = new Resource<Set<string>>('LoopEvents');
/** Detaches the page visibility/focus listeners at teardown. */
const DetachListenersResource = new Resource<() => void>('SoundListeners');

/** Owner key a `UiSoundEvent { loop: true }` holds its loop under. */
function uiLoopOwner(id: string) {
    return `ui:${id}`;
}

/**
 * Starts `sound` as a loop and wraps the instance as a LoopVoice.
 *
 * Stopping is the subtle part. @pixi/sound pauses every instance when the
 * window blurs (its WebAudioContext autoPause) by dropping the instance's
 * source node, and `stop()` on an instance without one is a no-op — the
 * instance would then resume, still looping, on focus. So `stop` first
 * un-pauses the instance (if the context runs, that gives it a source
 * again, and the stop in the same task means nothing is heard), and if it
 * is STILL there pins it paused at the instance level, where a global
 * resume cannot wake it, and reports failure so LoopPlayback retries.
 */
function startPixiLoop(sound: Sound, volume: number): LoopVoice | undefined {
    if (!sound.isLoaded) {
        // play() on an unloaded Sound returns a promise and starts a loop
        // later that nothing tracks. getCached only hands out loaded
        // sounds, so this is a guard, not a path.
        return undefined;
    }
    sound.volume = volume;
    // The loop has to be asked for PER PLAY: @pixi/sound's play(callback)
    // overload merges `{ complete }` over `{ loop: false }` (Sound.play;
    // the Sound's own `loop` is consulted only for the sprite overload).
    // The option is per instance, so the shared cached Sound is untouched.
    const instance = sound.play({ loop: true }) as IMediaInstance;
    const present = () => sound.instances.includes(instance);
    return {
        // `loop` too: a stopped instance goes back to @pixi/sound's pool
        // and may be handed out again for a one-shot of the same sound.
        alive: () => present() && instance.loop,
        stop: () => {
            if (!present()) {
                return true;
            }
            instance.paused = false;
            instance.stop();
            if (present()) {
                instance.paused = true;
                return false;
            }
            return true;
        },
    };
}

function playOneShot(id: string, displayAssets: DisplayAssetDataInterface,
    volume: number, limiter: SoundStartLimiter, frame: number) {
    const maybeSound = displayAssets.data.Sound.getCached(id);
    if (maybeSound && limiter.allow(id, frame)) {
        maybeSound.volume = volume;
        maybeSound.play();
    }
}

/**
 * Cut a sound off (e.g. the warp-up must not ring out over the system the
 * ship just jumped into). Never limited: silencing must always be allowed
 * to happen. @pixi/sound stops every instance of the sound, so a loop of
 * the same id stops too — LoopPlayback notices and restarts it next frame
 * if it is still wanted.
 */
function stopSound(id: string, displayAssets: DisplayAssetDataInterface) {
    displayAssets.data.Sound.getCached(id)?.stop();
}

/** The bridged channels: one-shots play, stops stop, loops are noted. */
function handleBridgedSound({ id, loop, stop }: SoundEventData,
    displayAssets: DisplayAssetDataInterface, volume: number,
    limiter: SoundStartLimiter, frame: number, loopEvents: Set<string>) {
    if (stop) {
        stopSound(id, displayAssets);
    } else if (loop) {
        loopEvents.add(id);
    } else {
        playOneShot(id, displayAssets, volume, limiter, frame);
    }
}

const SoundSystem = new System({
    name: 'SoundSystem',
    events: [SoundEvent],
    args: [SoundEvent, DisplayAssetDataResource, VolumeResource,
           SoundLimiterResource, TimeResource, LoopEventsResource,
           SingletonComponent] as const,
    step(sound, displayAssets, {volume}, limiter, time, loopEvents) {
        handleBridgedSound(sound, displayAssets, volume, limiter, time.time,
            loopEvents);
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
    args: [PlayerSoundEvent, DisplayAssetDataResource, VolumeResource,
        SoundLimiterResource, TimeResource, LoopEventsResource,
        PlayerShipSelector] as const,
    step(sound, displayAssets, {volume}, limiter, time, loopEvents) {
        handleBridgedSound(sound, displayAssets, volume, limiter, time.time,
            loopEvents);
    }
});

/**
 * Plays the local UI/space sounds (interface beeps, first-hostile,
 * boarding). UiSoundEvent is a display-only channel — never bridged to
 * peers — so this is the single place those client-local cues are turned
 * into audio. A `{ loop: true }` holds a loop demand for its id until the
 * matching `{ stop: true }` (the spaceport ambient); both are display-
 * local, so neither can be lost on the way. Exported for tests.
 */
export const UiSoundSystem = new System({
    name: 'UiSoundSystem',
    events: [UiSoundEvent],
    args: [UiSoundEvent, DisplayAssetDataResource, VolumeResource,
           SoundLimiterResource, TimeResource, LoopDemandResource,
           SingletonComponent] as const,
    step({ id, loop, stop }, displayAssets, {volume}, limiter, time, demand) {
        if (stop) {
            demand.delete(uiLoopOwner(id));
            stopSound(id, displayAssets);
        } else if (loop) {
            demand.set(uiLoopOwner(id), id);
        } else {
            playOneShot(id, displayAssets, volume, limiter, time.time);
        }
    }
});

const ShipWeaponsQuery = new Query([WeaponsStateComponent] as const,
    'LoopShipWeapons');
const BeamsQuery = new Query([BeamDataComponent] as const, 'LoopBeams');

/**
 * Every frame: derive the loops that should be playing and make the
 * playing set match (looping_sounds.ts). Then settle this frame's bridged
 * `{ loop: true }` events: one that the state already covers is the loop
 * just reconciled; any other plays once.
 */
export const LoopReconcileSystem = new System({
    name: 'LoopReconcileSystem',
    args: [LoopingSounds, LoopDemandResource, LoopEventsResource, RunQuery,
        SimulationTimeResource, Optional(SimulationGameDataResource),
        DisplayAssetDataResource, VolumeResource, SoundLimiterResource,
        TimeResource, SingletonComponent] as const,
    step(playback, demand, loopEvents, runQuery, simTime, gameData,
        displayAssets, {volume}, limiter, time) {
        const wanted = wantedWeaponLoops(
            runQuery(ShipWeaponsQuery).map(([weapons]) => weapons),
            runQuery(BeamsQuery).map(([beam]) => beam),
            simTime.time,
            id => gameData?.data.Weapon.getCached(id));
        for (const id of demand.values()) {
            wanted.add(id);
        }
        for (const id of wanted) {
            // Not loaded yet: start loading, so the loop starts a few
            // frames late instead of being silent for the whole run.
            if (!displayAssets.data.Sound.getCached(id)) {
                displayAssets.data.Sound.get(id).catch(() => { });
            }
        }
        playback.reconcile(wanted);

        for (const id of loopEvents) {
            if (!wanted.has(id)) {
                playOneShot(id, displayAssets, volume, limiter, time.time);
            }
        }
        loopEvents.clear();
    },
});

/**
 * Stop every loop (the next frame's reconciliation restarts whatever is
 * still wanted). Called when the page's visibility or focus changes:
 * @pixi/sound pauses its context on blur and, on focus, re-plays each
 * paused instance with `loopStart` set to where it was paused and no
 * `loopEnd` — so from then on the instance loops only the TAIL of its
 * sample, a shorter period for every sound (measured in headless Chrome
 * for #355: snd 225, 2.43 s, came back looping 2.19 s..end). Stopping and
 * restarting from the top puts every loop back on its real period.
 * Exported for tests.
 */
export function restartLoops(world: World) {
    world.resources.get(LoopingSounds)?.stopAll();
}

export const SoundPlugin: Plugin = {
    name: 'SoundPlugin',
    build(world) {
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        world.resources.set(VolumeResource, {volume: 0.045});
        world.resources.set(LoopingSounds, new LoopPlayback(id => {
            const sound = displayAssets?.data.Sound.getCached(id);
            return sound ? startPixiLoop(sound,
                world.resources.get(VolumeResource)?.volume ?? 0) : undefined;
        }));
        world.resources.set(SoundLimiterResource, new SoundStartLimiter());
        world.resources.set(LoopEventsResource, new Set());
        loopDemand(world);
        if (!world.resources.has(SimulationTimeResource)) {
            world.resources.set(SimulationTimeResource,
                defaultSimulationTime());
        }
        world.addSystem(SoundSystem);
        world.addSystem(PlayerSoundSystem);
        world.addSystem(UiSoundSystem);
        world.addSystem(LoopReconcileSystem);

        // The listeners are added after @pixi/sound's own (its context
        // registers focus/blur when the library loads), so on focus the
        // instances it has just resumed are the ones stopped here.
        if (typeof window !== 'undefined'
            && typeof document !== 'undefined') {
            const restart = () => restartLoops(world);
            window.addEventListener('focus', restart);
            document.addEventListener('visibilitychange', restart);
            world.resources.set(DetachListenersResource, () => {
                window.removeEventListener('focus', restart);
                document.removeEventListener('visibilitychange', restart);
            });
        }

        // Pre-warm the static UI/space sounds so the first beep/cue isn't
        // silent while the asset streams in (playOneShot reads getCached).
        for (const id of PREWARM_UI_SOUNDS) {
            displayAssets?.data.Sound.get(id);
        }
    },
    remove(world) {
        world.resources.get(DetachListenersResource)?.();
        world.resources.delete(DetachListenersResource);
        world.removeSystem(LoopReconcileSystem);
        world.removeSystem(UiSoundSystem);
        world.removeSystem(PlayerSoundSystem);
        world.removeSystem(SoundSystem);
        world.resources.delete(SoundLimiterResource);
        world.resources.delete(VolumeResource);
        world.resources.delete(LoopEventsResource);
        // A loop still running when this world is torn down (a system
        // change mid-fire, mid-death) would ring forever with nothing
        // left to reconcile it. Silence them here. One whose stop cannot
        // take yet (the window is blurred) is left pinned paused at the
        // instance level, so @pixi/sound's resume on focus cannot wake it.
        world.resources.get(LoopingSounds)?.stopAll();
        world.resources.delete(LoopingSounds);
    }
}
